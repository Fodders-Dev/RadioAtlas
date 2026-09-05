import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/**
 * A real radio stream that a test can starve, drop or refuse.
 *
 * ⚠ Why a real socket and not a Playwright route: `route.fulfill` hands the
 * browser a COMPLETE body, so the element has the whole thing buffered before
 * anything can go wrong. Every failure this acceptance run is about — a stream
 * that stops producing samples while the phone is in a pocket, a route that
 * refuses on the way back — is a property of an open connection over time. A
 * fulfilled response cannot express any of them.
 *
 * So this serves an ENDLESS WAV: a header declaring a length nobody will reach,
 * then 16-bit PCM written at real time. Chromium decodes it like any stream and
 * `currentTime` advances at 1 s/s, which is the only proof of audio this
 * project accepts.
 *
 * Three levers, each a different real failure:
 *
 *   starve()  stop writing, keep the socket open  -> the element freezes with
 *             `paused === false`. The nastier production shape, and the one
 *             `judgeBackgroundPlayback` exists for.
 *   drop()    destroy the sockets                 -> a network error mid-play.
 *   refuse()  answer every new request with 502   -> no candidate can connect,
 *             which is what "total failure" means from the app's side.
 *
 * `connections()` is the ground truth for «did the app start audio by itself».
 * It is counted HERE, by the thing being connected to, so it cannot be confused
 * with the test's own bookkeeping — the mistake that made an earlier retry test
 * assert its own narration.
 */

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const TICK_MS = 100;
const CHUNK_BYTES = Math.round((BYTES_PER_SECOND * TICK_MS) / 1000);

const wavHeader = () => {
  // A length no run will reach. The element treats it as a long file and keeps
  // reading; we control how much it actually gets.
  const dataSize = 0x7ffffffe - 44;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
};

/** A quiet tone rather than digital silence, so something is genuinely decoded. */
const toneChunk = (phaseStart: number) => {
  const frames = CHUNK_BYTES / BYTES_PER_SAMPLE;
  const chunk = Buffer.alloc(CHUNK_BYTES);
  for (let i = 0; i < frames; i += 1) {
    const t = (phaseStart + i) / SAMPLE_RATE;
    chunk.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * t) * 2000), i * BYTES_PER_SAMPLE);
  }
  return chunk;
};

export type StreamHit = { at: number; method: string; path: string; ua: string; range: string };

export type LiveStream = {
  url: string;
  /**
   * How many times anything opened the AUDIO path. The ground truth.
   *
   * ⚠ Audio only, and that distinction was earned: the server counted every
   * request, and a metadata/ICY probe against the same host read as "the app
   * started playing by itself". Attributing a probe to playback would have
   * reported a product defect that does not exist.
   */
  connections: () => number;
  /** Every request the server saw, so an unexpected one can be identified. */
  hits: () => StreamHit[];
  /** Stop writing samples; leave the socket open. Element freezes, not paused. */
  starve: () => void;
  /** Resume writing samples. */
  feed: () => void;
  /** Destroy every open socket: a network error mid-play. */
  drop: () => void;
  /** Answer new requests with 502 (and drop the open ones). */
  refuse: (on: boolean) => void;
  close: () => Promise<void>;
};

const AUDIO_PATH = '/live.wav';

export const startLiveStream = async (port: number): Promise<LiveStream> => {
  let connections = 0;
  const hits: StreamHit[] = [];
  let feeding = true;
  let refusing = false;
  const open = new Set<{ res: ServerResponse; timer: NodeJS.Timeout }>();
  const sockets = new Set<Socket>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || '').split('?')[0];
    hits.push({
      at: Date.now(),
      method: req.method || '?',
      path: req.url || '',
      ua: String(req.headers['user-agent'] || ''),
      range: String(req.headers.range || '')
    });
    if (path === AUDIO_PATH) connections += 1;
    if (refusing) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream refused');
      return;
    }
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'cache-control': 'no-store',
      // An icy-ish header set, so the app treats this the way it treats radio.
      'icy-name': 'Acceptance Live'
    });
    res.write(wavHeader());
    let phase = 0;
    const timer = setInterval(() => {
      if (!feeding || res.writableEnded) return;
      res.write(toneChunk(phase));
      phase += CHUNK_BYTES / BYTES_PER_SAMPLE;
    }, TICK_MS);
    const entry = { res, timer };
    open.add(entry);
    res.on('close', () => {
      clearInterval(timer);
      open.delete(entry);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  const dropAll = () => {
    for (const entry of open) {
      clearInterval(entry.timer);
      entry.res.destroy();
    }
    open.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };

  return {
    url: `http://127.0.0.1:${port}${AUDIO_PATH}`,
    connections: () => connections,
    hits: () => hits.slice(),
    starve: () => {
      feeding = false;
    },
    feed: () => {
      feeding = true;
    },
    drop: dropAll,
    refuse: (on: boolean) => {
      refusing = on;
      if (on) dropAll();
    },
    close: async () => {
      dropAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
};
