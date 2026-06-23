// Recording (tracklist): an ffmpeg-INDEPENDENT ICY metadata reader for the bot.
// While ffmpeg records the audio, this opens a SECOND http connection to the
// same resolved candidate URL with `Icy-MetaData: 1`, reads the metaint blocks
// for the recording window, parses each StreamTitle, timecodes it by wall-clock
// from the record start, and dedups consecutive repeats.
//
// Ported (copied + kept-in-sync — the monorepo has no shared package, same
// precedent as stationStreams.ts):
//   - the ICY metaint loop + StreamTitle extractor from
//     apps/api/src/media/metadataService.ts (extractIcyTrackTitle + the
//     icy-metaint read loop), reworked into a STREAMING state machine so it
//     reads MANY blocks across the whole window (the API version reads one and
//     returns).
//   - the trust normalizer normalizeTrustedTrackTitle from
//     apps/webapp/src/lib/trackTrust.ts (drops URLs, bare domains, the station's
//     own name/address, control-char & placeholder junk).
//
// Fail-isolated BY CONTRACT: readIcyTracklist never rejects — it resolves to a
// (possibly empty) array. The caller treats empty as "no tracklist" and sends
// the audio exactly as before. No new dependencies; global fetch + getReader().

export type TracklistEntry = {
  atSec: number; // seconds from record start, by wall-clock of reception
  title: string; // normalized "Artist - Title"
};

export type TracklistStation = {
  name: string;
  url_resolved?: string | null;
  url?: string | null;
  homepage?: string | null;
};

export type TracklistReaderDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
  // aborts the reader early (e.g. the recording was cancelled).
  signal?: AbortSignal;
  // per-candidate connect budget before moving to the next one (default 8s).
  connectTimeoutMs?: number;
};

export type TracklistOptions = {
  durationSec: number;
  station?: TracklistStation | null;
};

// ---- trust normalizer (copied from webapp trackTrust.ts; keep in sync) -------

const TECHNICAL_PAYLOAD = /^\{.*"(status|message|result|errorCode|error)".*\}\s*\d*$/i;
const URL_LIKE = /^https?:\/\/\S+$/i;
const BARE_DOMAIN_LIKE =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i;
const HTML_LIKE = /^<[^>]+>$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const FILLER_TITLES = new Set([
  '-',
  '--',
  '...',
  'loading',
  'loading...',
  'unknown',
  'unknown title',
  'unknown artist',
  'unknown song',
  'n/a',
  'none',
  'null',
  'undefined',
  'live',
  'live radio',
  'live stream',
  'live broadcast',
  'on air',
  'now playing',
  'currently playing',
  'stream',
  'radio',
  'no title',
  'no artist',
  'no track',
  'no track info',
  'no metadata',
  'metadata unavailable',
  'track metadata is not here yet',
  'трек ещё не пришёл',
  'трек еще не пришел',
  'нет трека',
  'нет данных',
  'загрузка',
  'без названия',
  // German — rautemusik.fm and other DE stations send these as their idle
  // "no current track" placeholder.
  'kein titel update',
  'kein titel',
  'kein song',
  'keine angabe',
  'unbekannt',
  // Spanish / Portuguese
  'sin titulo',
  'sin título',
  'sem titulo',
  'sem título',
  'desconocido',
  'desconhecido',
  // French
  'aucun titre',
  'titre inconnu',
  // Italian
  'titolo sconosciuto',
  // Polish
  'brak tytułu',
  'brak tytulu'
]);

const normalizeComparable = (value?: string | null) =>
  value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';

