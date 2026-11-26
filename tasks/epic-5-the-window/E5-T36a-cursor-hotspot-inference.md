---
id: E5-T36a
epic: 5
title: Infer the hotspot of a guest cursor image the device did not describe
priority: 0.387651
status: in-progress
depends_on: [E5-T37b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Host only: `web/src/sink/cursor-hotspot.{js,ts}` (new), `web/src/sink/cursor-controller.{js,ts}`,
the pointer bridge's frame hook in `web/main.js`, and the browser proof script
`tools/verify/e5-t36-hardware-cursor-browser.mjs` (shared with E5-T36c). No guest image change:
with today's image the guest paints its own pointer and reports no cursor plane, so nothing
visible changes until E5-T36b turns the hardware cursor on.

Why: on legacy KMS (the only way wlroots 0.17 gets a cursor plane from virtio-gpu on Linux 6.6)
`drmModeSetCursor` carries no hotspot. The device reports `hot_x = hot_y = 0` and the guest
places the plane at pointer minus hotspot instead. The host draws the guest's cursor image as a
CSS cursor at the real pointer, so without the hotspot the image sits offset by it: a pixel
for the arrow, (9,4) for the hand, (4,8) for the text caret.

What changes: the page knows the guest-space positions it sent; each position the guest MOVES
the cursor plane to is one of them minus the hotspot of the image shown. `CursorHotspotEstimator`
keeps, per cursor image, the candidate hotspots consistent with every such move seen so far
(against the recently sent positions, one pixel of rounding tolerated, u32-wrapped negatives
handled) and answers once exactly one candidate is left. `CursorController` uses the answer for
a CSS cursor whose device hotspot is (0,0): one style write when the answer changes. A device
that reports a non-zero hotspot, and overlay cursors, are untouched.

What is and is not evidence (revised after the first verifier's refutation):

- **Only moves.** The position a cursor UPDATE carries is never evidence: a legacy-KMS commit
  sets the image at the plane's previous position — computed with the previous image's
  hotspot — and moves it afterwards. (Fed that position, one straight glide onto the button
  left the hand at (45,7) for a true (9,4).)
- **Only in absolute mode, at one output size.** Changing pointer mode, a change of the guest
  output size the sent positions are computed for, and a guest reset start inference over.
- **At rest the lag is zero.** When no position was sent and the guest reported nothing for
  300 ms, the plane stands for the last position sent, which settles the hotspot without a
  second move in another direction — needed after a straight approach, where every lag fits.
  The rest position must be one the moves so far allow, and needs a move since the image
  changed.
- **An answer can be taken back.** Three moves in a row that the answer cannot explain although
  other sent positions could, or a plane that moves again after a rest answer while nothing new
  was sent, drop it; inference continues from that move.
- The estimator remembers at most 64 images (oldest out; a forgotten one is inferred again).

## Deterministic acceptance

- `cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`
  passes. The controller tests drive the device's real order (update at the previous plane
  position, then move), including a log recorded on the Replay desktop and 600 random approaches
  across an image change with lag: the inferred hotspot is never more than one pixel from the
  truth, and is known at rest. The estimator tests cover lag, rounding, wrapped positions, even
  sweeps (no guess), rest, a rest answer taken too early, contradiction, reset and the bound on
  images. The web unit suite fails no test that passed before.
- Browser, the committed bundle, published generation-1 image with its session restarted on
  legacy KMS from the serial root shell (the one change E5-T36b makes in the image):
  `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
  passes. Four plans, each starting inference over: three continuous 60 Hz glides onto the
  button from different directions (the first verifier's approaches A and C and one from the
  right) and one of jumps with rests. At every rest — 18 reads over arrow, hand and text caret —
  the hotspot is known, the canvas shows it, it is within one pixel of (1,1), (9,4) or (4,8),
  and the kernel's cursor-plane position plus that hotspot is the guest position the page
  sent, within one pixel. The guest frame has no painted pointer; no console errors and no
  cursor diagnostics.
- Unchanged with the image as published (software cursor):
  `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --scenarios click,type --n 8`
  — click and key-echo medians within the run-to-run spread of E5-T37b's (about 266 ms and
  47 ms). Demo page: zero console errors, suite at its full count.

## Adversarial verification

Medium risk. Attack list: two images with different hotspots alternating; a hotspot larger
than the image; positions near the output edges (clamped plane positions); a guest that lags
by a varying number of moves; the same image re-installed after a different one; an estimator
fed positions from a different output size (resize); memory growth over a long session. One
bounded novel attack of the verifier's choice.

## Verification log

### 2026-11-26 — worker — claim (head `49ef1ba61`)

Commit `49ef1ba61` on `codex/cursor-hotspot`: `web/src/sink/cursor-hotspot.{js,ts}` (new),
`cursor-controller.{js,ts}`, the pointer bridge's frame hook in `web/main.js`, the unit tests
and `tools/verify/e5-t36-hardware-cursor-browser.mjs`. The pre-commit build left the wasm
untouched (`web/dist` changes: the two sink files, `main.js`, `sw.js`, `tasks.json`).

**Gates** (`bash evidence/e5-t36a/gates.sh`, log sha256 `33ebd773ed44…`, at `49ef1ba61`):
the four cursor test files, 23 tests, all pass (10 in the new file); the shipped copies of the
two sink files are byte-identical to their sources; web unit suite 631 tests, 603 pass, 28 fail
— the same 28 names as before the pacing and cursor tasks (`web-unit-failing-before.txt`),
`diff` of the lists empty.

**Browser proof, the committed bundle at `49ef1ba61`** (`bash tools/serve-dist.sh 8125`; Chrome
158.0.8127.88 headless):
`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
— pass (`evidence/e5-t36a/browser/result.json`, sha256 `7ac780685eaa…`). The
published image's session was restarted from the serial root shell with `WLR_DRM_NO_ATOMIC=1`
in place of `WLR_NO_HARDWARE_CURSORS=1` (back at `REPLAY_CHROMIUM_READY` after
16 s; sway's environment afterwards: `WLR_DRM_NO_ATOMIC=1 WLR_RENDERER=pixman`). Then, per shape:

| shape | guest position sent | hotspot in the canvas's CSS cursor | kernel cursor-plane position | plane + hotspot |
|---|---|---|---|---|
| arrow over the page body | (450, 730) | (1, 1) | (449, 728) | (450, 729) |
| hand over the button | (93, 516) | (9, 4) | (84, 511) | (93, 515) |
| text caret over the terminal | (1000, 420) | (4, 8) | (995, 411) | (999, 419) |

Three different cursor images; every tip within one pixel of the sent position; the 48x48
region around a resting pointer hashes the same as after the pointer moved away (no painted
pointer in the guest frame); no console or page errors.

**Unchanged with the image as published** (software cursor, no cursor plane reported, so the
estimator is never consulted):
`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --scenarios click,type --n 8`
— click result median 267.1 ms (min 253.4, max 696.5, the first
click of the session), key echo median 47.8 ms; E5-T37b measured about 266 ms and
47 ms. Demo page: 127 passed, 0 failed of 127; no errors.

**What the recorded runs executed.** The browser proof runs the whole new path: `notePointer`
from the pointer bridge's frame hook on every move, `_trackHotspot` on each of the cursor
updates, `_inferHotspot` / `noteMove` on each plane move until the image resolves, and the one
style write with the inferred hotspot (the CSS cursor's `X Y` in the table is that write).
Covered by the unit tests only: a lagging guest, coalesced and dropped moves, rounding,
u32-wrapped plane positions, a straight sweep (no answer), unexplained positions, the bound on
remembered images, a device that reports its own hotspot, and the diagnostics on malformed
input.

**Not claimed.** Anything about the published image (still software cursors; E5-T36b and
E5-T41b), cursors larger than the CSS limit (they take the overlay path, untouched), and a
guest output that is resized while a hotspot is being inferred (the candidates of an
unresolved image may then be wrong until its history turns over; a resolved image is kept).

### 2026-11-26 — verifier — VERDICT: refuted

Fresh session; I did not implement this. Head `174de5271` (the claim's `49ef1ba61` plus one commit
that adds only the claim and `evidence/`). My predictions were written before I opened any
evidence or ran anything (`evidence/e5-t36a/verifier/predictions.txt`); every file named below is
in that directory. Browser runs: the committed bundle from `tools/serve-dist.sh` on 8125 (the
served `main.js` and both sink files hash the same as `web/dist` at this head), Chrome
158.0.8127.88 headless, the session restarted on legacy KMS exactly as the worker's script does.

Both acceptance commands pass as claimed, and the estimator never answers wrong when every
position it is given really is "a sent position minus this image's hotspot". The device does not
give it only such positions. After one ordinary straight pointer movement onto the button the
page settles on a wrong hotspot for the hand and keeps it for the rest of the session: the drawn
cursor sits 36 px from the guest pixel the page sent. Status `in-progress`; nothing promoted.

**Refuted**

- P2-E, the attack list's "two images with different hotspots" in the device's own event order —
  FAILED. Predicted before any run: a legacy-KMS commit is `drmModeSetCursor` then
  `drmModeMoveCursor`, so a new image's `UPDATE_CURSOR` arrives at the plane's previous position,
  which was computed with the previous image's hotspot; given to the estimator it can leave
  exactly one candidate, a wrong one; hand-worked case: (5,3) for a hand whose hotspot is (9,4).
  Observed:
  - unit, through the real `CursorController`: (5,3), and it stays after the worker's own four
    scattered points; a device whose update carries the new image's own position gives (9,4)
    (`attacks-legacy-order.log` §1).
  - the device's order: every update but the first event of each log carries the plane position
    of the event before it (559 of 560 in `natural-instrumented/events.json`, 266 of 267 in
    `approach-C-instrumented/events.json`); the image changes 55-240 ms after the guest pointer
    crossed the edge, in a commit of its own or together with a motion.
  - browser, uninstrumented, `plan-approach-C.json`: the pointer rests in the page body at
    (255,515), glides straight onto the button to (146,501) in 0.33 s (min-jerk, 60 Hz, 18
    positions) and rests. The canvas's CSS cursor for the hand is `… 45 7`. The kernel's plane is
    at (137,497) for the sent position (146,501), so the hotspot is (9,4); plane + CSS hotspot is
    (182,504), 36 px from the sent position. After the worker's own four scattered points with
    700 ms rests it is still (45,7) (tip (129,519) for the sent (93,516)), and again later in the
    session after a visit to the terminal (`approach-C-1/result.json`, sha256 `172f324bc1fb…`; no
    console errors, no cursor diagnostics). (45,7) was written into the plan file before the run.
    `plan-approach-A.json`, a 0.46 s glide from (431,552) to (142,515): (12,3), 3 px off, kept
    likewise (`approach-A-1/result.json`, sha256 `f9f97bd44c4b…`; predicted (13,3) or (12,3)).
  - citation: `approach-C-instrumented/events.json` #221 (t=42018.6: UPDATE installs the hand at
    plane (145,500), the arrow's plane for the pointer at (146,501); candidates
    `56,8 45,7 36,5 27,4 19,3 12,2 7,2 4,1 2,1 1,1`, (9,4) not among them) and #222 (t=42018.8:
    MOVE to (137,497); (45,7) alone survives and is answered). `replay-approach-C.txt` replays the
    log through the estimator and reproduces the hotspot the page logged on 534 of 534 cursor
    events. Code: `web/src/sink/cursor-controller.js:396` gives the update's position to the
    estimator; `web/src/sink/cursor-hotspot.js:88-107` intersects it with the next move and
    answers after two; `:72` never revisits an answer; `reset()` keeps it too
    (`attacks-controller.log` §3).
  - how often, by model only: one straight min-jerk glide from a random point of the page body
    onto the button leaves the hand wrong at rest in 12.0 % of 2481 glides at 60 Hz (8.5 % at
    100 Hz), 14.9 % (13.4 %) after three more short glides inside the button, worst (54,63); 0 of
    2481 with a device whose update carries the new position (`attacks-legacy-order.log` §3). The
    model's answers for the three browser plans held (§4); an earlier model of mine, which changed
    the image in the commit that crossed the edge, predicted (22,1) for
    `plan-approach-from-right.json` and the browser showed "no answer at rest, then (9,4)" — that
    prediction of mine failed and is recorded in the script's header.
  Demand: the position of an `UPDATE_CURSOR` that installs a different image is not evidence for
  that image; stop treating it as such, and re-record.
- Same class, unit level only — FAILED. An image first shown while the pointer is in relative
  mode (no absolute position is sent; `handleMove` infers regardless of mode,
  `cursor-controller.js:370`) answers (17,6) for a hotspot of (9,4) from the stale absolute
  history and shows it once back in absolute mode (`attacks-controller.log` §4). And with the
  page's output size stale for the first 1-6 moves of an image, 24 of 3000 seeds answer wrong
  (`attacks-estimator.log`); the claim's "wrong until its history turns over" does not hold for
  an answer, which is kept (`cursor-hotspot.js:72`). Neither was shown in a browser. Demand:
  infer only from positions that follow a sent absolute position at the current output size, or
  show in a run that the other cases cannot reach the estimator.

**Insufficient**

- The browser proof cannot see this. `tools/verify/e5-t36-hardware-cursor-browser.mjs:95` moves
  the pointer in single jumps with 700 ms rests. Its moves replayed one for one under V8 block
  coverage (`plan-worker-equivalent.json`, `worker-equivalent-coverage/`,
  `coverage-browser-worker-run.txt`): `cursor-hotspot.js:85` (the callback that compares two
  candidates of one report), `:101` (several clusters left: no answer) and `:53` (history
  trimmed) never executed. Every report before each answer had one candidate; the run never made
  the estimator choose, so "the browser proof runs the whole new path" holds for the functions
  and not for what they decide. The script passes on the bundle on which plan C leaves the hand
  36 px off (`browser/result.json`: same numbers as the claim). It does discriminate what it was
  built for: without `--legacy-kms-session` it fails at line 102 on the first shape (cursor
  `auto`, no plane; `browser-control-software-cursor/result.json`). Demand: the browser proof
  makes continuous approaches onto each shape from several directions and requires, at each
  rest, no answer or the tip within one pixel (`continuous-path-browser.mjs` with plans A and C
  does this and may be taken as is).
- The unit fixtures are not the device. `web/tests/e5-t36-cursor-hotspot.test.mjs:9-19`
  (`guest()` only ever reports a sent position minus the image's own hotspot) and `:153`,
  `:166`, `:169` (the controller test's updates carry the new image's own position). The mutant
  that stops giving an update's position to the estimator is noticed by `:158`: the test pins
  the behaviour that produces the wrong answer. Demand: drive the controller tests with the
  recorded order (update at the previous plane position, then move), across an image change.

**Coverage of the diff** (unit tests: `coverage-unit-tests.txt`; the worker's browser run: above)

- `cursor-hotspot.js:116-123` `forget` — dead in the page: no caller in `web/main.js` or
  `web/src` (only test line 88). Delete it or use it.
- `cursor-controller.js:403`, an answer of (0,0) — executed by no test and no run. Needs
  evidence: a controller test whose true hotspot is (0,0).
- `cursor-hotspot.js:51` (a repeated sent position is dropped) — executed by no test and not by
  the worker's browser run; `:74` (a second report from the same place) by the browser only.
  Needs evidence: one unit assertion each.
- Waived: `cursor-hotspot.js:21`, `:33-37` argument checks (`:38` and `:61-63` are executed by
  tests); `cursor-controller.js:383` disposed guard; `:384` and `:406-409` diagnostics (logging,
  unreachable with the checked values the page passes). The claim's "diagnostics on malformed
  input" are the estimator's `RangeError` (test `:94`), not these two.
- `web/main.js:910-917`: every block executed (14 calls for 14 moves).
- Mutants, in a scratch copy only (`mutate.py`, `mutants.json`): 15 of 35 noticed by the
  worker's tests. Survivors that touch a claim: `cursor-controller.js:393` without
  `state.hotX !== 0 || state.hotY !== 0` ("a device that reports a hotspot is never
  second-guessed" still passes: its two positions agree on no hotspot); `cursor-hotspot.js:53`
  history never trimmed; `:83-84` no bounds on candidates; `:91-96` no restart; `:103-106` no
  clamp. The code as written is right in each (`attacks-controller.log` §1-2,
  `attacks-estimator.log`); the tests would not say so if it stopped. Demand: with the rework,
  have the tests fail on these.

**Held**

- P0: `gates.log` names `49ef1ba61` and hashes `33ebd773ed44…`; `result.json` hashes
  `7ac780685eaa…`; `web/dist` sink files and `main.js` are byte-identical to their sources.
- P1: the four cursor test files, 23 of 23 (`unit-acceptance.log`).
- P3: the worker's browser command passes with the claim's numbers (`browser/result.json`).
- P4: the control fails where predicted (line 102).
- Attack list with positions that belong to their image (`attacks-estimator.log`): two images
  alternating with lag 0-4, 4000 of 4000 answered, 0 wrong; a hotspot larger than the image
  never answers ((64,10) on a 64-wide image answers (63,10)); wrapped positions in the corners,
  0 wrong of 1000; lag varying up to 20, 100 and 400 moves, 0 wrong of 12,000; 52,416 evenly
  spaced sweeps, 0 wrong (20,262 answer, within a pixel); 400,000 moves over 5,000 images: 64
  images, 128 positions, 47 candidates at most.
- A device that reports a hotspot, before and after an inferred image, and the same pixels with
  and without one (`attacks-controller.log` §1-2).
- P6: click 267.1 ms and key echo 47.8 ms against E5-T37b's 267.7 / 270.6 / 267.9 and
  45.4 / 48.8 / 44.2 (`evidence/e5-t37b/browser-paced-{1,2}.json`, `live/live.json`); judged on
  the worker's file, not re-run.

**Seen, no demand here**

- No answer is the usual state after a straight approach: the hand had hotspot (0,0), 9 px off,
  at rest in `natural-instrumented` (second read) and `approach-from-right-1` (second read)
  until the pointer turned; by model 79-88 % of straight glides. A delay by this task's terms;
  it is what a user will see first once E5-T36c makes this visible.
- `natural-instrumented` then answered (8,4) for the hand and kept it: within the one pixel this
  task allows, but line 103 of the worker's script demands (9,4) exactly.

SUITE: n/a until the refutation clears.

Commands (repo root unless said):
`cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`;
`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/verifier/browser`,
and without `--legacy-kms-session` into `…/browser-control-software-cursor`;
`node evidence/e5-t36a/verifier/continuous-path-browser.mjs --plan evidence/e5-t36a/verifier/plan-approach-C.json --out evidence/e5-t36a/verifier/approach-C-1`
(likewise `plan-approach-A.json`, `plan-approach-from-right.json`; `plan-natural.json` and plan C
again with `--instrument`; `plan-worker-equivalent.json` with `--coverage`);
`node evidence/e5-t36a/verifier/replay-events.mjs evidence/e5-t36a/verifier/approach-C-instrumented/events.json`;
`node evidence/e5-t36a/verifier/attacks-estimator.mjs`; `…/attacks-legacy-order.mjs`;
`…/attacks-controller.mjs`; the four test files with `NODE_V8_COVERAGE` and
`coverage-uncovered.mjs`; `python3 evidence/e5-t36a/verifier/mutate.py SCRATCH …/mutants.json`.

Not checked: a pristine clone (medium risk); the whole web unit suite and the demo page (taken
from `gates.log` and `demo-suite.json`); how often the wrong answer occurs with a real mouse
(two chosen glides were wrong in the browser, two unchosen ones were not; the percentages are a
model); Firefox and Safari; the relative-mode and stale-size cases in a browser; cursors above
the CSS limit; E5-T36b's image. In `natural-instrumented/events.json` the `img` column is a
constant (my logging mistake, fixed for `approach-C-instrumented`).
