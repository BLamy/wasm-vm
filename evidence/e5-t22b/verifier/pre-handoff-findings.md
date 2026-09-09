# Pre-handoff findings — formal verdict withheld

Frozen implementation: `2da168d7372dadbad60957adf622471915d8cc7d`.
Read AGENTS.md, task and diff before evidence. Predictions are in `predictions.md`.
Task was still `in-progress`; worker implemented/final handoff has not arrived.
No task status, acceptance checkbox, queue, implementation or commit changed.

## Confirmed semantic failure: matching repaint can be coalesced away

P3 / bounded novel attack FAILED twice. A 337x251 retained resource is presented
in a 351x263 CSS viewport after an odd-size sequence 329x277 -> 371x243 ->
351x263. Two matching-size frames, each with valid full-resource pixels but only
last-pixel damage, arrive synchronously before the next animation frame. The
matching image must replace all old black bars. Instead the second partial frame
replaces the pending full repaint and leaves the bars visible, even though
`sizeMismatch` is false.

`web/src/sink/presentation.js:358` decides whether to force full damage using
the last *received* resource; line 370 updates that resource before rendering.
The second frame therefore does not receive full damage. Line 371 enqueues it,
and unchanged `frame-scheduler.js:138` replaces the full pending plan outright.
The new matching-resource full-repaint behavior must survive coalescing until
the matching image has actually reached the backend. Worker must fix, add a
regression, and record this sequence on the resulting frozen head.

Repro: `node evidence/e5-t22b/verifier/odd-transition.mjs` (expected exit 0;
observed exit 1). Recheck: `ATTACK_REPORT=odd-transition-repeat.json node
evidence/e5-t22b/verifier/odd-transition.mjs` (same exit and byte-identical report).

Both actual Chrome backends fail at DPR 1, 1.5 and 2. At DPR 1, 7,725 pixels
mismatch; first (337,0) expected RGBA [48,16,152,255], actual [0,0,0,255]. DPR
1.5 has 123,577 mismatches; DPR 2 has 284,664. Citation:
`odd-transition.json:395` (Canvas2D), `:419` (false mismatch flag), `:1829`
(WebGL2); the matching repeat has identical lines and values. Both report SHA256:
`cd2be46575d0b6f4ab886a2435e36800739aab459f7dd6b4d9efe8d9ad0ac8b6`.
Chrome 152.0.7977.76, headless, SwiftShader flags specified by the worker/user;
functional proof only. No implementation changes were made.

## Results to retain at this unchanged code/evidence boundary

- P1 HELD on current recording: acceptance.log:40,43 plus six backend/DPR cases
  and live silent CDP DPR swaps. Bounded dimensions and explicit zero hook are
  directly asserted by the committed deterministic tests.
- P2 HELD on current recording: acceptance.log:41-44 verifies precise trailing
  deadline, replacement/error/disposal fences and silent DPR polling cleanup.
  Real storm makes one request, final 699x539. All six disposal snapshots have
  both timerPending and dprWatcherPending false.
- P3 HELD only for stale-source clipping/stride/black fill and an isolated first
  matching frame. General matching-frame bars removal FAILED above. Independent
  attack's 36 immediate-resize/partial-old pixel checks pass.
- P4 HELD for existing six-backend/DPR pixel fixtures, pending resize unit case,
  and context replacement. Independent attack additionally reads the replacement
  image without submitting another frame: zero mismatches in all three WebGL
  DPR cases (`odd-transition.json:1907`, `:2449`, `:2991`). Coalesced matching
  transition remains the failure above.
- P5 HELD for recording's actual pointer transport and documented native extent,
  clamps and next-mode-set caveat. Independent padding samples return
  {x:32767,y:32767} at each backend/DPR. T22a WASM SHA256 remains
  `563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc`;
  T22a runtime/TRANSFER sources are not changed by this diff. Carry its earlier
  architectural proof; do not rerun unrelated guest/Rust suites.

## Evidence integrity and coverage notes

Worker artifacts inspected provisionally, pending final handoff:

- viewport-proof.json SHA256
  `2ff642aa2a49afd6964101705edc54e2f924797c71092a6719d8dd6bf95679fe`;
  recorded head exactly matches frozen head. All 11 recorded file digests match.
- acceptance.log SHA256
  `53869fa5eee84f3d922b205c1f0a44d50290884f2563ded61eef0743a2c90fc4`;
  lines 60-69 report 55/55 tests, no skips, 46 pixel checks across six cases,
  demo 126/0/126, no collected errors.
- All seven screenshot digests match. Viewed Canvas2D DPR 1.5 and demo screenshot;
  diagnostic clearly labels synthetic source; demo shows 126 passing, 0 failing,
  and provisional in-progress / 0-of-5 metadata as expected before handoff.
- Every changed dist module/template equals its corresponding source blob at
  frozen head. Service-worker hash, docs, roadmap declaration and template/CSS
  are declarative/build outputs; no independent runtime semantic claim.
- viewport.js normal lifecycle, timers, RPC races and invalid inputs have direct
  unit assertions; real browser cases exercise actual layout, media/polling,
  CSS backing extent and pointer integration. presentation.js normal fixed-
  viewport fit, resize replay, matching transition and fallback are exercised;
  the independent attack exposes the uncovered composition.
- Harness source confirms expected pixels are computed independently from
  coordinates, not using fitFrameToViewport or the page's fixture generator.
  Synthetic frames plus paused real GPU prove the claimed boundary only.
- Main-app screenshot exercises wrapper construction and viewport diagnostics;
  boot ownership/frame/status integration is not fully demonstrated by that
  no-auto-boot suite. Do not claim a hunk-complete main-app boot audit from it.
  Full sufficiency signoff is deferred because semantic correctness already fails.
- No permanent suite promotion while correctness fails; preserve the reproducible
  verifier attack for worker regression and subsequent incremental verification.

Final handoff must identify the final recording and implemented task. Then recheck
digests before recording a formal verdict. If implementation changes, inspect its
delta and repeat affected proof; preserve HELD results where boundaries/digests
remain unchanged. Check accepted task checkboxes when finalizing verification.
