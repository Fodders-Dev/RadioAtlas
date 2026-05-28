import { describe, it, expect } from 'vitest';
import { HOME_SESSION_BUCKET_MS, isSameSessionBucket } from './Home';

// T_mobile_1 D — the session bucket gates whether a re-open rebuilds the
// recommendation snapshot. Live mobile feedback showed re-opens within the
// (old) 2h window felt "каждый раз одно и то же"; this is the contract test
// for the shorter 30-minute window.

describe('HOME_SESSION_BUCKET_MS (T_mobile_1 D)', () => {
  it('is 30 minutes', () => {
    expect(HOME_SESSION_BUCKET_MS).toBe(30 * 60 * 1000);
  });

  it('two timestamps 31min apart land in different buckets (re-render allowed)', () => {
    // Anchor inside a bucket, then cross its boundary by ≥1ms.
    const inside = 5 * HOME_SESSION_BUCKET_MS;
    const after = inside + HOME_SESSION_BUCKET_MS + 60 * 1000; // 31 minutes later
    expect(isSameSessionBucket(inside, after)).toBe(false);
  });

  it('two timestamps within the same 30min window are the same bucket (snapshot reused)', () => {
    const base = 5 * HOME_SESSION_BUCKET_MS + 1; // just inside the bucket
    const justUnder = base + HOME_SESSION_BUCKET_MS - 2; // still inside
    expect(isSameSessionBucket(base, justUnder)).toBe(true);
  });

  it('returns false when lastBuiltAt is unknown (forces a build)', () => {
    expect(isSameSessionBucket(null, Date.now())).toBe(false);
    expect(isSameSessionBucket(0, Date.now())).toBe(false);
  });
});
