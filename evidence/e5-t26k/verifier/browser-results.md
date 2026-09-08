# E5-T26k — independent browser and final coverage review

VERDICT: verified

All K acceptance criteria HELD; no correctness or sufficiency blocker found.
Worker implemented record is committed at
`c9aabb4a8abe42a557bd01997f7cf2e74b1ff5a9`, with frozen runtime unchanged.
The coordinator will commit this verdict and the test-only promotion. F's
original 2000-ms criterion FAILED in all four arms; default remains 4096.

Reviewed frozen implementation `a53e51a6caf6eb542e4fa2ef4c039f84298a5ec6` against
the pre-evidence P1–P7 ledger in `preflight.md`. The native/WASM, one pristine
clone, novel attack and mutation sensitivity in `native-wasm-results.md` carry
HELD. No browser, second clone, broad suite or release build was run by this critic.
The only subsequent source write is the explicitly authorized test-only promotion.

## P4/P7 — new cold seal, owned worker and actual bindings: HELD

Read the invocation, cold record, each raw canonical failure JSON and child log,
outer transcript and aggregate; re-derived every aggregate field through the
collector and separately subtracted all nine raw counter pairs and original
timestamps. Checked each child log's actual configuration, not just aggregate
labels. All four source bindings match current files and frozen Git blobs.

Independently recomputed the 150-file served runtime tree and 815-file closed
checkpoint profile tree (185825550 bytes). The new headless Chromium
152.0.7977.76 seal was created at 12:10:57.886 UTC after a real cold boot; no old
profile was rebound. Private seal:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26k-capacity-hQWMhT/normal-checkpoint.json`.
Its file SHA is
`72ee8bbf1823630a3e0ddb1283a06de61f63a76d00c60d9b6b4c2e0f440d429f`.
The four child profiles are distinct: iteration-ETlUvf, iteration-ep5QrD,
iteration-nL1fOt, iteration-gFJ3nc. All bind the same closed seed and envelope.

Recomputed bindings (not request echoes):

- Served runtime tree: `c62e2e6ef6f2efd301d78e9ca69bcb1eed2b2599fc3834172b8f688b415aa986`.
- Source and dist WASM: `041a86da41dbbd66b887dc480a93e25c60316c77030f6e1044cd46f4db31999f`.
- Closed profile tree: `27697985b33306bf700fade238b7a684a72504ed79f6f0deab73edf002c6c92b`.
- Actual decoded envelope, 2807842 bytes: `73c991c15d48e68869109934104c335be38f0b44def134a7719316350acc7ddd`.
- Actual sound section: `42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`.
- Exact 1-GiB resident image: `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e`.
- Served resident manifest: `2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef`.
- Kernel: `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.
- Unchanged guest helper: `2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c`.

Cold record `milestones.normalCheckpointBeforeReload` (JSON line 235) reports
paused/stillPaused, resume admission and stable generation 622; envelope CRC
`f43155a5`. Parsed the actual base64 envelope with the held sound parser and
matched the retained section: Prepared state 2, stereo S16/48k, buffer/period
3840/1920, zero pending TX/count/bytes, release, reset, XRUN/events and all kicks.

Independently viewed the cold prepared PNG: two actual terminals; pre-1/pre-2
PID 999, start 29961, /usr/bin/aplay inode-match, pipe_read, FIFO FD3 readonly
0100000, parent FD3 0100002, no child writers, PCM FD4 owner999 PREPARED with
hw_ptr/appl_ptr zero, then prepared marker and prompt. Initial playback has
1440 fresh non-silent frames. No claim that the cold run's earlier cumulative
writtenFrames counter was zero; the two restored pre-gesture samples below are
the actual empty fresh-host-ring proof.

Each restore reports exact first-present CRC, restored=true, HELLO generation2,
full repair frame and no booting state. Actual worker endpoints report the
selected capacity both times, with JIT executor, repack-off/24, both chaining
modes, ICount/divider10/timebase10MHz. Cold omission and explicit restored
selection execute the built path; held loader tests cover explicit cold and all
restore-route pre-pump ordering/refusal. This combination proves the changed
boundary without inventing another cold run.

## P5/P6 — raw functional events and honest negative timing: HELD

