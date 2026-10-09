---
paths:
  - "apps/api/**"
  - "ecosystem.config.cjs"
---

# Working in apps/api

## Lira evaluation boundaries

`npm run eval:lira:offline` runs fixed catalogue contracts through the real
agent and catalogue adapter. Its separate entry must never import dotenv,
load provider credentials or contact a model; attempted model calls fail the
contract. Expected UUIDs/actions are independent of the agent verifier, and
catalogue-only cases must not produce external sources or service links.
This is contract coverage, not a model-quality score.

`eval:lira` remains the provider runner and requires an owner-agreed budget
before billable calls. Its offline preflight must pass before those calls;
keep the deterministic contract total separate from provider passRate.


## Reply context

Composer guidance separates accepted user intent from actual station lookup outcome.
No station rows does not prove an attempted or failed search. Keep conversation and
knowledge free from unsolicited selection/playback offers; assistant suggestions
are not user consent. The bounded context stays internal and adds no model call.
Cover changes through real brain message/tool/action fixtures; mocked prose does
not establish provider quality.

## Music conversation subject

Music facts/similar-song requests may replay at most six supplied USER turns;
filter roles before bounding. Explicit title/artist corrections update the
subject; assistant prose never supplies it. Historical live-only references
cannot recover old player metadata, so ambiguous followups clarify without
search/model calls. An explicit current-song question uses fresh metadata.
Keep artist and song subjects distinct: an artist-only context does not identify
a song for release/album questions. Radio/unrelated topic changes break replay;
historical Play never grants new playback permission. No new response fields,
persistent music memory or extra planner phase.

For this music-only evidence lane, discard obvious generator/template widget
snippets that do not mention the subject in their body before composer and
attribution. A matching page title alone does not make reusable generation
settings facts about the song. This narrow guard is not universal fact checking;
lyrics/general source behavior and existing search deadline/caps stay unchanged.

## Selection continuation

The first accepted recommendation plan may resolve an internal continue/new
choice against at most six actual USER turns. Freeze country/count/known explicit
exclusions before any station tool and use that context through final filters
and composer. A disconnected lexical refinement must pass the existing first
planner before a direct genre route. Assistant suggestions and historical Play
permission are never user consent. Malformed/ambiguous continuation must not
silently fall back to global recommendations. Keep this context off the response
allow-list; fixture plans establish execution contracts, not model interpretation.

## What may leave this process

The API alone loads and configures long-lived provider keys. The optional
Tavily fallback is a narrow transport exception: after a direct Tavily 403, the
API may send the bearer key in memory through the existing loopback/SSH hop to
the NL Telegram relay, which forwards the fixed `/tavily/search` request over
HTTPS to Tavily. The relay does not configure, persist or log the key; it accepts
only that route and a bounded field allow-list. The `/ai/chat` response body is
an **explicit allow-list** (`reply`, `stations`, `serviceLinks`, `sources`,
`actions`, a bounded `run`). Adding a field to `ChatResult` does not expose it —
adding it to that literal does. Operator-only signals (`modelErrors`,
`cardGate`, `constraintFilter`, `webSearchStatuses`) must stay server-side.

The opt-in GPT-6 Luna Telegram pilot is a second model configuration behind the
same admission controls, selected only by the trusted internal bot's exact
server-configured Telegram ID. Never expose a provider selector to the browser
or switch other listeners as a side effect. Its dedicated key travels in memory
through the loopback/SSH `/openai/responses` relay to a fixed OpenAI HTTPS URL;
unknown Authorization-bearing relay routes must not fall through to Telegram.
Pilot Tavily stays disabled. Preserve the lifetime comparison/trial budget
ledger outside release directories; missing state must fail closed, never
automatically recreate a fresh allowance. Model failures must not silently
serve DeepSeek to the pilot owner. See docs/LIRA-LUNA-PILOT-2026-10-09.md.

Raw web-search snippets and cleaned lyrics pages are grounding context, never
response payload.

## Persistent files must survive a restart AND a deploy

