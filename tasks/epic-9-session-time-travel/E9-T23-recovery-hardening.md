---
id: E9-T23
epic: 9
title: Harden recording and seeking against crashes and corrupt history
priority: 524.923
status: verified
depends_on: [E9-T07, E9-T18c, E9-T20, E9-T21]
estimate: S
risk: high
capstone: false
---

## User scope amendment — 2026-10-28

The user waived the long original-cold boot/replay campaign. E9-T22d's full
performance campaign is therefore deferred and removed as an integration
prerequisite. The already verified storage, GPU-result, branch and import
boundaries remain prerequisites. All recovery/fuzz/context-loss criteria below
remain mandatory and use bounded deterministic/browser runs, without another
original Omarchy cold boot. This task makes no full-desktop qualification or
performance-budget claim.

## Goal

Keep recorded history and the browser usable across interruption, malformed data and device loss.

## Boundary

Integration recovery of accepted session boundaries: append/keyframe/branch/GC interruption, quota/eviction, multi-tab ownership, cancelled seeks and graphics context loss.

## Acceptance criteria

- [ ] A seeded fault matrix preserves the last committed prefix and every unaffected parent/sibling session; incomplete work never becomes playable.
- [ ] Exercise at least 10000 bounded manifest/event/keyframe mutations and varied completion schedules with no panic, out-of-bounds access, unbounded allocation or hung control request.
- [ ] Actual built-browser context loss, reload and stale-epoch injection resolve pending requests and show a recoverable state; evidence includes exact positions, digests and original failures.

## Deterministic acceptance

`make verify-E9-T23 E9_OUT=<unique-directory>` on a clean exact head.
The bounded gate runs format/clippy, native manifest/publication/witness tests,
a wasm32 metadata build, at least 10,000 actual codec mutations, seeded strict
IndexedDB crash/retention/multi-tab cases, real Linux file branches/reload and
physical GPU cancellation/context-loss/branch tests with independent byte
oracles. It performs no original Omarchy cold boot or long whole-history replay.

The storage matrix explicitly uses synthetic storage payloads rather than a
model VM. Separate short RV64/Linux recordings supply the actual guest/state
and physical-GPU evidence. Earlier development failures remain preserved.

## Adversarial verification

Choose new interruption points around commits and fence completion, race two tabs, and sabotage a cancellation/generation check to show that the promoted tests detect it.

## Verification log

### 2026-10-28 — worker — bounded development checks

The 12,000-case codec smoke passed. The final harness separately counts actual
mutations and valid controls so controls cannot satisfy the 10,000-mutation
criterion. The strict-IDB recovery development run `target/evidence/e9-t23-recovery-dev2`
passed 15 publication crash cuts, six GC cuts and 48 varied maintenance
schedules, preserving sibling manifests and the expected committed revisions.
The earlier dev1 failed on repeated evidence-export callback registration;
its unmodified failed receipt is retained. Fresh export pages repair that
harness-only issue. No runtime semantics changed. Final exact-head integration,
byte oracles and fresh actual Daybreak acceptance remain outstanding.

### 2026-10-28 — worker — exact-head bounded recovery submission

Claim head `d653efd8001fb0c9d9c61b860f2185e9488157c1`, clean throughout.
Command: `make verify-E9-T23 E9_OUT=target/evidence/e9-t23-exact-recovery-v1`.
The complete selected gate passed with no runtime semantic changes. Format,
storage clippy, 31 native storage tests, 58 native GPU/branch tests with guest
traces, independent native byte oracles and the wasm32 metadata build passed.
The built codec gate exercised 10,500 actual mutations plus 1,500 valid
controls across manifest/event/keyframe/RAM-delta parsers; no trap, panic or
out-of-bounds error was admitted, and retained metadata memory stayed within
its bounded harness limit. The strict-IDB matrix passed 15 publication crashes,
six garbage-collection crashes and 48 varied maintenance schedules, preserving
every tested sibling and the expected last committed revision.

The real short Linux file recording, mixed full/incremental keyframes, two
private file branches, discarded/cancelled publication and reload/deletion
checks passed their independent ext2 byte oracle. Physical GPU tests passed
real query/readback/error witnesses, private-seek cancellation, original
retired-capability refusal, real context loss, checkpoint rollback/rollover,
branch journal/paint/final-put failures, relative-session reload and independent
GPU/disk/network-counter byte oracles. All browser reports contain zero
unexpected errors; replay remained offline. The original Omarchy cold boot,
its long replay and the full performance campaign were not run.

