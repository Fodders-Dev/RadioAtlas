import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type express from 'express';

export const toAbsoluteUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

export const rewriteM3U8 = (body: string, sourceUrl: string, proxyBase: string) => {
  const lines = body.split('\n');
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const absolute = toAbsoluteUrl(trimmed, sourceUrl);
    return `${proxyBase}/stream?url=${encodeURIComponent(absolute)}`;
  });
  return rewritten.join('\n');
};

export const fetchUrlCandidates = (target: URL) => {
  const candidates: URL[] = [];
  if (target.protocol === 'http:') {
    const upgraded = new URL(target.toString());
    upgraded.protocol = 'https:';
    candidates.push(upgraded);
  }
  candidates.push(target);
  return candidates;
};

export const sendJsonError = (
  res: express.Response,
  status: number,
  error: string
) => {
  res.status(status).json({ error });
};

export const parseHttpUrl = (value: unknown) => {
  if (!value || typeof value !== 'string') {
    return { error: 'url is required' as const };
  }

  try {
    const target = new URL(value);
    if (!['http:', 'https:'].includes(target.protocol)) {
      return { error: 'invalid protocol' as const };
    }
    return { target };
  } catch {
    return { error: 'invalid url' as const };
  }
};

// ---- SSRF guard ---------------------------------------------------------
// Reject requests aimed at private / reserved address space and protect
// against DNS rebinding by re-resolving the host immediately before the
// outbound fetch. The MEDIA_SSRF_ALLOW_HOSTS env var (comma separated host
// names or literal IPs) is the opt-out used by tests that spin up upstream
// services on 127.0.0.1; it must remain empty in production deployments.

export class SsrfBlockedError extends Error {
  readonly host: string;
  readonly address: string | null;
  readonly reason: string;

  constructor(reason: string, host: string, address: string | null = null) {
    super(reason);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
    this.host = host;
    this.address = address;
  }
}

const v4InV6 = (addr: string): string => {
  const match = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return match?.[1] ?? addr;
};

const isPrivateIpv4 = (ip: string): boolean => {
  const segments = ip.split('.');
  if (segments.length !== 4) return true;
  const parts: number[] = [];
  for (const segment of segments) {
    if (!/^\d+$/.test(segment)) return true;
    const value = Number(segment);
    if (!Number.isInteger(value) || value < 0 || value > 255) return true;
    parts.push(value);
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 deprecated 6to4 anycast
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 multicast
  if (a >= 240) return true; // 240.0.0.0/4 reserved
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  return false;
};

const isPrivateIpv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('::ffff:')) return isPrivateIpv4(v4InV6(lower));
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('ff')) return true; // multicast ff00::/8
  if (lower.startsWith('2001:db8:')) return true; // documentation
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  return false;
};

export const isPrivateIp = (ip: string): boolean => {
  if (!ip) return true;
  const v4 = v4InV6(ip);
  if (isIP(v4) === 4) return isPrivateIpv4(v4);
  if (isIP(ip) === 6) return isPrivateIpv6(ip);
  return true; // unparseable / unexpected family - fail closed
};

type SsrfDnsLookup = (host: string) => Promise<LookupAddress[]>;

const defaultLookup: SsrfDnsLookup = async (host) => {
  const family = isIP(host);
  if (family) {
    return [{ address: host, family }];
  }
  return dnsLookup(host, { all: true, verbatim: true });
};

let lookupImpl: SsrfDnsLookup = defaultLookup;

export const __setSsrfDnsLookupForTesting = (fn: SsrfDnsLookup | null) => {
  lookupImpl = fn ?? defaultLookup;
};

const readAllowedHosts = (): Set<string> => {
  const raw = process.env.MEDIA_SSRF_ALLOW_HOSTS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
};

const allowedHostSet = readAllowedHosts();

const isAllowedHost = (host: string): boolean => allowedHostSet.has(host.toLowerCase());
const isAllowedAddress = (address: string): boolean => allowedHostSet.has(address.toLowerCase());

export const resolveHostAddresses = (host: string): Promise<LookupAddress[]> => lookupImpl(host);

export const assertHostIsPublic = async (host: string): Promise<LookupAddress[]> => {
  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(host);
  } catch (error) {
    throw new SsrfBlockedError(
      error instanceof Error ? `host lookup failed: ${error.message}` : 'host lookup failed',
      host
    );
  }
  if (!addresses.length) {
    throw new SsrfBlockedError('host has no DNS records', host);
  }
  const hostAllowed = isAllowedHost(host);
  for (const { address } of addresses) {
    if (hostAllowed || isAllowedAddress(address)) continue;
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(
        `host resolves to non-public address ${address}`,
        host,
        address
      );
    }
  }
  return addresses;
};

export type ParseAndValidateHttpUrlResult =
  | { target: URL }
  | { error: string; status: 400 | 403 | 502 };

export const parseAndValidateHttpUrl = async (
  value: unknown
): Promise<ParseAndValidateHttpUrlResult> => {
  const parsed = parseHttpUrl(value);
  if ('error' in parsed) {
    return { error: parsed.error ?? 'invalid url', status: 400 };
  }
  try {
    await assertHostIsPublic(parsed.target.hostname);
    return { target: parsed.target };
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { error: 'host not allowed', status: 403 };
    }
    return { error: 'host lookup failed', status: 502 };
  }
};

const guardOutboundFetchTarget = async (url: string) => {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return; // let fetch surface the invalid URL error itself
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return;
  }
  await assertHostIsPublic(target.hostname);
};

// ---- fetch helpers ------------------------------------------------------

const bindAbort = (controller: AbortController, signal?: AbortSignal) => {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
};

export const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
) => {
  await guardOutboundFetchTarget(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchWithDeadline = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
) => {
  await guardOutboundFetchTarget(url);
  const controller = new AbortController();
  const unbindAbort = bindAbort(controller, signal);
  const timeout = setTimeout(() => controller.abort(new Error('deadline exceeded')), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    return {
      response,
      cleanup: () => {
        clearTimeout(timeout);
        unbindAbort();
      }
    };
  } catch (error) {
    clearTimeout(timeout);
    unbindAbort();
    throw error;
  }
};

export const readTextWithLimit = async (
  response: Response,
  maxBytes = 256 * 1024
) => {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel('response too large');
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
};

export const readJsonWithLimit = async <T>(
  response: Response,
  maxBytes = 256 * 1024
) => JSON.parse(await readTextWithLimit(response, maxBytes)) as T;
