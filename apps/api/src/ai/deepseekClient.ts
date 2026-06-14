// Thin DeepSeek chat-completions client. fetch is injected (unit tests stub it).
// The API key lives ONLY in the DeepseekConfig built on the server from env —
// it never crosses into a client bundle. Any failure returns { error } instead
// of throwing, so the brain always degrades to a warm fallback.

import type { ChatUsage, DeepseekConfig } from './types.js';

export type DeepseekMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type DeepseekResult = {
  content: string;
  usage?: ChatUsage;
  error?: string;
};

export type DeepseekCallOptions = {
  temperature: number;
  maxTokens: number;
};

type RawCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

export const callDeepseek = async (
  config: DeepseekConfig,
  messages: DeepseekMessage[],
  options: DeepseekCallOptions,
  fetchImpl: typeof fetch
): Promise<DeepseekResult> => {
  if (!config.enabled || !config.apiKey) {
    return { content: '', error: 'disabled' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, config.timeoutSec) * 1000
  );

  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        // Reasoning tokens off — this is a fast conversational path, not a
        // chain-of-thought task (confirmed against the live container).
        thinking: { type: 'disabled' },
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { content: '', error: `deepseek http ${response.status}` };
    }

    const body = (await response.json()) as RawCompletion;
    const content = body.choices?.[0]?.message?.content;
    return {
      content: typeof content === 'string' ? content : '',
      usage: {
        prompt: toNumber(body.usage?.prompt_tokens),
        completion: toNumber(body.usage?.completion_tokens)
      }
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'deepseek call failed';
    return { content: '', error: reason };
  } finally {
    clearTimeout(timeout);
  }
};
