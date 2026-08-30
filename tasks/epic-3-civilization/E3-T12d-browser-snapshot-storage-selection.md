---
id: E3-T12d
epic: 3
title: Browser snapshot persistence and restore selection
priority: 321.94
status: in-progress
depends_on: [E3-T12c1, E3-T12c2, E3-T12c3, E3-T12c4]
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

### 2026-08-30 — fresh verifier — VERDICT: needs-evidence

- **Durable generation atomicity — HELD for implementation, NEEDS EVIDENCE for failure behavior.**
  Prediction: a successful overlay flush must write changed blocks and the next generation in one
  strict transaction, and advance the in-memory generation only after that transaction completes.
  The diff satisfies this at `crates/wasm/src/idb_store.rs:128-138,188-216` and
  `crates/wasm/src/lib.rs:1814-1859`; the narrow gate and focused metadata test passed. The supplied
  recording shows the successful path (`evidence/epic-3-t12d/node-alpine-overlay-generation-2026-08-30.json:21-27`),
  but has no abort, quota, or tab-kill observation, so atomicity under interruption remains unproven.
- **Reopen generation reconstruction — HELD.** Prediction: after a durable write, reopening must
  read the stored metadata generation before snapshot coherence is evaluated. The code does so at
  `crates/wasm/src/lib.rs:1090-1116,1223-1241`; the recording observes `0 → 16`, then generation `16`
  and `stale` after reload (`evidence/...overlay-generation-2026-08-30.json:21-32`). This proves the
  generation path, but not that the changed block bytes were also reconstructed: the record explicitly
  disclaims the post-reload shell/file read (`evidence/...overlay-generation-2026-08-30.json:34`).
- **AC1 and adversarial coverage — NEEDS EVIDENCE.** Peak memory versus the documented bound,
  interruption during clear/chunk/meta phases, quota exhaustion, two-tab races, and preservation of
  the live overlay are absent. Portability is also open: `make verify-E3-T12d` does not run the browser
  leg (`Makefile:544-550`), and the artifact-gated repository spec's post-reload file assertion at
  `web/tests/e3-t12d-snapshot-restore.spec.js:140-149` is not represented in this recording. Record
  bounded independent attacks and a portable artifact-bearing browser run, including the post-reload
  file read and memory instrumentation.
- **Payload integrity — HELD and carried forward.** The prior verifier's exact-head truncation,
  same-length mutation, typed `corrupt`, original re-import, and export/import digest results are not
  re-litigated.
- **Provenance/coverage — HELD with proof gaps.** The evidence SHA-256 is exactly
  `c90bd19314794f36965eb8ba7bd7c70cb6664c1b60b76985f0bf78e9c4c635d1`, `runtimeHead` is
  `33fc2308a2516f19191c255e4a1e6fec3831022c`, and only evidence/task files changed after that runtime
  commit. The changed Rust success path is exercised indirectly by the generation transition; the
  unrecorded post-reload file-read hunk and all fault/race paths remain unproven.

Commands: `make verify-E3-T12d`; `cargo test -p wasm-vm-storage meta_round_trips_a_durable_generation_and_reads_legacy_as_zero`;
`git diff --check 6d2b1244352e8963a2877f671d10eaf8c561968e 33fc2308a2516f19191c255e4a1e6fec3831022c`;
`shasum -a 256 evidence/epic-3-t12d/node-alpine-overlay-generation-2026-08-30.json`.

### 2026-08-30 — worker — parked as verification debt

Fresh verification remains `needs-evidence`, not `verified`. The durable generation commit and
reopen reconstruction are held, but the exact-head evidence still lacks peak-memory instrumentation,
interruption/quota/two-tab attacks, a portable artifact-bearing browser run, and the post-reload file
read that proves changed block bytes and metadata survive together. T12d is therefore leaving the
active lane with the verifier report preserved; it must return only when those named proof artifacts
can be recorded.

### 2026-08-30 — worker — resumed verification-debt clearance

The decomposed E3-T12c prerequisites (T12c1–T12c4) are all verified, so the stale parent
dependency was replaced with the verified leaves and T12d returned to the active lane. This
slice will record the missing browser proof: peak-memory instrumentation, bounded interruption
and quota attacks with overlay-preservation checks, a two-tab race, and the post-reload guest
file read. No implementation claim is made until the fresh recording covers those paths.

