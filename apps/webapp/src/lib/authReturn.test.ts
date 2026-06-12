import { describe, expect, it } from 'vitest';
import { parseAuthReturn, stripAuthReturnParams } from './authReturn';

const APP = 'https://radioatlas.test/';

describe('parseAuthReturn', () => {
  it('telegram success carries the session token (the iOS/Huawei hotfix path)', () => {
    const parsed = parseAuthReturn(
      `${APP}?auth_provider=telegram&auth_result=success&token=tok-123`
    );
    expect(parsed).toEqual({ provider: 'telegram', result: 'success', token: 'tok-123' });
  });

  it('vk success still parses (the pre-existing flow is untouched)', () => {
    expect(parseAuthReturn(`${APP}?auth_provider=vk&auth_result=success&token=tok-vk`)).toEqual({
      provider: 'vk',
      result: 'success',
      token: 'tok-vk'
    });
  });

  it('telegram error carries the message with a provider-specific fallback', () => {
    expect(
      parseAuthReturn(`${APP}?auth_provider=telegram&auth_result=error&message=hash%20mismatch`)
    ).toEqual({ provider: 'telegram', result: 'error', message: 'hash mismatch' });
    expect(parseAuthReturn(`${APP}?auth_provider=telegram&auth_result=error`)).toEqual({
      provider: 'telegram',
      result: 'error',
      message: 'telegram auth failed'
    });
  });

  it('preview tickets exist only for vk — a telegram preview is ignored', () => {
    expect(parseAuthReturn(`${APP}?auth_provider=vk&auth_result=preview&ticket=t-1`)).toEqual({
      provider: 'vk',
      result: 'preview',
      ticket: 't-1'
    });
    expect(
      parseAuthReturn(`${APP}?auth_provider=telegram&auth_result=preview&ticket=t-1`)
    ).toBeNull();
  });

  it('ignores unknown providers and plain navigation', () => {
    expect(parseAuthReturn(`${APP}?auth_provider=google&auth_result=success&token=x`)).toBeNull();
    expect(parseAuthReturn(`${APP}?utm_source=tg`)).toBeNull();
    expect(parseAuthReturn('not a url')).toBeNull();
  });
});

describe('stripAuthReturnParams', () => {
  it('removes every auth param (token included) and keeps unrelated ones', () => {
    const cleaned = stripAuthReturnParams(
      `${APP}?auth_provider=telegram&auth_result=success&token=tok-123&message=x&ticket=y&tab=library`
    );
    const url = new URL(cleaned);
    expect(url.searchParams.get('token')).toBeNull();
    expect(url.searchParams.get('auth_provider')).toBeNull();
    expect(url.searchParams.get('auth_result')).toBeNull();
    expect(url.searchParams.get('message')).toBeNull();
    expect(url.searchParams.get('ticket')).toBeNull();
    expect(url.searchParams.get('tab')).toBe('library');
  });
});