Every arm is reuse-only, acceptance:false, physical `play` at 5-ms edges, no
profiling, clock, command, pacing, JIT/residency or COMPLETE overrides.
`milestones.residentBeforeGesture` contains two locked/suspended observations
with all PCM indices/counts/nonSilent/maxAbs zero. Then actual tablet motion,
down/up, guest cursor pixel acknowledgement (94 matched pixels), ten matching
DOM/guest key events, frame4→11 and 8448 changed guest pixels precede accepted
green completion; final host heldButtons is empty.

All four canonical PNG files are byte-identical (pins below); I independently
viewed their common raster. It shows physical `play`, the same post PID/start,
FIFO/PCM identity and Prepared/zero pointers, green e5t26f-aplay, the original
aplay job Done and a prompt in the upper terminal. The unchanged helper
`tools/guest/e5-t26f-resident-aplay.sh:145–167` checks identity before finite
feed, closes the writer and requires successful `wait "$e5_pid"` before green.
No displayed XRUN appears in these captures; this is not proof that no XRUN
occurred anywhere.

Completion PCM is freshly 1440 written/inspected/non-silent frames, maxAbs
0.999969482421875, output attached, context running/unlocked in every arm.
Browser/HTTP filtered errors are empty. This is guest-visible input plus actual
PCM and conditional completion, not DOM-only or first-PCM-as-completed-playback.

| Arm | Actual entries | Original cap elapsed ms | Decoded builds Δ | JIT installs Δ | Retranslations Δ | Evictions Δ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 4096 | 4864.945 | 683942 | 563 | 270 | 105 |
| B1 | 16384 | 4687.215 | 140396 | 822 | 435 | 105 |
| B2 | 16384 | 4685.490 | 143014 | 815 | 422 | 105 |
| A2 | 4096 | 4885.200 | 690417 | 566 | 263 | 105 |

Times are `milestones.postRestoreEnd - postRestoreStart`, not later interaction
telemetry or phase-wall timestamps. Exact raw values:
4864.944999933243 / 4687.215000033379 / 4685.490000009537 /
4885.200000047684. Every T0 equals normalRestore.result.completedAt.
Immediate PCM sampling and output attachment precede frozen end; after RPC
requests follow end. For A1, raw lines 256/416/455/467 pin T0, PCM, end and after.
The other records have the same named fields. Source runner lines 1716–1719,
1817, 1860–1878 and 1921 retain this ordering and literal 2000-ms assertion.

Cursor acknowledgements arrive at 888.625/866.955/864.360/896.900 ms. PCM is
sampled at 4814.415/4653.385/4660.150/4843.205 ms; these are observations at
completion, **not first-PCM timestamps**. The records cannot establish earlier
audio arrival. No observer time was subtracted.

The exact sole canonical error in each raw record is AssertionError /
ERR_ASSERTION: “post-restore interaction exceeded 2 seconds”; every child exits1.
Outer0 means complete K measurements, not F success. Coherence audits remain
deferred and drag/second restore were not reached here; prior unchanged F
functional evidence carries rather than being re-proved by these four arms.

All nine deltas match raw endpoints: guest retirements
55473975/55473812/55473746/55973444; JIT retirements
20520065/22051563/22300686/20944246; entry hits
6482701/6615775/6611715/6289992; flush/discard deltas all zero.
CompiledBlocks 94→102, 95→137, 95→137, 94→111 are live gauges, not compile counts.
Sequential JIT/clock RPCs span extra execution, not an exact frozen interaction
window. timingEnabled=false and timerReads=0 cannot prove any 5-ms compilation
pause bound. Approximately 80% fewer decoded builds and local mean
4875.0725→4686.3525 ms (3.87%) are descriptive of this single ABBA only: no
generalized speedup, causal cost attribution, F promotion or default change.

## Coverage disposition and permanent test

- P1/P2 HELD: existing recorded strict numeric/invalid/no-op/actual-report tests;
  unchanged native/WASM evidence and new pending-patch promotion.
- P3 HELD: coherent resize, snapshot/architecture preservation, aliases/logged
  DMA-write seam, PMP/SMC and compiled invalidation. The isolated removed-invalidate
  mutant failed with compiledBlocks1 instead of0; original regression passed.
  No claim of a newly executed full DMA device workload.
