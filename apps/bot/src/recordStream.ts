// Recording PR1: the pure, testable core of "record a station's stream forward
// N minutes and hand back an MP3 file". Everything here is dependency-injected
// ({ fetch }, { spawn }) so it unit-tests with a mock fetch + mock spawn — no
// real ffmpeg, no network, exactly like inlineQuery.ts / billingForward.ts. The
// grammy glue (messages, keyboards, sending the file) lives in index.ts; the
// ffmpeg binary path (ffmpeg-static) is injected from there too, so this module
// stays free of the postinstall-heavy dependency.
import { buildStationStreamTargets } from './stationStreams.js';

// ---------------------------------------------------------------------------
// Station resolution (GET-only, against existing API endpoints)
// ---------------------------------------------------------------------------
export type StationDeps = {
  fetch: typeof fetch;
  apiUrl: string;
};

export type RecordStation = {
  stationuuid: string;
  name: string;
  url_resolved?: string | null;
  url?: string | null;
  homepage?: string | null;
};

export const SEARCH_LIMIT = 5;

// PR2: the Mini-App "Записать эфир" button deep-links to t.me/<bot>?start=rec_<id>
// so the bot's /start handler enters the recording flow with the station id.
export const RECORD_START_PREFIX = 'rec_';

export const parseStartPayload = (
  raw: string | undefined
): { kind: 'record'; stationId: string } | { kind: 'normal' } => {
  const trimmed = (raw ?? '').trim();
  if (trimmed.startsWith(RECORD_START_PREFIX)) {
    const stationId = trimmed.slice(RECORD_START_PREFIX.length).trim();
    if (stationId) return { kind: 'record', stationId };
  }
  return { kind: 'normal' };
};

export const searchStations = async (
  query: string,
  deps: StationDeps
): Promise<RecordStation[]> => {
  const trimmed = query.trim();
  if (!trimmed || !deps.apiUrl) return [];
  try {
    const response = await deps.fetch(
      `${deps.apiUrl}/catalog/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_LIMIT}`
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: unknown } | null;
    return Array.isArray(body?.items) ? (body.items as RecordStation[]) : [];
  } catch {
    return [];
  }
};

export const getStationById = async (
  stationId: string,
  deps: StationDeps
): Promise<RecordStation | null> => {
  if (!stationId || !deps.apiUrl) return null;
  try {
    const response = await deps.fetch(
      `${deps.apiUrl}/catalog/stations/${encodeURIComponent(stationId)}`
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { item?: RecordStation } | null;
    return body?.item ?? null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Duration presets + limits
// ---------------------------------------------------------------------------
export const DEFAULT_DURATION_SEC = 5 * 60;
export const DURATION_PRESETS_SEC = [5 * 60, 15 * 60, 30 * 60];
export const MAX_DURATION_SEC = 30 * 60;
export const MIN_DURATION_SEC = 30;
// Telegram bots cap file sends at 50 MB; keep a margin. At 128 kbps a 30-min
// recording is ~29 MB, so this guard never trips in practice — it's a backstop.
export const TELEGRAM_AUDIO_LIMIT_BYTES = 49 * 1024 * 1024;

export const clampDuration = (seconds: number): number => {
  if (!Number.isFinite(seconds)) return DEFAULT_DURATION_SEC;
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(seconds)));
};

// ---------------------------------------------------------------------------
// ffmpeg binary resolution (pure)
// ---------------------------------------------------------------------------
// Prefer a SYSTEM ffmpeg. The bundled ffmpeg-static (johnvansickle, fully static)
// SIGSEGVs on any network input on the prod VPS — a static-glibc DNS-resolve bug
// (lavfi encode works, network input crashes, ldd = "not a dynamic executable").
// The apt ffmpeg (dynamic, already on the VPS at /usr/bin/ffmpeg) records fine.
// ffmpeg-static stays as the dev/CI fallback. Order: FFMPEG_PATH env > a known
// system path that exists > ffmpeg-static.
const SYSTEM_FFMPEG_PATHS = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];

export const resolveFfmpegPath = (deps: {
  env: Record<string, string | undefined>;
  existsSync: (path: string) => boolean;
  staticPath: string | null;
}): string | null => {
  const override = deps.env.FFMPEG_PATH?.trim();
  if (override) return override;
  for (const candidate of SYSTEM_FFMPEG_PATHS) {
    if (deps.existsSync(candidate)) return candidate;
  }
  return deps.staticPath;
};

// ---------------------------------------------------------------------------
// ffmpeg argument builder (pure)
// ---------------------------------------------------------------------------
// A plain desktop-browser UA — some streams reject non-browser clients.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// I/O timeout (µs): if the input protocol stalls this long, ffmpeg gives up so a
// dead stream never hangs the job (the wall-clock kill is the harder backstop).
const RW_TIMEOUT_US = 15_000_000;

export const formatMskTimestamp = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);

export const buildFfmpegArgs = (params: {
  url: string;
  durationSec: number;
  stationName: string;
  outputPath: string;
  now: Date;
}): string[] => {
  const title = `${params.stationName} — ${formatMskTimestamp(params.now)} МСК`;
  return [
    // Overwrite the output path: a previous failed candidate may have left a file
    // there, and ffmpeg otherwise prompts on stdin (ignored → EOF → it aborts),
    // which would break the candidate fail-over on the first one that wrote.
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-rw_timeout',
    String(RW_TIMEOUT_US),
    // Candidate URLs come from the community catalog (Radio Browser) where the
    // scheme isn't validated. Whitelist only network protocols (NO 'file') so a
    // url=file:///…/.env can never make ffmpeg read & exfiltrate a local secret.
    '-protocol_whitelist',
    'http,https,tcp,tls,crypto',
    '-user_agent',
    BROWSER_UA,
    '-i',
    params.url,
    '-t',
    String(params.durationSec),
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-id3v2_version',
    '3',
    '-metadata',
    `title=${title}`,
    '-metadata',
    `artist=${params.stationName}`,
    '-f',
    'mp3',
    params.outputPath
  ];
};

