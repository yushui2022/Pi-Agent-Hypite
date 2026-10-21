// Provider wiring for generation.
//
// Division of labour, fixed by the operator: TokensFactory relays chat and image models
// (pi-agent's model channel + gpt-image-2), AutoDL runs the video workflows. Hypit's own
// generation relays are deliberately not used, so nothing here falls back to them.
//
// Two differences between the services are easy to get wrong and are encoded here:
//   - TokensFactory takes `Authorization: Bearer <key>` and an OpenAI-compatible /v1 base.
//   - AutoDL takes a bare token in `Authorization` (no "Bearer") and its own path layout.
//
// Nothing in this module spends money. The probes only list models and fetch a task that does
// not exist — both free. Real generation is a separate step with its own cost disclosure.

export interface ProviderEnv {
  TOKENSFACTORY_BASE_URL?: string;
  TOKENSFACTORY_API_KEY?: string;
  TOKENSFACTORY_MODEL?: string;
  AUTODL_API_BASE?: string;
  AUTODL_API_KEY?: string;
  AUTODL_WORKFLOW_DEFAULT?: string;
  AUTODL_WORKFLOW_FAST?: string;
}

export const DEFAULT_TOKENSFACTORY_BASE = 'https://tokensfactory.cc';
export const DEFAULT_AUTODL_BASE = 'https://autodl.art';
export const DEFAULT_CHAT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_AUTODL_WORKFLOW = 'minimax_h3_zm_u24';
export const DEFAULT_AUTODL_WORKFLOW_FAST = 'minimax_h3_zm_u08';

const trimBase = (value: string) => value.replace(/\/+$/, '');

/** Configuration state only. Never returns a key, a prefix or a length. */
export function providerStatus(env: ProviderEnv) {
  return {
    tokensFactory: {
      configured: Boolean(env.TOKENSFACTORY_API_KEY),
      baseUrl: trimBase(env.TOKENSFACTORY_BASE_URL ?? DEFAULT_TOKENSFACTORY_BASE),
      chatModel: env.TOKENSFACTORY_MODEL ?? DEFAULT_CHAT_MODEL,
      imageModel: DEFAULT_IMAGE_MODEL,
      role: '对话模型（pi-agent 通道）与图片生成',
    },
    autoDL: {
      configured: Boolean(env.AUTODL_API_KEY),
      baseUrl: trimBase(env.AUTODL_API_BASE ?? DEFAULT_AUTODL_BASE),
      workflowDefault: env.AUTODL_WORKFLOW_DEFAULT ?? DEFAULT_AUTODL_WORKFLOW,
      workflowFast: env.AUTODL_WORKFLOW_FAST ?? DEFAULT_AUTODL_WORKFLOW_FAST,
      role: '视频生成',
    },
  };
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

/** Free: lists the models this key may use, so a wrong key or /v1 duplication shows up here. */
export async function probeTokensFactory(env: ProviderEnv): Promise<ProbeResult> {
  if (!env.TOKENSFACTORY_API_KEY) return { ok: false, error: '未配置 TOKENSFACTORY_API_KEY' };
  const base = trimBase(env.TOKENSFACTORY_BASE_URL ?? DEFAULT_TOKENSFACTORY_BASE);
  try {
    const response = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${env.TOKENSFACTORY_API_KEY}` } });
    if (!response.ok) return { ok: false, status: response.status, error: (await response.text()).slice(0, 200) };
    const payload = (await response.json()) as { data?: { id?: string }[] };
    const ids = (payload.data ?? []).map(entry => entry.id).filter((id): id is string => Boolean(id));
    const chatModel = env.TOKENSFACTORY_MODEL ?? DEFAULT_CHAT_MODEL;
    return {
      ok: true, status: response.status,
      detail: {
        models: ids.length,
        chatModelPresent: ids.includes(chatModel),
        imageModelPresent: ids.includes(DEFAULT_IMAGE_MODEL),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '请求失败' };
  }
}

/** Free: asks for a task that cannot exist. 401 means the token is wrong; 200 means auth passed. */
export async function probeAutoDL(env: ProviderEnv): Promise<ProbeResult> {
  if (!env.AUTODL_API_KEY) return { ok: false, error: '未配置 AUTODL_API_KEY' };
  const base = trimBase(env.AUTODL_API_BASE ?? DEFAULT_AUTODL_BASE);
  const url = `${base}/api/v1/comfyui/comfyui_workflow/result/00000000-0000-0000-0000-000000000000`;
  try {
    // No "Bearer" prefix: AutoDL reads the raw token, unlike TokensFactory.
    const response = await fetch(url, { headers: { Authorization: env.AUTODL_API_KEY } });
    if (response.status === 401) return { ok: false, status: 401, error: '令牌被拒绝' };
    if (!response.ok) return { ok: false, status: response.status, error: (await response.text()).slice(0, 200) };
    const payload = (await response.json().catch(() => ({}))) as { code?: string; msg?: string };
    return {
      ok: true, status: response.status,
      detail: {
        workflowDefault: env.AUTODL_WORKFLOW_DEFAULT ?? DEFAULT_AUTODL_WORKFLOW,
        workflowFast: env.AUTODL_WORKFLOW_FAST ?? DEFAULT_AUTODL_WORKFLOW_FAST,
        // The expected business answer for a random id; presence proves the token authenticated.
        probeAnswer: payload.code ?? null,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '请求失败' };
  }
}