// Pull the hostname out of a free-form value that might be a URL, a bare domain,
// or already a hostname. Returns lowercased host with leading "www." stripped.
const extractHostname = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const normalizeTrustedTrackTitle = (
  value?: string | null,
  station?: TracklistStation | null
): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+-\s+/g, ' - ')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 180) return null;
  if (cleaned.includes('\uFFFD') || CONTROL_CHARS.test(cleaned)) return null;
  if (
    TECHNICAL_PAYLOAD.test(cleaned) ||
    URL_LIKE.test(cleaned) ||
    BARE_DOMAIN_LIKE.test(cleaned) ||
    HTML_LIKE.test(cleaned)
  ) {
    return null;
  }
  if (/^(error|failed|exception|timeout|forbidden|unauthorized)\b/i.test(cleaned)) return null;
  if (/^(.)\1{5,}$/.test(cleaned)) return null;
  if (!/[a-zа-яё0-9]/i.test(cleaned)) return null;

  const comparable = normalizeComparable(cleaned);
  if (FILLER_TITLES.has(comparable)) return null;
  if (station) {
    const stationName = normalizeComparable(station.name);
    const stationUrl = normalizeComparable(station.url_resolved || station.url);
    const stationHomepage = normalizeComparable(station.homepage);
    if (comparable === stationName || comparable === stationUrl || comparable === stationHomepage) {
      return null;
    }
    const valueHost = extractHostname(cleaned);
    if (valueHost) {
      const homepageHost = extractHostname(station.homepage);
      const streamHost = extractHostname(station.url_resolved || station.url);
      if (valueHost === homepageHost || valueHost === streamHost) {
        return null;
      }
    }
  }

  return cleaned;
};

// ---- StreamTitle decode (ported from metadataService.extractIcyTrackTitle) ---
// Try utf-8 then shift_jis and return the FIRST that yields a trusted, non-junk
// title for this station. Folding the trust filter into the encoding loop means
// a mojibake decode (replacement chars) is rejected and the next encoding tried.

