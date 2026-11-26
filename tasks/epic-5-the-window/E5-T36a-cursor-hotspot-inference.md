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
the pointer bridge's frame hook and the controller's idle-count reader in `web/main.js`, one
field (`idleYield`) in the loader's scheduler stats, and the browser proof script
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

What is and is not evidence (revised after two refutations):

- **Only moves.** The position a cursor UPDATE carries is never evidence: a legacy-KMS commit
  sets the image at the plane's previous position — computed with the previous image's
  hotspot — and moves it afterwards. (Fed that position, one straight glide onto the button
  left the hand at (45,7) for a true (9,4): round 1.)
- **Only in absolute mode, at one output size.** Changing pointer mode, a change of the guest
  output size the sent positions are computed for, and `resetHotspotInference()` start
  inference over — and the guest's moves count again only once it has caught up, because
  until then they stand for positions sent before the restart (round 2).
- **Caught up is something the page is told, not something it guesses.** The paced clock
  (E5-T37b) counts the guest's idle waits; a wait is reported only with no interrupt deliverable
  and every device idle. The controller asks for that count through the channel the pointer
  events take (so the answer is from after everything sent before the question) and waits for
  it to move on: the guest has then been idle after the last position reached it. The loader's
  scheduler stats gain one field, `idleYield`, so a guest without the paced clock is known to
  have no such count.
- **At rest with the guest caught up, the lag is zero.** When no position was sent and no
  cursor event arrived for 150 ms, and the guest has then been idle, the plane stands for the
  last position sent, which settles the hotspot without a second move in another direction —
  needed after a straight approach, where every lag fits. The rest position must be one the
  moves so far allow, needs a move since the image changed, and is not taken if a position was
  sent while the guest was being asked. Quiet on the page alone is never enough: round 2
  recorded the plane 62 px behind a pointer that had rested for 311 ms under guest load.
  Without the idle count (no paced clock) there is no rest rule, and a restart waits a fixed
  second instead.
- **An answer can be taken back.** Three moves in a row that the answer cannot explain although
  other sent positions could drop it; inference continues from that move.
- The estimator remembers at most 64 images (oldest out; a forgotten one is inferred again) and
  the last 512 sent positions.

## Deterministic acceptance

- `cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`
  passes. The controller tests drive the device's real order (update at the previous plane
  position, then move) with a guest that can be behind and an idle counter that moves only when
  it has nothing left to act on. They include: a log recorded on the Replay desktop; 400 random
  approaches across an image change with varying lag, random stalls during which the rest
  wait elapses, and nudges before the guest reports; round 2's two refuting sequences (the rest
  wait elapsing while the guest is a position behind and the pointer moving on; inference
  started over while the guest is a position behind, three ways). In all of them the inferred
  hotspot is never more than one pixel from the truth, and is known at rest once the guest has
  caught up. The web unit suite fails no test that passed before.
