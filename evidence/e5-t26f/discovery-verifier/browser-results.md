# F discovery observation — closed browser review

**Scoped observation predictions HELD; F timing FAILED.** No new projection,
accounting or provenance refutation found. This closes only the new cold plus
one unprofiled baseline at `690e23245b4b376c55c0b830f7690c8a0f72059e`.
It is not F verification, a speedup or a policy recommendation. Prior unchanged
K/H/I/J/T19a and F functional evidence carries within its original scope.

Read the actual orchestration, invocation, cold/reuse logs and exit records,
canonical raw JSON and collector output; independently viewed both canonical
PNGs. Re-derived the collector result and separately checked every discovery
delta and the original timing subtraction. No new tests, builds, browser,
runtime/status edits or commits. The separate latency replay is outside this
review and was not inspected.

## Source and new seal — P1/P5 HELD

The frozen runtime diff from `4671c61b` remains only the 20-line WASM projection
plus its test file; core and proper driver are unchanged. Collector/driver/
resident-proof/orchestration source hashes match the invocation. Projection and
six-test source match the preflight pins; the later seven-test collector file is
a separate test-only follow-up already reviewed in `gates.md`.

The orchestration makes a new temp profile, scrubs inherited task/compiler
overrides, runs cold=create then reuse with JIT1/repack-off, and records actual
child environments and exit codes. Cold exit0 and reuse exit1/no signal match the
retained files; the adjacent outer log ends after successful collection. Outer0
is diagnostic collection completion, not a successful F interaction.

