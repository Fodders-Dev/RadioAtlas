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

export const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

export const isBlockedHost = (value: string, blockedHosts: string[]) =>
  blockedHosts.some((host) => getHost(value).includes(host));

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
