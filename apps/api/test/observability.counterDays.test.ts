import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_COUNTER_KEYS,
  recordDailyIncrement,
  summariseCounterDays,
  type CounterDay
} from '../src/observabilityStore.js';

/**
 * Why this exists: on 2026-09-02 the question "did yesterday's fix help" had no
 * answer in this store. The hourly buckets hold 25 hours, so every bucket in it
 * was already AFTER the fix — the before did not exist to compare against, and
 * PLAN.md was telling the next person to make exactly that comparison.
 *
 * The clock is an argument here for the same reason as in the hourly recorder:
 * so a day boundary can be tested without waiting one.
 */

const DAY = 86_400_000;
const AT = (day: number, hour = 0) => day * DAY + hour * 3_600_000;
const ATTEMPT = 'client_event:play_attempt';
const SUCCESS = 'client_event:play_success';

test('increments land in the bucket for their own day', () => {
  const days: CounterDay[] = [];
  recordDailyIncrement(days, ATTEMPT, 1, AT(20_000, 0));
  recordDailyIncrement(days, ATTEMPT, 1, AT(20_000, 23));
  recordDailyIncrement(days, SUCCESS, 1, AT(20_000, 12));
  assert.equal(days.length, 1);
  assert.deepEqual(days[0], { day: 20_000, counters: { [ATTEMPT]: 2, [SUCCESS]: 1 } });

  recordDailyIncrement(days, ATTEMPT, 1, AT(20_001, 1));
  assert.equal(days.length, 2);
  assert.deepEqual(days[1], { day: 20_001, counters: { [ATTEMPT]: 1 } });
});

test('a key outside the allow-list is not recorded at all', () => {
  // This is the whole reason the list exists. The store carried 587 per-route
  // counters on 2026-09-02; keeping those for ninety days is the memory and
  // disk problem MAX_COUNTER_KEYS was written about, on a box whose swap is
  // already full.
  const days: CounterDay[] = [];
  recordDailyIncrement(days, 'request:GET:/artwork/scene/:id', 1, AT(20_000));
  recordDailyIncrement(days, 'ai_chat_tokens_prompt', 900, AT(20_000));
  // Not `deepEqual(days, [])`: node's strict assertions carry an
  // `asserts actual is T` signature, so a bare [] narrows `days` to never[]
  // and every later read of it stops compiling.
  assert.equal(days.length, 0, 'an unlisted key must not even open a day');

  recordDailyIncrement(days, ATTEMPT, 1, AT(20_000));
  assert.equal(days.length, 1);
  assert.deepEqual(Object.keys(days[0]!.counters), [ATTEMPT]);
});

test('the series is bounded, and it drops the oldest day rather than the newest', () => {
  const days: CounterDay[] = [];
  for (let day = 0; day < 120; day += 1) recordDailyIncrement(days, ATTEMPT, 1, AT(20_000 + day));
  assert.equal(days.length, 90);
  assert.equal(days[0]!.day, 20_030, 'the window must slide forward');
  assert.equal(days[days.length - 1]!.day, 20_119);
});

test('a clock step back folds into the open day instead of opening an earlier one', () => {
  // Out-of-order days would make the series non-monotonic, and anything reading
  // it as a time series would silently double-count across the seam.
  const days: CounterDay[] = [];
  recordDailyIncrement(days, ATTEMPT, 1, AT(20_001));
  recordDailyIncrement(days, ATTEMPT, 1, AT(19_999));
  assert.equal(days.length, 1);
  assert.deepEqual(days[0], { day: 20_001, counters: { [ATTEMPT]: 2 } });
});

test('the summary carries a readable UTC date, because an epoch day goes unread', () => {
  const days: CounterDay[] = [];
  recordDailyIncrement(days, ATTEMPT, 3, Date.UTC(2026, 8, 2, 11, 30));
  recordDailyIncrement(days, ATTEMPT, 4, Date.UTC(2026, 8, 3, 0, 1));
  assert.deepEqual(summariseCounterDays(days), [
    { date: '2026-09-02', counters: { [ATTEMPT]: 3 } },
    { date: '2026-09-03', counters: { [ATTEMPT]: 4 } }
  ]);
});

test('the three counters an honest success rate needs are all kept', () => {
  // `play_success / (play_attempt - play_superseded)` — see
  // `.claude/rules/webapp.md`. Dropping the supersede term does not break
  // anything visibly; it just makes every rate computed from this series wrong
  // in the flattering direction, which is worse.
  for (const key of [ATTEMPT, SUCCESS, 'client_event:play_superseded']) {
    assert.ok(DAILY_COUNTER_KEYS.has(key), `${key} must survive in the daily series`);
  }
});

test('the allow-list stays short, because its whole cost is length times ninety', () => {
  // Not a style rule. Each key is up to 90 stored numbers that are serialised
  // on every flush, so this ceiling is the budget. If a new key is worth more
  // than the ceiling, raise it deliberately here rather than by accident there.
  assert.ok(
    DAILY_COUNTER_KEYS.size <= 25,
    `the daily allow-list has grown to ${DAILY_COUNTER_KEYS.size} keys`
  );
  for (const key of DAILY_COUNTER_KEYS) {
    assert.ok(!key.includes('*'), `${key} looks like a pattern; the list takes exact names only`);
    assert.ok(!key.endsWith(':'), `${key} looks like a prefix; the list takes exact names only`);
  }
});

test('the documented COMMANDS read prefixed counter names', async () => {
  // RUNBOOK.md shipped `c.play_attempt` and printed `0/0` for months, because
  // the key is `client_event:play_attempt`. Nothing errored — the output was a
  // plausible number saying the box was idle, which is this project's most
  // expensive failure shape, so the documented command is worth a guard.
  //
  // Only FENCED CODE is scanned. Prose must stay free to quote the broken form,
  // because explaining the defect means naming it — the first draft of this
  // guard failed on the very note that documents it.
  const { readFile } = await import('node:fs/promises');
  const bare =
    /(?:\bc|counters)(?:\.|\[["'])(play_|app_opened|audio_|session_|home_|skip|stream_failure)/g;
  for (const doc of ['RUNBOOK.md', 'PLAN.md', '.claude/rules/api.md']) {
    const text = await readFile(new URL(`../../../${doc}`, import.meta.url), 'utf8');
    const fenced = text
      .split(/^```.*$/m)
      .filter((_, index) => index % 2 === 1)
      .join('\n');
    const found = fenced.match(bare) || [];
    assert.deepEqual(
      found,
      [],
      `${doc} has a command reading a client counter without its client_event: prefix: ${found.join(', ')}`
    );
  }
});
