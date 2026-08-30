---
id: E3-T12d
epic: 3
title: Browser snapshot persistence and restore selection
priority: 321.94
status: in-progress
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
- 2026-08-04 — **Browser plumbing landed + `make verify-E3-T12d` GREEN (commit `c588599`).** Marking
  `partially-verified`: the mechanism is complete and the risk-bearing logic is proven natively, but two
  items are honest verification debt (below).
  - `crates/wasm/src/snapshot_store.rs`: IndexedDB `SnapshotStore` mirroring `idb_store.rs` — `chunks`
    (key=index) + `meta` (key 0) stores, strict-durability txns, quota-name surfacing, versionchange
    auto-close. `save()` clears old chunks, streams 1 MiB chunks in 16-chunk batched strict txns (slices
    only — no whole-blob dup), writes `meta` LAST as the all-present commit marker; `load()` reassembles
    via the codec (a torn store → "corrupt").
  - `crates/wasm/src/lib.rs`: `build_core_hash()` (crate-version identity), `snapshot_base` on
    `LinuxInner`, `set_snapshot_identity(build_core_hash(), base_binding)` on the persistent path, and
    `#[wasm_bindgen]` `saveSnapshot`/`persistSnapshot`/`readStoredSnapshot`/`importStoredSnapshot`/
    `overlayGeneration`/`advanceOverlayGeneration`/`restoreDecisionCode`/`loadSnapshotBlob` (maps
    `ColdBootReason::code()`). JS controller + `window.__snapshot*` hooks in `web/loader.js`/`main.js`.
    Spec `web/tests/e3-t12d-snapshot-restore.spec.js` (skips without the chunked-Alpine artifact).
  - `make verify-E3-T12d`: fmt-check + wasm32 clippy `-D warnings` (core/storage/wasm) + the two native
    suites (`restore_decision` 11, `snapmeta` 11) — **passes.** wasm-bindgen link verified via the
    pre-commit `wasm-pack build --release`.

## Verification debt (E3-T12d)
1. **In-browser end-to-end acceptance (AC1 production-sized save→reload→restore; AC2 reload cold-boot;
   AC3 export/import digest) is not run headlessly** — the only shape that owns a snapshot store is the
   chunked-Alpine persistent boot (busybox is initramfs-only, no persistence), which is the ~37-min
   OS-reaping Alpine browser boot. Run the spec on `dev`: `make web-build && (cd web && npx playwright
   test tests/e3-t12d-snapshot-restore.spec.js)` — same host constraint as E3-T19.
2. **Overlay-generation cross-reload liveness — reworked in `33fc230`.** The durable overlay metadata
   now carries the commit generation; block writes and the next metadata generation commit in one
   strict IndexedDB transaction; and a reopened machine reconstructs that value before the snapshot
   coherence guard runs. The exact-head controller-ready recording is
   `evidence/epic-3-t12d/node-alpine-overlay-generation-2026-08-30.json`; the full cold-userland file
   read remains unrecorded on this Mac because the modified-overlay boot exceeded the local watchdog.

### 2026-08-29 — worker diagnostic — truncated import accepted as resume

Ran the persistent snapshot hooks against the locally served restored `node-alpine` guest in Google
Chrome `152.0.7977.65` at `?guest=node-alpine&profile=1&jit=0`. The first boot restored the shipped
snapshot in `1,687.660ms`; before saving, `__snapshotDecision()` returned `missing`. A successful
`__snapshotSave()` took `1,751.800ms`, and the exported snapshot was `138,257,790` bytes with SHA-256
`238214f0e8976cf94d2e021cdbd231fa01530152661d1af7f4da54dd20dad73c`; its decision was `resume`.

For the adversarial truncation check, imported a copy with exactly one final byte removed
(`138,257,789` bytes). `__snapshotDecision()` still returned `resume`; the expected typed result is
`corrupt`. Re-importing the original returned `resume`, and the live guest control check
`echo T12D_LIVE_$((6*7))` produced `T12D_LIVE_42` with exit 0. Raw evidence is
`evidence/epic-3-t12d/node-alpine-snapshot-corruption-2026-08-29.json`.

This is a concrete acceptance failure, not a verification claim: the import path appears to describe
the supplied blob as its own complete snapshot, leaving the restore decision without an independent
expected-length or integrity check. The task remains verification-debt and needs implementation work
before a fresh verifier can sign off. The same exploratory run's reload probe timed out at 180 seconds
while the guest was booting; that result is recorded but no root cause is assigned here.

### 2026-08-29 — fresh verifier — VERDICT: refuted

- **Prediction:** Importing a snapshot with exactly one final byte removed must yield typed decision
  `corrupt` under AC2.
- **Observed:** The original snapshot was `138257790` bytes; the imported truncation was `138257789`
  bytes; `decisionAfterTruncatedImport` was `resume`, not `corrupt`, in
  `evidence/epic-3-t12d/node-alpine-snapshot-corruption-2026-08-29.json`.
