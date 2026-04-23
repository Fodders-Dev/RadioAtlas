import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGiftPayload,
  buildPremiumPayload,
  buildSharePayload,
  buildStartPayload,
  buildSupportPayload
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

test('support, premium and gift payloads keep mini app routing stable', () => {
  assert.match(buildSupportPayload(helpers).buttonUrl || '', /start=support/);
  assert.match(buildPremiumPayload(helpers).buttonUrl || '', /start=premium/);
  assert.match(buildGiftPayload(helpers, 'friend42').buttonUrl || '', /start=gift%3Afriend42/);
});

test('share payload keeps simple command smoke contracts', () => {
  assert.equal(buildSharePayload('').text, 'Usage: /share <station_url>');
  assert.equal(
    buildSharePayload('https://example.com/stream').text,
    'Share this station: https://example.com/stream'
  );
});
