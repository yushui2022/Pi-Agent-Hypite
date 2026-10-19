import { createAssistantMessageEventStream, getCurrentTools } from '@earendil-works/pi-ai';
import { boundedBytes } from './shared';
export interface AgentEnv {
  P0_TOKEN: string;
  ARTIFACTS: R2Bucket;
  P0_MODEL_MODE?: string;
  P0_MODEL_BASE_URL?: string;
  P0_MODEL_ID?: string;
  P0_MODEL_KEY?: string;
  MODEL_TRANSPORT?: Fetcher;
}
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function model(env: AgentEnv) {
  return { id: env.P0_MODEL_ID || 'p0-protocol-fixture', name: 'P0 transport', api: 'openai-completions', provider: 'p0', baseUrl: env.P0_MODEL_BASE_URL || '',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 512 };
}

// Bounded HTTP adapter; fixture transport tests the same serialization/parsing path.
// No automatic retries: an ambiguous paid request must be reconciled, not resubmitted.
export function transport(env: AgentEnv, requestId: string) {
  return async (_model: any, context: any) => {
    const stream = createAssistantMessageEventStream();
    const base = { role: 'assistant' as const, api: 'openai-completions', provider: 'p0', model: _model.id, usage: structuredClone(zeroUsage), timestamp: Date.now() };
    try {
      const isFixture = env.P0_MODEL_MODE === 'fixture' && !!env.MODEL_TRANSPORT;
      if (!isFixture && (env.P0_MODEL_MODE !== 'live' || !env.P0_MODEL_KEY || !env.P0_MODEL_ID || !env.P0_MODEL_BASE_URL)) throw new Error('Real model transport disabled');
      const url = new URL(isFixture ? 'https://model-fixture.invalid/v1/chat/completions' : env.P0_MODEL_BASE_URL!.replace(/\/$/, '') + '/chat/completions');
      if (url.protocol !== 'https:') throw new Error('Model endpoint must use HTTPS');
      const messages = context.messages.map((message: any) => {
        if (message.role === 'assistant') return { role: 'assistant', content: message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''),
          tool_calls: message.content.filter((c: any) => c.type === 'toolCall').map((c: any) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) };
        if (message.role === 'toolResult') return { role: 'tool', tool_call_id: message.toolCallId, content: JSON.stringify({ isError: message.isError, content: message.content }) };
        return { role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map((c: any) => c.text || '').join('') };
      });
      const body = JSON.stringify({ model: _model.id, stream: false, max_tokens: 512, messages,
        tools: getCurrentTools(context.messages).map((tool: any) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) });
      if (new TextEncoder().encode(body).length > 32_768) throw new Error('Model request exceeds P0 limit');
      const req = new Request(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: {
        'content-type': 'application/json', ...(isFixture ? {} : { authorization: `Bearer ${env.P0_MODEL_KEY}` }), 'idempotency-key': requestId,
      }, body });
      const response = isFixture ? await env.MODEL_TRANSPORT!.fetch(req) : await fetch(req);
      if (!response.ok) throw new Error(`Model HTTP ${response.status}; request requires reconciliation`);
      if (!response.body) throw new Error('Empty model response');
      const data = JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 65_536)));
      const choice = data.choices?.[0];
      if (!choice?.message) throw new Error('Invalid model response');
      const content: any[] = [];
      if (typeof choice.message.content === 'string') content.push({ type: 'text', text: choice.message.content });
      const calls = choice.message.tool_calls || [];
      if (!Array.isArray(calls) || calls.length > 3) throw new Error('Too many model tool calls');
      for (const call of calls) {
        if (typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') throw new Error('Invalid tool envelope');
        content.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) });
      }
      if (!content.length) throw new Error('Empty model completion');
      const message = { ...base, content, stopReason: calls.length ? 'toolUse' as const : 'stop' as const };
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: message.stopReason, message });
    } catch (error) {
      stream.push({ type: 'error', reason: 'error', error: { ...base, content: [], stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error) } });
    }
    return stream;
  };
}
