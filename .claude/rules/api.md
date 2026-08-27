---
paths:
  - "apps/api/**"
  - "ecosystem.config.cjs"
---

# Working in apps/api

## What may leave this process

The API is the only process holding provider keys. The `/ai/chat` response body
is an **explicit allow-list** (`reply`, `stations`, `serviceLinks`, `sources`,
`actions`, a bounded `run`). Adding a field to `ChatResult` does not expose it —
adding it to that literal does. Operator-only signals (`modelErrors`,
`cardGate`, `constraintFilter`, `webSearchStatuses`) must stay server-side.

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

## Memory

The catalogue refresh is the heaviest moment the process has and the VPS is
oversubscribed. Before changing anything on that path, read the "Catalogue
refresh memory" section of `RUNBOOK.md` — the peak, the plateau and the two
rejected optimisations are already measured there.
