import { parseSse, request, trimSlashes } from './http.ts';
import { ProviderError } from './types.ts';
import type { ChatEvent, ChatRequest, ModelInfo, ProviderAdapter } from './types.ts';

interface StreamChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | string;
}

/** Adapter for any API that implements OpenAI's /chat/completions and /models. */
export function openaiAdapter(baseUrl: string, apiKey: string | null): ProviderAdapter {
  const base = trimSlashes(baseUrl);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    async listModels(signal) {
      const res = await request(`${base}/models`, { headers, signal: signal ?? null });
      const json = (await res.json()) as { data?: { id?: unknown }[] } | { id?: unknown }[];
      const list = Array.isArray(json) ? json : (json.data ?? []);
      return list
        .filter((m): m is { id: string } => typeof m.id === 'string')
        .map((m): ModelInfo => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      // No token limit is sent: OpenAI-compatible servers disagree on the
      // parameter name (max_tokens vs max_completion_tokens) and reject the other.
      const res = await request(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
      });
      if (!res.body) throw new ProviderError('Provider returned an empty response');

      for await (const ev of parseSse(res.body)) {
        if (ev.data === '[DONE]') break;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(ev.data) as StreamChunk;
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new ProviderError(typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'Provider error'));
        }
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { type: 'text', text };
        if (chunk.usage) {
          const usage: ChatEvent = { type: 'usage' };
          if (chunk.usage.prompt_tokens !== undefined) usage.inputTokens = chunk.usage.prompt_tokens;
          if (chunk.usage.completion_tokens !== undefined) usage.outputTokens = chunk.usage.completion_tokens;
          yield usage;
        }
      }
    },
  };
}
