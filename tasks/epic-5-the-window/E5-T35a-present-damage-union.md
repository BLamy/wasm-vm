---
id: E5-T35a
epic: 5
title: Paint the union of coalesced damage so an earlier flush is never left stale on the canvas
priority: 0.38764
status: verified
depends_on: [E4-T40b]
estimate: S
risk: low
capstone: false
---

## Boundary

`web/src/sink/presentation.js` only (host presentation; no guest or wasm change).

The frame scheduler keeps one pending frame and presents at most once per animation frame.
Every frame carries the whole resource, but the presentation controller painted only the
newest frame's rect. When two guest flushes land inside one animation frame — a button
repaint, then a flush elsewhere such as the cursor — the first region was never painted and
stayed stale until some later flush happened to cover it.

Track the damage queued behind the scheduler and paint its union with the newest rect (same
resource size only; a resized resource already repaints in full). An immediate present that
replaces a queued frame keeps that frame's damage too.

## Deterministic acceptance

`cd web && node --test tests/e5-t06d-presentation.test.mjs tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs`
passes, including three new cases: coalesced flushes paint the union with the newest pixels
and painted damage is not carried into the next frame; queued damage of another resource
size is not unioned into a resized frame; an immediate present keeps the damage of the
queued frame it replaces.

## Adversarial verification

Low risk: inspect the direct result. The new test must fail on the previous
`presentation.js`.

## Verification log

### 2026-11-24 — worker — claim (head `2356edbd1`)

Implementation: `08d2fdda9` (`web/src/sink/presentation.js`, tests in
`web/tests/e5-t06d-presentation.test.mjs`, rebuilt `web/dist`); `2356edbd1` only refreshes the
generated `web/gpu-checkpoint-build.js` so it equals the copy in `web/dist`.

Commands, at `2356edbd1`:

- `cd web && node --test tests/e5-t06d-presentation.test.mjs tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs`
  → 19 pass, 0 fail. Log `evidence/e5-t35a/tests.log`
  (sha256 `386820a8068acb153f7ee534d3f273676c9c887126418ee4868bd79fb81fa1c7`).
- Sabotage: `git show dd668e65e:web/src/sink/presentation.js > web/src/sink/presentation.js`,
  then `node --test tests/e5-t06d-presentation.test.mjs` → 6 pass, 2 fail ("frames coalesced
  within one animation frame paint the union of their damage", "an immediate present keeps the
  damage of the queued frame it replaces"); file restored afterwards. Log
  `evidence/e5-t35a/sabotage-old-presentation.log`
  (sha256 `781ee96b66d4a59c5b4e701bb1114e9b0517189509f127a2736707260c97e009`). The third new
  case (another resource size is not unioned) passes on the old code too: it guards the new
  code against over-painting, it does not detect the old bug.
- `cmp web/src/sink/presentation.js web/dist/src/sink/presentation.js` → identical.
- Browser sanity on the committed bundle (`bash tools/serve-dist.sh 8125`):
  `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label damage-union --n 3 --scenarios idle,click,sweep,type --out evidence/e5-t35a/browser-dist.json`
  → exit 0, no missing samples, one console message (the favicon 404). Click result median
  516 ms, sweep 454 ms, key echo 43 ms: the same range as before the change, so the union does
  not cost visible latency. `evidence/e5-t35a/browser-dist.json`
  (sha256 `1c6f4adb6edc2947ce44e03a5e2fd9b03a53310acab87ab9d20be1df82ee7491`).

What this shows: with two flushes inside one animation frame the controller now paints one rect
covering both, using the newest frame's pixels, and forgets that damage once painted; a queued
frame of another size is not folded into a resized frame; a synchronous present that replaces a
queued frame still paints the queued frame's region. Not shown: a browser capture of the stale
region itself. The stale-rect symptom needs two guest flushes to fall inside one 16 ms frame,
which I could not force reliably from outside the guest, so the unit tests are the evidence of
record and the browser run is only a no-regression check.

### 2026-11-24 — verifier — VERDICT: verified

Fresh session; no implementation code edited (the sabotage swap was restored and
`git diff --quiet HEAD -- web/src/sink/presentation.js` is clean). Under test:
`web/src/sink/presentation.js` as of `2356edbd1`, head `fed441d08`. The claim's three sha256
values match the files, and `cmp web/src/sink/presentation.js web/dist/src/sink/presentation.js`
is identical. Predictions were formed from the diff before my first run
(`evidence/e5-t35a/verifier/predictions.txt`); logs are in `evidence/e5-t35a/verifier/`.

- **P1 union painted with the newest pixels — HELD.** Predicted: after an 8x8 full paint, flushes
  `{1,1,2,2}` then `{5,6,1,1}` before one animation frame give exactly one backend present, rect
  `{1,1,5,6}`, carrying the second frame's pixels. Observed that (test "frames coalesced within one
  animation frame paint the union of their damage"; probe L in `probes.log` checks all 64 words,
  the test checks `pixels[0]`). The same holds across pause/resume and the 250 ms hidden-tab timer
  (probes F, G). The previous file paints `{5,6,1,1}`.
