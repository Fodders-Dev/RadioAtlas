import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forwardBillingWebhook,
  type BillingForwardDeps,
  type BillingForwardInput
} from '../src/billingForward.js';

// T0.2b regression tests: the user paid Telegram Stars; the handler
// MUST return an actionable intent in every branch. Each test injects
// a controlled fetch + log capture and asserts on:
//   - intent kind (success vs apology)
//   - apology copy contains SUPPORT_HANDLE and the reconcile ID
//   - structured log line is a single JSON line with stable shape

type LogCapture = {
  log: (line: string) => void;
  lines: string[];
};

const collectLog = (): LogCapture => {
  const lines: string[] = [];
  return { log: (line) => lines.push(line), lines };
};

const baseInput = (overrides: Partial<BillingForwardInput> = {}): BillingForwardInput => ({
  invoicePayload: 'purchase-123',
  telegramChargeId: 'charge-abc',
  ...overrides
});

const okFetch: typeof fetch = async () => new Response('', { status: 200 });

const baseDeps = (overrides: Partial<BillingForwardDeps> = {}): BillingForwardDeps => ({
  fetch: okFetch,
  apiUrl: 'http://api.test',
  internalWebhookToken: 'tok',
  webAppUrl: 'https://webapp.test/',
  supportHandle: '@ahjkuio',
  log: () => {},
  ...overrides
});

test('(1) env missing → apology + structured log reason=env-missing', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(
    baseInput(),
    baseDeps({ internalWebhookToken: '', log: capture.log })
  );
  assert.equal(result.kind, 'apology');
  if (result.kind !== 'apology') return;
  assert.match(result.replyText, /Оплата получена/);
  assert.match(result.replyText, /@ahjkuio/);
  assert.match(result.replyText, /<code>purchase-123<\/code>/);
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'billing_webhook_forward_skipped');
  assert.equal(log.reason, 'env-missing');
  assert.equal(log.purchaseId, 'purchase-123');
  assert.equal(log.chargeId, 'charge-abc');
});

test('(2) network throw → apology + reason=network with error.message string (not {})', async () => {
  const capture = collectLog();
  const throwingFetch: typeof fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const result = await forwardBillingWebhook(
    baseInput(),
    baseDeps({ fetch: throwingFetch, log: capture.log })
  );
  assert.equal(result.kind, 'apology');
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'billing_webhook_forward_failed');
  assert.equal(log.reason, 'network');
  // The whole point of error.message vs error: JSON.stringify(new Error('x'))
  // returns '{}' and the diagnostic vanishes. Lock the post-fix shape.
  assert.equal(log.error, 'ECONNREFUSED');
});

test('(3) http 5xx → apology + reason=http-500', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(
    baseInput(),
    baseDeps({
      fetch: (async () => new Response('', { status: 500 })) as typeof fetch,
      log: capture.log
    })
  );
  assert.equal(result.kind, 'apology');
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'billing_webhook_forward_failed');
  assert.equal(log.reason, 'http-500');
});

test('(4) http 200 + webAppUrl set → success WITH keyboard, no failure log', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(baseInput(), baseDeps({ log: capture.log }));
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.showKeyboard, true);
  assert.match(result.replyText, /Покупка подтверждена/);
  assert.match(result.replyText, /Открой RadioAtlas/);
  // Existing happy path stays quiet — no stderr noise on normal traffic.
  assert.equal(capture.lines.length, 0);
});

test('(5) http 200 + webAppUrl missing → success WITHOUT keyboard, log reason=webapp-url-missing', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(
    baseInput(),
    baseDeps({ webAppUrl: '', log: capture.log })
  );
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.showKeyboard, false);
  assert.match(result.replyText, /Покупка подтверждена/);
  assert.doesNotMatch(result.replyText, /Открой RadioAtlas/);
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  // This is a success path (Premium granted) with a degraded UX; the
  // log marker exists so an operator can spot the deploy bug.
  assert.equal(log.event, 'billing_webhook_succeeded_no_keyboard');
  assert.equal(log.reason, 'webapp-url-missing');
});

test('(6) empty purchaseId → apology + reason=empty-payload, reconciles via chargeId', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(
    baseInput({ invoicePayload: '' }),
    baseDeps({ log: capture.log })
  );
  assert.equal(result.kind, 'apology');
  if (result.kind !== 'apology') return;
  // Empty purchaseId means we can't tell the user to quote it; fall
  // back to the Telegram charge ID, which the operator can chase via
  // the billing service's payment log.
  assert.match(result.replyText, /<code>charge-abc<\/code>/);
  assert.match(result.replyText, /номером операции Telegram/);
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'billing_webhook_forward_skipped');
  assert.equal(log.reason, 'empty-payload');
  assert.equal(log.purchaseId, '');
  assert.equal(log.chargeId, 'charge-abc');
});

test('(7) apiUrl missing → apology + reason=api-url-missing', async () => {
  const capture = collectLog();
  const result = await forwardBillingWebhook(
    baseInput(),
    baseDeps({ apiUrl: '', log: capture.log })
  );
  assert.equal(result.kind, 'apology');
  if (result.kind !== 'apology') return;
  assert.match(result.replyText, /<code>purchase-123<\/code>/);
  assert.match(result.replyText, /номером покупки/);
  assert.equal(capture.lines.length, 1);
  const log = JSON.parse(capture.lines[0]);
  assert.equal(log.event, 'billing_webhook_forward_skipped');
  assert.equal(log.reason, 'api-url-missing');
});