- P4 HELD: native/WASM retention, deterministic loader/linked-worker cold/restore
  ordering and failure paths, plus actual new built cold/restored endpoints.
- P5/P6 HELD for isolation, actual observations and unchanged assertion; F's
  ≤2000-ms result explicitly FAILED. Bad endpoint/non-cap rejection is covered by
  recorded deterministic tests, not claimed as actual browser sabotage.
- P7 HELD: new cold seal, independent ABBA, original failures and exact bindings.
  Driver cold/loop/output paths execute in this record. Positive-cap collector
  branches have deterministic fixture coverage only, not an F timing pass.
- Getter/export/types/Make/roadmap plumbing is build/test/demo-covered; static
  declarations/comments need no independent execution. No remaining changed
  runtime hunk is unidentified or awaiting an additional scoped run.

At coordinator request promoted the identical 12-case attack into
`crates/core/src/decoded_cache_capacity_tests.rs:250`. Original file is an
unchanged prefix; mechanically compared the appended test to the scratch
artifact ignoring formatting: identical tokens. `promoted-test.log` retains
the initial wrong-edition formatter check and omitted-gpu-trace attempt, then
successful repository-edition fmt check and the single prescribed-feature native
test (1 passed, 12 cases, same three one-retirement trace hashes). These are
critic setup corrections, not runtime fixes. No unrelated gates were repeated.

Independently read and viewed built-demo JSON/PNG: 126 passed, 0 failed,
0 filtered console/HTTP errors, K IN PROGRESS as frozen metadata intended.
The raw console does contain the permitted favicon404 and blocked-SW warning;
do not describe it as literally no console messages.

The two pre-existing dirty user-owned dist manifests remain explicitly outside
the release/cleanliness claim; their unchanged present hashes are pinned below.
Neither is a new K runtime input. Source runtime uses authenticated
artifacts-alpine plus the resident manifest. No global dirty-worktree cleanliness
claim, user-file staging, web metadata regeneration or deployment is made.

## Mechanically checked artifact SHA-256

Paths are repository-relative. Canonical raw files, not duplicate post-restore
captures, are the evidence of record. All table digests were generated from files
and rechecked after report creation; structured tree/section digests above were
recomputed separately.

