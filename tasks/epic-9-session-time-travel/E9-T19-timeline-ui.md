---
id: E9-T19
epic: 9
title: Build the session timeline and accessible time-travel controls
priority: 524.919
status: verified
depends_on: [E9-T06, E9-T16]
estimate: S
risk: medium
capstone: false
---

## Goal

Expose play/pause, seek, forward/backward step and event/keyframe navigation over real recorded state.

## Boundary

The timeline UI and embedding control surface over the accepted seek controller. Show recording/replay/live mode, exact position, event markers, previews, progress, cancellation and errors.

## Acceptance criteria

- [x] Mouse, touch and keyboard users can select a saved session, scrub, step and navigate keyframes; previews never masquerade as completed machine restoration.
- [x] Visible position, active VM state and rendered frame agree after each completed seek; obsolete progress cannot overwrite a newer request.
- [x] Reflow on narrow screens, preserve focus/status announcements and keep controls responsive during restoration; unsupported accelerated sessions are clearly gated until T17/T18 are accepted.

## Deterministic acceptance

`make verify-E9-T19`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Operate the timeline with keyboard only, scrub faster than restores finish and select incompatible/incomplete sessions. Check displayed positions against independently observed VM digests.

## Verification log

### 2026-10-21 — worker — start timeline controls

Selected from the top of Next up. E9-T06 and E9-T16 are independently verified;
risk remains medium and the slice is S. E9-T18b is externally blocked on the
independent verifier's account security setup and leaves the active lane. This
independent UI slice uses the accepted software seek controller and keeps full
GPU replay gated until E9-T18c is verified. No UI implementation or recorded
acceptance is claimed yet.

### 2026-10-21 — worker — frozen software timeline submission

Runtime/source head: `76aaf3539724cf32eb77a06716cb9d31142e2603`. The timeline
PR was moved below the externally blocked GPU pending-keyframe PR. This release
uses the exact already-verified A Wasm (`eaf24659537e2cd79def0e49b698fdd3ced525998dc9332ba8d286538d13a35e`,
2361401 bytes) and contains no pending-GPU implementation. The UI and browser
acceptance sources are byte-identical to the preliminary passing `9e09ee4e6`
run; the final release recording below is on the verified runtime.

Command: `E9_TIMELINE_EVIDENCE_DIR=target/evidence/e9-t19-final-76aaf353 make verify-E9-T19`.
All eight medium-risk commands passed: policy, format, three JavaScript syntax
checks, 21 deterministic replay plus 6 seek tests, the affected Wasm/browser
build, and the built-page acceptance. No unrelated full workspace wall or cold
clone is claimed for this UI-only medium-risk boundary.

Evidence (relative to this checkout):

- `target/evidence/e9-t19-final-76aaf353/report.json`, SHA-256 `cd7f77b1d2d57586b939d7da4ee5cc9b17b38ece282510fab113f6850b483472`; 108.61 seconds.
- `target/evidence/e9-t19-final-76aaf353/browser/report.json`, SHA-256 `c6be9959e327e17f2db00a2bc0458830fa05088815e9fcbf258f7bdd6db41304`.
- `target/evidence/e9-t19-final-76aaf353/browser/browser-trace.zip`, SHA-256 `c5661cc9a738bed262638827391c47c27fe495d271c594280b54485d3ed2967d`.
- Desktop and phone captures: `target/evidence/e9-t19-final-76aaf353/browser/timeline-{desktop,phone}.png`.
- Independent worker digest catalog audit: `target/evidence/e9-t19-final-audit-76aaf353.json`; all 12 recorded files (8124813 bytes) and 14 source hashes rechecked.

The recording demonstrates a real saved Linux boot excerpt, private restoration
and 13 independent from-start VM/console comparisons, exact full positions,
keyboard text/slider/step/keyframe navigation, mouse and touch scrubbing,
390-pixel reflow with retained focus and polite status announcements, actual
live BusyBox controller pausing, playback/pause, refresh/reselection event
navigation, and a complete early-finish recording ending at transition 64.
A held first frame proves a newer seek survives cancellation of Open; 100
superseded requests all cancel (0.735 ms total) while only the newest actual
state publishes. Invalid transitions and stored incompatible/incomplete/GPU
metadata leave the previous machine and console intact.

The observation marker is explicitly a synthetic UI-routing fixture at
63/observe: the authenticated tape stays untouched and the independently
observed real Linux VM/console at transition 64 is asserted. The short excerpt
does not claim to have produced a real RTC/entropy observation. GPU metadata
fixtures prove gating, not GPU execution. Test hooks use the production 10000 ms
worker watchdog instead of the special 300 ms fatal-watchdog-test default; no
production timeout changed.

Fresh preaudit identified and the worker fixed initial-open/new-seek retirement,
event-option clearing on refresh, and step enablement at same-transition
boundaries. All three are now exercised in the recording. This is a worker
claim awaiting the independent final verdict. Main-site publication follows
verification on this verified-runtime branch; the pending GPU branch remains
blocked and must not ride that release.

### 2026-10-21 — worker — close non-empty console proof