### 2026-08-30 — worker — browser verification-debt recording — implemented

- Runtime/evidence head: `e9664e557eb0b368887b852a8b991c1a4a10a88f`.
- Exact command: `make verify-E3-T12d` — fmt check, wasm32 clippy, 11 restore-decision tests,
  11 snapmeta tests, `make web-build`, and the headed raw-Playwright browser proof; all passed in
  `80,537ms`.
- Evidence: [`evidence/epic-3-t12d/browser-storage-2026-08-30.json`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json),
  SHA-256 `9baf83a964200bea93e0fbf107fab4f287bb3296dba01fc695ac19418270a852`; screenshot
  [`evidence/epic-3-t12d/browser-storage-2026-08-30.png`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.png),
  SHA-256 `ea8b95a72685157cd11fab7f7a3163bd26643660aa3dc22f9bf157a100af7e7c`.
- The production whole-machine Worker saved a `60,430,185`-byte snapshot and reloaded it with
  `missing → resume`. The main-thread memory leg measured `15,822,259` bytes overhead against the
  `33,554,432`-byte bound across 66 samples and observed `save-start`, clear, chunk, and meta
  commit callbacks. Fresh disposable contexts killed the tab during clear, chunk, and meta phases;
  each left the overlay intact and selected a safe `corrupt`/`stale` result. The quota attack
  raised a typed `QuotaExceededError`, left the overlay intact, and a live guest still returned
  `T12D_QUOTA_LIVE`. The two-tab race fenced the contender read-only (`persistResult: 0`), preserved
  the overlay, and allowed writer takeover after the first tab closed.