// ---------------------------------------------------------------------------
// Concurrency limiter (module-level, in-memory, testable)
// ---------------------------------------------------------------------------
export const createRecordingLimiter = (
  options: { maxGlobal?: number; maxPerUser?: number } = {}
) => {
  const maxGlobal = options.maxGlobal ?? 2;
  const maxPerUser = options.maxPerUser ?? 1;
  let activeGlobal = 0;
  const perUser = new Map<number, number>();

  return {
    tryAcquire(userId: number): boolean {
      if (activeGlobal >= maxGlobal) return false;
      if ((perUser.get(userId) ?? 0) >= maxPerUser) return false;
      activeGlobal += 1;
      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      return true;
    },
    release(userId: number): void {
      activeGlobal = Math.max(0, activeGlobal - 1);
      const next = (perUser.get(userId) ?? 0) - 1;
      if (next <= 0) perUser.delete(userId);
      else perUser.set(userId, next);
    },
    get activeCount(): number {
      return activeGlobal;
    }
  };
};

// ---------------------------------------------------------------------------
// Recorder core (spawn + file-size injected)
// ---------------------------------------------------------------------------
// Minimal slice of ChildProcess we depend on — node's ChildProcess satisfies it
// and a test fake implements it without booting a process.
type FfmpegProcess = {
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): unknown;
};
export type SpawnLike = (command: string, args: string[]) => FfmpegProcess;

export type RecordStreamDeps = {
  ffmpegPath?: string | null;
  spawn?: SpawnLike;
  // Bytes of the produced file (0 if missing). Injected so the candidate loop is
  // unit-testable without touching the filesystem.
  probeSize?: (path: string) => Promise<number>;
  now?: () => Date;
  // Extra grace over the recording duration before the process is force-killed.
  killGraceSec?: number;
  // Cancel button: aborting kills the running ffmpeg AND stops the candidate
  // loop (so a cancel doesn't roll over into recording the next candidate).
  signal?: AbortSignal;
  log?: (line: string) => void;
};

export type RecordStreamInput = {
  streamCandidates: string[];
  durationSec: number;
  stationName: string;
  outputPath: string;
};

export type RecordStreamResult =
  | { ok: true; path: string; bytes: number; url: string }
  | {
      ok: false;
      reason: 'no-ffmpeg' | 'no-candidates' | 'all-failed' | 'too-large' | 'cancelled';
      bytes?: number;
    };

// A capture that produced fewer bytes than this is treated as an empty/failed
// stream → try the next candidate.
const MIN_VALID_BYTES = 4096;

const runFfmpeg = (
  spawn: SpawnLike,
  ffmpegPath: string,
  args: string[],
  killAfterMs: number,
  signal?: AbortSignal
): Promise<{ code: number | null; killed: boolean }> =>
  new Promise((resolve) => {
    const child = spawn(ffmpegPath, args);
    let killed = false;
    const kill = () => {
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(kill, killAfterMs);
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, killed });
    };
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });

export const recordStream = async (
  input: RecordStreamInput,
  deps: RecordStreamDeps = {}
): Promise<RecordStreamResult> => {
  const ffmpegPath = deps.ffmpegPath;
  if (!ffmpegPath) return { ok: false, reason: 'no-ffmpeg' };

  const spawn = deps.spawn;
  if (!spawn) return { ok: false, reason: 'no-ffmpeg' };

  // Defense in depth alongside the -protocol_whitelist arg: only ever hand ffmpeg
  // an http(s) URL, so a file:// / pipe: / concat: candidate from the catalog is
  // dropped before it can spawn anything.
  const candidates = input.streamCandidates.filter((url) => /^https?:\/\//i.test(url.trim()));
  if (!candidates.length) return { ok: false, reason: 'no-candidates' };
  if (deps.signal?.aborted) return { ok: false, reason: 'cancelled' };

  const probeSize = deps.probeSize ?? (async () => 0);
  const now = deps.now ?? (() => new Date());
  const killAfterMs = (input.durationSec + (deps.killGraceSec ?? 30)) * 1000;

  for (const url of candidates) {
    if (deps.signal?.aborted) return { ok: false, reason: 'cancelled' };
    const args = buildFfmpegArgs({
      url,
      durationSec: input.durationSec,
      stationName: input.stationName,
      outputPath: input.outputPath,
      now: now()
    });
    const { code, killed } = await runFfmpeg(spawn, ffmpegPath, args, killAfterMs, deps.signal);
    if (deps.signal?.aborted) return { ok: false, reason: 'cancelled' };
    const bytes = await probeSize(input.outputPath).catch(() => 0);

    // Only a clean exit with real audio counts. A non-zero exit, a wall-clock
    // kill (stalled stream), or a ~empty file → move on to the next candidate.
    if (code !== 0 || killed || bytes < MIN_VALID_BYTES) {
      deps.log?.(
        `record: candidate failed code=${code} killed=${killed} bytes=${bytes} url=${url}`
      );
      continue;
    }
    if (bytes > TELEGRAM_AUDIO_LIMIT_BYTES) {
      return { ok: false, reason: 'too-large', bytes };
    }
    return { ok: true, path: input.outputPath, bytes, url };
  }

  return { ok: false, reason: 'all-failed' };
};
