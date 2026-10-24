---
id: E9-T22l
epic: 9
title: Admit bounded local session metadata above the portable payload cap
priority: 524.922029
status: verified
depends_on: [E9-T22k]
estimate: S
risk: high
capstone: false
---

## Goal

Let a real long exact-GPU local session continue beyond the shared manifest's
4 GiB aggregate payload cap without changing portable archive admission.

## Boundary

One explicit local-versus-portable manifest policy in the native codec and
its browser callers. Local validation, append, references, publication, open,
GC and reader paths may admit a bounded history above 4 GiB. Portable bundle,
storage-only witness archive and immutable import/export keep the 4 GiB bound.
Keep the 4 GiB per-blob bound, 1 MiB encoded manifest bound, index limits,
64 GiB local graph ceiling, 8 GiB configured physical retention, object
hashing, replay semantics and checkpoint cadence unchanged. E9-T22c owns the
next complete cold-workload run.

## Acceptance criteria

- [ ] Independently reproduce the exact E9-T22c `cold-257` rejection from
      the retained failed prefix, account for committed/candidate event and
      checkpoint lengths, and admit the candidate through local validation.
- [ ] Prove above-4-GiB local publication, reopen, witness graph inventory,
      GC and GPU-reader admission with intact references and no revision or
      epoch acknowledgement on failure. A local aggregate bound remains explicit.
- [ ] Prove the same candidate is rejected for both portable export paths and
      immutable archive admission; preserve the old per-blob and 4 GiB portable
      boundaries on native and Wasm.
- [ ] Run scoped high-risk native/Wasm/browser gates, threat-model attacks,
      exact-head evidence and a final cold clone; obtain a fresh actual
      Daybreak adversarial verdict and verify the production demo.

## Deterministic acceptance

`E9_T22L_DESKTOP=target/evidence/e9-t22c-submission-bcc6bc1c4/desktop make
verify-E9-T22l`: reconstruct and replay the saved failed candidate in a copy
of the retained browser state, run focused native/browser policy attacks and
the built demo. A pristine clone must point `E9_T22L_DESKTOP` at the retained
absolute path. A resumed prefix is not C's full workload acceptance.

## Adversarial verification

Cross 4 GiB with deduplicated checkpoint references and event chunks. Admit a
local candidate below its explicit ceiling, reject one byte above that ceiling,
and prove rejection is atomic. Attempt portable export/import through every
entry point, including a misleading `scope: local`; reject oversized single
blobs, malformed append prefixes and absent/corrupt referenced objects. Audit
every changed caller so archive and immutable readers cannot silently choose
local policy. Sabotage one bound assertion and prove the focused test fails.

## Verification log

### 2026-10-24 — Daybreak verifier — VERDICT: verified

- P1 exact failed boundary — **HELD.** Predicted a fresh reconstruction from the retained
  `bcc6bc1c4` browser state would uniquely recover `cold-257`, account for the committed
  4,291,892,438 bytes plus the 4,642,115-byte candidate increment, admit the resulting
  4,296,534,553-byte manifest locally and reject it portably. The independent replay produced
  candidate SHA-256 `7e3695bb903112a43d6f1d3a04c85f7a727573b15a6848b7ecccaaabe5decf57`
  and a report byte-identical to the worker's, SHA-256
  `e9edcaa41fa1be104770a5795025142f64e4fcda9db2d0a62fb93178553e68cd`.
- P2 local publication and atomic failure — **HELD.** Predicted the saved-profile run would
  publish revision 495→496, reopen the exact manifest, authenticate all 2,138 references,
  remove only the corrupt unrequested orphan, survive post-GC reopen, reach the unfinished
  commitment check through the local GPU reader, and reject a 64-GiB-plus-one candidate before
  publication while acknowledging the frozen RAM epoch only with `false`. The report records
  every value, including 5,994,290,586 reachable physical bytes below 8 GiB, zero publication
  attempts for the over-limit candidate and revision 496 after failure. Citation: exact-browser
  report SHA-256 `ff1fe2ddcfe8dfce7e735e8445262cbab06fd332b6a107103303beeba0553ce0`
  and trace SHA-256 `ce986e0f6c0b42b01051bfd129899e6951df34a2a976f1829c280f0149fd2143`.
- P3 portable and per-blob boundaries — **HELD.** Predicted storage-only archive through both
  ordinary and misleading `scope: 'local'` options, playback export and immutable GPU reading
  would return typed `BundleBound`; local validation would still reject a blob above 4 GiB and
  malformed, missing or corrupt references. The prefix and browser reports record all refusals;
  focused native tests independently passed the exact 64-GiB edge, one-byte overflow, 4-GiB
  portable rejection and per-blob guard.
