import { request as httpsRequest } from 'node:https';

const UPSTREAM_HOST = 'api.openai.com';
const UPSTREAM_PORT = 443;
const UPSTREAM_PATH = '/v1/responses';
const RELAY_PATH = '/openai/responses';
const MAX_AUTH_KEY_LENGTH = 512;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OUTPUT_TOKENS = 1000;
const MAX_INPUT_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 100 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONCURRENT = 2;

const json = (res, status, value, { close = false } = {}) => {
  if (res.destroyed || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  if (close) res.setHeader('connection', 'close');
  res.end(body);
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.has(key));

const authorizationKey = (req) => {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]{1,512})$/.exec(header);
  if (!match || match[1].length > MAX_AUTH_KEY_LENGTH) return null;
  return match[1];
};

const validText = (value) => {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(['verbosity', 'format']))) return false;
  if (value.verbosity !== 'low') return false;
  if (value.format === undefined) return true;
  const format = value.format;
  return isRecord(format) && hasOnlyKeys(format, new Set(['type', 'name', 'strict', 'schema'])) &&
    format.type === 'json_schema' &&
    typeof format.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(format.name) &&
    format.strict === false && isRecord(format.schema);
};

const allowedPayload = (value) => {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set([
    'model', 'input', 'max_output_tokens', 'reasoning', 'text', 'store', 'safety_identifier'
  ]))) return null;
  if (value.model !== 'gpt-6-luna' || value.store !== false) return null;
  if (!Number.isInteger(value.max_output_tokens) || value.max_output_tokens < 1 || value.max_output_tokens > MAX_OUTPUT_TOKENS) return null;
  if (!Array.isArray(value.input) || value.input.length < 1 || value.input.length > MAX_INPUT_MESSAGES) return null;
  for (const message of value.input) {
    if (!isRecord(message) || !hasOnlyKeys(message, new Set(['role', 'content']))) return null;
    if (!['developer', 'user', 'assistant'].includes(message.role)) return null;
    if (typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_CHARS) return null;
  }

  const reasoning = value.reasoning;
  if (!isRecord(reasoning) || !hasOnlyKeys(reasoning, new Set(['effort', 'context']))) return null;
  if (!['none', 'low'].includes(reasoning.effort) || reasoning.context !== 'current_turn') return null;
  if (!validText(value.text)) return null;
  if (value.safety_identifier !== undefined &&
      (typeof value.safety_identifier !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.safety_identifier))) return null;

  return value;
};

/**
 * Handle the one Responses request shape used by modelClient. The fixed
 * destination and strict allow-list keep this from becoming a general proxy.
 */