const decodeStreamTitle = (
  metaBytes: Uint8Array,
  station: TracklistStation | null | undefined,
  log: (msg: string) => void
): string | null => {
  for (const encoding of ['utf-8', 'shift_jis'] as const) {
    try {
      const text = new TextDecoder(encoding).decode(metaBytes);
      const match = text.match(/StreamTitle='([^']*)'/) || text.match(/StreamTitle=([^;]*)/);
      if (match?.[1] == null) continue;
      const normalized = normalizeTrustedTrackTitle(match[1], station);
      if (normalized) {
        if (encoding !== 'utf-8') log(`tracklist: decoded ICY metadata via ${encoding}`);
        return normalized;
      }
    } catch (error) {
      log(`tracklist: decoder ${encoding} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
};

// ---- streaming metaint parser -----------------------------------------------
// The wire layout repeats: `metaint` audio bytes, then 1 length byte L, then
// L*16 metadata bytes (0 length = "no change this cycle"). We discard the audio
// and surface each completed metadata block. Unlike the API one-shot parser this
// keeps cycling for the whole window, retaining only the current meta block.

type MetaPhase = 'audio' | 'length' | 'meta';

const createMetaintParser = (metaint: number, onMetaBlock: (block: Uint8Array) => void) => {
  let phase: MetaPhase = 'audio';
  let audioRemaining = metaint;
  let metaRemaining = 0;
  let metaBuf = new Uint8Array(0);
  let metaFilled = 0;

  return (chunk: Uint8Array) => {
    let i = 0;
    while (i < chunk.length) {
      if (phase === 'audio') {
        const skip = Math.min(audioRemaining, chunk.length - i);
        i += skip;
        audioRemaining -= skip;
        if (audioRemaining === 0) phase = 'length';
      } else if (phase === 'length') {
        const lengthByte = chunk[i] ?? 0;
        i += 1;
        metaRemaining = lengthByte * 16;
        if (metaRemaining === 0) {
          phase = 'audio';
          audioRemaining = metaint;
        } else {
          metaBuf = new Uint8Array(metaRemaining);
          metaFilled = 0;
          phase = 'meta';
        }
      } else {
        const take = Math.min(metaRemaining, chunk.length - i);
        metaBuf.set(chunk.subarray(i, i + take), metaFilled);
        metaFilled += take;
        metaRemaining -= take;
        i += take;
        if (metaRemaining === 0) {
          onMetaBlock(metaBuf);
          phase = 'audio';
          audioRemaining = metaint;
        }
      }
    }
  };
};

const MAX_TRACKLIST_ENTRIES = 300;

// Read ONE candidate. Returns true once it committed (had a valid icy-metaint
// header) — even if the stream then ended — so the caller stops probing further
// candidates. Returns false on a missing header / connect error → try the next.
const readCandidate = async (
  url: string,
  station: TracklistStation | null | undefined,
  startMs: number,
  now: () => number,
  parentSignal: AbortSignal,
  connectTimeoutMs: number,
  log: (msg: string) => void,
  push: (entry: TracklistEntry) => boolean,
  fetchImpl: typeof fetch
): Promise<boolean> => {
  // Connect budget: a per-candidate timeout combined with the window/cancel
  // signal. On commit we drop the connect timeout and let the window signal
  // bound the body read.
  const connectSignal = AbortSignal.timeout(Math.max(1000, connectTimeoutMs));
  const candidateAbort = new AbortController();
  const probeSignal = AbortSignal.any([parentSignal, connectSignal, candidateAbort.signal]);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'RadioAtlas/1.0 (+tracklist)' },
      signal: probeSignal
    });
  } catch {
    return false; // connect error / timeout → next candidate
  }

  const metaintHeader = response.headers.get('icy-metaint');
  const metaint = Number(metaintHeader);
  if (!metaintHeader || !Number.isFinite(metaint) || metaint <= 0) {
    candidateAbort.abort(); // drop the socket; this candidate has no metadata
    return false;
  }

  const body = response.body;
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader) {
    candidateAbort.abort();
    return false;
  }

  log(`tracklist: reading ICY metaint=${metaint} from ${url}`);

  // Committed. The body read is bounded only by the window/cancel signal now.
  const bodySignal = AbortSignal.any([parentSignal, candidateAbort.signal]);
  let lastComparable = '';
  const parse = createMetaintParser(metaint, (block) => {
    const title = decodeStreamTitle(block, station, log);
    if (!title) return;
    const comparable = normalizeComparable(title);
    if (comparable === lastComparable) return; // consecutive dedup (still playing)
    lastComparable = comparable;
    push({ atSec: Math.max(0, Math.round((now() - startMs) / 1000)), title });
  });

  const onBodyAbort = () => reader.cancel().catch(() => {});
  bodySignal.addEventListener('abort', onBodyAbort, { once: true });
  try {
    while (!bodySignal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) parse(value);
    }
  } catch {
    // aborted (window ended / cancelled) or stream error — keep what we have.
  } finally {
    bodySignal.removeEventListener('abort', onBodyAbort);
    reader.cancel().catch(() => {});
  }
  return true;
};

// Public reader. NEVER rejects. Tries each candidate until one yields ICY
// metadata, reads it for the recording window, and returns the timecoded,
// consecutive-deduped tracklist (empty when no candidate exposes ICY).
export const readIcyTracklist = async (
  candidates: string[],
  options: TracklistOptions,
  deps: TracklistReaderDeps = {}
): Promise<TracklistEntry[]> => {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const fetchImpl = deps.fetch ?? (globalThis.fetch as typeof fetch);
  const connectTimeoutMs = deps.connectTimeoutMs ?? 8000;
  const windowMs = Math.max(0, Math.round(options.durationSec * 1000));
  const entries: TracklistEntry[] = [];
  if (!candidates.length || windowMs <= 0) return entries;

  const startMs = now();
  // The window deadline (plus any external cancel) bounds the whole read.
  const deadlineSignal = AbortSignal.timeout(windowMs);
  const windowSignal = deps.signal
    ? AbortSignal.any([deps.signal, deadlineSignal])
    : deadlineSignal;

  const push = (entry: TracklistEntry): boolean => {
    if (entries.length >= MAX_TRACKLIST_ENTRIES) return false;
    entries.push(entry);
    return true;
  };

  try {
    for (const url of candidates) {
      if (windowSignal.aborted) break;
      const committed = await readCandidate(
        url,
        options.station,
        startMs,
        now,
        windowSignal,
        connectTimeoutMs,
        log,
        push,
        fetchImpl
      );
      if (committed) break;
    }
  } catch (error) {
    log(`tracklist: reader failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return entries;
};

// ---- formatting -------------------------------------------------------------

export const formatTimecode = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

// Build the human tracklist block. Empty entries → '' (caller stays silent).
export const buildTracklistText = (entries: TracklistEntry[]): string => {
  if (!entries.length) return '';
  const lines = entries.map((entry) => `${formatTimecode(entry.atSec)} — ${entry.title}`);
  return `🎵 Треклист:\n${lines.join('\n')}`;
};
