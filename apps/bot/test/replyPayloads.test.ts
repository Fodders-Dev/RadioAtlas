import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGiftPayload,
  buildInlineResults,
  buildPremiumPayload,
  buildSharePayload,
  buildStartPayload,
  buildSupportPayload,
  type InlineStation
} from '../src/replyPayloads.js';

const helpers = {
  webAppUrl: 'https://radioatlas.duckdns.org/',
  withSharedApi: (value: string) => `${value}?api=%2Fapi&v=abc1234`,
  withMiniAppParam: (param: string) =>
    `https://radioatlas.duckdns.org/?start=${encodeURIComponent(param)}&api=%2Fapi&v=abc1234`
};

test('start payload includes deep link and opens the shared mini app URL', () => {
  const payload = buildStartPayload(helpers, { username: 'radioatlas_bot' });
  assert.match(payload.text, /Добро пожаловать в RadioAtlas/);
  assert.match(payload.text, /Deep link: https:\/\/t\.me\/radioatlas_bot\?startapp=radio/);
  assert.equal(payload.buttonLabel, 'Открыть радио');
  assert.equal(payload.buttonUrl, 'https://radioatlas.duckdns.org/?api=%2Fapi&v=abc1234');
});

test('deferred paid payloads route back to core radio', () => {
  const payloads = [
    buildSupportPayload(helpers),
    buildPremiumPayload(helpers),
    buildGiftPayload(helpers, 'friend42')
  ];

  for (const payload of payloads) {
    assert.match(payload.text, /закрыты|фокусируется/);
    assert.doesNotMatch(payload.text, /Stars|Premium/);
    assert.equal(payload.buttonLabel, 'Открыть RadioAtlas');
    assert.match(payload.buttonUrl || '', /start=radio/);
    assert.doesNotMatch(payload.buttonUrl || '', /start=(support|premium|gift)/);
  }
});

test('share payload keeps simple command smoke contracts', () => {
  assert.equal(buildSharePayload('').text, 'Usage: /share <station_url>');
  assert.equal(
    buildSharePayload('https://example.com/stream').text,
    'Share this station: https://example.com/stream'
  );
});

const inlineStation = (over: Partial<InlineStation> = {}): InlineStation => ({
  stationuuid: 'uuid-1',
  name: 'Tokyo FM',
  favicon: 'https://cdn.example.com/tokyo.png',
  country: 'Japan',
  tags: 'jpop,night',
  ...over
});

test('buildInlineResults: N stations → N article results with the station deep-link button', () => {
  const stations = [
    inlineStation({ stationuuid: 'uuid-a', name: 'Tokyo FM' }),
    inlineStation({ stationuuid: 'uuid-b', name: 'Osaka Nights', tags: 'jpop', country: 'Japan' }),
    inlineStation({ stationuuid: 'uuid-c', name: 'Berlin Pulse', tags: 'techno', country: 'Germany' })
  ];

  const results = buildInlineResults(stations, { username: 'radioatlasbot' });

  assert.equal(results.length, 3);
  results.forEach((result, index) => {
    const station = stations[index];
    const deepLink = `https://t.me/radioatlasbot?startapp=station_${station.stationuuid}`;
    assert.equal(result.type, 'article');
    assert.equal(result.id, station.stationuuid);
    assert.equal(result.title, station.name);
    // Self-contained message carries the deep link (clickable even where the
    // button is stripped), and the URL button points at the same deep link.
    assert.ok(result.input_message_content);
    const messageText = (result.input_message_content as { message_text: string }).message_text;
    assert.ok(
      messageText.includes(`Слушать вживую: ${deepLink}`),
      `message should embed the deep link, got: ${messageText}`
    );
    const button = result.reply_markup?.inline_keyboard?.[0]?.[0];
    assert.equal(button?.text, '▶ Слушать');
    assert.equal((button as { url?: string })?.url, deepLink);
    // URL button, NOT a web_app button (inline-mode constraint).
    assert.equal((button as { web_app?: unknown })?.web_app, undefined);
  });
});

test('buildInlineResults: title/description/thumb come from the station', () => {
  const [result] = buildInlineResults([inlineStation()], { username: 'radioatlasbot' });
  assert.equal(result.title, 'Tokyo FM');
  assert.equal(result.description, 'jpop · Japan');
  assert.equal((result as { thumb_url?: string }).thumb_url, 'https://cdn.example.com/tokyo.png');
});

test('buildInlineResults: omits a non-http favicon thumb instead of emitting junk', () => {
  const [result] = buildInlineResults([inlineStation({ favicon: 'not-a-url' })], {
    username: 'radioatlasbot'
  });
  assert.equal((result as { thumb_url?: string }).thumb_url, undefined);
});

test('buildInlineResults: empty list → single "Открыть RadioAtlas" fallback', () => {
  const results = buildInlineResults([], { username: 'radioatlasbot' });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'open-radioatlas');
  const button = results[0].reply_markup?.inline_keyboard?.[0]?.[0];
  assert.equal((button as { url?: string })?.url, 'https://t.me/radioatlasbot?startapp=radio');
});

test('buildInlineResults: missing username → fallback only, never a t.me/undefined link', () => {
  const results = buildInlineResults([inlineStation()], { username: undefined });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'open-radioatlas');
  // No username → no deep link → no broken button.
  assert.equal(results[0].reply_markup, undefined);
  assert.ok(
    !(results[0].input_message_content as { message_text: string }).message_text.includes('undefined')
  );
});