- P4 exact-head and browser evidence — **HELD.** Runtime evidence is frozen at
  `8b85004ea130390b617f296cc3d8380d879f5218`; report heads and served hashes agree with that
  commit. The pristine sparse clone at the same head passed the acceptance with scrubbed Cargo
  and Rust flags and remained clean. Cold report SHA-256 values are prefix
  `e9edcaa41fa1be104770a5795025142f64e4fcda9db2d0a62fb93178553e68cd`, browser
  `c63a4d239cad173dd820c918a6c1690ca8573d3657af2651d22d07f88114b269`, trace
  `fb51aa3975b205650f629abd776922609533bc69094be79ca3e6a8bdeb73d327`, and demo
  `dac029e693910fde5608a8321416b80c699e0647c2ec1366a4805fec64c0ddd3` (127 passed,
  0 failed, no browser/HTTP errors). Source/dist pairs, generated bindings/build ID, task ledgers
  and Make wiring are **WAIVED** as generated or declarative support exercised by both acceptance
  runs; every semantic Rust and browser caller hunk is covered by focused tests, the exact-browser
  trace, or the cited supplemental caller reports.
- P5 supplemental caller compatibility — **HELD.** Full/delta keyframes, software/GPU bundles,
  real Linux and hardware-GPU branching, legacy GPU checkpoints, and real Linux input/file
  transfer all passed at the frozen head. The two older software-checkpoint runs also completed
  this diff's changed local publication path at revision 1, preserved it through injected failure,
  reloaded and restored byte-exact state before failing the unchanged stop-ownership helper.
  That reproducible helper result predates this diff (`4169888c59`) and does not contradict L's
  manifest-policy claim; retain it as a separate integration finding rather than relabeling either
  failed run.
- P6 sabotage sensitivity — **HELD.** In the pristine scratch clone, inverting the new local
  admission assertion made `cargo test -p wasm-vm-storage --test session_local` fail 1/2 at the
  changed assertion with the actual value still admitted; restoring it returned the focused suite
  to 2/2.
- Novel conflicting-reference attack — **HELD.** A scratch-only local manifest added a second
  role with the same authenticated hash but a different declared length. Local manifest syntax
  remained admissible, while `references_local` rejected the deduplicated collision with
  `LengthMismatch`; no ambiguous physical object entered publication.
- SUITE: retain `crates/storage/tests/session_local.rs`, the exact failed-prefix/browser harnesses
  and `verify-E9-T22l`. The scratch collision duplicates the existing shared reference-conflict
  invariant and is not promoted. No complete E9-T22c workload or performance claim follows.

Commands: `cargo test -p wasm-vm-storage --test session_local`; fresh
`node tools/verify/e9-local-manifest-repro.mjs ...`; isolated assertion sabotage and conflicting
deduplicated-reference attack in `/private/tmp/e9-t22l-cold-proof-20261024`; read-only report,
trace, diff and caller audit from failed parent `bcc6bc1c4` through frozen runtime head
`8b85004ea` and submission head `050b7baf1`.

### 2026-10-24 — worker — implemented at frozen runtime head `8b85004ea130390b617f296cc3d8380d879f5218`

`E9_T22L_DESKTOP=<absolute retained E9-T22c bcc6bc1c4 desktop> E9_OUT=target/evidence/e9-t22l-submission-8b85004ea make verify-E9-T22l` passed from a clean tree. Its acceptance log SHA-256 is `29c1696059460b3ab553fb88b7412a4f3df17fb256081c6ed611913aee4c5f0f`. The independent failed-prefix reconstruction report is `target/evidence/e9-t22l-submission-8b85004ea/prefix/report.json` SHA-256 `e9edcaa41fa1be104770a5795025142f64e4fcda9db2d0a62fb93178553e68cd`; the separate physical-closure audit SHA-256 is `c1f340dd5a0317d603a91f78e2a37b3097160392793a4dd7d911b4ae158d53ad`. The original `cold-257` candidate is 4,296,534,553 direct bytes, 1,567,257 above the portable 4 GiB metadata limit. Its complete authenticated graph has 2,138 references and 10,242,268,131 logical bytes, while 5,994,290,586 reachable physical bytes remain below the configured 8 GiB retention limit. The unchanged portable codec rejects that exact candidate; local validation admits its canonical bytes.

