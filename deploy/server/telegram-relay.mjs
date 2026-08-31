// A loopback relay to the Telegram Bot API, for a host that cannot reach it.
//
//   TELEGRAM_RELAY_PORT=8399 node deploy/server/telegram-relay.mjs
//
// Measured 2026-08-31 from the Russian host: api.telegram.org does not answer —
// TCP to :443 never opens, three attempts, no response in 20 s. The bot there
// logs ETIMEDOUT in a loop and the API's billing calls (createInvoiceLink,
// getStarTransactions) cannot run at all.
//
// The path is: our process on the Russian box → http://127.0.0.1:<port> → an
// SSH tunnel → this relay on loopback of a host abroad → https://api.telegram.org.
//
// ⚠⚠ THE BOT TOKEN IS IN THE PATH OF EVERY REQUEST (`/bot<TOKEN>/method`).
// That is why this binds to LOOPBACK ONLY and why it never logs a path. In
// plaintext the token exists on the loopback interface of two machines we own
// and nowhere else: the hop between them is inside SSH, and the hop out of here
// is TLS to Telegram.
//
// Deliberately not Caddy: the Caddy on that box is the edge for other people's
// services, and a shared config is the wrong place to learn that a reload went
// badly.
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PORT = Number(process.env.TELEGRAM_RELAY_PORT || 8399);
const HOST = '127.0.0.1';
const UPSTREAM = 'api.telegram.org';
// Long, because /record uploads audio through here and Telegram is not quick
// about large files. Short enough that a wedged socket does not live forever.
const UPSTREAM_TIMEOUT_MS = Number(process.env.TELEGRAM_RELAY_TIMEOUT_MS || 120_000);

let served = 0;
let failed = 0;

const server = createServer((req, res) => {
  served += 1;

  // Rebuild the headers rather than forwarding them wholesale: `host` must name
  // the upstream or Telegram's router does not recognise the request, and the
  // hop-by-hop ones are ours, not theirs.
  const headers = { ...req.headers };
  delete headers.connection;
  delete headers['keep-alive'];
  delete headers['proxy-connection'];
  delete headers['transfer-encoding'];
  headers.host = UPSTREAM;

  const upstream = httpsRequest(
    {
      host: UPSTREAM,
      port: 443,
      method: req.method,
      path: req.url,
      headers,
      timeout: UPSTREAM_TIMEOUT_MS
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('upstream timeout'));
  });

  upstream.on('error', (error) => {
    failed += 1;
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    // The message, never the path — the path carries the token.
    res.end(JSON.stringify({ ok: false, error_code: 502, description: `relay: ${error.message}` }));
  });

  // If the caller goes away mid-upload, do not leave the upstream half-open.
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});

server.on('clientError', (_error, socket) => {
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`telegram-relay: ${HOST}:${PORT} -> https://${UPSTREAM} (paths are never logged)`);
});

// A heartbeat with counts and no paths, so "is it doing anything" is answerable
// from the journal without putting a token in it.
setInterval(() => {
  console.log(`telegram-relay: served=${served} failed=${failed}`);
}, 3_600_000).unref();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