Recording root: `target/evidence/e9-t23-exact-recovery-v1` in this checkout.
Top-level report SHA-256 `99b50fb454f89f6bceebbef386b42ef981615f5ce12b2a09eecbb395f446a9ff`.
The report includes executed harness hashes, every exact command/log digest,
child report digests and source head. Native traces/raw states, browser traces,
screenshots and saved IndexedDB bytes remain there for independent critique.
Portable controller receipt and a key-artifact inventory are committed under
`evidence/e9-t23-recovery-d653efd80/`.

This worker claim is not verification. A fresh actual Daybreak session must
attack the acceptance/coverage, use independent seeds and a bounded novel
attack, sabotage-check the new gate, and record the final verdict.

### 2026-10-28 — fresh Daybreak Blue verifier — VERDICT: verified

- P1 evidence identity — **HELD**. Predicted exact source
  `d653efd8001fb0c9d9c61b860f2185e9488157c1`, top-report SHA-256
  `99b50fb454f89f6bceebbef386b42ef981615f5ce12b2a09eecbb395f446a9ff`,
  zero selected-command failures and matching child/harness bytes. Observed all
  16 command logs, five child reports and four recorded harness hashes match;
  `report.json:4-5,137-273` and committed
  `evidence/e9-t23-recovery-d653efd80/evidence-index.json:2-59`. Full hashes:
  base `92e88f303c916b57ddb56bb3b09d6816df5861fb`, code head
  `d653efd8001fb0c9d9c61b860f2185e9488157c1`, metadata head
  `610f3133452e021d9cf7b65e3030f934457d86db`. The post-recording diff is only
  this task/queue and the committed evidence index/worker-report metadata.
- P2 committed-prefix recovery — **HELD**. Predicted revisions 1 at
  `chunk-durable`, `object-durable`, `before-commit` and
  `before-final-authorize`, revision 2 at `commit-durable`, with unchanged
  pre-commit manifests/siblings and reacquired ownership. All 15 cuts satisfy
  that prediction (`durable-recovery/report.json:57008-57245`, digest
  `499541c6f493e58e28c2edf5c4074d704446f9fe7032dd91cfd5421505e7451a`).
  Seeds 17/47/71 also cover 48 schedules (eight reader/eight writer per seed)
  and six cuts at `gc-metadata-deleted` / `gc-before-sweep-commit`
  (`:9412,11214,28393,30195,47374,49176`). All three saved IDB exports contain
  11 chunks whose bytes independently hash to their filenames; storage JSON
  digests are respectively
  `7d435cf50223881728227ff3aaca45af66ddec492f6542aa9bc003fd37d59a19`,
  `6652e320dbe73f18991820365b7b9263fad0599fb08aa87de2c031a9e8e18394`
  and `d3b92e6392ae8794f9b1aad842b41441f7fb0ec220a069078df9f82160f647f3`.
- P3 bounded malformed history — **HELD**. Predicted 12,000 cases = 10,500
  mutations + 1,500 controls, four codecs, all trailing-NUL sentinels rejected,
  and retained growth below 64 MiB. Observed exactly those counts, 125 forced
  rejects in every codec/seed row, and Wasm memory `1,114,112 -> 6,553,600`
  bytes (`codecs/report.json:6-145`, digest
  `bca1423d64488eaaf044803a4cdaf0adb51f98dc92129ed8e2fd21da2a12750f`).
  No trap/OOM/OOB failure appears in the preserved report or logs.
- P4 actual guest/state recovery — **HELD**. Predicted real RV64/Linux positions,
  mixed keyframes, distinct private branches, cancellation/reload and offline
  counters. Observed past `(315621376,315608950,seq 67)`, parent
  `(318767104,318754348,seq 72)`, A `(319291392,319278523,seq 74)` and B
  `(318832640,318819882,seq 74)` at
  `linux-branches/report.json:141-166,280,53-123`; A/B digests
  `c1f34d40...` / `1bb96ba0...` survive reopen. The delta sample at transition
  3,000,000 has two deltas and one full; both publication cuts are present at
  `:296-316`; external requests and sockets are empty at `:10-11`. The
  independent ext2 oracle passed for past/P/A/B and all six raw resume files
  re-hash to their declared digests (`independent-files.json:2-139`, report
  digest `c14a1602260d16ad6c5b4e331f14b42d83a434a4ee610d66d60e6bb5a4e7dc87`).