- **P2 painted damage not carried — HELD.** Predicted: the next flush `{7,0,1,1}` paints exactly
  that rect, and deleting the clear at presentation.js:363 fails the worker's test. Observed both
  (mutant M1 killed, `mutants.log`). M1 trips earlier than I predicted: the first full frame's
  damage is never cleared, so the union assertion already sees `{0,0,8,8}`. A frame presented from
  inside a delivery is tracked as fresh damage and painted alone on the next frame (probe H).
- **P3 other-size queued damage not unioned — HELD, after closing a proof gap.** Predicted before
  running: the worker's case cannot tell whether the size check at presentation.js:349-350 works,
  because `present` resizes first, which clears `_paintedResource`, and `_deliver` then repaints in
  full whatever rect the frame carries. Observed: with the check deleted (M2) or reduced to one
  dimension (M3, M9), all 19 of the worker's tests still pass. The product itself is right: under
  a fixed viewport, where nothing forces a full repaint, a queued 16x16, 8x16 or 4x8 frame replaced
  by an 8x8 frame reaches the backend as the 8x8 frame's own rect `{0,0,1,1}` with no controller
  error (probes A, A2), and in the worker's own scenario `snapshot().latest.rect` is `{0,0,1,1}`
  (probe A3). Promoted as a test (see SUITE); it kills M2, M3 and M9.
