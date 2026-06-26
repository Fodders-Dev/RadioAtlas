import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type express from 'express';
// T0.1b: undici's exported fetch + Agent. We use undici directly
// (rather than the global fetch) so the per-request `dispatcher`
// option is typed and so we can construct an Agent with a custom
// `connect.lookup` that pins the destination IP to the address WE
// validated. The global fetch in Node 24 is the same undici under
// the hood; behaviour is identical, only the types differ.
import { Agent, fetch } from 'undici';

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

let allowedHostSet = readAllowedHosts();

export const __setSsrfAllowedHostsForTesting = (hosts: string[] | null) => {
  if (hosts === null) {
    allowedHostSet = readAllowedHosts();
    return;
  }
  allowedHostSet = new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
};

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

// Returns the validated addresses for the URL's hostname when the
// guard ran; null when the URL is malformed or the protocol is non-
// http (let fetch surface the underlying error). Callers use the
// returned array to seed the per-request pinned-lookup Agent so
// undici's TCP connect lands on an address WE validated, not whatever
// the OS resolver returns at connect time.
const guardOutboundFetchTarget = async (
  url: string
): Promise<LookupAddress[] | null> => {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return null;
  }
  return assertHostIsPublic(target.hostname);
};

// ---- T0.1b: pinned-lookup Agent -----------------------------------------
//
// undici's `connect.lookup` mirrors Node's `dns.lookup` callback shape.
// When undici needs to open a TCP connection it calls this with the
// hostname, an options object containing `family` / `hints`, and a
// node-style callback. By satisfying the callback from the pre-
// validated `LookupAddress[]` we got from `assertHostIsPublic`, undici
// NEVER asks the OS resolver again — closing the residual race window
// between T0.1's final resolve and undici's TCP connect.
//
// Per the IPv4/IPv6 design parameters (locked, see T0.1b brief):
//   options.family === 4 → first v4 address, else ENOTFOUND
//   options.family === 6 → first v6 address, else ENOTFOUND
//   options.family === 0 → prefer v4 (most public services dual-stack
//                          with v4 reachable from anywhere)
//
// NEVER silently downgrade family. If the validate-time set has no
// match for the requested family, return ENOTFOUND so the caller
// sees a clean connection failure — not an attacker-flipped address
// of a different family.
//
// TLS SNI: undici's TLS connect uses the URL hostname for `servername`
// regardless of what `lookup` returns. We do NOT touch `servername`.
// The pinned lookup only controls the destination IP; the original
// hostname rides as the SNI and the HTTP Host header.

// Match Node's LookupFunction overload exactly: when `all: true` the
// success path returns LookupAddress[]; otherwise a single
// (address, family) pair. We only emit the single-address shape (we
// pick ONE address from the validated set per family), but the type
// must accept both branches to satisfy undici's `LookupFunction`.
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

// Mirror Node's dns.LookupOptions — `family` may arrive as a number,
// or the string aliases 'IPv4' / 'IPv6' (Node 18+ overload). The
// normalizer below collapses both into the integer form we compare
// against LookupAddress.family.
type LookupOptions = {
  family?: number | 'IPv4' | 'IPv6';
  hints?: number;
  all?: boolean;
};

const normalizeFamilyHint = (family: LookupOptions['family']): number => {
  if (family === 'IPv4') return 4;
  if (family === 'IPv6') return 6;
  if (typeof family === 'number') return family;
  return 0;
};

const pickAddressByFamily = (
  addresses: LookupAddress[],
  requestedFamily: number
): LookupAddress | null => {
  if (requestedFamily === 4) {
    return addresses.find((entry) => entry.family === 4) ?? null;
  }
  if (requestedFamily === 6) {
    return addresses.find((entry) => entry.family === 6) ?? null;
  }
  // family === 0 (or undefined): prefer v4, fall back to v6.
  return (
    addresses.find((entry) => entry.family === 4) ??
    addresses.find((entry) => entry.family === 6) ??
    null
  );
};