- P5 physical GPU/context loss — **HELD**. Predicted a concrete original
  failure, settled/cancelled request, retired-epoch refusal and recoverable
  reload. At `(transition 30000, retired 29980, seq 10)` physical state becomes
  `qualified:false,lost:true` and the original callback resolves as
  `GPU request owner was disposed`
  (`gpu-recovery/report.json:1227434-1227475`); private seek cancellation and
  retired completion refusal appear at `:71392,72496-72551`. Replay ends at
  `(420512,420346,seq 40)`, with no external requests/sockets (`:416-417,11699`),
  report digest
  `ea844049ae15b9a70ca5c6b751a50a2f8e2f26f49d8d577203a1ab36b2eb68ef`.
  GPU branch parent/past positions are
  `(480000,479848,seq 46)` / `(270000,269866,seq 38)` and both children reopen
  at `(728752,728600,seq 45)`; context-loss, journal, paint, final-put and
  creation refusal attacks are at `gpu-branches/report.json:27654-27841`.
  Independent native/RAM/readback/disk digests for past/P/A/B are recorded in
  `gpu-branches/independent-files.json:2-118`; `replayCalls=0` and no external
  requests/sockets (`gpu-branches/report.json:1529-1544`, report digest
  `b8832caeebb866e92f3cf5d99ff3a258c57bca9e0ae1cca7ce31ee742e4cfbf5`).
  All four browser trace ZIPs passed archive integrity.
- P6 changed-hunk coverage and falsification — **HELD**. The Make recipe and
  controller success path ran at exact head; the browser harness executed every
  fixture, five publication points, both GC points, configured schedule ranges,
  IDB export and normal cleanup; the codec harness executed all eight mutation
  modes for every codec/seed. Independent seeds `101,509,2027` passed another
  12,000 codec cases. Invalid seed count/value, reused output, optimized Python,
  dirty source, child nonzero exit, ordinary timeout and SIGTERM-resistant
  timeout/SIGKILL paths all failed closed. In a scratch clone, replacing only
  the manifest validator with identity caused the oversized-input sentinel to
  fail immediately at `e9-recovery-codecs.mjs:45` with exit 1 and a preserved
  failed report. The unchanged default `firstSeed=17` is narrowly waived: it is
  literal preservation of the former fixed range for existing callers, while
  this diff's configured branch executed ranges 17-32, 47-62 and 71-86.
  HTTP 404/path-traversal and missing-pause timeout arms are also waived as
  fail-closed harness self-protection, not claimed product behavior; real page
  crash, child close, tracing stop and server/browser cleanup all executed.
- P7 pristine boundary — **HELD within the mandated scope; partial run reported
  honestly**. Sparse clone `/private/tmp/e9-t23-final.x5Cldg/repo` shares
  immutable Git objects, excluded historical `evidence/` except the small T22u
  waiver receipts, began without `target` or `web/node_modules`, and used
  `npm ci --offline --ignore-scripts --no-audit --no-fund` (158 packages).
  With Rust/Cargo/Node/Python overrides scrubbed it passed policy, format,
  storage clippy/tests, 58 native GPU/branch tests, both native byte oracles,
  wasm32 build and codec gate using its own newly built Cargo output. The
  managed verifier sandbox then rejected `listen(127.0.0.1)` with `EPERM`, so
  this is not claimed as a full clean-clone browser gate. The exact-head full
  browser recording remains the acceptance evidence; the clone failure is an
  external sandbox capability restriction, not a semantic contradiction.
  Pins: Node 24.20.0, npm 11.19.0, cargo/rustc 1.96.0, Python 3.9.6,
  `Cargo.lock` SHA-256
  `fb33b01d97f5051018aeb4bb48fdfdf1b306a367e692541a8ba4d1ac5146d491`,
  `web/package-lock.json` SHA-256
  `1bd432e67f671eb62296d64c473da133a9e97ab482cc946cacb80127bd760153`.
- COVERAGE — **HELD**. Executable changed lines are either exercised above or
  narrowly waived with the stated fail-closed reasoning. Task/queue prose and
  `.PHONY` are declarative. No production/runtime semantic line changed.
- CARRIED BOUNDARIES — **HELD**. Verified E9-T07/E9-T18c/E9-T20/E9-T21 code,
  dependency and evidence boundaries are unchanged and were not re-litigated.
  T22u/T22p/T22c/T22d remain cancelled/deferred scope; no original Omarchy cold
  boot, long original-cold replay or full performance acceptance is claimed.
- SUITE: keep the new deterministic `verify-E9-T23` target, codec corpus,
  strict-IDB crash matrix, guest traces and independent byte oracles. No extra
  verifier test is promoted: the independent seeds found no new stable
  regression input beyond the parameterized permanent harness.

Verifier artifacts and exact commands/outcomes are preserved under
`target/evidence/e9-t23-final-verifier/`; the pristine scratch clone is retained
at the path above. No implementation or production source was edited.