| Artifact | SHA-256 |
| --- | --- |
| evidence/e5-t26k/verifier/preflight.md | 4433ec899acfcd25bc255a4af0188130df560292a83630008df9b77e99b54c8a |
| evidence/e5-t26k/verifier/native-wasm-results.md | 3334ad67a4e5276aadcc0ea4e38323e19d76fcd2a82623f96a2652a0657b735c |
| evidence/e5-t26k/capacity-a53e51a6/invocation.json | 89348af1408d6ee7619f9e6fbdf0769956e0fafd4d0f16e3dbc3c5c35df73a68 |
| evidence/e5-t26k/capacity-a53e51a6/comparison.json | 408f0e39bcdee9b7766b96557f615e8af49ea1e8fc5e652ca32159e8c7a214e4 |
| evidence/e5-t26k/capacity-a53e51a6.log | 59dc49c5a14ad60eba9ffe6e5adf87354b7aa6c1fa42bce039614febe6798e52 |
| evidence/e5-t26k/capacity-a53e51a6/cold/diagnostic-checkpoint.json | e3118c2d988ea1c4a082e1e872de791b7608ef1639f80950b6452f070d96791a |
| evidence/e5-t26k/capacity-a53e51a6/cold/resident-prepared.png | 5a25145ac5c336f3f80fd497425a03b4b68480ce8604cdbb4b76d76792c3e6e4 |
| evidence/e5-t26k/capacity-a53e51a6/cold/run.log | d817f2d2cb38476bd5448d52856c9ee3c82c0dda61ac5609366b2eb7845dbc06 |
| evidence/e5-t26k/demo-a53e51a6/demo-suite.json | e23ca5b0c21fe4b9dfc6c08c752d96a1b99b873ea1c9d52a0bd4b92f7ae63467 |
| evidence/e5-t26k/demo-a53e51a6/demo-suite.png | 1b66363502e765295099bed0248a0b2578718c7ef4cb43ef7c191ee781855477 |
| crates/core/src/decoded_cache_capacity_tests.rs | 3c445c6502283a67a47709d8310a93ac3040071985a47443e761d0e34da9958d |
| web/dist/artifacts.json | 9e28ead1264e08a806ef7fd3159813163ca26d4caf85071923b20467f3fa35dc |
| web/dist/artifacts-node-alpine.json | 86cd0e8049ca1943848bfe3215d36e53e705cdb986b61d37a6aa2e92d5c27543 |
| evidence/e5-t26k/capacity-a53e51a6/1-4096/failure-post-restore-interaction-checks.json | b48262170545e142053df8119170123a8754d16cbc33c783f4995e1e8b3fbcf1 |
| evidence/e5-t26k/capacity-a53e51a6/1-4096/failure-post-restore-interaction-checks.png | 7d6a3d3b70a46898ec64763d087a753e1c291ef05452dead81f7683003180333 |
| evidence/e5-t26k/capacity-a53e51a6/1-4096/failure-post-restore-interaction-checks-server.log | ffe8d0d40b8fce84ae3ba3abcc9a2fd7139c8d175af33d160dfd7e7494a56135 |
| evidence/e5-t26k/capacity-a53e51a6/1-4096/run.log | cdaca6fef7a63c3fb0d877f17dfbd4eba2a87405ec8f3d796a4bb598a7d2638b |
| evidence/e5-t26k/capacity-a53e51a6/2-16384/failure-post-restore-interaction-checks.json | dbb51f02cdb833c4be80dfe592709f799c7e7d64c68f98e8e8a3938bc68101d2 |
| evidence/e5-t26k/capacity-a53e51a6/2-16384/failure-post-restore-interaction-checks.png | 7d6a3d3b70a46898ec64763d087a753e1c291ef05452dead81f7683003180333 |
| evidence/e5-t26k/capacity-a53e51a6/2-16384/failure-post-restore-interaction-checks-server.log | 2635dbda3b0e17e61d2caf5f4440f6edc9e1f0917d2da78b4643419fefaf7da8 |
| evidence/e5-t26k/capacity-a53e51a6/2-16384/run.log | 36a23da06b24e5282cca074663685b4ccf7459155d73c1574a46f7a316869752 |
| evidence/e5-t26k/capacity-a53e51a6/3-16384/failure-post-restore-interaction-checks.json | a94dec7707a31381f23276746e495ed7f07b4bc51484ce0405b39a00f8cbe400 |
| evidence/e5-t26k/capacity-a53e51a6/3-16384/failure-post-restore-interaction-checks.png | 7d6a3d3b70a46898ec64763d087a753e1c291ef05452dead81f7683003180333 |
| evidence/e5-t26k/capacity-a53e51a6/3-16384/failure-post-restore-interaction-checks-server.log | aafa8494b78af41f6cad08468052ed9f4ace962203c32e0945c64a697bb6b944 |
| evidence/e5-t26k/capacity-a53e51a6/3-16384/run.log | 1f6366fd0c86c060233acd6f6b94752182e5ea2241f25973773e80abda7fe870 |
| evidence/e5-t26k/capacity-a53e51a6/4-4096/failure-post-restore-interaction-checks.json | 93bf99a025947d36d8d5477e517212b6b65567683cdb8d409c22501c43701a47 |
| evidence/e5-t26k/capacity-a53e51a6/4-4096/failure-post-restore-interaction-checks.png | 7d6a3d3b70a46898ec64763d087a753e1c291ef05452dead81f7683003180333 |
| evidence/e5-t26k/capacity-a53e51a6/4-4096/failure-post-restore-interaction-checks-server.log | 52e8c4b2d2f3197720c369e15f53e6d7aec14df3695218ea2902b370012e238f |
| evidence/e5-t26k/capacity-a53e51a6/4-4096/run.log | 9b82a510acca46b1e8871f57edfccd3bdd642fae8b06e089e3ac9573914daa67 |
| evidence/e5-t26k/verifier/promoted-test.log | 45e7e1f03beb990bc241f2f32784685d23ff457332e1488cb7fa70b666d592f7 |
