// Video generation through AutoDL's MiniMax H3 workflows.
//
// The parameter spec below was read from the workflow itself (GET /api/v1/comfyui/workflows/{id}),
// not guessed: prompt, ref_image_0..8, ref_audio_0..2, duration, resolution, seed.
//
// Two facts worth keeping in mind:
//   - There is no reference-video field. Motion cannot be handed over as footage; it has to be
//     described in the prompt. Anyone expecting frame-level copying of the original clip will be
//     disappointed, and that is a platform limit, not a bug here.
//   - Resolution is an enum of Chinese labels ("768p竖" and friends), not a pixel value.
//
// Billing from the same response: 480p costs 40 per task (30 off-peak), 768p costs 50 (40).
// This module never submits by itself; the caller decides, and the route is explicit.

export interface VideoEnv {
  AUTODL_API_BASE?: string;
  AUTODL_API_KEY?: string;
  AUTODL_WORKFLOW_DEFAULT?: string;
  AUTODL_WORKFLOW_FAST?: string;
}

export const AUTODL_RESOLUTIONS = ['480p横', '480p竖', '768p横', '768p竖', '480p(1:1)', '768p(1:1)'] as const;
export type AutoDLResolution = typeof AUTODL_RESOLUTIONS[number];

export interface VideoRequest {
  variant?: 'default' | 'fast';
  prompt: string;
  /** Object URLs reachable by AutoDL. At least one is required by the workflow. */
  images: string[];
  audio?: string[];
  duration?: number;
  resolution?: AutoDLResolution;
  seed?: number;
}

export interface VideoTask {
  taskId: string;
  status?: string;
  videoUrl?: string;
  raw?: unknown;
}

const trimBase = (value: string) => value.replace(/\/+$/, '');
const baseOf = (env: VideoEnv) => trimBase(env.AUTODL_API_BASE ?? 'https://autodl.art');
const workflowOf = (env: VideoEnv, variant: 'default' | 'fast') => variant === 'fast'
  ? env.AUTODL_WORKFLOW_FAST ?? 'minimax_h3_zm_u08'
  : env.AUTODL_WORKFLOW_DEFAULT ?? 'minimax_h3_zm_u24';

/** Validates against the workflow's own rules so a bad request costs nothing. */
export function buildPayload(request: VideoRequest): Record<string, unknown> {
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (!prompt || prompt.length > 20_000) throw new Error('提示词需为 1–20000 个字符');
  const images = (request.images ?? []).filter(url => typeof url === 'string' && /^https:\/\//.test(url));
  if (!images.length) throw new Error('至少需要 1 张参考图片（ref_image_0 必填）');
  if (images.length > 9) throw new Error('最多 9 张参考图片');
  const audio = (request.audio ?? []).filter(url => typeof url === 'string' && /^https:\/\//.test(url));
  if (audio.length > 3) throw new Error('最多 3 段参考音频');
  const duration = request.duration ?? 5;
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) throw new Error('时长需为 1–15 的整数秒');
  const resolution = request.resolution ?? '768p竖';
  if (!AUTODL_RESOLUTIONS.includes(resolution)) throw new Error(`分辨率只能是：${AUTODL_RESOLUTIONS.join('、')}`);

  const payload: Record<string, unknown> = { prompt, duration, resolution };
  images.forEach((url, index) => { payload[`ref_image_${index}`] = url; });
  audio.forEach((url, index) => { payload[`ref_audio_${index}`] = url; });
  if (Number.isInteger(request.seed) && request.seed! >= 0) payload.seed = request.seed;
  return payload;
}

/** The task id is returned immediately and must be stored: resubmitting bills again. */
export async function submitVideo(env: VideoEnv, request: VideoRequest): Promise<VideoTask> {
  if (!env.AUTODL_API_KEY) throw new Error('未配置 AUTODL_API_KEY');
  const payload = buildPayload(request);
  const workflow = workflowOf(env, request.variant ?? 'default');
  const response = await fetch(`${baseOf(env)}/api/v1/comfyui/comfyui_workflow/${workflow}`, {
    method: 'POST',
    // AutoDL reads the raw token; adding "Bearer" here breaks auth.
    headers: { Authorization: env.AUTODL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as { code?: string; msg?: string; data?: { task_id?: string } };
  if (!response.ok || data.code !== 'Success' || !data.data?.task_id) {
    throw new Error(`提交失败（${data.code ?? response.status}）：${data.msg ?? '未知错误'}`);
  }
  return { taskId: data.data.task_id, status: 'submitted', raw: data };
}

export async function pollVideo(env: VideoEnv, taskId: string): Promise<VideoTask> {
  if (!env.AUTODL_API_KEY) throw new Error('未配置 AUTODL_API_KEY');
  if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error('任务编号无效');
  const response = await fetch(`${baseOf(env)}/api/v1/comfyui/comfyui_workflow/result/${taskId}`, {
    headers: { Authorization: env.AUTODL_API_KEY },
  });
  const data = (await response.json().catch(() => ({}))) as {
    code?: string; msg?: string;
    data?: { status?: string; results?: { url?: string; type?: string }[] };
  };
  if (!response.ok) throw new Error(`查询失败 HTTP ${response.status}`);
  const results = data.data?.results ?? [];
  const video = results.find(item => item.type === 'video' || /\.mp4$/i.test(item.url ?? ''));
  return { taskId, status: data.data?.status, videoUrl: video?.url, raw: data };
}
