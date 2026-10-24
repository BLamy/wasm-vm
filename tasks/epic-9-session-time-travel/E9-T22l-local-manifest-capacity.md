---
id: E9-T22l
epic: 9
title: Admit bounded local session metadata above the portable payload cap
priority: 524.922029
status: implemented
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
