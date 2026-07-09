---
id: E3-T07
epic: 3
title: Benchmark IndexedDB vs OPFS backends and select the default
priority: 330
status: pending
depends_on: [E3-T05, E3-T06]
estimate: S
capstone: false
---

## Goal
A reproducible benchmark page comparing `IdbBackend` and `OpfsBackend` on identical
workloads, a written decision selecting the default backend, and a runtime selector that
prefers the default and falls back cleanly — both backends staying alive behind the
`BlockBackend` trait.

## Context
**Groomed 2026-07-06:** deferred with E3-T06 (needs both backends; OPFS is blocked on
E4-T22 worker infra). Until this runs, IndexedDB (E3-T05) is the de-facto default backend.
The "both backends pass the crashtest" acceptance line from E3-T08 is re-checked here.

The expectation is OPFS-with-sync-handles wins by a wide margin on 4 KiB random writes and
commit latency, but the decision must be measured, per browser, not assumed — and IndexedDB
must remain a maintained fallback for any environment without sync access handles. The
selector logic belongs at backend construction time (capability probe from T06, then user
override via a query param for debugging, e.g. `?backend=idb`). Whichever loses stays in CI
so it can't rot: both backends keep running the T04 conformance proptest in the browser
harness.

## Deliverables
- `web/bench/blocks.html` benchmark page driving both backends through the wasm boundary:
  4 KiB random write IOPS, 64 KiB sequential write MB/s, random read IOPS (warm), `commit`
  latency (p50/p99), each over ≥3 runs with variance reported.
- `docs/design/block-backend-choice.md`: result tables for Chrome + Firefox + Safari (or a
  recorded note for any browser unavailable in the dev environment), the decision, and the
  fallback ladder (OPFS → IndexedDB → in-memory with a "non-persistent" warning).
- Backend selector in the boot path implementing that ladder + `?backend=` override.
- CI: both backends' conformance tests wired into the browser test suite.

## Acceptance criteria
- [ ] Benchmark page produces all metrics for both backends in one click and renders a table.
- [ ] Decision doc contains real numbers from at least two browser engines.
- [ ] Boot path selects the default automatically; `?backend=idb` and `?backend=opfs` force
      each backend, verifiable via a startup log line naming the active backend.
- [ ] In a simulated no-OPFS environment (capability probe stubbed false), boot proceeds on
      IndexedDB with no code change.
- [ ] Browser CI job runs the T04 conformance suite against both backends and is green.

## Adversarial verification
Re-run the benchmark three times and compare against the doc's numbers: if the published
ranking flips between runs and the doc doesn't discuss variance, refute. Force each backend
via query param and repeat T05/T06's write-reload-readback test to prove the selector doesn't
mix backends between sessions (writing via OPFS then reloading into IDB and losing data is a
refutation — the selector must persist/rediscover the same choice for an existing overlay).
Check the in-memory last-rung fallback actually warns the user visibly. Inspect the bench for
cheating: measurements must include the wasm-boundary cost, not just raw JS API calls.

## Verification log
(empty)