Fresh sufficiency review found that the 2.1M-transition excerpt ended before any
serial output, so the original 13 console comparisons covered only the empty
view. Independent verifier evidence at
`target/evidence/e9-t19-verifier-76aaf353/independent-report.json` demonstrates
646 genuine pinned Linux UART bytes at transition 3000000 before external I/O,
a matching private replay, an explicitly labelled 80003-byte formatting fixture
with the exact 65536-byte tail, and a passing stale-admission/Pause/new-seek
attack. Those renderer/controller/ownership results are retained HELD.

The worker is extending the product excerpt to that observed 3M horizon so the
demo itself can show the real kernel output, and adding an end-keyframe oracle
to the official browser run. This changes the sample horizon, so status returns
to in-progress and the selected medium-risk submission is recorded again at
the new frozen source. The native runtime and accepted seek controller remain
unchanged; no unrelated high-risk wall or cold clone is restarted.

### 2026-10-21 — worker — final genuine-console resubmission

Frozen release/runtime head: `ff28becd087b375399949df5db2472baec6a049b`.
Only the sample horizon changed from 2.1M to the independently observed 3M
transitions; the native A runtime, controller and console renderer are unchanged.
The official harness now also navigates the final keyframe, asserts non-empty
real Linux output and a disabled forward step, and compares that machine/console
to a from-start replay (14 state/console oracles total).

Command: `E9_TIMELINE_EVIDENCE_DIR=target/evidence/e9-t19-final-ff28becd make verify-E9-T19`.
All eight selected medium-risk commands passed again, including 27 native seek/
replay tests, the affected target build and the built browser suite (127 passed,
0 failed, zero console errors). The exact accepted A Wasm SHA remains
`eaf24659537e2cd79def0e49b698fdd3ced525998dc9332ba8d286538d13a35e`.

- `target/evidence/e9-t19-final-ff28becd/report.json`: SHA-256 `4d200b2e272213ed77680be4047f61d69cb2a919afcaad71f808454a80c9349e`; 120.55 seconds.
- `target/evidence/e9-t19-final-ff28becd/browser/report.json`: SHA-256 `be8b136e4a17eb6e5590934920a280cf177a218b7afd3f9ef5601d57ab5f1ced`.
- `target/evidence/e9-t19-final-ff28becd/browser/browser-trace.zip`: SHA-256 `4e052c90cde5a45c1c1b3ff283238a238ee9a3ee963720eda710541fce6c5f79`.
- `target/evidence/e9-t19-final-audit-ff28becd.json`: all 12 recorded files (19876765 bytes) plus 14 source hashes independently rechecked by the worker.
- Final desktop/phone captures are beside the browser report; the desktop capture now shows the genuine kernel output.

Retain the verifier’s unchanged renderer/ownership/formatting predictions and
receipts in `target/evidence/e9-t19-verifier-76aaf353`. The previous frozen
submission remains historical passing evidence; this new exact source is the
release claim. No GPU pending-keyframe code is in this branch, and full GPU
replay remains gated. Await the fresh final verdict, then publish this branch
to the main Cloudflare URL.


### 2026-10-21 — verifier — VERDICT: verified

Fresh independent review covered the task and complete diff from verified A
`7d142f83d` through frozen runtime `ff28becd087b375399949df5db2472baec6a049b`;
worker submission `1b24b19c0` adds only the task log/status and Queue. No
implementation was changed by this verifier. Predictions were saved before the
corresponding evidence was inspected in
`target/evidence/e9-t19-verifier-{76aaf353,ff28becd}/predictions.md`.

- **P1/P7 exact source and evidence — HELD.** Independently rehashed all 12
  official files (19876765 bytes), all 14 source entries and the three worker
  report/browser/trace digests. All eight commands passed; the 27 native tests
  report zero ignored tests, and the built page reports 127 passed/0 failed,
  zero console/HTTP/MIME errors. Source/dist modules agree. The deployed Wasm
  remains the accepted A bytes, SHA-256
  `eaf24659537e2cd79def0e49b698fdd3ced525998dc9332ba8d286538d13a35e`,
  2361401 bytes; no native crate differs from A. See final `submission-audit.json`
  and official `report.json:6-108`, `seek-regression.log:27,39`.
- **AC1/P2/P8 restoration and real frame — HELD.** All 14 independent from-start
  oracles match the full active position, active/visible/observed digest and
  console. The final keyframe is transition 3000000/retired 2999343/before:0/
  sequence 5, digest
  `c1b1ac22df2fb67e3d2d0b2cf8914d15007b554d8f2d990ec2e484380e4b99ce`
  (official browser `report.json:350-373`, trace `call@270`, physical line948).
  Its real Linux output is visible in the DOM at trace line933 and in the
  desktop capture; the former empty-console proof gap is closed. The separate
  genuine 646-byte UART recording and explicitly synthetic 65536-byte tail
  fixture carry unchanged from the earlier verifier recording.