export const createOpenAiRelayHandler = ({
  request = httpsRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxConcurrent = DEFAULT_MAX_CONCURRENT
} = {}) => {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > DEFAULT_MAX_CONCURRENT) {
    throw new TypeError('maxConcurrent must be between 1 and 2');
  }

  let active = 0;

  return (req, res) => {
    const url = typeof req.url === 'string' ? req.url : '';
    const rawPath = url.split('?', 1)[0];
    let decodedPath = rawPath;
    try { decodedPath = decodeURIComponent(rawPath); } catch { /* malformed paths still use raw namespace checks */ }
    const isReservedPath = rawPath.toLowerCase().startsWith('/openai') ||
      decodedPath.toLowerCase().startsWith('/openai');
    if (!isReservedPath) return false;

    // This namespace is private to the relay. Misspellings and query strings
    // must never be reinterpreted as Telegram Bot API paths.
    if (url !== RELAY_PATH) {
      req.resume?.();
      json(res, 404, { error: 'not found' }, { close: true });
      return true;
    }

    if (req.method !== 'POST') {
      req.resume?.();
      json(res, 405, { error: 'method not allowed' }, { close: true });
      return true;
    }

    const contentType = req.headers?.['content-type'];
    if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      req.resume?.();
      json(res, 415, { error: 'unsupported media type' }, { close: true });
      return true;
    }

    const apiKey = authorizationKey(req);
    if (!apiKey) {
      req.resume?.();
      json(res, 401, { error: 'unauthorized' }, { close: true });
      return true;
    }

    const declaredLength = Number(req.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      req.resume?.();
      json(res, 413, { error: 'request too large' }, { close: true });
      return true;
    }

    if (active >= maxConcurrent) {
      req.resume?.();
      json(res, 429, { error: 'too many requests' }, { close: true });
      return true;
    }

    active += 1;
    let settled = false;
    let upstreamRequest = null;
    let upstreamResponse = null;
    let timer;
    const release = () => {
      if (settled) return false;
      settled = true;
      active -= 1;
      clearTimeout(timer);
      req.removeListener('aborted', onClientAbort);
      res.removeListener('close', onResponseClose);
      return true;
    };
    const abortUpstream = () => {
      if (upstreamResponse && !upstreamResponse.destroyed) upstreamResponse.destroy();
      if (upstreamRequest && !upstreamRequest.destroyed) upstreamRequest.destroy();
    };
    const finish = (status, body, { close = false, destroyRequest = false } = {}) => {
      if (!release()) return;
      abortUpstream();
      json(res, status, body, { close });
      if (destroyRequest) {
        res.once('finish', () => {
          if (!req.complete && !req.destroyed) req.destroy();
        });
      }
    };
    const onClientAbort = () => {
      if (!release()) return;
      abortUpstream();
    };
    const onResponseClose = () => {
      if (!res.writableEnded) onClientAbort();
    };
    req.once('aborted', onClientAbort);
    req.once('error', onClientAbort);
    res.once('close', onResponseClose);

    // One absolute wall-clock budget covers upload, parsing and upstream work.
    timer = setTimeout(() => {
      finish(504, { error: 'upstream timeout' }, { close: true, destroyRequest: true });
    }, timeoutMs);
    timer.unref?.();

    const chunks = [];
    let requestBytes = 0;
    req.on('data', (chunk) => {
      if (settled) return;
      requestBytes += chunk.length;
      if (requestBytes > MAX_REQUEST_BYTES) {
        finish(413, { error: 'request too large' }, { close: true, destroyRequest: true });
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', () => {
      if (settled) return;
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks, requestBytes).toString('utf8'));
      } catch {
        finish(400, { error: 'invalid request' }, { close: true });
        return;
      }
      const payload = allowedPayload(parsed);
      if (!payload) {
        finish(400, { error: 'invalid request' }, { close: true });
        return;
      }

      const outboundBody = Buffer.from(JSON.stringify(payload));
      try {
        const outbound = request({
          hostname: UPSTREAM_HOST,
          port: UPSTREAM_PORT,
          method: 'POST',
          path: UPSTREAM_PATH,
          headers: {
            'content-type': 'application/json',
            'content-length': String(outboundBody.length),
            authorization: `Bearer ${apiKey}`
          },
          timeout: timeoutMs
        }, (incoming) => {
          upstreamResponse = incoming;
          if (settled) {
            incoming.destroy();
            return;
          }
          const status = Number(incoming.statusCode || 0);
          const responseChunks = [];
          let responseBytes = 0;
          incoming.on('data', (chunk) => {
            if (settled) return;
            responseBytes += chunk.length;
            if (responseBytes > MAX_RESPONSE_BYTES) {
              finish(502, { error: 'upstream failure' }, { close: true });
              return;
            }
            responseChunks.push(chunk);
          });
          incoming.once('aborted', () => {
            if (!settled) finish(502, { error: 'upstream failure' }, { close: true });
          });
          incoming.once('error', () => {
            if (!settled) finish(502, { error: 'upstream failure' }, { close: true });
          });
          incoming.once('end', () => {
            if (settled) return;
            if (status < 200 || status >= 300) {
              // Keep the provider's bounded status code so modelClient can
              // classify auth/rate-limit failures, while never returning its
              // body, headers, request id or diagnostic text.
              const safeStatus = status >= 400 && status <= 599 ? status : 502;
              finish(safeStatus, { error: 'upstream failure' });
              return;
            }
            if (!release()) return;
            const body = Buffer.concat(responseChunks, responseBytes);
            res.statusCode = status;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.setHeader('content-length', String(body.length));
            res.end(body);
          });
        });
        upstreamRequest = outbound;
        outbound.once('error', () => {
          if (!settled) finish(502, { error: 'upstream failure' }, { close: true });
        });
        outbound.end(outboundBody);
      } catch {
        if (!settled) finish(502, { error: 'upstream failure' }, { close: true });
      }
    });
    return true;
  };
};
