// Restricted local P0 contract, not the production ProjectSpec or scheduler.
export type Input = { name: string; sha256: string };
export type Spec = {
  schema: 'pi-studio.p0-project@1';
  shots: { source: string; startSeconds: number; caption: string }[];
  inputs: Input[];
};
type Step = { id: string; operation: string; key: string; dependencies: string[]; caption?: string; startSeconds?: number };
export type Plan = { schema: string; key: string; engine: string; spec: Spec; steps: Step[] };
export type Artifact = { name: string; sha256: string; outputBytes: number };
export type Journal = { planKey: string; status: 'running' | 'failed' | 'complete'; steps: Record<string, { key: string; artifact: Artifact }>; error?: string };
const names = ['shot-1.mp4', 'shot-2.mp4', 'shot-3.mp4', 'voice.wav', 'music.wav', 'font.ttf'];
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map(n => n.toString(16).padStart(2, '0')).join('');
function fields(value: object, expected: string[]) {
  if (!value || Object.keys(value).some(key => !expected.includes(key))) throw new Error('Unsupported project field');
}

export async function compileProject(source: Spec, engine: string): Promise<Plan> {
  const spec = structuredClone(source);
  fields(spec, ['schema', 'shots', 'inputs']);
  if (spec.schema !== 'pi-studio.p0-project@1' || !Array.isArray(spec.shots) || spec.shots.length !== 3 ||
      !Array.isArray(spec.inputs) || spec.inputs.length !== 6 || !/^[a-f0-9]{64}$/.test(engine)) throw new Error('Invalid P0 project or engine fingerprint');
  for (const input of spec.inputs) {
    fields(input, ['name', 'sha256']);
    if (!names.includes(input.name) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid input reference');
  }
  if (new Set(spec.inputs.map(input => input.name)).size !== 6) throw new Error('Duplicate input reference');
  spec.inputs.sort((a, b) => a.name.localeCompare(b.name));
  const inputHash = (name: string) => spec.inputs.find(input => input.name === name)!.sha256;
  const steps: Step[] = [];
  for (const [i, shot] of spec.shots.entries()) {
    fields(shot, ['source', 'startSeconds', 'caption']);
    if (shot.source !== `shot-${i + 1}.mp4` || !Number.isFinite(shot.startSeconds) || shot.startSeconds < 0 || shot.startSeconds > 55 ||
        Math.abs(shot.startSeconds * 25 - Math.round(shot.startSeconds * 25)) > 1e-6) throw new Error('Invalid shot source or frame boundary');
    if (typeof shot.caption !== 'string' || !shot.caption.trim() || shot.caption.split('\n').length > 2 ||
        shot.caption.split('\n').some(line => !line.trim() || [...line].length > 15)) throw new Error('Invalid caption');
    const operation = `normalize-${i + 1}`;
    steps.push({ id: operation, operation, dependencies: [], caption: shot.caption, startSeconds: shot.startSeconds,
      key: await digest({ engine, operation, shot, video: inputHash(shot.source), font: inputHash('font.ttf') }) });
  }
  steps.push({ id: 'final', operation: 'final', dependencies: steps.map(step => step.id),
    key: await digest({ engine, profile: 'hard-cut-3x5s-720p25-fixed-mix@1', shots: steps.map(step => step.key), voice: inputHash('voice.wav'), music: inputHash('music.wav') }) });
  return { schema: 'pi-studio.p0-execution@1', key: await digest({ engine, spec }), engine, spec, steps };
}

// Caller must serialize runs and provide durable save plus independent artifact checks.
// No supplier requests are made here; retries are safe only for these local media operations.
export async function executePlan(plan: Plan, previous: Journal | undefined, io: {
  save: (journal: Journal) => Promise<void>;
  execute: (step: Step) => Promise<Artifact>;
  verify: (artifact: Artifact) => Promise<boolean>;
  validateFinal: (artifact: Artifact) => Promise<void>;
}): Promise<Journal> {
  const journal: Journal = { planKey: plan.key, status: 'running', steps: {} };
  try {
    await io.save(structuredClone(journal));
    for (const step of plan.steps) {
      if (step.dependencies.some(id => !journal.steps[id])) throw new Error('Unresolved dependency');
      const old = previous?.steps[step.id];
      let artifact: Artifact;
      if (old?.key === step.key && await io.verify(old.artifact)) artifact = old.artifact;
      else {
        artifact = await io.execute(step);
        const expectedName = step.id === 'final' ? 'final.mp4' : step.id.replace('normalize-', 'render-') + '.mp4';
        if (artifact.name !== expectedName || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.outputBytes) ||
            artifact.outputBytes <= 0 || !await io.verify(artifact)) throw new Error(`Artifact verification failed: ${step.id}`);
      }
      journal.steps[step.id] = { key: step.key, artifact };
      await io.save(structuredClone(journal));
    }
    await io.validateFinal(journal.steps.final.artifact);
    journal.status = 'complete';
    await io.save(structuredClone(journal));
    return journal;
  } catch (error) {
    journal.status = 'failed';
    journal.error = error instanceof Error ? error.message : 'Execution failed';
    await io.save(structuredClone(journal));
    throw error;
  }
}
