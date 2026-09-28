# Frozen source and coverage review

Reviewed `3cb109d87f1bf08ad0ba6c6122ff0e884d4d3030` against activation `8da6f97372508791db30f7ebc9a49003e5217816` before the authorized guest recording. Predictions are in `predictions.md`.

## Boundary

The nine committed files comprise the two existing profiler/recorder edits, existing profiler test, new capture helper/CLI/test and three evidence scripts. No runtime, web distribution, guest image, production default, deployment or Epic 6 hunk changes. `audit-carry-forward.py` independently checks the unchanged runtime against T03z and T03ab, all 69 T03z and 29 T03aa sealed files, earlier T03ab failed reports, release WASM and R3 files. The actual `runLive()` function body is byte-identical to T03ab: readiness, physical keys, independent nonce readback and 300/60/120/20-second bounds remain the prior verified path.

The existing profiler selects one exact worker URL from this owned browser process, attaches without waiting for a debugger, enables the host CPU profiler, sets interval 1000 us, and now returns the selected target ID/type/URL. No guest pause, step, timer or instrumentation calls are added. The new helper is reached in the failed-input catch only after `Promise.all` completes screenshot/runtime capture. Its initial assertion requires the unchanged failed verdict after Enter+120s, and it rejects any failure-capture error. Capture reads the actual image before attach, uses a fixed 30000 ms delay, and bounds every CDP phase/write/close by 180000 ms. The original owned watchdog receives only its already-supported fixed 180000 ms allowance.

The parent performs one spawn, sanitizes all inherited OMARCHY selectors, selects only candidate residency/cap256/recyclingOFF and pins the committed head/served WASM/R3. The child retains exit 1 and result failed; only the independent diagnostic's parent criterion can succeed. A late pending read cannot resume the rejected acceptance promise. No new physical or serial input is sent during sampling, and parent validation rejects post-verdict sends.

## Pre-run findings resolved before freeze

1. An ambiguous profile with two parents for one child could previously overwrite a parent in the offline inclusive-time map. The capture validator now requires unique nodes, valid child IDs, unique parent edges and one connected acyclic tree; focused malformed-graph fixtures cover the cases.
2. The final verdict comparison originally included three cleanup-only page-clock annotations added after sampling. `workerCostInputVerdict()` now omits exactly those annotations while preserving all actual acceptance fields. The focused test confirms a changed Enter timestamp still fails.

Neither finding required a guest run or runtime change.

## Hunk coverage disposition

| Changed behavior | Proof route |
| --- | --- |
| Exact target ID/type/URL returned by existing profiler | Recorded Chrome worker test and actual raw profile target |
| Opt-in restricted to candidate residency | Three independent actual CLI preflight rejections in `preflight-checks.json`, before directory or browser creation |
| Helper source pins and clean scoped head | Actual report helper digests and frozen committed bytes |
| Post-failure capture, immutable verdict, save raw bytes, disconnect client | One actual diagnostic recording, plus synthetic exact-call-order and verdict-mutation tests |
| Reject wrong target/sample span/missing sample, malformed trees | Focused test mutations; independent raw tree audit |
| Reject premature/no-image/late attach | Focused helper tests; actual phase timestamps |
| Fixed parent allowance and owned process closure | Existing deterministic watchdog tests plus actual parent exit and cleanup receipt |
| Successful-input skip labels | Source waiver for diagnostic metadata: existing success path is unchanged, the profiler is only reachable from the failed-verdict catch, and the helper rejects any success verdict |
| Parent/harness declarations, JSON receipt metadata, comments/imports | Waived non-runtime wiring, checked by syntax/source review and actual receipt parsing |
| New gate/freeze/symbol preparation scripts | Recorded command outputs plus independently reconstructed hashes/section identity |

The synthetic profile/image fixtures test harness guards only. Their names say synthetic; no fixture is accepted as desktop, readiness, nonce, pixel or CPU-cost evidence. No tests are disabled or skipped in the diff. Worker gate logs record 70 passing tests, zero failed/skipped, plus one actual Chrome worker-profiler test; four syntax checks pass. This harness-only medium-risk boundary needs no repeated workspace gauntlet, runtime build, deployment or cold clone.

## Remaining evidence review

Do not conclude desktop success from this task. After recording, independently reconstruct input and wire replies, view the actual failure image, inspect all phase boundaries, recount weighted raw samples and bind names with the separate parser. The companion is offline-only; confirm no browser request serves it. Perform the planned bounded misattribution attack without another guest run.