- **P4 immediate present keeps replaced damage — HELD.** Predicted: queued `{0,0,2,2}`, then
  `presentNow` `{6,6,2,2}`, paints `{0,0,8,8}` at once with the newer pixels, and the following
  animation frame paints nothing. Observed (test "an immediate present keeps the damage of the
  queued frame it replaces"; probe P4; M6 killed). The previous file paints `{6,6,2,2}`.
- **Acceptance command — HELD.** 19 pass, 0 fail at `fed441d08`; 20 pass with the promoted case
  (`tests.log`). The two other unit files that import the module, `e5-t25a-perf-hooks` and
  `e5-t22b-viewport`, pass 16/16.
- **Sabotage — HELD.** With `dd668e65e`'s presentation.js in the repo: 6 pass, 2 fail, the two
  tests and the rects the claim reports; restored. `sabotage-old-presentation.log` repeats it
  against the final test file in a scratch copy: 7 pass, 2 fail. The promoted case passes on the
  previous file by design (that file never unions); its sabotage is M2/M3/M9.
- **COVERAGE.** `node --test --experimental-test-coverage` over the three acceptance files (worker's
  tests): every changed line of presentation.js executes (75-85, 133, 346-359, 363, 487-493, 501,
  503, 507-508, 515); the uncovered lines are all outside the diff. Two changed lines execute but
  no test distinguishes them; both waived. Line 515 (`invalidate` clears pending damage; M4
  survives) shows only in `snapshot().latest.rect`, because `invalidate` also forgets the painted
  size and the next frame repaints in full (probes C, D). The `if (!replay)` on line 363 (M5
  survives) only keeps damage that the replay has just painted in full, so its one effect is a
  larger rect than needed on the frame after a `setViewport` replay (probe I: `{1,1,5,6}` where
  `{5,6,1,1}` would do), never a missing one.
- **Bounded attack.** Seeded fuzz, 600 seeds of 600 operations (present, presentNow, tick, pause,
  resume, discardPending, invalidate, clear) with partial rects over a cumulative resource,
  checking after every backend present that the surface equals the buffer that present carried.
  0 failures for one resource size with and without a fixed viewport, for resource-following
  resizes, and for a fixed viewport when a new size arrives as a full flush. The previous file
  fails every seed in the single-size modes (`fuzz.log`).
- **Browser run — not re-run** (this session was told not to start servers). `browser-dist.json`
  agrees with the claim: `missing: []`, medians 515.9 ms click, 454.2 ms sweep, 42.6 ms key echo,
  one console message (a 404). The claim already states it is a no-regression check and that no
  browser capture of the stale region exists; the unit tests stay the evidence of record.
- **SUITE.** Promoted "under a fixed viewport, queued damage of another resource size is not
  unioned" into `web/tests/e5-t06d-presentation.test.mjs`. It accepts the frame's own rect or a
  full repaint and rejects a rect that mixes two resource sizes. Probe and fuzz scripts: discarded
  (throwaway harness); their outputs are kept in the verifier folder.
- **Observations, no demand.** None is stated by the task and none is a regression: the previous
  file does the same or worse in each.
  1. Fixed viewport, a resource-size round trip with no paint in between: 8x8 `{6,6,2,2}` queued,
     a 16x16 frame queued, 8x8 `{0,0,1,1}` queued, then one animation frame paints `{0,0,1,1}` only
     and `{6,6,2,2}` stays stale (probe B; fuzz mode "fixed viewport, resources persist across size
     changes", 71 of 600 seeds). The task's "a resized resource already repaints in full" is true
     for resource-following resizes but not here: the pending record was replaced by the 16x16 one
     and `_paintedResource` still names 8x8. It needs two size changes inside one pause, one
     hidden-tab timer period or one animation frame, and a partial first flush after the second.
  2. A backend `present` that throws loses the coalesced damage: line 363 clears it before the
     call, so the next frame paints only its own rect (probe E).
  3. `snapshot().latest.rect` now reports the coalesced union, not the newest flush's own rect.
     `tools/verify/omarchy-opaque-foot-command.mjs:33` compares it exactly and
     `tools/verify/omarchy-compositor-input-capture.mjs:19-21` bounds it. A union of rects inside
     the scanout stays inside it, so I expect no change there; the field's meaning did change.
- **For the worker/orchestrator (outside the verifier's writes):** the `web/roadmap.js` entry
  still reads `in-progress … Awaiting a fresh verifier`.

Commands: `cd web && node --test tests/e5-t06d-presentation.test.mjs
tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs` (before and after
the promoted case, and once with `--experimental-test-coverage`);
`git show dd668e65e:web/src/sink/presentation.js > web/src/sink/presentation.js`, `node --test
tests/e5-t06d-presentation.test.mjs`, `git checkout -- web/src/sink/presentation.js`;
`node --test tests/e5-t25a-perf-hooks.test.mjs tests/e5-t22b-viewport.test.mjs`;
`shasum -a 256 evidence/e5-t35a/*`; `cmp web/src/sink/presentation.js
web/dist/src/sink/presentation.js`. Mutants, probes and fuzz ran against a scratch copy of
`web/src/sink` and `web/tests` outside the repo; each mutant is one edit listed at the top of
`mutants.log`.