// Per-request Agent. Caller MUST `await agent.close()` in finally so
// pooled sockets drain after the fetch settles. Connection-pool reuse
// across requests is intentionally NOT preserved — pinning correctness
// trumps the marginal connection-reuse win for our single-shot media
// proxy use-case.
// Filter the validated address set to a single family. Used for the
// `all: true` happy-eyeballs callback path — undici's Node 18+ net.
// connect uses `lookupAndConnectMultiple` which calls with `all: true`
// to receive every available address per family and pick its own
// connection winner. We still enforce family rules so the pin can't
// be tricked by an attacker who managed to slip an extra family into
// the validated set.
const filterAddressesByFamily = (
  addresses: LookupAddress[],
  requestedFamily: number
): LookupAddress[] => {
  if (requestedFamily === 4) return addresses.filter((entry) => entry.family === 4);
  if (requestedFamily === 6) return addresses.filter((entry) => entry.family === 6);
  // family === 0: return everything; undici's happy-eyeballs picks.
  return [...addresses];
};

const buildPinnedAgent = (addresses: LookupAddress[]): Agent => {
  const lookup = (
    _hostname: string,
    options: LookupOptions,
    callback: LookupCallback
  ): void => {
    const requestedFamily = normalizeFamilyHint(options.family);
    // Node's `net.connect` (and through it undici) calls our lookup
    // with `all: true` (happy-eyeballs path, returns Array<LookupAddress>)
    // or `all: false` / undefined (returns a single address). Handle
    // both because undici's choice between the two modes is a Node-
    // version implementation detail we don't want to depend on.
    if (options.all) {
      const filtered = filterAddressesByFamily(addresses, requestedFamily);
      if (!filtered.length) {
        const error: NodeJS.ErrnoException = new Error(
          `pinned lookup: no address of family ${requestedFamily} in validated set`
        );
        error.code = 'ENOTFOUND';
        callback(error, []);
        return;
      }
      callback(null, filtered);
      return;
    }
    const picked = pickAddressByFamily(addresses, requestedFamily);
    if (!picked) {
      const error: NodeJS.ErrnoException = new Error(
        `pinned lookup: no address of family ${requestedFamily} in validated set`
      );
      error.code = 'ENOTFOUND';
      // The Node LookupFunction type requires a non-undefined address
      // argument even on the error branch; an empty string is the
      // convention (consumed only when err is non-null, which
      // immediately rejects the connect).
      callback(error, '');
      return;
    }
    callback(null, picked.address, picked.family);
  };
  return new Agent({
    connect: {
      lookup
    }
  });
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

const MAX_REDIRECT_HOPS = 5;

const isRedirectStatus = (status: number) => status >= 300 && status < 400;

// Cancelling the body settles the agent-disposal wrapper (wrapResponseWithAgentDisposal),
// which is the ONLY thing that fires the pinned undici Agent's close(). Any caller that
// abandons a response without reading it must drain it, or it leaks a socket + Agent.
export const drainResponseBody = async (response: Response) => {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // best effort - the body may already be settled
  }
};

