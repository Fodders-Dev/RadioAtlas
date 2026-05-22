// T0.2b: pure-function wrapper around the bot -> API billing webhook
// forward. Extracted from the inline `bot.on('message:successful_payment', …)`
// handler in index.ts so unit tests can inject a mocked fetch + capture
// the structured log output without booting grammy.
//
// Contract: ALWAYS return an actionable intent. The caller (index.ts)
// maps the intent to a ctx.reply call. There is no silent-return path —
// the user paid Telegram Stars and is owed a response in every branch.
//
// Branches (in execution order):
//   0a) empty invoice_payload         → apology  + log 'empty-payload'
//   0b) apiUrl env missing            → apology  + log 'api-url-missing'
//   a)  internalWebhookToken missing  → apology  + log 'env-missing'
//   b)  fetch throws                  → apology  + log 'network'   + error.message
//   c)  response.ok === false         → apology  + log 'http-<status>'
//   d-no-webapp) ok but !webAppUrl    → success  + log 'webapp-url-missing'
//                                       (Premium granted, keyboard absent;
//                                        deploy bug worth flagging)
//   d)  ok + webAppUrl                → success  (no log; existing path)
//
// ETA copy "10 минут" in the apology is aspirational — T0.2c will add a
// reconcile sweep that actually delivers Premium within that window. Until
// then, the apology directs the user to SUPPORT_HANDLE with the purchase
// ID so the operator can grant manually.

export type BillingForwardDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  internalWebhookToken: string;
  webAppUrl: string;
  supportHandle: string;
  log: (line: string) => void;
};

export type BillingForwardInput = {
  invoicePayload: string | undefined;
  telegramChargeId: string | undefined;
};

export type BillingForwardResult =
  | { kind: 'success'; replyText: string; showKeyboard: boolean }
  | { kind: 'apology'; replyText: string };

const APOLOGY_INTRO = 'Оплата получена. Активация займёт до 10 минут.';
const SUCCESS_WITH_KEYBOARD =
  'Покупка подтверждена. Открой RadioAtlas, Premium уже должен примениться.';
const SUCCESS_NO_KEYBOARD = 'Покупка подтверждена. Premium уже должен примениться.';

const buildApologyText = (
  supportHandle: string,
  reconcileId: string,
  reconcileKind: 'purchase' | 'charge'
) => {
  // <code>…</code> renders as monospace tap-to-copy in Telegram with
  // parse_mode: 'HTML'. The handler in index.ts sets that mode for
  // apology replies. purchaseId/chargeId values are bot-controlled
  // (DB row IDs and Telegram-issued strings), so HTML escaping the
  // value isn't load-bearing here.
  const idLabel =
    reconcileKind === 'purchase' ? 'номером покупки' : 'номером операции Telegram';
  return (
    `${APOLOGY_INTRO}\n` +
    `Если Premium не появился — напишите ${supportHandle} с ${idLabel}: ` +
    `<code>${reconcileId}</code>`
  );
};

const writeLogLine = (
  log: (line: string) => void,
  payload: Record<string, unknown>
) => {
  // ONE JSON.stringify per call — single-line stable shape so a future
  // log shipper can parse without regex. No console.log decorations.
  log(JSON.stringify(payload));
};

export const forwardBillingWebhook = async (
  input: BillingForwardInput,
  deps: BillingForwardDeps
): Promise<BillingForwardResult> => {
  const purchaseId = input.invoicePayload?.trim() || '';
  const chargeId = input.telegramChargeId?.trim() || '';

  // 0a — Telegram delivered a successful_payment with empty invoice_payload.
  // We can't forward (no purchase row to look up) but the user still paid;
  // reconcile via the Telegram charge ID instead.
  if (!purchaseId) {
    writeLogLine(deps.log, {
      event: 'billing_webhook_forward_skipped',
      reason: 'empty-payload',
      purchaseId,
      chargeId
    });
    return {
      kind: 'apology',
      replyText: buildApologyText(deps.supportHandle, chargeId, 'charge')
    };
  }

  // 0b — API_URL env missing on the bot host. Config-drift class with (a).
  if (!deps.apiUrl) {
    writeLogLine(deps.log, {
      event: 'billing_webhook_forward_skipped',
      reason: 'api-url-missing',
      purchaseId,
      chargeId
    });
    return {
      kind: 'apology',
      replyText: buildApologyText(deps.supportHandle, purchaseId, 'purchase')
    };
  }

  // a — INTERNAL_WEBHOOK_TOKEN env missing. Same UX class as 0b.
  if (!deps.internalWebhookToken) {
    writeLogLine(deps.log, {
      event: 'billing_webhook_forward_skipped',
      reason: 'env-missing',
      purchaseId,
      chargeId
    });
    return {
      kind: 'apology',
      replyText: buildApologyText(deps.supportHandle, purchaseId, 'purchase')
    };
  }

  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiUrl}/billing/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalWebhookToken
      },
      body: JSON.stringify({
        purchaseId,
        telegramChargeId: chargeId
      })
    });
  } catch (error) {
    // b — fetch threw (DNS, ECONNREFUSED, etc.). Pull error.message
    // explicitly: JSON.stringify(new Error('x')) is '{}' and loses the
    // diagnostic, defeating the whole point of the structured log.
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeLogLine(deps.log, {
      event: 'billing_webhook_forward_failed',
      reason: 'network',
      purchaseId,
      chargeId,
      error: errorMessage
    });
    return {
      kind: 'apology',
      replyText: buildApologyText(deps.supportHandle, purchaseId, 'purchase')
    };
  }

  if (!response.ok) {
    // c — API responded with non-2xx. Could be auth (X-Internal-Token
    // mismatch → 401), purchase row missing (404), or the API itself
    // crashed (5xx). All resolve the same way for the user: apology.
    writeLogLine(deps.log, {
      event: 'billing_webhook_forward_failed',
      reason: `http-${response.status}`,
      purchaseId,
      chargeId
    });
    return {
      kind: 'apology',
      replyText: buildApologyText(deps.supportHandle, purchaseId, 'purchase')
    };
  }

  // d-no-webapp — Premium was granted (API responded 2xx) but the bot
  // can't render the "Открыть RadioAtlas" button because WEBAPP_URL is
  // unset. Not a payment failure; still worth a log line so an operator
  // notices the env drift.
  if (!deps.webAppUrl) {
    writeLogLine(deps.log, {
      event: 'billing_webhook_succeeded_no_keyboard',
      reason: 'webapp-url-missing',
      purchaseId,
      chargeId
    });
    return { kind: 'success', replyText: SUCCESS_NO_KEYBOARD, showKeyboard: false };
  }

  // d — full success: existing happy path. No log (don't pollute stderr
  // on normal operation; this path will be most traffic once the env
  // settles).
  return { kind: 'success', replyText: SUCCESS_WITH_KEYBOARD, showKeyboard: true };
};
