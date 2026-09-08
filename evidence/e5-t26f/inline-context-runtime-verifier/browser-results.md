# Closed inline-context runtime browser review

**VERDICT: bounded observer timing FAILED; reached normal-restore interaction functionality
HELD; E5-T26f remains unverified.**

Fresh Daybreak Blue review, 2026-09-08. This report covers only the original unprofiled
cold/reuse record under `evidence/e5-t26f/single-process-observer-657fb5a2/` at frozen head
`657fb5a23b411bf02832b2d10ef943b43d0becf1`. I did not build, clone, launch a browser, rerun
the image, alter the sealed profile, inspect any later latency diagnostic, or change product,
harness, task, queue, metadata, branch, or HEAD state. Both retained PNGs were viewed at original
resolution. `audit.mjs` independently reads and hashes the closed artifacts and immutable seal.

## Prediction results

- **P1 fresh exact bindings — HELD.** Git still identified the frozen head and
  `codex/e5-t26f-inline-context-browser-proof` during review. Cold, reuse, and observation bind
  that head and the same 150-file served runtime tree
  `f3a4fbe4d5aee30a9fcaa6f38cef292d8a65959d56612c43f3a82c427701249d`. Independently read
  `web/pkg` and `web/dist/pkg` WASM both hash to M's held
  `18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4`; current
  `jit_browser.rs` is M's held source digest
  `5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`.
  All 17 invocation source/binary/metadata pins rehash exactly. The actual 1-GiB image is
  `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`, kernel
  `af7c4e47…`, and manifest `e02a9af5…`. The sealed checkpoint reports headless
  `chromium`, `Chrome/152.0.7977.76`. The first audit attempt refused my prefix-free browser
  version expectation; correcting only that verifier expectation made the full audit pass.

- **P2 no historical seal rebind — HELD.** The newly retained baseline is
  `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-9IMCYn`.
  Its 816-file `checkpoint-profile` independently hashes to
  `3d1f4671402fc69da3f4957cd32f1fd9d92ea3fb28e1d03d60e8f716a4c65a0e`; its checkpoint was
  created `2026-09-08T18:46:29.552Z` and hashes to `8a4289c8…`. Reuse launched the copied
  `iteration-g6gfpr/profile`, not the baseline. The new 2,820,140-byte snapshot is
  `a91dd00f8b7b3552c75cbf98c6f9701952aaa4c39eb4009892cb1f98a32c7a88`, CRC `fa67bb62`,
  paused at overlay generation 637. No old seal or old snapshot digest is rebound.

- **P3 actual same prepared process — HELD within the carried observer/helper contract.** The
  viewed cold PNG shows both `pre-1` and `pre-2` at PID 1000/start 26791, inode-matched
  `/usr/bin/aplay`, `pipe_read`, child FIFO FD3 flags `0100000`, parent FD3 flags `0100002`,
  zero child writers, PCM FD4 owner 1000, PREPARED, and zero hw/appl pointers. The viewed reuse
  PNG shows physical `play`, the same PID/start/executable/FIFO/PCM/zero-pointer post record,
  green `e5t26f-aplay`, `[1]+ Done`, and a shell prompt. The unchanged helper/source/binary pins
  retain the already-reviewed finite-feed/close/same-child-wait semantics. Independent envelope
  parsing finds sound SHA `330d02f9…`, Prepared stereo S16/48-kHz, 3840-byte buffer,
  1920-byte period, and zero pending transfers/bytes, TX kicks, events, next-XRUN, release, or
  reset. The cold lower window visibly retains a historical 0.288-ms underrun; this is not a
  zero-underrun claim.

- **P4 unchanged execution policy — HELD.** Reuse records physical `play` at 5-ms pacing,
  JIT enabled, decoded capacity 4096, `repack-off` cap 24, compile-queue capacity 256, and
  entry-cost timing disabled at both RPC endpoints. Command, CPU, latency, guest-PC profile,
  guest clock, ICount divider, decoded-capacity override, completion mode, and explicit key-delay
  override are absent. Nothing here changes or re-proves live CSR state, interrupt sampling,
  clock, quantum, or execution budget.