- **AC1/P4/P12-P13 native controls — HELD.** Keyboard text entry, transition
  stepping, keyframe navigation and native slider interaction, plus mouse and
  touch scrubbing, restore the independently observed states. The final slider
  keyboard target is 3000. A further native letter gesture selects a second
  canonical stored history through the real select/change listener, retaining
  focus and the prior VM/console (independent trace `call@48`, physical line132;
  raw V8 counter for `session-timeline.js:23` is positive). End and a quick
  second-letter return were unsupported native Mac Chrome gestures in the
  extra harness, also observed on a bare select; their failed receipts remain
  labelled `selector-end-*`/`selector-prefix-*`. No product change or synthetic
  DOM input was used to replace the passing native selection.
- **AC2/P3/P6/P9 ownership — HELD.** The first held Open frame yields to the
  newer 123 seek; all 100 obsolete held-frame requests cancel while only target
  1000273 publishes (official trace `call@42`, `call@170`; latest oracle
  `call@172`). Refresh/reselection preserves event choices. The same-transition
  initial event disables Back (`call@124`), and the actual end disables Forward
  (`call@272`). A bounded independent attack holds a successful real store
  admission, cancels Open with Pause, completes a newer keyboard seek 63, then
  releases the stale admission. Open settles cancelled without changing the
  new VM/console/status or leaving pending set (independent trace `call@72`,
  physical line228). The from-start 63 digest is
  `7f4a6c2a6fa939c5dfbf2ce1efe5b2b2bde774a8bd9740e924d9f317998ef208`
  (`call@74`, line236).
- **AC3/P4 layout, status and admission — HELD.** The 390 px panel has client/
  scroll 388 and right edge 390, with polite status, retained editing/selection
  focus and responsive cancellation. Stored incompatible, incomplete, GPU and
  missing histories retain the committed machine; GPU replay is explicitly
  gated (official browser `report.json:528-574`). The real BusyBox worker
  remains the same owner and changes paused false to true through `main.js`
  (`call@26`/`call@44`). Full and early-finish recordings complete; the early
  history ends at 64 with two checkpoints (`report.json:576-586`). Observation
  marker routing is explicitly a UI fixture against unchanged authenticated
  tape, with actual Linux state 64 independently checked; no RTC/GPU execution
  claim is inferred from those metadata fixtures.
- **P5/P10 COVERAGE — HELD.** All 46 submitted text/binary hunks are classified:
  15 executed and 31 declarative/generated/history waivers; zero dead and zero
  needs-evidence. Runtime subroutes have explicit execution citations or
  defensive/unreachable dispositions in `coverage-closure.json`; raw V8 ranges
  and function counts supplement the full official recording. Source for both
  instrumented modules byte-matches the frozen source. The native controller
  is unchanged; no unrelated full wall or portability cold clone is required
  for this medium UI boundary.
- **SUITE — HELD.** Promoted five deterministic tests in
  `tools/verify/e9-timeline-console.test.mjs`: delivered serial receipt/queue
  ordering, exact 65536-byte tail, frame-position refusal, same-transition step
  boundaries and play-at-end/owner retirement. `node --test
  tools/verify/e9-timeline-console.test.mjs` passes all 5 with zero skips
  (`promoted-tests.log`). The existing `make verify-E9-T19` retains the real
  browser/native acceptance and the preaudit regression paths.

Verifier receipt: `target/evidence/e9-t19-verifier-ff28becd/receipt.json`, SHA-256
`32df765b8a116d52c01dac8d84aae734d6e38f8f0cc26026f55470686458b551`.
Independent report SHA-256
`67556f3b9b8b1796a677e2fa82a8ba21c09a7dac8919b5e6f58d76b98f66a945`;
independent browser trace SHA-256
`bbf6d6b46e392a6350d30a8569398aedbc2813cd83ccb8c9641cbfa5aef16abd`;
coverage closure SHA-256
`05c29269e0ccf14309ec52c8405160a03452a3acc97114089a667bd15f9e07b7`.
Trace indexes retain re-openable call IDs and physical record lines. Policy was
checked before queue regeneration. This verdict covers the software timeline
only; pending GPU work stays blocked and main-site publication follows on this
verified A+UI branch. No B status, implementation, deployment or merge changed.


### 2026-10-21 — verifier — retain promoted checks in acceptance

The five promoted tests now run automatically as
`console-controls-regression` in `make verify-E9-T19`, after the affected target
build supplies their Wasm dependency and before the browser gate. The recorder
also binds the promoted test source in its digest catalogue.

Direct `node --test tools/verify/e9-timeline-console.test.mjs` passes all five
again (`target/evidence/e9-t19-verifier-ff28becd/promoted-gate-tests.log`), and
Python AST parsing of the touched recorder passes. This is a test-recorder
promotion only; all frozen runtime/UI/browser-checker sources remain unchanged,
so the verified runtime and browser evidence carry forward. No full nine-command
resubmission is claimed or required for this promotion.

Promotion receipt: `target/evidence/e9-t19-verifier-ff28becd/promotion-receipt.json`,
SHA-256 `b8efc674b665d4afb9ef5cd5b57577b2fa745f09fa46f2e7e3121aba4bc8c685`.