- After a real guest write, the modified overlay selected `stale` on reload; a proof-only Alpine
  main-thread JIT boot into `/bin/sh` then read `/root/t12d-reload-file` as
  `T12D_RELOAD_FILE` with exit 0. The clean save/restore leg remained the production Worker path;
  the fast-init override only avoids the unrelated local OpenRC startup cost for the changed-block
  read. All recorded browser contexts had zero console errors and no bad HTTP responses (the local
  server's absent favicon is the explicitly allowed 404).

This is a worker submission only; a fresh verifier must interrogate this exact recording and set the
terminal `verified` status.

### 2026-08-30 — worker — deployment attempt

`bash tools/deploy-cloudflare.sh` successfully verified the existing R2 objects and staged the
small boot artifacts, but Wrangler 4.127.1 stopped before the Pages publish because this
non-interactive environment has no `CLOUDFLARE_API_TOKEN`. The live Pages site is therefore not
claimed as updated; rerun the command after authenticating Wrangler or supplying that token.

### 2026-08-30 — fresh verifier — VERDICT: refuted

- **Provenance — HELD.** Prediction: the supplied recording must name the worker's exact runtime
  commit, have the claimed SHA-256, and include the screenshot. Observed `runtimeHead` is
  `e9664e557eb0b368887b852a8b991c1a4a10a88f` at
  `evidence/epic-3-t12d/browser-storage-2026-08-30.json:3`; its SHA-256 is
  `9baf83a964200bea93e0fbf107fab4f287bb3296dba01fc695ac19418270a852`, the screenshot exists and
  hashes to `ea8b95a72685157cd11fab7f7a3163bd26643660aa3dc22f9bf157a100af7e7c`, and `e9664e5` is
  an ancestor of current `HEAD` `8d12ef886b02e663235875bddba574c0775afeee`. The post-runtime diff
  contains evidence/task metadata and generated `web/dist` outputs, not a later runtime source edit.
- **AC1 / whole-blob load — FAILED.** Prediction: production-sized reload/restore must stay within
  the `33,554,432`-byte bound and must not hold a second whole snapshot allocation. The supplied
  memory record samples only the main-thread save callbacks (`...browser-storage-2026-08-30.json:18-33`),
  while `SnapshotStore::load` obtains all IndexedDB values and copies every chunk into a Rust map
  (`crates/wasm/src/snapshot_store.rs:279-290`), then `reassemble` allocates a full `total_len` output
  while that map still owns the chunk payloads (`crates/storage/src/snapmeta.rs:174-190`), followed by
  another JS `Uint8Array` copy at `crates/wasm/src/lib.rs:1927-1933`. For the recorded ~60 MB blob,
  this is a whole-payload map plus a whole-payload reassembly (and boundary copy), directly
  contradicting the deliverable's no-whole-blob-duplication requirement. The clean decision calls
  exercise `load`, but no load/reload memory sample exists in the harness (`tools/verify/e3-t12d-browser-proof.mjs:305-350`). Rework the load path to a genuinely bounded representation or record a design that proves the bound for the actual load/restore path.
- **Two-tab snapshot fencing — FAILED / INSUFFICIENT.** Prediction: a read-only contender must be
  unable to save or import a snapshot while another tab owns the persistent writer lease. The
  persistent constructor sets `snapshot_base` for read-only and writer tabs alike
  (`crates/wasm/src/lib.rs:1223-1234`), while `persist_snapshot` checks only that optional base and
  calls `store.save` without checking read-only ownership (`crates/wasm/src/lib.rs:1888-1908`); the
  import path can likewise write the store (`crates/wasm/src/lib.rs:1943-1989`). The recorded
  contender only calls overlay `__persist`, yielding `persistResult: 0`, and never races
  `snapshotSave`/`snapshotImport` (`...browser-storage-2026-08-30.json:551-567`,
  `tools/verify/e3-t12d-browser-proof.mjs:485-518`). Gate snapshot writes on the same ownership
  state and record a two-tab snapshot-store race.
- **AC2 attacks — PARTIALLY HELD, object-swap proof missing.** Prediction: killing clear/chunk/meta
  or exhausting quota must never select a half-published snapshot and must preserve the overlay. The
  recording observes clear/chunk/meta kills selecting `corrupt`/`stale` with `overlayPreserved: true`
  (`...browser-storage-2026-08-30.json:499-535`) and a typed `QuotaExceededError`, preserved overlay,
  and live guest marker (`:537-549`). The exact-head payload evidence independently holds truncation
  and same-length mutation as typed `corrupt`, original re-import as `resume`, and identical export /
  import digest (`evidence/epic-3-t12d/node-alpine-snapshot-integrity-2026-08-30.json:21-40`; its
  SHA-256 is unchanged and its runtime head is an ancestor). No recorded attack swaps complete
  snapshot objects/chunks or metadata between generations/bases, so that explicit high-risk angle
  remains `NEEDS EVIDENCE`.
- **Durable-generation and post-reload file — HELD within their stated scope.** Prediction: a durable
  overlay write must advance the generation, reconstruct it after reload, select `stale` for the old
  RAM snapshot, and preserve readable changed bytes. The prior exact-head generation record observes
  `0 → 16`, reconstructed generation `16`, and `stale` (`evidence/epic-3-t12d/node-alpine-overlay-generation-2026-08-30.json:21-32`); the current continuation observes
  `stale` and reads `T12D_RELOAD_FILE` with exit 0 (`...browser-storage-2026-08-30.json:569-579`).
  The Alpine `jit=1`, `init=/bin/sh`, single-user continuation is sufficient for this narrow
  changed-overlay IndexedDB/file-read assertion because it uses the same persistent chunked path; it
  is not evidence of a production OpenRC boot. The clean save/reload leg is correctly recorded as
  `whole-machine-worker` (`...browser-storage-2026-08-30.json:7-16`), but its `resume` decision does
  not repair the failed load-memory proof above.
- **Coverage and gates.** The current post-runtime hunks are either the evidence record, task/queue
  metadata, or generated deployment artifacts; `git diff --check` passed. Narrow checks passed:
  `cargo fmt --check -p wasm-vm-core -p wasm-vm-storage -p wasm-vm-wasm`; wasm32 clippy with
  `-D warnings`; restore-decision (11/11); snapmeta (11/11); storage lib (106/106); snapshot
  coherence (5/5); and `node --check` for the proof, loader, and main scripts. These gates do not
  establish the missing load bound or read-only snapshot fencing. Status returns to `in-progress`
  for runtime rework and a fresh exact-head recording; no merge or push performed.

### 2026-08-30 — worker — rework started after fresh verifier refutation

The verifier's evidence audit identified two runtime proof gaps rather than a generic test failure:
the browser load path still materialized all chunks plus a second whole-blob reassembly, and a
read-only persistent tab was not fenced from snapshot save/import. This slice replaces load with
sequential bounded chunk assembly, adds a direct wasm restore path that avoids the export copy, gates
both snapshot writes on writer ownership, and extends the browser recording with reload-memory,
snapshot-write fencing, and a cross-generation metadata-swap attack. The task remains `in-progress`
until a new exact-head recording is reviewed by a fresh verifier.

### 2026-08-30 — worker — snapshot proof rework — implemented

- Runtime/harness commit: `3d96209f22b24200385d84bb5a17861f3cf27742` (the preceding runtime rework is
  `db19a1e71e78dc4bf08fe3479eaf1da9b4bf625b`). The wasm loader now reassembles IndexedDB snapshots
  sequentially into one Rust buffer, restores directly inside wasm before fetching the shipped Alpine
  RAM fallback, and fences snapshot save/import to the persistent writer tab. The browser harness now
  records the explicit same-writer export/import round-trip as well as the high-risk storage attacks.
- Exact-head evidence: `evidence/epic-3-t12d/browser-storage-2026-08-30.json`, SHA-256
  `731eb9348a285947ba33b219f01e4faa3891729eb8effe3ecd3f20056448c8f4`; screenshot
  `evidence/epic-3-t12d/browser-storage-2026-08-30.png`, SHA-256
  `ea8b95a72685157cd11fab7f7a3163bd26643660aa3dc22f9bf157a100af7e7c`.
- `make verify-E3-T12d` passed at the exact head: the production whole-machine Worker saved
  60,430,185 bytes and reloaded with `resume`; export/import preserved the identical digest; the
  main-thread save overhead was 16,811,975 bytes under the 33,554,432-byte bound; the reload load
  staging overhead was 2,168,093 bytes under the same bound. Clear/chunk/meta interruption selected
  `corrupt`/`corrupt`/`stale`, quota surfaced `QuotaExceededError`, and every path preserved the
  overlay. The second tab was `read_only` and both snapshot save/import calls returned `read_only`;
  the cross-generation metadata swap selected `corrupt`; the modified-overlay reload selected
  `stale` and read `T12D_RELOAD_FILE` with exit 0. All recorded browser contexts had zero console
  errors and no disallowed HTTP responses (the missing favicon 404 is explicitly allowed).
- Supporting gates: `cargo fmt --all -- --check`; wasm32 clippy with `-D warnings`; restore-decision
  (11/11); snapmeta (11/11); `cargo test -p wasm-vm-storage` (106/106); wasm32 check; and JavaScript
  syntax checks. This is a worker submission only; a fresh verifier must interrogate this exact
  recording and set the terminal status.

### 2026-08-30 — worker — deployment attempt

`bash tools/deploy-cloudflare.sh` verified/staged the existing R2 boot objects but Wrangler 4.127.1
stopped before the Pages publish because this non-interactive environment has no
`CLOUDFLARE_API_TOKEN`. The live Pages site is not claimed as updated; rerun after authenticating
Wrangler or supplying that token.

### 2026-08-30 — fresh verifier — VERDICT: refuted

- **Provenance — HELD.** Prediction: the submitted recording must identify the exact runtime head,
  match its claimed digest, and include the named screenshot. Observed `runtimeHead` is
  `3d96209f22b24200385d84bb5a17861f3cf27742` at
  [`evidence/epic-3-t12d/browser-storage-2026-08-30.json:3`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json),
  the committed JSON SHA-256 is
  `731eb9348a285947ba33b219f01e4faa3891729eb8effe3ecd3f20056448c8f4`, and the named screenshot
  exists with SHA-256 `ea8b95a72685157cd11fab7f7a3163bd26643660aa3dc22f9bf157a100af7e7c`.
  `3d96209` is an ancestor of exact current `HEAD` `18bec4efff5a7c02f816f2a1e006467e1cb1bae1`;
  the source/runtime diff under review is `3fd720a..3d96209`. The screenshot was inspected and is a
  roadmap overview, so the JSON—not the screenshot—is relied on for the behavioral values.
- **AC1 — HELD for the recorded paths.** Prediction: a production-sized snapshot must save, reload,
  and restore without a second whole-payload staging allocation. The clean whole-machine Worker
  saved `60,430,185` bytes and kept the exact digest across export/import at
  [`browser-storage-2026-08-30.json:7-26`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json);
  the save probe measured `16,811,975 <= 33,554,432` bytes over 66 samples at
  [`:28-43`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json). The production-sized
  reload load path separately measured raw overhead `62,603,490`, payload `60,435,397`, and residual
  staging overhead `2,168,093 <= 33,554,432` at [`:596-611`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json).
- **AC2 named interruption/quota/object attacks — HELD.** Prediction: clear, chunk, meta, quota, and
  object-swap faults must never select a half-published resume and must preserve the overlay. The
  committed record observes `clear -> corrupt`, `chunk -> corrupt`, `meta -> stale`, all with
  `overlayPreserved: true`, at [`:509-545`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json);
  quota surfaces `QuotaExceededError`, the live guest exits 0 with `T12D_QUOTA_LIVE`, and the overlay
  remains intact at [`:547-559`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json). The
  cross-generation metadata swap selects `corrupt` with `overlayPreserved: true` at
  [`:581-587`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json). A fresh bounded browser
  probe also replaced a chunk with a plain object and observed the decision API resolve to the typed
  value `corrupt`.
- **AC3 — HELD.** Prediction: export/import must preserve the container byte count and SHA-256.
  Observed `60,430,185` bytes and digest
  `27f2f7a954763682fa18b206ba8503cf08f37917cffcbc683cb9f2ab233f67cc` before and after import at
  [`:11-23`](../../evidence/epic-3-t12d/browser-storage-2026-08-30.json).
- **Two-tab ownership after lease release — FAILED; this refutes the task.** Prediction: once a tab
  relinquishes the writer lease and another tab acquires it, the old live controller must be unable
  to mutate the shared snapshot namespace; otherwise the claimed single-writer fence permits a stale
  writer to destroy a newer owner's snapshot. In a fresh bounded whole-machine-Worker probe, the first
  controller reported `{backend: "whole-machine-worker", readOnly: false}`, explicitly released its
  writer lock, and the second controller acquired `{backend: "whole-machine-worker", readOnly: false}`.
  The old first controller then successfully resolved `snapshotImport(new Uint8Array([1,2,3]))` to
  `true`; the second controller's decision immediately changed to `corrupt`. The guard only checks
  the boot-time `lockReadOnly` closure at [`web/loader.js:960-962`](../../web/loader.js) and
  [`web/loader.js:987-989`](../../web/loader.js), while `releaseWriterLock` clears the release
  callback but never invalidates that flag at [`web/loader.js:996-1002`](../../web/loader.js). The
  wasm guards likewise use the construction-time `snapshot_read_only` field at
  [`crates/wasm/src/lib.rs:1900-1902`](../../crates/wasm/src/lib.rs) and
  [`crates/wasm/src/lib.rs:2003-2007`](../../crates/wasm/src/lib.rs). Demand that lease relinquishment
  retire or dynamically fence the old controller, then re-record the two-tab attack.
- **Coverage — NEEDS EVIDENCE.** The sequential `SnapshotStore::load`, direct wasm restore,
  read-only save/import, cleanup handlers, and the named browser attack helpers were exercised by the
  exact-head recording; the independent gates also passed `cargo fmt --all -- --check`, restore
  decision `11/11`, snapmeta `11/11`, snapshot coherence `5/5`, wasm32 check, and JavaScript syntax
  checks. The added `snapshotRestore` protocol allow-list/grace entries at
  [`web/linux-worker-protocol.js:18-25`](../../web/linux-worker-protocol.js) and
  [`:54-64`](../../web/linux-worker-protocol.js), plus the page hook at
  [`web/main.js:1371`](../../web/main.js), were not directly called by the submitted harness (the
  clean reload exercises the loader's internal restore instead). They are declarative/test-surface
  changes rather than a separate refutation, but remain unproven until an explicit Worker RPC restore
  call is recorded or the unused surface is removed.
- **Status:** remains `in-progress` after refutation; no runtime implementation files were changed.

Commands: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test restore_decision`
(`11/11`); `cargo test -p wasm-vm-storage snapmeta` (`11/11`);
`cargo test -p wasm-vm-core --test snapshot_coherence` (`5/5`);
`cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; JavaScript syntax checks; fresh
raw-Playwright replay and bounded whole-machine-Worker lease/object probes. No merge or push.