The saved-profile Chrome result `target/evidence/e9-t22l-submission-8b85004ea/exact-browser/report.json` SHA-256 `ff1fe2ddcfe8dfce7e735e8445262cbab06fd332b6a107103303beeba0553ce0` and trace SHA-256 `ce986e0f6c0b42b01051bfd129899e6951df34a2a976f1829c280f0149fd2143` show publication 495→496, byte-identical reopen, full local graph authentication, GC of one corrupted unrequested orphan, post-GC reopen, GPU-reader local admission, and complete session-library preview. Both storage-only archive attempts (including misleading `scope: 'local'`), playback bundle export and the immutable reader retain typed `BundleBound` refusal. An over-64-GiB local aggregate, an over-4-GiB single blob, malformed/missing/corrupt references, and a failed keyframe after native RAM-epoch freeze are rejected without advancing revision or acknowledging the epoch (`finishSoftwareRamEpoch(false)`). The built demo report SHA-256 `3d91ded60cc48a1b022a88e0279ff2f5b92c582afde03a6f05289757a109ac8a` records 127 passed, 0 failed, no unexpected browser/HTTP errors and no mobile overflow.

The pristine sparse checkout `/private/tmp/e9-t22l-cold-proof-20261024` at the same committed head excludes only unrelated historical `evidence/` data, uses the retained failed C desktop by absolute path, and ran `make web-build` plus the same `verify-E9-T22l` with `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all inherited `CARGO_*` absent. Its tree remained clean. Cold acceptance log SHA-256 `309bda3becc115ea8e011f40745d8156b943f122d67b0b943bab1cc5c7580b62`; prefix report `e9edcaa41fa1be104770a5795025142f64e4fcda9db2d0a62fb93178553e68cd`; browser report `c63a4d239cad173dd820c918a6c1690ca8573d3657af2651d22d07f88114b269`; trace `fb51aa3975b205650f629abd776922609533bc69094be79ca3e6a8bdeb73d327`; demo `dac029e693910fde5608a8321416b80c699e0647c2ec1366a4805fec64c0ddd3`. The cold demo independently passed 127/0 with no errors. The first cold attempt was sandbox-denied while activating the installed Emscripten cache, before any browser evidence; its log is retained as `/private/tmp/e9-t22l-cold-acceptance-sandbox-denied.log`. The successful run used the same local toolchain with cache access.

The focused Rust tests, strict storage and session-web Clippy, formatting, Wasm/native builds, graph-limit tests, and `web/dist` parity passed in acceptance. `make test wasm features test-riscv riscv-tests-suite determinism perf-smoke` passed (log SHA-256 `5533b0a0de788d5ff72d6d24d6859e52826bfa3ee1989420a0f396b2d7951f65`). `make ci` reaches the pre-existing quarantined `zicsr-stub` `dead_code` warnings outside this diff (log `target/evidence/e9-t22l-development-ci.log`, SHA-256 `f83a2be62e879c5e46c21599c56f2df9e7f92768a1b99f5a0850eaf1ad4b5f86`); strict stub Clippy with only `dead_code` waived passed in the clean clone (`/private/tmp/e9-t22l-stub-clippy.log`, SHA-256 `9f43fc50e54afd24d4243f576ee205d6c9cd09c524142f11212d9861da66665e`).

Supplemental exact-head browser caller reports passed: full/delta keyframes `3262b17bb1f847e7356c098eca271b8f7c22ef74043c059cc424ba9e9b14e886`, real Linux branching `ebfc3339b88217314c013f9f095984e9525ef5732a2e49c4c4c96f2c66bc1b78`, hardware-GPU branching `2a0bf7ad22018b0874b790fa91a82ce9f4e26e988d984b41bac4baecca65dbad`, four fresh-profile software/GPU bundles `b09c3b85b616369933557245532af86d8a44f1f7891fb627df16704a9daf1312`, legacy GPU checkpoints `42a252c49526e61a4b85a8589e706ad477d1855f5b524201ec7c220b772b3dc4`, and real Linux input/file transfer `b9103eab7d0eb10c41260b7eeeb0000ba28936c752468c6f2cf044be62e2825b`. All reports are under `target/evidence/e9-t22l-caller-*8b85004ea*/report.json`; the four-case bundle report is in the `-3` directory. Two runs of the older software-checkpoint browser script committed its changed local save path at revision 1 and preserved it through injected publication failure, then failed a later unchanged stop-ownership helper assertion (`accepted` versus expected `session checkpoint owner stopped`); both failure reports and traces are retained under `target/evidence/e9-t22l-caller-software-checkpoints-8b85004ea*`. This separate reproducible finding is disclosed for the verifier; neither the helper nor loader changed in this diff. No complete E9-T22c workload or performance claim is made here.

### 2026-10-24 — planning — exact failed C prefix retained

`E9-T22c` failed at transition `12900000000` under exact head
`bcc6bc1c4a8eb7d6cb82a1ffc1653b2827d63a60` with
`TooLarge("session payload")`. The independent Daybreak calculation puts the
candidate at `4296534553` aggregate bytes. The unchanged failed report and
saved graph are in
`target/evidence/e9-t22c-submission-bcc6bc1c4/desktop/`. This task changes
the shared metadata policy only; complete workload qualification stays in C.
