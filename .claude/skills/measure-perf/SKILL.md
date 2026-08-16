---
name: measure-perf
description: Measure a performance or memory change in this project honestly — before/after, in separate processes, with a check that you measured the thing you think you measured. Use before shipping any optimisation, and before believing one.
---

# Measuring in RadioAtlas

This project has a history of plausible optimisations that measurement killed,
and of measurements that quietly measured nothing. Both failure modes are cheap
to avoid.

## Run each variant in its own process

A harness that measures variant A then variant B in one process reports the
**second** one as worse, in either order — that is GC lag, not a difference.
Spawn one process per variant and compare across runs.

```bash
for v in old new old new; do node --import tsx --expose-gc harness.mts $v; done
```

Use `--expose-gc` and force a collection before reading, or you are measuring
uncollected garbage.

## Prove you measured the real path

Every measurement here needs a tell that distinguishes the real work from a
cache hit:

- **A catalogue refresh takes ~70 seconds.** A response in milliseconds is a
  cache hit. `/catalog/summary` comes from an HOURLY bucket cache and never
  reaches the catalogue at all — drive `/catalog/search`, and wait out BOTH the
  raw TTL (`CATALOG_CACHE_TTL_MS`) and the hard-coded 5-minute profiled cache.
- **Wait for the boot warm to finish**, not for a guessed number of seconds.
  Poll until `/catalog/summary` reports a real station count.
- Log the duration next to the number so a cache hit cannot be mistaken for a
  result.

## RSS is not the heap

`--max-old-space-size` bounds the V8 old space; pm2's `max_memory_restart`
watches RSS; the gap between them here is ~90MB of code, stacks and
fragmentation. Sizing the flag from RSS turns a graceful restart into a fatal
OOM. `/observability` exposes `runtime:heap_used_mb`, `heap_total_mb`,
`external_mb` and `heap_limit_mb` for exactly this.

## Report what it did NOT fix

The measurements that mattered most in this repo were the negative ones: a
WeakMap search index saved 20MB of a 789MB peak, in-place normalisation saved
2-3MB instead of the expected 74MB, and "we fetch 110k stations and discard
half" turned out to be false. Write those down — `PLAN.md` keeps rejected
hypotheses so nobody re-litigates them.

Existing numbers live in `RUNBOOK.md` under "Catalogue refresh memory" and "The
heap cap". Read them before measuring the same thing again.
