import { createHash, randomBytes } from 'node:crypto';
import type { AssistantRuntime } from '../aiRoutes.js';
import type { AssistantRuntimeAdmission } from '../aiRoutes.js';
import type { ChatInput, ChatResult, ModelErrorKind } from './types.js';

export type ProviderFallbackReason = 'unavailable' | 'budget';
export type PublicProvider = { name: 'gpt-6-luna' | 'deepseek'; fallback: boolean };
export type ProviderFallbackTicket = {
  token: string;
  reason: ProviderFallbackReason;
  provider: 'deepseek';
};
export type ProviderChatResult = ChatResult & {
  provider?: PublicProvider;
  providerFallback?: ProviderFallbackTicket;
};

const TICKET_TTL_MS = 10 * 60_000;
const MAX_TICKETS = 1024;
const eligibleErrors = new Set<ModelErrorKind>([
  'auth', 'billing', 'budget', 'network', 'provider_unavailable', 'rate_limit', 'timeout'
]);
const GPT_WARNING = 'GPT-6 Luna сейчас недоступна. Можно продолжить через DeepSeek.';
const NO_FALLBACK_WARNING = 'GPT-6 Luna сейчас недоступна.';
const RETRY_NOTICE = 'Не удалось подтвердить повторный запрос. Отправь сообщение ещё раз.';

const semanticPayload = (input: ChatInput) => ({
  userMessage: input.userMessage,
  history: input.history || [],
  surface: input.surface,
  locale: input.locale || '',
  // Bot taste is loaded from the server-side account library on each request;
  // bind submitted Mini App taste while leaving that derived bot context out.
  userTaste: input.surface === 'miniapp' ? input.userTaste || null : null,
  nowPlaying: input.nowPlaying || null,
  agentContext: input.agentContext || null,
  actionReceipts: input.actionReceipts || [],
  safetyIdentifier: input.safetyIdentifier || ''
});

const requestDigest = (input: ChatInput, identity: string) => createHash('sha256')
  .update(JSON.stringify({ request: semanticPayload(input), identity }))
  .digest('hex');

export class FallbackTicketStore {
  private readonly entries = new Map<string, { digest: string; expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(input: ChatInput, identity: string, reason: ProviderFallbackReason): string | null {
    this.prune();
    if (this.entries.size >= MAX_TICKETS) return null;
    const token = randomBytes(32).toString('base64url');
    this.entries.set(token, {
      digest: requestDigest(input, identity),
      expiresAt: this.now() + TICKET_TTL_MS
    });
    return token;
  }

  consume(token: string, input: ChatInput, identity = ''): boolean {
    this.prune();
    const entry = this.entries.get(token);
    if (!entry || entry.expiresAt <= this.now() || entry.digest !== requestDigest(input, identity)) return false;
    // Delete before returning: any concurrent/replayed retry loses.
    this.entries.delete(token);
    return true;
  }

  private prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}

const emptyReply = (reply: string, diagnostics?: ChatResult): ProviderChatResult => ({
  reply,
  stations: [],
  serviceLinks: [],
  sources: [],
  actions: [],
  ...(diagnostics?.usage ? { usage: diagnostics.usage } : {}),
  ...(diagnostics?.agentRun ? { agentRun: diagnostics.agentRun } : {}),
  ...(diagnostics?.modelErrors ? { modelErrors: diagnostics.modelErrors } : {}),
  ...(diagnostics?.cardGate ? { cardGate: diagnostics.cardGate } : {}),
  ...(diagnostics?.constraintFilter ? { constraintFilter: diagnostics.constraintFilter } : {}),
  ...(diagnostics?.webSearchStatuses ? { webSearchStatuses: diagnostics.webSearchStatuses } : {}),
  provider: { name: 'gpt-6-luna', fallback: false }
});

export const createPrimaryProviderController = (options: {
  gptRuntime: AssistantRuntime | null;
  deepseekRuntime: AssistantRuntime | null;
  unavailableReason?: ProviderFallbackReason;
  admission?: AssistantRuntimeAdmission;
  tickets?: FallbackTicketStore;
  now?: () => number;
}) => {
  const tickets = options.tickets || new FallbackTicketStore(options.now);
  const emptyTicketResult = (): ProviderChatResult => emptyReply(RETRY_NOTICE);
  const unavailable = (
    input: ChatInput, identity: string, reason: ProviderFallbackReason, diagnostics?: ChatResult
  ) => {
    if (!options.deepseekRuntime) return emptyReply(NO_FALLBACK_WARNING, diagnostics);
    const token = tickets.issue(input, identity, reason);
    return token
      ? { ...emptyReply(GPT_WARNING, diagnostics), providerFallback: { token, reason, provider: 'deepseek' as const } }
      : emptyReply(NO_FALLBACK_WARNING, diagnostics);
  };

  return {
    checkRateLimit: (req: Parameters<AssistantRuntime['checkRateLimit']>[0]) =>
      (options.gptRuntime || options.deepseekRuntime)?.checkRateLimit(req) ??
        options.admission?.guard.checkRateLimit(req) ?? null,
    async chat(input: ChatInput, args: { fallbackToken?: string; identity?: string } = {}): Promise<ProviderChatResult> {
      const identity = args.identity || '';
      if (args.fallbackToken !== undefined) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(args.fallbackToken) || !tickets.consume(args.fallbackToken, input, identity)) {
          return emptyTicketResult();
        }
        if (!options.deepseekRuntime) return emptyTicketResult();
        const result = await options.deepseekRuntime.chat(input);
        return { ...result, provider: { name: 'deepseek', fallback: true } };
      }

      if (!options.gptRuntime) return unavailable(input, identity, options.unavailableReason || 'unavailable');
      const result = await options.gptRuntime.chat(input);
      const failures = result.modelErrors || [];
      if (!failures.length) return { ...result, provider: { name: 'gpt-6-luna', fallback: false } };
      if (!failures.some((kind) => eligibleErrors.has(kind))) {
        return { ...result, provider: { name: 'gpt-6-luna', fallback: false } };
      }
      const reason = failures.includes('budget') ? 'budget' : 'unavailable';
      return unavailable(input, identity, reason, result);
    }
  };
};