- **P5 original timing boundary — FAILED exactly at the task cap.** T0 is restore
  `completedAt = 1177.8849999904633`; frozen end is `4879.879999995232`; subtraction is
  **3701.9950000047684 ms**, above 2000 ms. The reuse child exits 1 on
  `AssertionError [ERR_ASSERTION]: post-restore interaction exceeded 2 seconds` at
  `tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12`. Cold exits 0, reuse exits 1, and the
  outer wrapper exits 0 only because it successfully records the cap failure and accounting.
  Raw reuse SHA-256 is
  `0c282602e307dd9a4c50995414ff3ecca27aa7212fd357d723b502830dc853d8`.

- **P6a fresh interaction — HELD.** First-present CRC `fa67bb62` matches the saved CRC; full
  repair and fresh HELLO generation 2/version 1 occur through states
  fetching/instantiating/restored with no `booting`. Two samples at 1478.980 and 1834.270 ms
  remain locked/suspended with all PCM counters zero. A fresh tablet frame renders the cursor at
  (684,392), 94 matched pixels, at T0+765.890 ms. Physical `play` records 10 matching keyboard
  and DOM transitions, accepted input, 8500 changed pixels, a green completion marker and no red
  marker. At completion, fresh PCM is positive/non-silent with max amplitude
  `0.999969482421875`; output is attached, audio is unlocked/running, rendered frames rise
  44,628→185,556, pointer frames reach 3, keyboard frames 10, and held buttons are empty.

- **P6b anticipated exact 1440 PCM frames — FAILED as an over-specific subprediction.** The
  actual immediate completion delta is **4320 written frames, 2656 non-silent**, with write/read
  indices 4320 and zero fill. This does not refute F's required fresh positive non-silent PCM,
  which held, but the counter cannot be reported as the anticipated 1440 or used as a bit-exact
  finite-payload-length claim. No first-PCM timestamp exists in this unprofiled record.

- **P7 coherence and later phases — HELD as a limitation.** As predicted for a non-COMPLETE
  timing failure, normal coherence remains `deferred`; drag saves, second reload, and guest
  no-stuck hover are absent. Nothing here upgrades the carried historical drag boundary or proves
  it freshly. The generic failed reuse record also omits complete browser/page/HTTP error arrays;
  the first-present presentation's local empty errors are not a substitute. Cold error arrays are
  empty.

- **P8 M/acceptance limits — HELD.** M's independently verified exact four-bit cache projection
  is carried, not repeated. The cold record, reuse run, and observation remain
  `acceptance:false`; observation has `fTimingPassed:false` and `fVerified:false`. This one
  endpoint does not establish a speedup, latency cause, stable comparison, deployment, or full F
  acceptance. The previous 4.3622-s unprofiled and 4.10187-s print-only records remain failures.

## Exact read-only counters

Across the sequential before/after RPCs, guest retirements rise
6,493,894→52,473,355 (delta 45,979,461), JIT retirements
2,187,823→20,812,410 (delta 18,624,587), dynamic-link hits 838→36,543, and decoded block
builds 11,766→597,644. Discovery generation remains 5; nominations add 2691, discovery depth
adds 85, and stale/overflow/count-map-loss deltas remain zero.

The collector conserves 2606 staged jobs as 83 additional pending + 1787 backpressure drops +
0 stale cancellations + 736 pops. The pops split into 468 submissions + 268 pre-submission
refusals; drops split into 1251 incoming rejections + 536 resident displacements. Queue depth is
165→248 and high-water 223→256. These lifetime/sequential counters are jobs, not unique PCs,
do not exactly delimit T0/end, and prove no performance cause or improvement.

## Disposition

The closed screen is useful negative timing evidence with reached functionality, not a verifier
verdict for E5-T26f. A complete non-diagnostic `make verify-E5-T26f` exact-head run would still be
required even had this screen met 2000 ms; this failed screen additionally leaves normal coherence,
all drag phases, second restore, guest no-stuck release, and complete reuse error arrays unproven.
Any future latency sampler on a copy of this seal is a separate perturbed diagnostic and is not
part of this report.

Verifier artifacts: `audit.mjs` SHA-256
`8b4440470a3b815a721fc514eee8e41471e0f2984c6e088636dffcf4a3c7218b`; passing
`audit-result.json` SHA-256
`a62f9fa855da5c0d0ba4d4c8ac9e3c5167dc4a9034681b4906427e08cf7dfa6a`.