// T0.1b: each hop owns a freshly-built pinned Agent. Closing the old
// Agent before opening the next one keeps connection cleanup tight and
// prevents leftover sockets from outliving the redirect chain.
const guardedFetchWithRedirects = async (
  initialUrl: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> => {
  let currentUrl = initialUrl;
  let redirectCount = 0;
  // The agent for the CURRENT hop. We dispose it (close()) before
  // building the next hop's agent, except when we hand the final
  // response back to the caller — that response's body is still tied
  // to the agent's connection, so we attach a finaliser via the
  // patchResponseAgentDisposal helper below.
  let currentAgent: Agent | null = null;
  try {
    while (true) {
      const addresses = await guardOutboundFetchTarget(currentUrl);
      // addresses === null means a malformed URL / non-http protocol;
      // let fetch surface the underlying error without dispatcher.
      const agent = addresses ? buildPinnedAgent(addresses) : null;
      // Tear down the prior hop's agent BEFORE the next fetch so we
      // never hold two sockets open for the same request.
      if (currentAgent) {
        await currentAgent.close().catch(() => {});
      }
      currentAgent = agent;

      const response = await fetch(currentUrl, {
        ...init,
        redirect: 'manual',
        signal,
        ...(agent ? { dispatcher: agent } : {})
      });
      if (!isRedirectStatus(response.status)) {
        // Final response — wrap so agent.close() fires when the body
        // settles. Transfer ownership; set currentAgent to null so
        // the outer finally doesn't double-close.
        const final = currentAgent
          ? wrapResponseWithAgentDisposal(response, currentAgent)
          : (response as unknown as Response);
        currentAgent = null;
        return final;
      }
      const location = response.headers.get('location');
      if (!location) {
        const final = currentAgent
          ? wrapResponseWithAgentDisposal(response, currentAgent)
          : (response as unknown as Response);
        currentAgent = null;
        return final;
      }
      if (redirectCount >= MAX_REDIRECT_HOPS) {
        await drainResponseBody(response as unknown as Response);
        throw new SsrfBlockedError('too many redirects', initialUrl);
      }
      let next: URL;
      try {
        next = new URL(location, currentUrl);
      } catch {
        await drainResponseBody(response as unknown as Response);
        throw new SsrfBlockedError(`invalid redirect Location: ${location}`, currentUrl);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        await drainResponseBody(response as unknown as Response);
        throw new SsrfBlockedError(`disallowed redirect protocol: ${next.protocol}`, currentUrl);
      }
      await drainResponseBody(response as unknown as Response);
      redirectCount += 1;
      currentUrl = next.toString();
    }
  } catch (error) {
    if (currentAgent) {
      await currentAgent.close().catch(() => {});
    }
    throw error;
  }
};

// Attaches agent disposal to the response body lifecycle. Response
// instances are immutable (the body property is read-only) so we
// build a fresh Response whose body is a pull-stream that proxies
// the original body and fires agent.close() exactly once when the
// caller has read (or cancelled) it. close() fires whether the
// caller awaits arrayBuffer/text/json (full read to completion) or
// cancels partway through.
const wrapResponseWithAgentDisposal = (
  response: { body: ReadableStream | null; status: number; statusText: string; headers: Headers },
  agent: Agent
): Response => {
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    void agent.close().catch(() => {});
  };
  if (!response.body) {
    // No body to wait on — drop the agent now. The headers-only
    // response (e.g. HEAD, 204) can return as-is, just typed back to
    // the global Response shape.
    dispose();
    return response as unknown as Response;
  }
  const upstream = response.body;
  const wrappedBody = new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
        dispose();
      }
    },
    cancel() {
      // Best-effort upstream cancel — if it throws (stream already
      // closed), we still need to dispose the agent.
      void upstream.cancel().catch(() => {});
      dispose();
    }
  });
  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
};

const runFetch = async (
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> => {
  // The default redirect mode in fetch is 'follow', and undici resolves the
  // Location target itself - that bypasses our SSRF guard entirely. Only fall
  // back to plain fetch when the caller explicitly opted in to a non-default
  // redirect mode and is therefore taking responsibility for what happens.
  if (init.redirect === undefined) {
    return guardedFetchWithRedirects(url, init, signal);
  }
  // Explicit-redirect path: still pin the destination for the single
  // hop the caller is making. They own redirect handling beyond that.
  const addresses = await guardOutboundFetchTarget(url);
  const agent = addresses ? buildPinnedAgent(addresses) : null;
  try {
    const response = await fetch(url, {
      ...init,
      signal,
      ...(agent ? { dispatcher: agent } : {})
    });
    return agent
      ? wrapResponseWithAgentDisposal(response, agent)
      : (response as unknown as Response);
  } catch (error) {
    if (agent) {
      await agent.close().catch(() => {});
    }
    throw error;
  }
};

export const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await runFetch(url, init, controller.signal);
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
  const controller = new AbortController();
  const unbindAbort = bindAbort(controller, signal);
  const timeout = setTimeout(() => controller.abort(new Error('deadline exceeded')), timeoutMs);
  try {
    const response = await runFetch(url, init, controller.signal);
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

// Read a response body into a Buffer with a hard byte cap, cancelling the read
// (which settles the agent-disposal wrapper → releases the socket) the moment it
// exceeds the cap. Use instead of `arrayBuffer()` when the upstream size is
// untrusted — arrayBuffer() buffers the WHOLE body into RAM before any limit, so
// one oversized response with a missing/false content-length can OOM the process.
export const readBytesWithLimit = async (
  response: Response,
  maxBytes: number
): Promise<Buffer> => {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel('response too large');
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
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
