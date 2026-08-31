/**
 * A second way out, for stations this host cannot reach.
 *
 * The service now runs on a Russian host, and about half the catalogue plays
 * ONLY through this proxy: an `http://` stream on an `https://` page is
 * mixed-content blocked in the browser, so the server's own reachability
 * decides whether those stations play at all.
 *
 * Measured 2026-08-31 over 148 stations, two passes from each host: 122/148 and
 * 123/148 reachable from the RU box against 135/148 both times from the
 * Netherlands one. Eleven stations (7.4%) failed from RU in BOTH passes while
 * succeeding from NL in both — those are the ones this exists for. One of them
 * is in the promoted pool of 48. Thirteen more were dead from both hosts, which
 * is a broken station, not a routing problem, and no egress will fix it.
 *
 * So this is deliberately a FALLBACK and not a route: the overwhelming majority
 * of streams are fetched directly, and only a failed fetch pays the second hop.
 * Sending everything abroad would double the bandwidth bill on both boxes, add
 * a round trip to every listener, and defeat the point of being on a Russian
 * host in the first place.
 *
 * The far end is this same API running on the other host — `/stream?url=…` is
 * already exactly "fetch this and stream it back", with the same SSRF
 * protection and rate limits. No new service, no second implementation to keep
 * in sync.
 */

export type ForeignEgressConfig = {
  /** Base URL of the API on the other host, e.g. `https://…/api`. */
  base: string;
  timeoutMs: number;
};

/**
 * Marks a request as already being the second hop.
 *
 * Without it, two hosts that each name the other would bounce a failed stream
 * between them until something timed out — and the failure mode of a loop is
 * a pegged CPU and a listener hearing nothing, not an error anybody sees.
 */
export const EGRESS_HOP_HEADER = 'x-radioatlas-egress-hop';

export const readForeignEgressConfig = (
  env: NodeJS.ProcessEnv,
  defaultTimeoutMs: number
): ForeignEgressConfig | null => {
  const base = String(env.MEDIA_FOREIGN_EGRESS_BASE || '').trim();
  if (!base) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const configured = Number(env.MEDIA_FOREIGN_EGRESS_TIMEOUT_MS);
  return {
    // Normalised without a trailing slash so the join below is predictable.
    base: parsed.toString().replace(/\/+$/, ''),
    timeoutMs: Number.isFinite(configured) && configured > 0 ? configured : defaultTimeoutMs
  };
};

/** Pure, so the shape of the second hop is testable without a network. */
export const buildForeignEgressUrl = (base: string, target: URL | string): string => {
  const encoded = encodeURIComponent(typeof target === 'string' ? target : target.toString());
  return `${base.replace(/\/+$/, '')}/stream?url=${encoded}`;
};

/** Is this request itself already a second hop? */
export const isEgressHop = (headers: Record<string, unknown>): boolean =>
  String(headers[EGRESS_HOP_HEADER] || '') === '1';

export type ForeignEgressFetch = (
  url: string,
  init: { headers: Record<string, string> },
  timeoutMs: number
) => Promise<Response>;

/**
 * Try the other host. Returns the upstream response, or null if it could not
 * help — a null here must leave the caller's original error intact, because
 * "the station is down" and "we could not reach our own relay" are different
 * things and only the first should be reported to a listener as a dead station.
 */
export const fetchViaForeignEgress = async (
  config: ForeignEgressConfig,
  target: URL | string,
  init: { headers: Record<string, string> },
  fetchImpl: ForeignEgressFetch
): Promise<Response | null> => {
  try {
    const response = await fetchImpl(
      buildForeignEgressUrl(config.base, target),
      {
        headers: {
          ...init.headers,
          [EGRESS_HOP_HEADER]: '1'
        }
      },
      config.timeoutMs
    );
    if (!response.ok) {
      // Release the socket rather than abandoning it. A discarded body keeps
      // its agent pinned, and this path runs precisely when things are already
      // going wrong — the worst moment to start leaking connections.
      try {
        await response.body?.cancel();
      } catch {
        // already gone
      }
      return null;
    }
    return response;
  } catch {
    return null;
  }
};
