import type {
  AiModelConfig,
  ChatUsage,
  ModelErrorKind,
  ModelReasoningEffort
} from './types.js';

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ModelResult = {
  content: string;
  usage?: ChatUsage;
  error?: string;
  /**
   * Operator-facing classification of `error`. The message string stays as it
   * was (tests and logs read it), but a dead provider has to be *countable*:
   * an exhausted balance and a 500 both used to surface as the same warm
   * fallback with nothing to alert on. Never carries provider prose — only a
   * closed set of kinds, so nothing from a response body can leak into logs.
   */
  errorKind?: ModelErrorKind;
};

export type JsonSchemaOutput = {
  name: string;
  schema: Record<string, unknown>;
};

export type ModelCallOptions = {
  temperature: number;
  maxTokens: number;
  jsonSchema?: JsonSchemaOutput;
  safetyIdentifier?: string;
  signal?: AbortSignal;
};

type DeepseekCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

type OpenAiResponse = {
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const normalizedProvider = (config: AiModelConfig) => config.provider || 'deepseek';

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

// HTTP status → what an operator has to DO about it. `billing` and `auth` mean
// the provider is dead until a human acts; `rate_limit` and `unavailable` are
// expected to recover on their own. Anything unmapped stays `http`.
export const classifyModelHttpStatus = (status: number): ModelErrorKind => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider_unavailable';
  return 'http';
};

export const classifyModelThrow = (error: unknown): ModelErrorKind => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'AbortError' || /timeout|aborted/i.test(message)) return 'timeout';
  return 'network';
};

const attachAbortSignal = (
  controller: AbortController,
  externalSignal: AbortSignal | undefined
) => {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
    return () => {};
  }
  const abort = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener('abort', abort, { once: true });
  return () => externalSignal.removeEventListener('abort', abort);
};

const deepseekThinking = (effort: ModelReasoningEffort | undefined) => {
  if (!effort || effort === 'none') return { thinking: { type: 'disabled' } };
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: effort === 'max' ? 'max' : 'high'
  };
};

const extractOpenAiText = (body: OpenAiResponse): string => {
  if (typeof body.output_text === 'string') return body.output_text;
  return (body.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => String(item.text))
    .join('');
};

const callDeepseekCompatible = async (
  config: AiModelConfig,
  messages: ModelMessage[],
  options: ModelCallOptions,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<ModelResult> => {
  const response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
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
      ...deepseekThinking(config.reasoningEffort),
      ...(options.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
      ...(options.safetyIdentifier ? { user_id: options.safetyIdentifier } : {}),
      stream: false
    }),
    signal
  });

  if (!response.ok) {
    return {
      content: '',
      error: `deepseek http ${response.status}`,
      errorKind: classifyModelHttpStatus(response.status)
    };
  }

  const body = (await response.json()) as DeepseekCompletion;
  const content = body.choices?.[0]?.message?.content;
  return {
    content: typeof content === 'string' ? content : '',
    usage: {
      prompt: toNumber(body.usage?.prompt_tokens),
      completion: toNumber(body.usage?.completion_tokens)
    }
  };
};

const callOpenAiResponses = async (
  config: AiModelConfig,
  messages: ModelMessage[],
  options: ModelCallOptions,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<ModelResult> => {
  const response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      input: messages.map((message) => ({
        role: message.role === 'system' ? 'developer' : message.role,
        content: message.content
      })),
      max_output_tokens: options.maxTokens,
      reasoning: {
        effort: config.reasoningEffort || 'low',
        context: 'current_turn'
      },
      text: {
        verbosity: 'low',
        ...(options.jsonSchema
          ? {
              format: {
                type: 'json_schema',
                name: options.jsonSchema.name,
                // Planner args are intentionally tool-dependent, so the outer
                // decision is schema-shaped but cannot use OpenAI strict mode.
                strict: false,
                schema: options.jsonSchema.schema
              }
            }
          : {})
      },
      ...(options.safetyIdentifier
        ? { safety_identifier: options.safetyIdentifier }
        : {}),
      store: false
    }),
    signal
  });

  if (!response.ok) {
    return {
      content: '',
      error: `openai http ${response.status}`,
      errorKind: classifyModelHttpStatus(response.status)
    };
  }

  const body = (await response.json()) as OpenAiResponse;
  return {
    content: extractOpenAiText(body),
    usage: {
      prompt: toNumber(body.usage?.input_tokens),
      completion: toNumber(body.usage?.output_tokens)
    }
  };
};

export const callModel = async (
  config: AiModelConfig,
  messages: ModelMessage[],
  options: ModelCallOptions,
  fetchImpl: typeof fetch
): Promise<ModelResult> => {
  if (!config.enabled || !config.apiKey) {
    // Deliberately configured off: not an incident, so it stays unclassified
    // and never reaches the model-error counters.
    return { content: '', error: 'disabled' };
  }

  const controller = new AbortController();
  const detachExternalSignal = attachAbortSignal(controller, options.signal);
  const timeout = setTimeout(
    () => controller.abort(new Error('model timeout')),
    Math.max(1, config.timeoutSec) * 1000
  );

  try {
    if (normalizedProvider(config) === 'openai') {
      return await callOpenAiResponses(
        config,
        messages,
        options,
        fetchImpl,
        controller.signal
      );
    }
    return await callDeepseekCompatible(
      config,
      messages,
      options,
      fetchImpl,
      controller.signal
    );
  } catch (error) {
    const provider = normalizedProvider(config);
    const reason = error instanceof Error ? error.message : `${provider} call failed`;
    return { content: '', error: reason, errorKind: classifyModelThrow(error) };
  } finally {
    clearTimeout(timeout);
    detachExternalSignal();
  }
};