Three files outlive the process: the metrics store, the fallback catalogue
snapshot, and generated scene artwork. Rules learned the hard way:

- **Never resolve a persistent path from `import.meta.url`.** On the VPS that
  lands inside `/opt/RadioAtlas/releases/<sha>/`, so every deploy starts from
  nothing and `prune_old_releases` deletes the history. Production paths are
  pinned by env in `ecosystem.config.cjs` (`OBSERVABILITY_STORE_PATH`,
  `CATALOG_DATA_DIR`, `STATION_INTEL_DB_PATH`).
- **Write temp → rename, with a UNIQUE temp name per write, and unlink the
  partial file on any failure.** `sceneArtwork.ts` has the reference
  implementation. A shared `<target>.tmp` collides as soon as two writes overlap
  and the loser fails `ENOENT` — twice shipped, twice reverted.
- **One writer at a time, enforced inside the module.** Debouncing the caller
  only spaces out when writes start, not how long they take.
- A fire-and-forget `void somePromise()` with no `.catch` is a process killer:
  an unhandled rejection is fatal in Node.

## Deleting an account

`DELETE /me` (`deleteAccountCompletely` in `account/core/authService.ts`) is the
only route in this codebase that destroys rather than revokes. The privacy policy
promises it and Play requires it, so it has to be true, not approximately true.

`PRAGMA foreign_keys = ON` is set when the database opens, so the cascade does
most of the work: `providers`, `sessions`, `link_requests`, `audit_events` and
`billing_purchases` go with the row, and `station_profiles.owner_account_id` is
nulled (a broadcaster's profile is not the listener's data and outlives them).

**Two tables have no foreign key and will NOT cascade:**
`promotion_events.account_id` and `bot_subscriptions.account_id`. A plain delete
leaves both holding an id that identified somebody, pointing at an account the
schema no longer has. Both are cleared inside the same transaction. **If you add
a table that references `accounts`, either give it a real foreign key or add it
to that transaction** — nothing else in the system will notice that you didn't,
and the person who asked to be deleted will still be in the database.

No audit event is written for the deletion: `audit_events` cascades away with the
account, and a tombstone recording that this person deleted themselves would be a
record about them surviving the deletion they asked for.

`?confirm=delete` is required on top of a valid session. Every other DELETE here
is recoverable — a provider can be relinked, a session replaced by logging in
again — and this one is not.

## Counters and telemetry

Counter keys are the one structure the age-based prune never touches, so any key
built from caller input is an unbounded leak. Client event names are a closed
allow-list in `observability.ts`, kept honest by
`test/observability.clientEvents.test.ts`, which reads the webapp sources — add a
`reportProductEvent` name there and that test fails before CI does.

Retained agent runs deliberately carry **no prompt text**. When a question needs
production evidence about what users asked, add a counter, not a transcript.

Counters are cumulative and the store now outlives deploys, so a total is not a
rate: read `counterWindows.last1h` / `.last24h` from the snapshot, which carry
per-hour increments for the counters that moved. A new counter needs nothing
extra to appear there.

⚠ **Client counters are keyed `client_event:<name>`, not `<name>`.** The
RUNBOOK's own success-rate command got this wrong and printed `0/0` for months,
which reads as an idle box rather than as a broken command. Type a key you have
seen in the payload.

Windows answer "how is it going now". They cannot answer **"did that change
help"**: they come from 25 hourly buckets, so anything deployed yesterday has no
"before" left to compare against — found on 2026-09-02, when the effect of the
black-screen fix turned out to be unmeasurable. `counterDaily` is the other
half: 90 days, one entry per day with a readable date, for the short allow-list
in `DAILY_COUNTER_KEYS`. Adding a counter does NOT put it there, deliberately —
587 of this store's 624 keys are per-route, and keeping those for a quarter is
the cardinality problem `MAX_COUNTER_KEYS` exists to prevent, on a box whose
swap is already full. Add by exact name when a number is worth a quarter.

## The second way out, for a host that cannot reach half the world

