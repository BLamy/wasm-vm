---
id: E3-T12d
epic: 3
title: Browser snapshot persistence and restore selection
priority: 321.94
status: pending
depends_on: [E3-T12c]
estimate: S
risk: high
capstone: false
---

## Goal
Persist coherent snapshots in the browser and select restore versus cold boot using exact build,
base-image, and overlay-generation validation.

## Deliverables
- Bounded streaming snapshot save/load storage plus export/import without whole-blob duplication.
- A typed browser restore decision API returning resume or a specific cold-boot reason.
- Browser tests for corrupt, truncated, stale, missing, and valid snapshots across reload.

## Acceptance criteria
- [ ] `make verify-E3-T12d` saves, reloads, validates, and restores a production-sized snapshot
  without exceeding the documented memory bound.
- [ ] Every invalid snapshot falls back to cold boot with a typed reason and leaves local overlay
  state intact.
- [ ] Export/import round-trips the identical container digest.

## Adversarial verification
Kill the tab during each storage phase, truncate or swap snapshot objects, exhaust quota, and race
two tabs opening the same snapshot. Any half-published snapshot selected for restore, silent data
loss, whole-RAM duplicate allocation, or ambiguous fallback refutes.

## Verification log
- 2026-08-04 — **Foundation: the two risk-bearing PURE layers landed + native-tested (commit `6c78f9e`).**
  The c1–c4 Rust snapshot machinery (`Machine::save_resume`/`load_resume`, coherence header) was
  complete but NOT exposed to the browser; T12d adds the browser decision + storage on top. Two pure,
  headlessly-tested layers first:
  - `crates/core/src/resume.rs`: `RestoreDecision` + `ColdBootReason`. `RestoreDecision::decide(stored,
    core, base, gen)` is the typed resume-vs-cold-boot gate — it mirrors the guard `load_resume` runs
    first, so a `Resume` verdict means coherence won't be what rejects the load. The whole failure space
    partitions into typed reasons: `missing` / `corrupt` / `foreign_build` / `foreign_image` / `stale`.
    `ColdBootReason::from_snapshot_error` maps a restore-time `SnapshotError` onto the SAME space, so a
    pre-check and a load failure yield one uniform reason (AC2's "typed reason"). 11 tests
    (`crates/core/tests/restore_decision.rs`).
  - `crates/storage/src/snapmeta.rs`: `SnapshotMeta` (identity + shape), `snapshot_store_name`
    (per-base-image namespaced `wvsn-<hex>`), and the chunking codec. `reassemble()` validates
    completeness against the meta (every chunk present with its EXACT expected length) → a torn/half-
    published store is a typed `TornChunk` error → cold boot, never a truncated resume (AC2 adversarial:
    "any half-published snapshot selected for restore … refutes"). `SNAPSHOT_CHUNK=1MiB` streams the
    ~60 MB blob without a second whole-blob copy (AC1 memory bound). 11 tests (`snapmeta/tests.rs`).
- IN PROGRESS: the browser plumbing (wasm-bindgen `saveSnapshot`/`loadSnapshotBlob`/`overlayGeneration`/
  `advanceOverlayGeneration`/`restoreDecisionCode` on `WasmLinux`; an IndexedDB `SnapshotStore` mirroring
  `idb_store.rs` with strict-durability chunked save/load + quota surfacing; JS `window.__snapshot*` test
  hooks; `make verify-E3-T12d`). The full in-browser production-sized save→reload→restore proof (AC1) is
  the OS-reaping-prone Alpine-boot path (see [[browser-alpine-boot-reaped-on-mac]]) — provable on `dev`,
  like E3-T19; the busybox-persistent path exercises the decision/store logic headlessly-fast.
