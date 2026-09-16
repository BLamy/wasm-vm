VERDICT: verified

Scope: **bounded negative preparation diagnostic only**. The proposed fully
rendered smaller checkpoint was not obtained. No usable pair, confirmed focused
smaller Foot image, keyboard response, T03ae eligibility or T03q promotion follows.
The worker claim at submission `e6ae6e9a` states these limits correctly.

Predictions were committed before the recordings in `predictions.md`. All report
line numbers below refer to `../prepared-mode-r2/desktop/report.json`, SHA-256
`623ce524582b5afe676727a54b0f87879c4273e73a2d76671d486fbd5d5829b2`.

- **P1 identity and ownership — HELD within the recorded boundary.** Independent
  raw audit binds 19 helpers to recorded head
  `545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e`, all 94 served receipts to actual
  files, the exact R3 kernel/snapshot/delta/manifest pins and release WASM
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  The runtime remains cap256, recycling off, threshold512/cold65536/decoded4096,
  ICount64, unchanged R3 LP1/SDR; no timer instrumentation is enabled. Source
  comparison with T03z `53103e762c6c4003a5976bfa90131a03702fd2e7` has no
  runtime/web/Cargo difference (`r2-source-review.json`). The one owned launch
  and normal child/browser/client closes are recorded. This verifier launched
  no guest or browser. An independent process-table sweep was unavailable
  (`ps` returned EPERM), so the report does not claim one. Carry the unchanged
  runtime evidence; do not repeat unrelated runtime/deployment gates.
- **P2 phase bounds — HELD for the observed failure.** Lines38425–38433 pin
  navigation/preparation at03:14:19.640Z and the single deadline03:29:19.640Z.
  The preparation receipt keeps that same deadline; the pending focus read
  fails at03:29:19.643Z (lines38784–38785), a3-ms timer-dispatch delay, with no
  late acceptance. Failure PNG is captured03:29:19.705Z (lines310–312), cleanup
  starts03:29:19.706Z and finishes03:29:19.984Z (lines38967–38971,39023).
  The child closes03:29:19.995Z, exit1, no signal/watchdog (`run.json:14`).
  Export never starts. Fixed180000-ms export phase and distinct1110000-ms
  outer watchdog are exercised by the focused tests; physical deadlines remain
  300000-ms startup and Enter-anchored120000-ms response. Positive-image timing
  is not established because P4 fails.
- **P3 ingress and exact transaction — HELD.** The input fence acknowledgment
  precedes navigation at03:14:19.641Z (lines38430–38433), and the actual Chrome
  fixture executes the same fence/manifest-observer blocks across two
  navigations. Raw traffic contains zero physical input events and no guest
  keyboard/tablet/mouse/agent RPC. Independent reconstruction finds only layers,
  one fixed monitor command, clients and activewindow. Worker event252 sends
  `setDisplay(640,400)` id235; event253 acknowledges it before serial event254.
  The serial command replies `ok`, exit0, at event950/03:18:38.267Z. No guest
  file write or terminal injection is present (`r2-run-audit.json`,
  `final-audit.json`; event indices are zero-based).
- **P4 smaller geometry — HELD; fully visible focused terminal — FAILED/NEEDS
  EVIDENCE.** At03:19:30.619Z, actual scanout resource7 is640×448, advertised
  display640×400, and latest guest rect640×400; received/presented counters
  advance3→6 (lines38875–38950). The clients reply identifies mapped, visible
  Foot at(12,38), size616×350 (lines38738–38783). However, activewindow never
  completes; focusHistoryID0 is not substituted for that proof. The real pixel
  loop and export are never reached. I personally viewed the actual failure PNG
  and independently decoded its PNG stream/CRCs/filters: all1,024,000 pixels
  have RGB=(0,0,0), alpha255. PNG SHA-256:
  `658bf3e9ddc65742c6a9eb38880568a004a89c9a2b94ce4a5d40d2c1d8ce6587`.
  Demand: retain the negative result; do not call this a prepared desktop.
