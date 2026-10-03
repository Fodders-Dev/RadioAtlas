import { request as httpsRequest } from 'node:https';

const UPSTREAM_HOST = 'api.tavily.com';
const UPSTREAM_PORT = 443;
const UPSTREAM_PATH = '/search';
const RELAY_PATH = '/tavily/search';
const MAX_AUTH_KEY_LENGTH = 512;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_CONCURRENT = 4;
const ALLOWED_FIELDS = new Set([
  'query',
  'search_depth',
  'max_results',
  'include_answer',
  'include_raw_content'
]);

const json = (res, status, value, { close = false } = {}) => {
  if (res.destroyed || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  if (close) res.setHeader('connection', 'close');
  res.end(body);
};

const authorizationKey = (req) => {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (tvly-[A-Za-z0-9_-]+)$/.exec(header);
  if (!match || match[1].length > MAX_AUTH_KEY_LENGTH) return null;
  return match[1];
};

const allowedPayload = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) return null;
  if (typeof value.query !== 'string' || value.query.length > 500) return null;
  const query = value.query.trim();
  if (!query) return null;
  if (value.search_depth !== undefined && value.search_depth !== 'basic') return null;
  const maxResults = value.max_results === undefined ? 5 : value.max_results;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 5) return null;
  if (value.include_answer !== undefined && value.include_answer !== false) return null;
  const includeRawContent = value.include_raw_content === undefined ? false : value.include_raw_content;
  if (includeRawContent !== false && includeRawContent !== 'text') return null;
  return {
    query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: includeRawContent
  };
};

/**
 * Make a bounded, fixed-destination relay for the single Tavily search route.
 * The returned synchronous handler claims its route by returning true; false
 * leaves the request for the existing loopback Telegram relay.
 */
export const createTavilyRelayHandler = ({
  request = httpsRequest,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxConcurrent = DEFAULT_MAX_CONCURRENT
} = {}) => {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('maxConcurrent must be a positive integer');

  let active = 0;

  return (req, res) => {
    const url = typeof req.url === 'string' ? req.url : '';
    const pathname = url.split('?', 1)[0];
    const isReservedPath = pathname === '/tavily' || pathname.startsWith('/tavily/');
    if (!isReservedPath) return false;

    // Never pass this namespace or its query strings to Telegram. Drain the
    // request so a rejected request cannot leave unread bytes on keep-alive.
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

    const apiKey = authorizationKey(req);
    if (!apiKey) {
      req.resume?.();
      json(res, 401, { error: 'unauthorized' }, { close: true });
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
      clearTimeout(timer);
      active -= 1;
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
    res.once('close', onResponseClose);

    // The wall-clock budget includes a slow request body, JSON parsing, and the
    // complete upstream response. It never resets when another chunk arrives.
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
    req.once('error', () => onClientAbort());
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

      let outbound;
      try {
        const outboundBody = Buffer.from(JSON.stringify(payload));
        outbound = request({
          hostname: UPSTREAM_HOST,
          port: UPSTREAM_PORT,
          method: 'POST',
          path: UPSTREAM_PATH,
          headers: {
            'content-type': 'application/json',
            'content-length': String(outboundBody.length),
            authorization: `Bearer ${apiKey}`
          }
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
          incoming.once('error', () => {
            if (!settled) finish(502, { error: 'upstream failure' }, { close: true });
          });
          incoming.once('end', () => {
            if (settled) return;
            if (status < 200 || status >= 300) {
              finish(502, { error: 'upstream failure' });
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