- Browser, the committed bundle, published generation-1 image with its session restarted on
  legacy KMS from the serial root shell (the one change E5-T36b makes in the image):
  `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
  passes. Four plans, each starting inference over: three continuous 60 Hz glides onto the
  button from different directions (the first verifier's approaches A and C and one from the
  right) and one of jumps with rests. At every rest — 18 reads over arrow, hand and text caret —
  the hotspot is known, the canvas shows it, it is within one pixel of (1,1), (9,4) or (4,8),
  and the kernel's cursor-plane position plus that hotspot is the guest position the page
  sent, within one pixel. A timeline of every answer the page showed (sampled every 8 ms)
  contains none more than a pixel from the truth. The guest frame has no painted pointer; no
  console errors and no cursor diagnostics.
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

### 2026-11-26 — worker — round 2 claim (head `c989491f5`)

The refutation is right and the fix is in the two commits `4eb3d3179` and `c989491f5`.

**What was wrong.** I gave the position of every cursor UPDATE to the estimator. On legacy KMS
an update carries the plane's previous position, computed with the previous image's hotspot, so
at an image change it is evidence for the wrong image. My tests' device model reported the new
image's own position in its updates, and my browser proof only jumped with long rests; neither
could see it.

**What changed.**

- Only cursor MOVES are evidence (`cursor-controller.js` `handleMove`; `_trackHotspot` no longer
  calls `noteMove`). A re-set of the same image leaves the estimator alone; a change of image
  tells it the plane position remembered for that image is stale (`noteInstall`).
- Positions are noted only in absolute mode; changing pointer mode, a change of the output size
  the positions are computed for (the page hook now passes it) and a guest reset start
  inference over (`resetHotspotInference`, `CursorHotspotEstimator.reset`; `forget` is gone).
- The pointer at rest settles the hotspot: 300 ms without a sent position or a cursor event,
  and the plane stands for the last position sent (`noteRest`). It must be one of the offsets
  the moves so far allow and needs a move since the image changed. This is what gives a
  straight approach its answer: on the verifier's approach C the hand has four fitting
  offsets after its one move, and (9,4) at rest.
- An answer can be taken back: three moves in a row it cannot explain although other sent
  positions could, or a plane that moves again after a rest answer with nothing new sent.
- An inferred (0,0) is an answer like any other (the special case the verifier found
  unexecuted is gone).

**Tests** (`web/tests/e5-t36-cursor-hotspot.test.mjs`, 22 tests). The controller tests now
drive the device's order through a `LegacyKmsGuest` model (update at the previous plane
position, then move). Among them: the verifier's recorded log of approach C as a fixture (65
events with their page timestamps; ends at (9,4), and fails with (45,7) if an update's position
is fed again); 600 random approaches across an image change with lag 0–3 and the image change
0–3 positions late — the inferred hotspot is never more than one pixel off, and known at rest
in at least 90% of them; relative mode; output-size change; a contradicted answer taken back; a
same-image update before the rest; an image that comes back without a move of its own.
Mutants: 38 one-line mutants of the estimator and of the controller's use of it, in a scratch
copy (`python3 evidence/e5-t36a/mutants.py <scratch dir>`, log `mutants.log`): 37 killed. The
survivor writes the style on an unchanged answer, which `_setHostCursor` already skips, so
nothing observable changes. (My first run left 11 alive; the second commit is the tests for
them, plus the one redundant check they exposed.)

**Gates** (`bash evidence/e5-t36a/gates.sh`, log sha256 `99231c6e0f61…`, at `c989491f5`): the
four cursor test files, 35 tests, all pass; shipped copies of the two sink files byte-identical
to their sources; web unit suite 643 tests, 615 pass, 28 fail — the same 28 names as before,
`diff` empty.

**Browser proof, the committed bundle at `c989491f5`**
(`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`;
`result.json` sha256 `46b0079615e0…`; Chrome 158.0.8127.88 headless; session
restarted on legacy KMS, back after 16 s). Four plans, each starting
inference over; glides are min-jerk at 60 Hz; every read is taken at rest:

| plan | read | sent | CSS hotspot | kernel plane | plane + hotspot − sent |
|---|---|---|---|---|---|
| approach C | arrow over the page body | (380, 640) | (1, 1) | (379, 639) | (0, 0) |
| approach C | hand, first time: one straight glide onto the button, at rest | (146, 501) | (9, 4) | (137, 497) | (0, 0) |
| approach C | hand, after four scattered points inside the button | (93, 516) | (9, 4) | (84, 512) | (0, 0) |
| approach C | text caret over the terminal, after two glides | (1100, 340) | (4, 8) | (1096, 332) | (0, 0) |
| approach C | hand again, later in the plan | (100, 520) | (9, 4) | (91, 516) | (0, 0) |
| approach A | arrow over the page body | (380, 640) | (1, 1) | (379, 639) | (0, 0) |
| approach A | hand, first time: one straight glide onto the button, at rest | (142, 515) | (9, 4) | (133, 511) | (0, 0) |
| approach A | hand, after four scattered points inside the button | (93, 516) | (9, 4) | (84, 512) | (0, 0) |
| approach A | text caret over the terminal, after two glides | (1100, 340) | (4, 8) | (1096, 332) | (0, 0) |
| approach A | hand again, later in the plan | (100, 520) | (9, 4) | (91, 516) | (0, 0) |
| approach from the right, across the button's edge at a slant | arrow over the page body | (380, 640) | (1, 1) | (379, 639) | (0, 0) |
| approach from the right, across the button's edge at a slant | hand, first time: one straight glide onto the button, at rest | (72, 532) | (9, 4) | (63, 528) | (0, 0) |
| approach from the right, across the button's edge at a slant | hand, after four scattered points inside the button | (93, 516) | (9, 4) | (84, 512) | (0, 0) |
| approach from the right, across the button's edge at a slant | text caret over the terminal, after two glides | (1100, 340) | (4, 8) | (1096, 332) | (0, 0) |
| approach from the right, across the button's edge at a slant | hand again, later in the plan | (100, 520) | (9, 4) | (91, 516) | (0, 0) |
| jumps with rests | arrow over the page body | (450, 730) | (1, 1) | (449, 729) | (0, 0) |
| jumps with rests | hand over the button | (93, 516) | (9, 4) | (84, 512) | (0, 0) |
| jumps with rests | text caret over the terminal | (1000, 420) | (4, 8) | (996, 412) | (0, 0) |

18 reads, every hotspot known and exact, every tip on the sent pixel. Approach C is the plan
that gave (45,7) before, approach A the one that gave (12,3). No painted pointer in the guest
frame, no console errors, no cursor diagnostics.

**Unchanged with the image as published**: click result median 272.8 ms, key echo
median 46 ms (n = 8 each; E5-T37b: about 266 ms and 47 ms). Demo page:
127 passed, 0 failed of 127; no errors.

Round 1's evidence is kept in `evidence/e5-t36a/round-1/`.

**Not claimed / known limits.** A guest more than 128 sent positions behind the pointer gives
no evidence (and a contradiction is not counted) until it catches up. If the rest wait fires
while the guest is still more than 300 ms behind, the answer read then can be wrong until the
plane's next move, which takes it back (unit-tested; not produced in the browser). The first
time a shape is met on a straight approach its cursor is drawn with no hotspot for the 300 ms
before the rest answer. Cursors above the CSS size limit take the overlay path, untouched.

### 2026-11-26 — verifier (round 2) — VERDICT: refuted

Fresh session; I implemented nothing here and was not round 1's verifier. Head `843f0a9d7` (the
claim's `c989491f5` plus one commit of claim and evidence only). My predictions were written before
I ran anything or opened round 2's evidence (`evidence/e5-t36a/verifier-r2/predictions.txt`); every
file named below is in that directory unless its path says otherwise. Browser runs: the committed
bundle from `tools/serve-dist.sh` on 8125 (the served `main.js` and both sink files hash as
`web/dist` at this head, which equals the sources), Chrome 158.0.8127.88 headless, the session
restarted on legacy KMS as the worker's script does it.

Round 1's bug is fixed, both acceptance commands pass for me, and in six browser runs of my own
(about 115 continuous approaches the worker's plans do not contain, idle, under guest load and on a
slowed host) the page never showed a hotspot more than a pixel from the truth. What does not hold
is the rest rule's safety net: the claim says an answer read while the guest was still behind is
wrong only "until the plane's next move, which takes it back". In the device's order it is kept
when one position was sent in between. I could not produce that in a browser; I could record its
precondition there. Status `in-progress`; nothing promoted.

**Refuted**

- P2-E2, the attack list's "a guest that lags by a varying number of moves", against the rest
  rule — FAILED, at unit level, through the real `CursorController`, in the device's order.
  - Predicted before any run (24x24 images, arrow (1,1), hand (9,4), guest one position behind
    on an even 10 px run, the hand appearing in the middle): rest wait fires with the plane one
    position behind → hand (0,4); then one more position is sent and the guest reports its two
    outstanding positions → still (0,4), at rest, indefinitely.
  - Observed: exactly that (`p2-handworked.log`, case E2): (0,4) for a true (9,4) after 9 s of
    rest, after 20 more positions along the same line and 5 s more, and after one jump elsewhere;
    taken back on the second jump (the third move it cannot explain). No rest wait is armed in
    between. Cases MAIN and E1 of the same file (guest caught up; nothing sent before the plane's
    next move) behave as the claim says: (9,4).
  - Why: `web/src/sink/cursor-hotspot.js:145` — a rest answer counts as "still arriving" only
    while nothing was sent since; after one sent position it is treated like an answer two moves
    agreed on: any sent position may explain the plane's next move (`:147-150`, here the new
    position itself), three misses in a row are needed (`:155`), and
    `cursor-controller.js:479` waits for no further rest once an answer is shown.
    `web/tests/e5-t36-cursor-hotspot.test.mjs:132-148` pins the take-back only for "nothing
    sent", `:149-151` pins that a sent position switches it off (on a right answer); the 600
    approaches hold the lag constant (`:432`) and let the rest wait elapse only after the guest
    has caught up (`:464-469`).
  - The precondition, in the browser. The Boundary's "at rest the lag is zero" is the premise
    of the 300 ms wait (`cursor-controller.js:13`). Recorded on the committed bundle (two log
    lines injected in memory, as round 1 did), the pause-and-nudge pattern, one-hart guest:
    - idle: a sent position was followed by the plane within 9 ms (median), 169 ms at most
      (`lag-by-phase-load.log` L0); in round 1's logs a move never trailed the next sent
      position by more than 38 ms (`replay-round1-logs.log`).
    - a process printing to the guest's terminal: median 91 ms, p99 290 ms, max 306 ms; longest
      stretch with neither a sent position nor a cursor event while the plane was behind:
      177 ms (`lag-by-phase-load.log` L1).
    - the same plus two CPU-bound loops: median 171 ms, p99 476 ms, max 526 ms; seven such
      stretches of 258-311 ms. `heavy-instrumented/events.json` #871-#875: last position sent
      at t=80323.1 (304,628); the plane goes to (365,657) at 80372.3; nothing for 311 ms; the
      plane arrives at (303,627) at 80683.3. The pointer was at rest for 311 ms with the plane
      62 px right of and 30 px below where it ended up (`quiet-while-behind.log`). The arrow
      had its answer, so no wait was armed.
    - the same on a slowed host (Chrome started with `taskpolicy -b`,
      `chrome-background-qos.sh`; session restart 43-76 s instead of 16 s): median 359 ms, max
      2.9 s; 52 such stretches of 300 ms and more, the longest 1.75 s; the page's rest wait fired
      20 times while the plane was not on the last sent position
      (`lag-by-phase-heavy-slow-host.log`, `replay-heavy-slow-host-instrumented.log`).
    In none of them did a wrong answer follow: "last sent - plane" was outside the image (the
    approaches onto the button move left) or not an offset the image's moves allowed, or the
    image had been settled by its moves.
  - How wrong and how often, by model only (`attacks-r2.log` §1, §8; a timed model of page and
    guest, 400 approaches per row, the guest silent for 320-2000 ms from within the last 150 ms
    of the glide): a wrong hotspot is shown in 1-4 % of such approaches; if the user then does
    nothing it is gone with the plane's next move (as claimed); with one or two nudges it is
    still there after 3 s of rest in up to 3.3 % (none for a 320 ms stall); after four more
    short glides in 0 of 400. Worst kept: 6 px with an idle guest's latency, 45 px ((46,53) for
    the caret's (4,8)) with the latency measured under load, approaching the terminal
    rightwards. No stall: 0 of 400.
  - Not produced in a browser: `own-1`, `load-instrumented`, `heavy-instrumented`,
    `heavy-slow-host`, `heavy-slow-host-instrumented`, `terminal-slow-host` — 342 reads, 339
    answered, every answer within a pixel, and no wrong answer in any page timeline (a recorder
    samples the CSS cursor and `__cursor.state()` every 8 ms). `terminal-slow-host` is 18
    approaches onto the terminal moving right and down, under load, on the slowed host.
  Demand: an answer read at rest must not outlive the discovery that the plane was still on its
  way, also when a position was sent in between — or state the limit as it is and say why it is
  acceptable; either way a controller test in the device's order in which the rest wait elapses
  while the guest is behind and the pointer then moves on.
- Same class, unit level only — FAILED (and so did my own prediction "no answer from stale
  positions"). Inference started over while the guest is one position behind on an even run —
  by the output size changing on the next sent position (800 → 801 rows), by relative mode and
  back, or by `resetHotspotInference()`: the hand is (0,4) from the second move after the
  restart, through the run, 5 s of rest and one jump (`attacks-r2.log` §4). `reset()` forgets
  the sent positions (`cursor-hotspot.js:217-220`), but the guest's next move still stands for
  a position sent before it; its only explanations are positions sent after
  (`:167-169`), so the truth is not among the candidates and two moves agree on truth plus one
  step. Round 1 asked for inference "only from positions that follow a sent absolute position
  at the current output size". Reach: a real change of output size scales the positions, so it
  needs the pointer near the origin; relative mode and back within one frame, as I modelled it,
  is not something a user does; the hook is the proof script's, called at rest. Not shown in a
  browser. Demand: after a restart, a
  move is evidence only once it can stand for a position sent after it, with a test.

**Held** (carry forward while the code and evidence they rest on are unchanged)

- P0: `gates.log` names `c989491f5` (sha256 `99231c6e0f61…`); `c989491f5..843f0a9d7` touches no
  source; `web/dist` sink files and `main.js` are byte-identical to their sources; the server on
  8125 serves them (`orient.log`).
- P1: the four cursor test files, 35 of 35 (`unit-acceptance.log`).
- P3: round 1's two recorded device logs replayed through the new controller, its rest timer
  driven from the recorded timestamps (`replay-log.mjs`, `replay-round1-logs.log`): 0 of 493 and
  0 of 1059 looks at a shown answer further than a pixel from the truth. Approach C: hand none
  after its first move at t=42018.8, (9,4) from the rest at 42379.8, never (45,7); arrow (1,1),
  caret (4,8). 792 of 827 moves are a sent position minus the true hotspot of the image shown
  within a pixel (the other 35 came before the first sent position); 825 of 827 updates carry
  the plane position of the event before.
- P4: the worker's browser command passes for me with the claim's 18 rows exactly
  (`browser/result.json`, sha256 `6f9831bf9d12…`). Each read requires a known hotspot, the CSS
  cursor showing it, the tip within a pixel of the last position the page really sent
  (`window.__pointer.frames()`), and the expected hotspot within a pixel
  (`tools/verify/e5-t36-hardware-cursor-browser.mjs:147-156`); its three glide plans are round
  1's approaches C, A and from the right, the same points and durations.
- P5, approaches the worker's four plans do not contain, each starting inference over
  (`plan-r2-own.json`, `own-1/result.json`): a slow diagonal across the window border onto the
  terminal's caret; across the button without stopping, then a short glide back in; a slow
  vertical approach stopping 3 px inside the button's edge; a glide and two nudges 200 ms apart;
  a 120 ms flick from 550 px away; a 120 Hz zigzag in and out across the button's top edge; two
  clicks at rest; a slow approach across the page's text (caret). 27 reads, early (450 ms after
  the stop) and late: every one answered and exact; 34 answers in the timeline, none wrong.
  645 updates, 62 style writes: the per-commit re-set of the same image writes nothing.
- Update positions are never used: 300 random runs, every update's position replaced by noise,
  identical timelines of shown answers (`attacks-r2.log` §3). Hotspots (0,0) and (63,63): 0
  wrong of 200 approaches each, known at rest; 3000 images: 64 remembered, 128 positions (§6).
- P8: click 272.8 ms and key echo 46 ms against E5-T37b's 267.7 / 270.6 / 267.9 and
  45.4 / 48.8 / 44.2; demo page 127 of 127, no errors — judged on the worker's files.

**Seen, no demand here**

- The claim's "a guest more than 128 sent positions behind gives no evidence (and a
  contradiction is not counted)" is not so while the pointer stays in a small area: 140, 200
  and 400 positions behind, a right answer was dropped in 60 of 60 runs and a wrong one shown
  on about 40 % of the moves; right again at rest after catching up in 60 of 60 (§5). Two
  seconds of lag at 60 Hz. I predicted it would be kept; it is not.
- An image that comes back while the pointer rests takes a right rest answer away for 300 ms
  (the "plane moved, nothing sent" rule; §2). Two clicks on the button at rest did not change
  the image in the browser (`load-instrumented` L4), so I did not see it there.
- A MOVE with resource id 0 while a rest wait is armed leaves the wait to throw inside its
  `try`: one `cursor-hotspot-error` diagnostic (§7). Not an order I saw the device produce.
- The first time a shape is met its cursor has no hotspot for 310-460 ms, not 300 (`own-1`
  timeline). The worker's script reads 2.3 s after each stop and cannot see an answer shown
  and taken back; `continuous-path-r2.mjs` records every change and may be taken as is.

**Coverage of the diff** (`coverage-unit-tests.txt`; the browser runs above)

- `cursor-hotspot.js:161-162`, the `seen.length === 0` arms (a rest answer dropped by a plane
  that moved to where nothing sent explains it) — executed by no test. Needs evidence: one
  assertion.
- `cursor-controller.js:483`, the second check inside the rest callback — executed by nothing
  and unreachable as far as I can see (everything that changes the image, the answer or the
  mode cancels or replaces the wait; mutants V6 and V14 each survive). Waived as a guard, or
  delete it.
- `cursor-controller.js:101-102`, the default timers — not by the tests; by every rest answer
  in a browser run. `web/main.js:910-919` — executed in the browser (no answer without it).
  Everything else in the two sink files' diff: executed by the tests.
- Mutants, scratch copies only: the worker's 38 reproduce, 37 noticed
  (`mutants-worker-rerun.log`). Twenty of mine (`mutants-r2.py`, `mutants-r2.log`): 9 noticed.
  Survivors that are behaviour: V4 (a dropped answer stays marked as a rest answer), V7 (a
  known image installed without its hotspot — in the device's order every commit would then
  write the style twice), V16 (rest with no candidate at all), V19 (a rest answer not clamped
  into the image). The code is right in each; the tests would not say so if it stopped. The
  rest change nothing observable (V2, V3, V10, V12, V17; V6 and V14 back each other up).

SUITE: n/a until the refutation clears.

Commands (repo root):
`cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`;
`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/verifier-r2/browser`;
`node evidence/e5-t36a/verifier-r2/continuous-path-r2.mjs --plan …/plan-r2-own.json --out …/own-1`
(likewise `plan-r2-load.json` and `plan-r2-heavy.json` with `--instrument`; `plan-r2-heavy.json`
and `plan-r2-terminal.json` with `--chrome …/chrome-background-qos.sh`, the former also with
`--instrument`); `node …/p2-handworked.mjs`; `node …/attacks-r2.mjs` (and `8`, `8 loaded`);
`node …/replay-log.mjs evidence/e5-t36a/verifier/approach-C-instrumented/events.json`, the
`natural` log with `--label-by-truth`, my three logs with `--resets DIR/result.json`;
`node …/lag-by-phase.mjs DIR`; `node …/quiet-while-behind.mjs DIR/events.json`;
`python3 evidence/e5-t36a/mutants.py SCRATCH`; `python3 …/mutants-r2.py SCRATCH`; the four test
files with `NODE_V8_COVERAGE` and round 1's `coverage-uncovered.mjs`.

Not checked: a pristine clone (medium risk); the whole web unit suite, the demo page and the
latency run (taken from `gates.log`, `demo-suite.json`, `browser-unchanged.json`); a wrong
hotspot kept in a browser (tried as above, not seen); a real mouse; how often a guest is silent
for 300 ms on other people's machines (one slowed host here); Firefox and Safari; relative mode
and a change of output size in a browser; cursors above the CSS limit; E5-T36b's image. The
replay of my own logs differs from what the page showed on 2 of 1772 and 19 of 1914 cursor
events (in each the page had no answer yet where the replay had the right one; I take it to be
the page's rest timer firing later than 300 ms under load, and did not check).