The service runs on a Russian host now, and about **half the catalogue is
`http://`** — those streams can ONLY play through this proxy, because an
insecure stream on an `https://` page is mixed-content blocked in the browser.
So this server's own reachability decides whether they play at all.

Measured 2026-08-31 over 148 stations, two passes from each host:

| | pass 1 | pass 2 |
| --- | --- | --- |
| RU host | 122/148 (82.4%) | 123/148 (83.1%) |
| NL host | 135/148 (91.2%) | 135/148 (91.2%) |

**Eleven stations (7.4%) failed from RU in BOTH passes and succeeded from NL in
both** — one of them in the promoted pool of 48. Thirteen more were dead from
both hosts: a broken station, which no egress fixes. Three flipped between the
RU passes and are simply unstable, which is why this was run twice; a single
pass would have reported 13 and been wrong by two.

`media/foreignEgress.ts` is the fallback. Two rules about its shape:

- **It is a fallback, not a route.** Only a request whose every direct candidate
  failed pays the second hop. Sending everything abroad would double the
  bandwidth on both boxes, add a round trip for every listener, and defeat the
  point of being on a Russian host.
- **The far end is this same API on the other host.** `/stream?url=…` already is
  "fetch this and stream it back", with the same SSRF protection and rate
  limits, so there is no second implementation to keep in sync and no new
  service to run.

⚠ `EGRESS_HOP_HEADER` is not decoration. If two hosts ever name each other, an
unreachable station would bounce between them until something timed out, and the
symptom would be a pegged CPU and a listener hearing silence — no error anybody
would see. The header marks a request as already relayed and the handler refuses
to relay it again.

Off unless `MEDIA_FOREIGN_EGRESS_BASE` is set, and a malformed value is refused
rather than half-used — this path only ever runs when something is already
broken, which is the worst moment to discover a typo.

## Telegram is not reachable from the host this runs on

Measured 2026-08-31 from the Russian box: `api.telegram.org`, `telegram.org`
and `oauth.telegram.org` all fail to connect — TCP to :443 never opens, no
response in 20 s, three attempts each. Everything else the service depends on is
fine from there (Radio Browser `de1`/`all.api`, DeepSeek, Tavily, Google and VK
sign-in, Cloudflare R2), so this is specific and not a general outage.

That matters here because the API calls Telegram for **billing** —
`createInvoiceLink` and `getStarTransactions` in `routeSupport.ts`. On a host
that cannot reach Telegram, payments do not work.

`telegramApiRoot.ts` makes the host configuration (`TELEGRAM_API_ROOT`,
defaulting to Telegram's own). The bot has its own copy of the same fifteen
lines, deliberately duplicated: separate workspaces, no shared package, and a
dependency between them would cost more than the duplication. Both have tests
that name each other — change one, change both.

⚠⚠ **The bot token is in the PATH of every Bot API call** (`/bot<TOKEN>/method`).
Whatever `TELEGRAM_API_ROOT` points at sees the token on every request. It may
only be a host we own, over https, whose access log does not record paths. The
resolver enforces the transport half: plaintext is refused for anything but
loopback, and so are non-http schemes and any query or fragment.

⚠ An invalid value **throws at startup** rather than falling back to Telegram's
host. A fallback would leave billing quietly pointed somewhere it cannot reach,
which is indistinguishable from the outage this exists to fix, and would give
nobody a way to tell a typo from a blockade.

## Memory

The catalogue refresh is the heaviest moment the process has and the VPS is
oversubscribed. Before changing anything on that path, read the "Catalogue
refresh memory" section of `RUNBOOK.md` — the peak, the plateau and the two
rejected optimisations are already measured there.

## Repeat-exclusion budget

The optional internal getStationsByIds capability resolves at most the existing
128 mirror anchors in one metered operation from the in-process catalogue. Keep
all explicit UUID exclusions even after missing/failed resolution. Never turn
batch failure into an unbounded serial fallback or raise the six-call runner
limit to cover duplicate work. Nonmusic replies must not resolve anchors.
Provider-internal before-cap filtering still runs; do not claim one total
catalogue read for the entire turn.
