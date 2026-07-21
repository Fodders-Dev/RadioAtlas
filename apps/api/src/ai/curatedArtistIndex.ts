// Curated artist index — the L1 (authoritative) layer of find_stations_by_artist.
// Maps a free-form artist/band query («радио с Дискотекой Авария», «нюша»,
// «artik asti») to the ONE curated Radio-Vanya station dedicated to that artist,
// when we own one. Source of truth is curatedOverlay's CURATED_ARTIST_STATIONS
// (the rows carrying an explicit `artist`).
//
// Why this exists: the catalog's q-search is a single contiguous-substring match
// (service.ts buildSearchResponse), so an inflected query — «дискотекОЙ авария»
// (instrumental case) — is NOT a substring of the alias «дискотекА авария» and
// scores zero, which then trips the vibe→genre backstop and returns generic
// retro/pop stations instead of the dedicated one. Token-prefix matching here
// fixes the case-ending mismatch deterministically, with no DeepSeek call.
//
// Pure module: no catalog/route imports, no I/O. The live station CARD is fetched
// separately by the catalog tool provider (resolveArtistStation), keyed off the
// hit this returns.

import { CURATED_ARTIST_STATIONS } from '../catalog/curatedOverlay.js';
import type { CuratedArtistHit } from './types.js';

// Minimum shared leading characters for two LONG (≥4-char) tokens to count as the
// same word despite a different case ending («дискотека» ⊇ «дискотекой» → 8).
const MIN_PREFIX = 4;

// Lowercase → fold Cyrillic ё onto е (mirrors the catalog's foldCyrillic so the
// query and the curated keys normalize identically) → drop everything that isn't
// a Latin/Cyrillic letter or digit (spaces preserved) → collapse whitespace.
export const normalizeArtist = (value: string | null | undefined): string =>
  String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const tokensOf = (normalized: string): string[] => normalized.split(' ').filter(Boolean);
const LATIN_TOKEN = /^[a-z0-9]+$/;

// Two tokens are "the same word" when either is exactly the other (covers short
// tokens like «и», «дж») OR CYRILLIC words share a ≥MIN_PREFIX-char leading run
// (covers case endings: «авария»/«аварией», «дискотека»/«дискотекой»). Latin
// artist tokens require exact equality: English has no case endings here, while
// prefix matching turns The Weeknd into false hits on «week» and «weekend».
const tokenMatches = (queryToken: string, keyToken: string): boolean => {
  if (queryToken === keyToken) return true;
  if (LATIN_TOKEN.test(queryToken) || LATIN_TOKEN.test(keyToken)) return false;
  // A ≤3-char key token must match EXACTLY — a 1–3 char prefix is too weak and
  // would let «дж» swallow «джаз»/«django» etc.
  if (keyToken.length <= 3 || queryToken.length < MIN_PREFIX) return false;
  let shared = 0;
  const max = Math.min(queryToken.length, keyToken.length);
  while (shared < max && queryToken[shared] === keyToken[shared]) shared += 1;
  return shared >= MIN_PREFIX;
};

// True when EVERY token of the key (a curated name/alias) is covered by some
// token of the query — a token-set containment with case-tolerant matching. The
// key drives the loop (not the query) so extra query words («радио с …», «и»)
// never block a match; the brain strips most of them before we get here anyway.
export const artistTokensMatch = (queryNorm: string, keyNorm: string): boolean => {
  const keyTokens = tokensOf(keyNorm);
  if (!keyTokens.length) return false;
  const queryTokens = tokensOf(queryNorm);
  if (!queryTokens.length) return false;
  return keyTokens.every((keyToken) => queryTokens.some((qt) => tokenMatches(qt, keyToken)));
};

// Resolve a free-form artist query to the curated station dedicated to it, or
// null when we don't own one. Tries each station's artist name, display label
// and every alias as a candidate key; the first token-match wins.
export const resolveCuratedArtist = (query: string): CuratedArtistHit | null => {
  const queryNorm = normalizeArtist(query);
  if (!queryNorm) return null;
  for (const entry of CURATED_ARTIST_STATIONS) {
    const keys = [entry.artist, entry.displayName, ...entry.aliases];
    if (keys.some((key) => artistTokensMatch(queryNorm, normalizeArtist(key)))) {
      return {
        stationuuid: entry.fallbackUuid,
        artist: entry.artist,
        displayName: entry.displayName,
        name: entry.name,
        mount: entry.mount,
        matchTerms: [entry.name, entry.displayName, ...entry.aliases]
      };
    }
  }
  return null;
};