- **Finding:** This violates the requirement that every invalid snapshot falls back to cold boot with
  a typed reason. The exercised path is `importStoredSnapshot` (`crates/wasm/src/lib.rs`), and the
  store creates metadata from the supplied blob length (`crates/wasm/src/snapshot_store.rs`), so the
  decision lacks an independent expected-length or integrity check.
- **Additional gap:** The same exploratory reload probe timed out after 180 seconds, so end-to-end
  reload evidence remains incomplete.

This is a verifier refutation requiring implementation rework and a fresh recording; no verified
status is claimed.

### 2026-08-30 — worker — rework started

The task is back in the active lane to repair the independently identified import-integrity gap.
The implementation slice will bind imported data to the already-persisted valid snapshot when one
exists, surface a typed `corrupt` decision on mismatch, preserve the live overlay, and add a
deterministic regression before a fresh browser recording.

### 2026-08-30 — worker — framing-integrity rework — implemented

- Commit: `86afb33373170bd7b91d527ca2eebe44b4e7b0aa`.
- Changes: `RestoreDecision::decide` now consumes the full section framing before returning `resume`;
  `importStoredSnapshot` rejects framing-corrupt input into a committed zero-length corrupt marker;
  the marker keeps the machine and overlay untouched and makes the next decision typed `corrupt`.
  The native regression covers a final-section truncation.
- Gates: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test restore_decision`; `cargo test
  -p wasm-vm-core --lib`; `cargo clippy -p wasm-vm-core -p wasm-vm-wasm --all-targets -- -D warnings`;
  `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; `wasm-pack test --node crates/wasm
  --test resume`; `make web-dist`; and `make verify-E3-T12d` — all passed. The known unrelated
  `crates/wasm/tests/hart_ctrl.rs` unused-import warning remains outside this diff.
- Exact-head browser evidence: `evidence/epic-3-t12d/node-alpine-snapshot-corruption-2026-08-30.json`,
  SHA-256 `8762f8227c370c6aef5a56fb6d61310a06670dad3efdfdd1596d6f6c41b01708`. It records the restored production
  Node guest at `86afb33`, a 138,279,943-byte snapshot, one-byte truncation → `corrupt`, original
  re-import → `resume`, live output `T12D_LIVE_42`, and zero console errors. The page screenshot is
  `/private/tmp/e3-t12d-browser-verification-2026-08-30.png`.

This implementation claim clears the refuted truncation behavior. It does not claim the separate
production-sized reload, quota/crash, two-tab race, or full export/import digest acceptance until a
fresh verifier records those paths.

### 2026-08-30 — fresh verifier — VERDICT: refuted

- **Prediction:** A payload-byte mutation that preserves section framing must not be accepted as a
  resumable snapshot under AC2.
- **Observed:** The exact-head recording clears the one-byte tail truncation (`corrupt`) and restores
  the original (`resume`), but `validate_container` only checks section headers, lengths, and tags.
  A same-length payload mutation can therefore pass `importStoredSnapshot` and reach
  `RestoreDecision::Resume` without an independent content check.
- **Finding:** AC2 remains refuted. Add an independent stored content digest or full semantic
  validation, and record a fresh attack proving the mutated payload returns typed `corrupt` while the
  original can still be re-imported.
- **Evidence gaps:** The recording does not prove production-sized save→reload→restore, memory bound,
  quota/crash, two-tab race, overlay-generation persistence, or export/import digest acceptance.
- **Provenance gap:** The evidence records runtime head `86afb33`; the evidence commit is `3fb54c0`.
  Re-record or explicitly bind the final evidence to the exact committed head before claiming
  verification.

This verdict returns the task to `refuted`; no verified status is claimed.

### 2026-08-30 — worker — payload-integrity rework started

The second rework slice adds a content digest to the durable snapshot metadata, verifies it on
reassembly, and preserves the expected digest in a corrupt marker so the bad import is reported as
`corrupt` while a subsequent import of the original snapshot can recover to `resume`. The browser
recording will be rerun after the final evidence commit with both truncation and same-length payload
mutation attacks.

### 2026-08-30 — worker — payload-integrity rework — implemented

- Runtime commit: `6d2b1244352e8963a2877f671d10eaf8c561968e`.
- Evidence: `evidence/epic-3-t12d/node-alpine-snapshot-integrity-2026-08-30.json` (SHA-256
  `a7e26fe8361e18f64538f0d6c48bf38f885eac5d84dd136e6bce58bb4468e866`; the recording's
  runtime head is the commit above; this follow-on commit contains only evidence/task metadata and
  the regenerated queue).