- **P5 export suppression — HELD; actual coherent prepared pair — NEEDS
  EVIDENCE if later claimed.** There is no pair/export/persistence-capture
  receipt, and both private output directories are empty mode0700
  (`final-audit.json`). Two recorded actual-capture-body fixtures cover paused
  and twice-drained ordering, exact warm-seed selection with foreign/legacy
  decoys, full fixture block enumeration, gzip bytes and headers, and rejection
  of running/foreign/stale states. The source remains byte-identical to the
  guest head. The independent positive parent-postprocessor fixture exercises
  actual file hashing, decompression and pair validation and still yields
  `usablePair:false`. These are explicitly synthetic harness checks, including
  a header-only synthetic RAM payload; none proves an actual checkpoint.
  `audit-pair.py` was prepared but not run because no pair exists. A future
  usable-pair claim requires the actual files, complete RAM/delta parse and
  actual terminal image; it cannot inherit a positive result from these tests.
- **P6 honest failure and separation — HELD.** Final raw result is failed
  (line38965); parent result is `preparation-failed-input-untested` with
  `usablePair:false` (`run.json:60`). No nonce/input/export occurred. R1's
  earlier manifest-observer wiring failure is retained as a separate startup
  failure, not counted as a rendering experiment. All17 preserved R1 artifacts
  and all21 sealed R2/corrective artifacts match; seal SHA-256 is
  `b3fd0051965f62799c41bd7a283b2ce48a1aa20094c81ca48a7670e880c86708`.
  Demand: preserve the lack of AE/Q eligibility and the original physical-input
  acceptance budget in subsequent planning.
- **P7 bounded novel attack — HELD.** The actual helper and actual browser pixel
  callback are run in a tiny synthetic VM. A plausible640×448 resource and
 172 bright pixels/16 colors pass the real nonblank check, but stale frame and
  present counters remain4 relative to baseline4. The helper expires at its
  unchanged100-ms test deadline, captures no screenshot/pair and reports
  failure (`stale-frame-attack.log:1`, helper SHA-256
  `a9a622f5b7a220334af14bff94b19b770bb2b99207723edbeb0d32b3f6d2bc73`).
  This is synthetic classifier evidence, not a successful guest frame.
- **P8 changed-hunk sufficiency — HELD for the negative claim.** See
  `coverage.md`. Exact-head48 affected tests, one actual Chrome fixture and two
  syntax checks passed. The later2-test capture fixture is isolated in
  `4d3aef8ec125aefe9c00a162619bd9aa0591de36`; it changes only its test file.
  The additional verifier positive-postprocessor fixture closes the unexecuted
  parent success-audit branch without another guest. Status/logging/configuration
  bookkeeping receives explicit waivers; no runtime proof is replaced by mocks.

## Durable checks and execution

Keep the worker's focused regression tests and the verifier stale-frame case.
Keep the bounded postprocessor fixture as clearly labelled synthetic harness
coverage. Retain both raw negatives and their images. The unused pair parser is
an audit utility, not a passing artifact. No full gauntlet, cold clone, deployment,
publication or merge was run by this verifier.

Commands (from repository root, after owned guest cleanup):

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 evidence/omarchy-profile/prepared-mode-verifier/audit-run.py evidence/omarchy-profile/prepared-mode-r1 1cfedb179a63ac274bf36fa42202b6e5eb10e177 > evidence/omarchy-profile/prepared-mode-verifier/r1-run-audit.json
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 evidence/omarchy-profile/prepared-mode-verifier/audit-run.py evidence/omarchy-profile/prepared-mode-r2 545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e > evidence/omarchy-profile/prepared-mode-verifier/r2-run-audit.json
node evidence/omarchy-profile/prepared-mode-verifier/stale-frame-attack.mjs > evidence/omarchy-profile/prepared-mode-verifier/stale-frame-attack.log
DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 evidence/omarchy-profile/prepared-mode-verifier/audit-final.py > evidence/omarchy-profile/prepared-mode-verifier/final-audit.json
node evidence/omarchy-profile/prepared-mode-verifier/positive-postprocessor-fixture.mjs > evidence/omarchy-profile/prepared-mode-verifier/positive-postprocessor-fixture.json
```

All five completed with exit0. Parent retains Git/task/queue ownership and can
append this verifier-authored result as the task's diagnostic verdict.