New seal:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-discovery-XRWve7/normal-checkpoint.json`,
created 2026-09-08 13:00:02.658 UTC, headless Chrome/152.0.7977.76. Reuse uses a
separate iteration-m6woXf/profile copy. Independently recomputed:

- Seal-file SHA `8e26664637f29aa8d14925a21557976e5787cc5dba0c9a2bc7d4db020f023278`.
- Closed 815-file profile tree `68ee83c092ab7627523ac4fd4837dc845d27a62e27af7cb883ff6961c55fcb87`.
- Served 150-file runtime tree `bf20ff6317d43a6069c49f85d84fd6167bb74bfd417e6ac873bf27d36810c440`.
- Source/dist WASM both `e5e73a60e2e05690e20ae8f40f54bdbd8d6987b1ae589952146d780c3e2266f4`.
- Actual decoded envelope, 2807910 bytes: `263ba774eb5dd211775ef26dc9896e2d784ccbb59f4866d9541ad20d19db34c6`.
- Actual sound section: `42dfc147f4ad0d0b98490c3cb39bb8f3932f785a8266335fcd151de18b56858f`.

Cold/reuse image, kernel, fixture and runtime bindings match. The unchanged image
and helper provenance remain HELD; this is not the old K profile rebound.
Parsed the actual sealed bytes and matched Prepared stereo S16/48k,
3840/1920-byte parameters, no pending TX/count/bytes, release/reset/XRUN/events
and all kicks zero. Cold frozen audit reports paused/stillPaused, decision resume,
generation/finalGeneration631 and exact envelope/CRC80ab2d17.

Cold PNG shows two real terminal windows and pre1/pre2 PID999/start28696,
aplay inode-match, pipe_read, FIFO FD3 readonly0100000, parentFD3 0100002,
no child writers, PCM FD4 owner999 PREPARED with hw/app pointers0, then prepared
green/prompt. Initial completed playback has1440 non-silent frames. I do not
call the earlier cold cumulative writtenFrames counter zero.

## Actual observation and original deadline — P2–P4 HELD, F cap FAILED

Canonical reuse JSON `milestones.normalRestore` records restored=true,
HELLO generation2, no booting state, first-present CRC80ab2d17 matching the
saved frame. Both fresh pre-gesture host observations are locked/suspended
with zero PCM indices/counts/nonSilent/maxAbs. Then mapped tablet input and
real cursor pixels (94 matched; arrival829.850 ms), focus/down/up, physical
`play` at5-ms edges, ten matching DOM/guest keyboard events and frame4→11
with8462 changed pixels precede command acceptance.

The reuse PNG independently shows the post PID999/start28696 and same saved
FD/Prepared identity, green e5t26f-aplay, original child Done and next prompt.
The unchanged helper's identity-before-feed, finite payload, original-writer
close and successful same-child wait-before-green contract carries HELD.
Fresh output is1440 written/inspected/non-silent frames, maxAbs0.999969482421875,
attached and running/unlocked. No XRUN is displayed in either inspected PNG;
that is not a claim that none occurred anywhere.

Raw timing (JSON lines255/421/460/472):

- Original restore T0:1210.7450000047684.
- PCM observation:5795.965000033379; elapsed4585.22000002861.
- Output attached observation:5800.240000009537.
- Frozen end:5801.920000076294.
- **Original elapsed:4591.175000071526 ms**, not later telemetry4591.650000095367.
- Before RPC requested261.485 ms after T0, received269.755 ms after T0.
  After requested0.940 ms after frozen end, received44.310 ms after end.

The exact canonical error at line545 is AssertionError/ERR_ASSERTION,
“post-restore interaction exceeded 2 seconds”; the held runner's literal cap at
line1921 is unchanged. No first-PCM timestamp exists in this baseline; completion
sampling cannot establish earlier arrival. No observer time is subtracted.

The current generic JIT failure capture does not retain full browser-error arrays:
cold arrays and reuse presentation errors are empty, and the server transcript's
only HTTP failures are two favicon404s. Do not promote this to a full browser-
error-free acceptance assertion. Normal coherence audit remains deferred;
drag/second restore/no-stuck guest-hover phases were not reached. Their prior
unchanged HELD results are not re-proved by this single failed-cap record.

## Counter accounting and inference limit

Actual nested `milestones.jitBefore.state.discovery` and
`jitAfter.state.discovery` (raw lines308/524), not requested options:

| Field | Before | After | Counter delta |
| --- | ---: | ---: | ---: |
| nominated | 271 | 3316 | 3045 |
| deduped | 552317 | 4124902 | 3572585 |
| droppedStale | 0 | 0 | 0 |
| droppedOverflow | 0 | 0 | 0 |
| countsDropped | 0 | 0 | 0 |
| excluded | 22 | 29 | 7 |
| queueDepth | 0 | 25 | gauge |
| queueHighWater | 137 | 137 | lifetime maximum |
| candidates | 3735 | 28425 | gauge |
| generation | 5 | 5 | unchanged |

Actual executor=true, decoded4096, repack-off/24 and both chaining modes hold at
both endpoints; timingEnabled=false/timerReads0. The unchanged defaults and
absence of clock overrides carry the selected ICount/divider10 configuration;
this record does not contain a newly sampled clock RPC.

Zero overflow/exhaustion **since-reset totals**, not merely zero interval deltas,
mean those counter-producing mechanisms are not observed in this discovery
epoch. They do not support the proposed overflow/map-exhaustion explanation for
this run. Positive droppedStale is still not exercised; the reviewed mapping and
unchanged producer carry, not an invented stale-job test.

Other raw deltas: submittedMembers585, installs584, retranslations237,
evictions98, decoded builds700099, guest retirements53475451,
JIT retirements21041082, decoded flush/discard0. CompiledBlocks95→130 is a live
gauge, not35 compiles. Nominations3045 versus submitted585 are neither a
one-to-one conversion funnel nor unique-PC attribution; differing layers,
exclusion/dedup/generation histories and queued work prevent that inference.
Sequential endpoint counters include execution outside the exact frozen F
window. Disabled timers prove no compile-pause bound. No causal latency diagnosis,
generalized performance gain or change to intentional anti-storm policy follows.

P1/P2 narrow read-only/field semantics and P3 refusal accounting carry the prior
nine-WASM/72-Node plus seven collector-test recordings. P4 original measurement
and P5 fresh-byte provenance now have the actual browser evidence above.
No scoped observation proof remains missing; F's ≤2000-ms criterion remains
failed, with all other prior limits intact.

## Mechanically audited artifact SHA-256

Repository-relative paths. Only canonical captures are cited; duplicate
post-restore files and the separate latency run are not extra evidence.

| Artifact | SHA-256 |
| --- | --- |
| evidence/e5-t26f/discovery-690e2324/run.mjs | 9df9694c6d6442874ff902c901ee2c2e765030bff74648656d5d5bec6d0acba5 |
| evidence/e5-t26f/discovery-690e2324/invocation.json | ca8cda6bbe7a7a4875dc1ac4507b6461786a407cf9c1b049c0dc20d235fb44cf |
| evidence/e5-t26f/discovery-690e2324/observation.json | 062033a26d709529c4e792b3e992a1500514197f370b4c622e056dc8551da72b |
| evidence/e5-t26f/discovery-690e2324/cold/diagnostic-checkpoint.json | d29f4b6c14a4ffa750ef7482987aae13c171b7bf35d2278e609b69e24fe6b6ab |
| evidence/e5-t26f/discovery-690e2324/cold/resident-prepared.png | 113c9ac72bb5a69cfd1190d9ff70b0063e37df9089fb2bfa977f170d97c426f4 |
| evidence/e5-t26f/discovery-690e2324/cold/run.log | aae185e16e8987e872d91565718b16ee65525f3c4c34392c59b67e9b67bb2732 |
| evidence/e5-t26f/discovery-690e2324/cold/exit.json | bcebd13d238a77ac126cc4e2019b18ca63df4a97ac56ee163379a4c768d3acd3 |
| evidence/e5-t26f/discovery-690e2324/reuse/failure-post-restore-interaction-checks.json | dff1a5a6a53b698fce3dc7d787af265bf4eae819e78407238fbb1993b2324d31 |
| evidence/e5-t26f/discovery-690e2324/reuse/failure-post-restore-interaction-checks.png | 57f35b0c1ac35da7ba873f7067b9ff577e5ce7ed349de2ceb4454f4478377b0d |
| evidence/e5-t26f/discovery-690e2324/reuse/failure-post-restore-interaction-checks-server.log | a462baf3f548c2520ae7d8ce2e4ded0cd8619f49d181fb28f2d6afe8227309ca |
| evidence/e5-t26f/discovery-690e2324/reuse/run.log | fab900971a01d2b0cf298fcfab951883e958dc531502966da99c79a79e090a8c |
| evidence/e5-t26f/discovery-690e2324/reuse/exit.json | 0cf195d64edfa93e108082da543b5fe976bc4709e8021c314b822c486255c3d7 |
| evidence/e5-t26f/discovery-verifier/preflight.md | 8323bbaeff8a6fe954766901edab83f172c0bed61e0fce3575489eb9a6cedfa8 |
| evidence/e5-t26f/discovery-verifier/gates.md | 64674c1e42e22fc8443de75ec7f5ef98b07be981919cfa2248913d29c566ef0e |
| tools/verify/e5-t26f-discovery-observation.mjs | 4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04 |
| tools/verify/e5-t26f-browser-roundtrip.mjs | bfcdc06f6d6ec330815d7ad12b7a0c101035a11d50348828fe2d39a7370cb219 |
| crates/wasm/src/lib.rs | bd19b54e044ca5497d4624fe299ce561f9b676de6467b1f112a3bba58fd5f77a |
| crates/wasm/tests/discovery_stats.rs | ecb473af2ca60ebea0db3d2a6e16fbad0df9d4ed59560820fd62634c7b02f8e9 |
| web/pkg/wasm_vm_wasm_bg.wasm | e5e73a60e2e05690e20ae8f40f54bdbd8d6987b1ae589952146d780c3e2266f4 |
| web/dist/pkg/wasm_vm_wasm_bg.wasm | e5e73a60e2e05690e20ae8f40f54bdbd8d6987b1ae589952146d780c3e2266f4 |
| evidence/e5-t26f/discovery-690e2324.log | 7e497e95c2739e28b1b0c94f8b64fd0e00c062da3178777bd584c2f362921fc4 |