- Exact production-sized browser recording: a restored `node-alpine` whole-machine worker persisted
  a 138,252,418-byte snapshot; truncation and a same-length final-payload-byte mutation both produced
  typed `corrupt`; re-importing the original produced `resume`; export/import SHA-256 was identical;
  reload produced `resume`; advancing overlay generation produced `stale`; the live guest computed
  `T12D_LIVE_42` with exit 0; console errors were empty. Screenshot:
  `/private/tmp/e3-t12d-browser-verification-2026-08-30-digest.png`.
- Gates: `make verify-E3-T12d`; `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`;
  `wasm-pack test --node crates/wasm --test resume`; and `make web-dist` — all passed. The repository
  Playwright spec now carries the same truncation, payload-mutation, round-trip digest, reload, and
  stale-generation assertions; the direct run used the local Node/Playwright harness because the
  normal runner's large-artifact path is not available on this checkout.
- This clears the fresh verifier's payload-integrity refutation. Production-sized reload memory-bound
  instrumentation, quota/crash interruption, two-tab race, and persisted overlay-generation evidence
  remain separate verification debt; this worker entry does not claim them verified.

### 2026-08-30 — fresh verifier — VERDICT: needs-evidence

- **Payload-integrity slice — HELD.** The exact recording shows one-byte truncation and a same-length
  payload mutation returning typed `corrupt`, while re-importing the original returns `resume`; the
  content digest is independently equal before and after export/import. No refutation found in the
  repaired runtime path (`crates/wasm/src/snapshot_store.rs` and `crates/wasm/src/lib.rs`).
- **AC1 — NEEDS EVIDENCE.** The 138,252,418-byte recording proves production-sized save/reload/
  decision behavior, but does not measure peak memory against the documented bound. Record memory
  instrumentation during save and reload, not just the blob size.
- **High-risk adversarial coverage — NEEDS EVIDENCE.** The recording does not cover tab termination
  during clear/chunk/meta phases, quota exhaustion, object swapping, or two-tab races, nor does it
  assert that the live overlay remains intact after each attack. Record bounded independent attacks
  for the omitted phases before verification.
- **Overlay-generation persistence — NEEDS EVIDENCE.** The current spec proves only in-memory
  `advanceOverlayGeneration()` → `stale`; it does not prove a reload after a durable overlay write
  reconstructs the generation and refuses the old snapshot.
- **Provenance/coverage — HELD with a portability gap.** The evidence SHA matches the committed
  evidence file, `runtimeHead` is an ancestor of `HEAD`, and no runtime files changed afterward.
  The repository Playwright spec remains skipped on this checkout because the chunked-Alpine manifest
  is absent; the referenced screenshot is not a guest-terminal view. Preserve a portable browser
  recording bundle or rerun the spec on the artifact-bearing verifier host.
- Commands checked: `make verify-E3-T12d` (fmt, wasm32 clippy, 11 restore-decision tests, 11 snapmeta
  tests). Verdict: the payload-integrity refutation is cleared, but the task is not verified until the
  listed acceptance and adversarial evidence exists.

### 2026-08-30 — worker — overlay-generation persistence rework started

The fresh verifier identified a live correctness gap: a durable guest overlay write did not advance
the snapshot coherence generation, and a reopened machine therefore reset to generation 0. This
slice adds the generation to the persisted overlay metadata, commits it with each successful block
flush, reconstructs the machine from that metadata on reopen, and adds a reload-after-write proof.

### 2026-08-30 — worker — overlay-generation persistence — implemented

- Runtime commit: `33fc2308a2516f19191c255e4a1e6fec3831022c`.
- Changes: `OverlayMeta` now serializes a durable generation (while reading legacy generation-less
  metadata as generation 0); a persistent flush writes blocks and the next generation in one strict
  IndexedDB transaction; persistent reopen stamps the machine with the stored generation; and the
  worker protocol exposes the generation for evidence. The browser spec pauses/drains before taking
  a snapshot, then exercises a real guest write, stale selection, and post-reload reconstruction.
- Exact-head evidence: `evidence/epic-3-t12d/node-alpine-overlay-generation-2026-08-30.json`,
  SHA-256 `c90bd19314794f36965eb8ba7bd7c70cb6664c1b60b76985f0bf78e9c4c635d1`. It records generation
  `0` at snapshot time, `0 → 16` after the durable guest write, `stale` before reload, and generation
  `16` plus `stale` at persistent-controller readiness after reload, with zero console errors.
- Gates: `make verify-E3-T12d`; `cargo test -p wasm-vm-storage --lib` (106/106); `cargo test -p
  wasm-vm-core --test snapshot_coherence` (5/5); `cargo check -p wasm-vm-wasm --target
  wasm32-unknown-unknown`; and `make web-dist` — all passed. The repository Playwright spec remains
  artifact-gated on this checkout; the full cold-userland file-read continuation exceeded the local
  1,800,000 ms watchdog and is not claimed here.

The worker claim is limited to the generation-persistence slice. The task remains subject to fresh
verifier review and the previously listed memory-bound, crash/quota, two-tab, and portability proof
gaps.
