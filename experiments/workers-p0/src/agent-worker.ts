import { runAgentLoop, runAgentLoopContinue } from '@pi/agent';
import Type from 'typebox';
import { Settings } from 'typebox/system';
import { authorize, bodyJson, failure, json, Problem, runId } from './shared';
import { transport, model, type AgentEnv } from './model-transport';

// Explicitly use the interpreted validator: no request-time new Function/eval.
Settings.Set({ useAcceleration: false });
let busy = false;
export default {
  async fetch(request: Request, env: AgentEnv) {
    try {
      authorize(request, env);
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST' || !['/start', '/resume'].includes(path)) throw new Problem(404, 'Unknown Pi experiment route');
      const { id: rawId, scenario = 'valid' } = await bodyJson(request);
      const id = runId(rawId);
      if (!['valid', 'invalid', 'unknown', 'denied'].includes(scenario)) throw new Problem(400, 'Unknown fixture scenario');
      if (env.P0_MODEL_MODE !== 'fixture') throw new Problem(503, 'Live model validation awaits configured account/model/budget; P0 route accepts fixture mode only');
      if (busy) throw new Problem(429, 'Pi experiment already running');
      busy = true;
      try {
        const key = `pi/${id}/checkpoint.json`;
        const existingObject = await env.ARTIFACTS.get(key);
        const existing: any = existingObject ? await existingObject.json() : null;
        if (existing && existing.scenario !== scenario) throw new Problem(409, 'Run id already belongs to another scenario');
        if (path === '/start' && existing) return json(existing);
        if (path === '/resume' && !existing) throw new Problem(409, 'No checkpoint');
        if (path === '/resume' && existing?.state === 'complete') return json(existing);
        if (path === '/resume' && existing?.state !== 'awaiting-continuation') throw new Problem(409, 'Run cannot resume automatically');
        // A durable intent survives a failure before checkpointing. Such runs require review.
        const intent = await env.ARTIFACTS.get(`pi/${id}/${path.slice(1)}-intent.json`);
        if (intent) throw new Problem(409, 'Outcome unknown; reconcile before resubmitting');
        await env.ARTIFACTS.put(`pi/${id}/${path.slice(1)}-intent.json`, JSON.stringify({ id, scenario, at: new Date().toISOString() }));
        let toolExecutions = existing?.toolExecutions || 0;
        const tools = [{
          name: 'inspect_asset', label: 'Inspect registered fixture', description: 'Read only a registered asset reference. No arbitrary paths.',
          parameters: Type.Object({ assetId: Type.String({ minLength: 1, maxLength: 32 }) }, { additionalProperties: false }),
          async execute(_callId: string, raw: unknown) {
            if (!raw || typeof raw !== 'object' || !('assetId' in raw) || typeof raw.assetId !== 'string') throw new Error('Invalid asset arguments');
            const args = raw as { assetId: string };
            if (args.assetId !== 'fixture-shot-1') throw new Error('Asset is outside the authorized fixture scope');
            toolExecutions++;
            return { content: [{ type: 'text' as const, text: JSON.stringify({ assetId: args.assetId, durationFrames: 125, width: 720, height: 1280 }) }], details: { assetId: args.assetId } };
          },
        }];
        const events: string[] = [];
        const context = { messages: existing?.messages || [], tools };
        const configuration = {
          model: model(env), convertToLlm: (messages: any[]) => messages, toolExecution: 'sequential' as const,
          finishTurn: async (turn: any) => {
            const errored = turn.message.stopReason === 'error' || turn.toolResults.some((r: any) => r.isError);
            const state = errored ? 'failed' : turn.toolResults.length ? 'awaiting-continuation' : 'complete';
            await env.ARTIFACTS.put(key, JSON.stringify({ schema: 'pi-p0-checkpoint@1', id, scenario, state, messages: turn.context.messages, toolExecutions,
              provider: 'fixture', liveModelAccepted: false, cost: null, events }));
            return { action: 'end' as const };
          },
        };
        const emit = (event: any) => { events.push(event.type); };
        const stream = transport(env, `pi-p0:${id}:${path.slice(1)}`);
        if (path === '/start') await runAgentLoop([{ role: 'user', content: `P0 fixture scenario: ${scenario}`, timestamp: Date.now() }], context, configuration as any, emit, undefined, stream);
        else await runAgentLoopContinue(context, configuration as any, emit, undefined, stream);
        const object = await env.ARTIFACTS.get(key);
        if (!object) throw new Error('Pi produced no durable checkpoint');
        return json(await object.json());
      } finally { busy = false; }
    } catch (error) { return failure(error); }
  },
};
