---
id: E5-T36a
epic: 5
title: Infer the hotspot of a guest cursor image the device did not describe
priority: 0.387651
status: evidence-needed
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

What is and is not evidence (revised after three refutations):

- **Only moves.** The position a cursor UPDATE carries is never evidence: a legacy-KMS commit
  sets the image at the plane's previous position — computed with the previous image's
  hotspot — and moves it afterwards. (Fed that position, one straight glide onto the button
  left the hand at (45,7) for a true (9,4): round 1.)
- **Only while the page knows the guest's pointer stands on a position it remembers.** The
  device reports the plane's place on every commit, also when the plane stays where it stood
  (767 of 2847 moves in round 3's log). A move therefore says "the pointer is here", not "the
  pointer has just arrived for the last position sent", and comparing it with sent positions
  is sound only if the position the pointer stands on is among them. It is not at the page's
  start, after a guest reset, and after a change of pointer mode or of the guest output size —
  those forget the positions sent and everything not settled (a settled hotspot is kept: it
  belongs to its image). From any of them on, no move is evidence (`hotspotSettling`) until the
  guest has been idle after a position sent SINCE: its pointer then stands on that position or
  a later one. (Round 2: moves for positions sent before the restart. Round 3: the restart
  ended when the guest was idle, with no position sent since; the report of the plane where it
  stood was then explained by the next position sent, and an even run left the truth plus one
  pointer step.)
- `resetHotspotInference()`, the proof script's hook, forgets every hotspot and keeps the
  positions sent, so it has nothing to wait for and takes nothing from what the page knows.
- **Caught up is something the page is told, not something it guesses.** The paced clock
  (E5-T37b) counts the guest's idle waits; a wait is reported only with no interrupt deliverable
  and every device idle. The controller asks for that count through the channel the pointer
  events take (so the answer is from after everything sent before the question) and waits for
  it to move on: the guest has then been idle after the last position reached it. The loader's
  scheduler stats gain one field, `idleYield`, so a guest without the paced clock is known to
  have no such count. Without the count nothing is inferred at all (the cursor is drawn with
  the device's (0,0)); the page looks for one again every two seconds.
- **At rest with the guest caught up, the lag is zero.** When no position was sent and no
  cursor event arrived for 150 ms, and the guest has then been idle, the plane stands for the
  last position sent, which settles the hotspot without a second move in another direction —
  needed after a straight approach, where every lag fits. The rest position must be one the
  moves so far allow, needs a move since the image changed, and is not taken if a position was
  sent, or the image changed, while the guest was being asked. Quiet on the page alone is never
  enough: round 2 recorded the plane 62 px behind a pointer that had rested for 311 ms under
  guest load.
- **An answer can be taken back.** Three moves in a row that the answer cannot explain although
  other sent positions could drop it; inference continues from that move.
- The estimator remembers at most 64 images (oldest out; a forgotten one is inferred again) and
  the last 512 sent positions.

## Deterministic acceptance

- `cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`
  passes. The controller tests drive the device's real order — every commit an update at the
  previous plane position and then a move, also when nothing changed — with a guest that can be
  behind and an idle counter that moves only when it has nothing left to act on. They include:
  a log recorded on the Replay desktop; 400 random approaches across an image change with
  varying lag, random stalls during which the rest wait elapses, nudges before the guest
  reports and commits of the guest's own; round 2's two refuting sequences; round 3's — an even
  run from where the pointer rests, with the plane reported where it stands before the first
  move — after each way inference can start over (the page's start, a guest reset, pointer mode,
  output size, the hook), and 500 random such runs; the client changing the cursor while the
  guest is being asked. In all of them the inferred hotspot is never more than one pixel from
  the truth, and is known at rest once the guest has caught up and the image was reported since.
  The web unit suite fails no test that passed before.
- Browser, the committed bundle, published generation-1 image with its session restarted on
  legacy KMS from the serial root shell (the one change E5-T36b makes in the image):
  `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
  passes. The page is settling until the guest has been idle after the first position sent.
  Then four plans, each forgetting the hotspots first: three continuous 60 Hz glides onto the
  button from different directions (the first verifier's approaches A and C and one from the
  right) and one of jumps with rests. At every rest — 18 reads over arrow, hand and text caret —
  the hotspot is known, the canvas shows it, it is within one pixel of (1,1), (9,4) or (4,8),
  and the kernel's cursor-plane position plus that hotspot is the guest position the page
  sent, within one pixel. Then 48 even runs of 2 to 10 positions from where the pointer rests,
  right after starting over (24 by the hook, 24 by the hook and a pointer-mode change), while
  the terminal prints in bursts (the third verifier's runs): whatever is shown at rest is the
  arrow's (1,1), and it is known after two more positions. A timeline of every answer the page
  showed in all of this (sampled every 8 ms) contains none more than a pixel from the truth.
  The guest frame has no painted pointer; no console errors and no cursor diagnostics.
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

### 2026-11-26 — worker — round 3 claim (head `09e327eeb`)

Round 2's refutation is right as well: I had replaced one guess (the update's position) by
another (300 ms of quiet means the guest is at rest). Commits `c787e08f3`, `bef2762bb` (build
id), `9861abce7` and `09e327eeb` (the proof script only).

**What was wrong.** The rest rule read "last position sent minus plane" off a plane that could
still be on its way, and its take-back worked only if nothing was sent before the plane's next
move. And inference started over while the guest was a position behind took moves that stood
for positions sent before the restart.

**What changed: the page no longer guesses whether the guest has caught up.** The paced clock
(E5-T37b) counts the guest's idle waits, and E5-T37a's core reports a wait only with no
interrupt deliverable and every device idle. The controller reads that count through
`schedulerStats`, the same ordered channel the pointer events take, and waits (polling every
40 ms, at most 2 s) for it to move on: the guest has then been idle after everything sent
before the question reached it.

- **Rest**: 150 ms without a sent position or a cursor event, then the guest caught up, then —
  if no position was sent meanwhile — the plane stands for the last position sent
  (`_restHotspot`). A busy guest gives no rest answer; without the count (no paced clock) no
  rest wait is armed at all.
- **Restart** (pointer mode, output size, `resetHotspotInference()`): the guest's moves are not
  evidence until it has caught up (`_hotspotSettling`); without the count, for a fixed second.
  A mode or size change keeps settled hotspots (they belong to their images) and forgets the
  positions sent and everything unsettled (`CursorHotspotEstimator.restart`); only the explicit
  reset forgets everything.
- The "still arriving" special case is gone (it was the hole); three contradicting moves still
  drop an answer. The history is 512 positions. The loader's scheduler stats gain `idleYield`.

**Tests** (`web/tests/e5-t36-cursor-hotspot.test.mjs`, 26 tests). The guest model now queues
what the page sends and acts on it when the test lets it, and its idle count moves only when
the queue is empty. New or changed: round 2's first sequence in its own numbers (the rest wait
elapses with the guest a position behind, the pointer moves on: no answer for 2.6 s of quiet,
none wrong after, (9,4) once it has caught up); round 2's second sequence three ways (size,
mode, explicit: nothing while the guest is behind, however long, also after the first question
timed out); 400 random approaches with varying lag, late image changes, stalls during which
the rest wait elapses and nudges before the guest reports — never more than a pixel off, known
at rest in at least 90%; a counter that is absent, null, non-numeric, throwing, slow (ten
polls) or never idle; a position sent while the guest is being asked; restarts keeping settled
hotspots. Mutants (`python3 evidence/e5-t36a/mutants.py <scratch dir>`, `mutants.log`): 61
one-line mutants, 60 killed; the survivor writes the style for an unchanged answer, which
`_setHostCursor` skips. The round-2 verifier's `p2-handworked.mjs` run against this code shows
no wrong hotspot in any of its cases (its harness has no idle counter, so there is no rest
answer; the hand is settled by the jumps that follow).

**Gates** (`bash evidence/e5-t36a/gates.sh`, log sha256 `9fc64fd2c6ed…`, at `09e327eeb`): the
four cursor test files, 39 tests, all pass; shipped copies of the two sink files byte-identical
to their sources; web unit suite 647 tests, 619 pass, 28 fail — the same 28 names as before,
`diff` empty.

**Browser proof, the committed bundle** (sources as of `9861abce7`; `09e327eeb` changes the proof
script only): `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
(`result.json` sha256 `56c61729e493…`; Chrome 158.0.8127.88 headless). The
script now waits, after the session restart, for 20 consecutive idle seconds (32 s
here) — Chrome's start-up work keeps the guest busy 5–20 s after its window is up, and a busy
guest gives no rest answers — and after each plan's reset for the settling to end.

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

18 reads, every hotspot known and exact, every tip on the sent pixel. The timeline of the
canvas's cursor (sampled every 8 ms over the whole run): 40 changes, 27 answers
shown, none more than a pixel from the truth. In an instrumented run of approach C
(not kept as evidence; logging appended to the controller in memory) the hand's rest question
went out 150 ms after the last event and was answered 45 ms later. No painted pointer, no
console errors, no cursor diagnostics.

**Unchanged with the image as published**: click result median 265.2 ms, key echo
median 44 ms (n = 8 each). Demo page: 127 passed,
0 failed of 127; no errors. Round 2's evidence is kept in
`evidence/e5-t36a/round-2/`.

**Limits, as they are.**

- While the guest is continuously busy (never idle for 2 s at a stretch) there are no rest
  answers and a restart does not end: hotspots are then settled by moves alone, so a shape met
  for the first time on a straight approach is drawn without its hotspot until the pointer
  turns. That is the price of not guessing; the first seconds after a session start are like
  this (hence the proof's wait).
- "The guest has been idle" proves it has acted on the pointer positions. It does not prove a
  client has finished changing the cursor image (Chrome does that on its frame timer, 55–240 ms
  later by round 1's log); that is why a rest answer needs a move of the image since it was
  installed.
- A guest more than 512 sent positions behind makes moves that nothing truthful explains; in a
  small area other positions may explain them, and a right answer can then be dropped after
  three such moves (round 2 saw this with a 128-position history). It is found again by moves
  or at rest.
- Without the paced clock (`?pace=0`): no rest rule, and a restart trusts moves after one
  second.

### 2026-11-26 — verifier (round 3) — VERDICT: refuted

Fresh session; I implemented nothing here and was not round 1's or round 2's verifier. Head
`e902fffb9` (the claim's `09e327eeb` plus one commit of claim and evidence only). My predictions
were written before I ran anything or opened round 3's evidence
(`evidence/e5-t36a/verifier-r3/predictions.txt`; one addendum, timed in the file, written before
the run it predicts); every file named below is in that directory unless its path says otherwise.
Browser runs: the committed bundle from `tools/serve-dist.sh` on 8125 (the served `main.js`,
`loader.js`, `idle-sleep.js` and both sink files hash as `web/dist` at this head, which equals the
sources: `orient.log`), Chrome 158.0.8127.88 headless, the session restarted on legacy KMS as the
worker's script does it. Instrumented runs change the sink file in memory only (`page.route`).

Round 2's two refuting sequences are fixed, both acceptance commands pass for me, and the premise
the rework rests on held in every browser run: in 252 conclusions "the guest has caught up" (idle,
terminal output in bursts, a terminal flood, flood plus CPU loops, a slowed host) the plane stood
for the last position sent every time it could be checked, and no move for an earlier position
arrived after one. What does not hold is the restart rule. Starting inference over forgets every
position sent, including the one the plane is standing for; the device re-reports the plane's
place on every commit; after the restart that re-report is taken as a fresh move, against
positions sent later. The page then shows truth plus one pointer step. I predicted it, produced it
at unit level, and produced it in a browser on the committed bundle through the proof script's
own hook: the arrow drawn with (9,3), (5,5) and (9,3) for its (1,1), for as long as the pointer
rested. Status `in-progress`; nothing promoted.

**Refuted**

- P3, inference started over with the guest NOT behind — FAILED.
  - Predicted before any run (64x64, hand (9,4); `resetHotspotInference()` with the pointer at
    rest and the guest idle; then an even run of 6 px steps from the rest position, the guest one
    position behind, and one commit that leaves the plane where it is after the first new
    position): hand (15,4) from the second move, through the run and at rest.
  - Observed, unit, the real `CursorController`, device order, an idle counter that moves only
    with nothing outstanding (`p3-stale-rereport.log`, case A): exactly that — hand (15,4), arrow
    (6,4) for steps of (5,3), caret (0,6) for (-4,-2); still shown after 5 s at rest with no wait
    armed, through the next jump, dropped on the one after (the third move it cannot explain).
    Case B (no even run: the image flips to the arrow and back where the plane stands): (15,4),
    kept. Case M (no hook: relative mode and back at rest on an image a busy guest never let
    settle, then the run): (15,4), kept. Controls: the same run after a restart by output size is
    right (C: that restart happens on the first sent position, so the guest is asked after it);
    the same re-report with the history intact is right (D). Three rows of A failed MY
    prediction: a mode change on a settled image is right — my script had settled the image
    first, and settled hotspots are kept.
  - Why: `web/src/sink/cursor-hotspot.js:218-225` and `:228-231` forget `_sent` and delete every
    unsettled image with its `last`, so `:145` (a second report from the same place is nothing
    new) no longer knows the plane's place; `cursor-controller.js:408-411` gives every move to the
    estimator once settling is over, and settling (`:469-483`) ends when the guest has acted on
    what was sent BEFORE the restart — the plane then still stands for the last of those.
    Round 2 demanded that "a move is evidence only once it can stand for a position sent after"
    the restart.
  - The device: 767 of 2847 moves in `premise-1/events.json` re-report the plane where it
    already was (sway commits for other reasons; update and move both, as round 1 recorded), 61
    of them after a newer position had been sent.
  - Browser, the committed bundle, arrow, true (1,1). Each trial: rest in the page body, the
    hook, wait for `hotspotSettling === false`, then even steps at 60 Hz from the rest position.
    - 10 steps (`plan-r3-stale.json`, `stale-1/result.json` sha256 `0c06323bc740…`): idle guest 0
      of 6; under terminal output 4 of 32: the page showed (13,5), (6,4), (9,3), (13,5) — truth
      plus the step each time — for 40-48 ms, then took it back (the guest kept up for the rest
      of the run: three moves it could not explain). `stale-1/events.json` #4207-#4234: hook at
      t=174891.7, caught up at 174940.9; S(451,666) at 175053.8; U/M (445,662), the old place,
      at 175069.3; S(456,669), S(461,672); M(450,665) at 175100.1 and (6,4) is shown; none at
      175144.9; (1,1) at 175161.9.
    - 2-4 steps (`plan-r3-stale-short.json`, `stale-short-1/result.json` sha256
      `d14a3bcfcc67…`; predicted in the addendum): 3 of 48 trials end WRONG and stay so at the
      reads 0.4 s, 1.9 s and 4 s after the stop: (9,3), (5,5), (9,3), each shown for 5.0 s — until
      the next trial's hook. `stale-short-1/events.json` #1135-#1180: hook at t=80894, caught up
      at 80990.5; S(441,671) at 81137.6; M(432,668), the old place, at 81146.6; S(449,673),
      S(457,675); M(440,670) at 81178.7 and (9,3) is shown; M(448,672) (explained by the position
      sent after it), M(456,674) (one miss); the plane then rests at (456,674) with (9,3): the
      drawn tip is 8 px right of and 2 px below the pixel the page sent. Guest load: `seq 1 30;
      sleep 0.15` in a loop on the terminal, load average 0.24; no console errors, no cursor
      diagnostics.
  - By model, given the one re-report (`attacks-r3.log` §i, 200 seeds a row, runs of 2-10
    positions): guest one or two positions behind, wrong after 3 s of rest in 86-94 %; guest
    keeping up, 0.
  - Reach: nothing in the page calls `resetHotspotInference()`; the proof scripts do, and then
    jump far away, which is why the proof cannot see this. A pointer-mode change reaches it only
    for an image not yet settled and with the first absolute position a step from where the
    guest's pointer was left (M); a restart by output size does not reach it (C). I produced it
    in a browser through the hook only.
  Demand: after inference starts over, a move that leaves the plane where it stood is not
  evidence against positions sent afterwards (or what the plane stands for is not forgotten) — or
  state the limit as it is and say why it is acceptable; either way a controller test in the
  device's order that starts a run from the rest position after each kind of restart.

**Insufficient**

- The test guest is still not the device in one respect. `LegacyKmsGuest.show` reports a MOVE
  only when the plane moves (`web/tests/e5-t36-cursor-hotspot.test.mjs:368`); the device reports
  one on every commit (the file's own fixture has such a pair at `:463`). With that condition
  removed in a scratch copy 25 of 26 tests still pass (the one that fails, `:663-674`, pins "an
  update, no move", an order the device does not produce): the code is right about re-reports
  while the history is intact, and no test starts a run where the pointer rests after a restart.
  Demand: the guest model reports a move on every commit.
- Mutants of the asynchronous code, scratch copies only (`mutants-r3.py`, `mutants-r3.log`):
  11 of my 17 survive the worker's tests. One is behaviour: V1, a rest answer given to whatever
  image is shown when the guest answers (no `key !== this._imageKey` at
  `cursor-controller.js:606`) — with it the hand is drawn with the caret's (4,8) and keeps it
  when the client changes the cursor while the guest is being asked
  (`mutants-r3-vs-my-attacks.log`); that is the ordinary order on a button (Chrome changes the
  cursor 55-240 ms after the pointer arrives). The code as written is right there
  (`attacks-r3.log` §c). V5, V6 and V10 (epoch checks of a restart's question, the epoch bump)
  I could not turn into a wrong answer — the guards back each other up; V2, V3, V4, V7, V8, V16,
  V20 change nothing observable (V20: `cursor-hotspot.js:222` is never read). The worker's 61
  reproduce, 60 noticed (`mutants-worker-rerun.log`). Demand: a test in which the image changes
  while the guest is being asked.

**Held** (carry forward while the code and evidence they rest on are unchanged)

- P0: `gates.log` names `09e327eeb` (sha256 `9fc64fd2c6ed…`); `09e327eeb..e902fffb9` touches no
  source; `web/dist` sink files, `main.js` and `loader.js` are byte-identical to their sources;
  the server on 8125 serves them (`orient.log`). The worker's `browser/result.json` (sha256
  `56c61729e493…`) was written at 07:31:25, after `9861abce7` (07:25:51) and 11 s before the
  proof script's change was committed (`09e327eeb`, 07:31:36); my own run of the committed
  script stands in for it.
- P1: the four cursor test files, 39 of 39 (`unit-acceptance.log`).
- P2: round 2's sequences through the new controller with an honest idle counter
  (`p2-handworked-r3.log`). Its E2: no answer at t=381 (round 2 observed (0,4)) nor when the
  guest catches up at 516; (9,4) at t=790; (9,4) after 9 s, after 20 more positions with the
  guest one behind, after the jumps; never anything but none or (9,4). (I predicted 640-710: my
  arithmetic, the commit at t=600 re-arms the wait.) MAIN (9,4) at t=286, E1 at t=510, both as
  predicted. Its §4, three ways: no answer during the run nor in 3 s of the guest staying
  behind, none at rest after it caught up, (9,4) after one more position.
- P4, the premise, in the real system. Read: pointer events and the stats call share one FIFO
  (`web/linux-worker-protocol.js` `chain`), cursor frames and RPC results share the worker's
  endpoint in the order produced, every run entry forces a full device sync
  (`crates/core/src/lib.rs:7484`), the input device drops its OLDEST frames on overflow.
  Measured (`analyze-premise.mjs` over the instrumented logs of `premise-1`, `premise-slow-host`,
  `stale-1`, `stale-short-1`): 252 conclusions "caught up" (126 after a rest, 126 after a
  restart). In the 195 with a known image and a sent position the last cursor move plus the true
  hotspot was within a pixel of the last position sent before the question (or of one sent
  during it): 195 of 195. Moves that took the plane elsewhere after a conclusion with nothing
  sent since the question: 0. Six times the client changed the image after a conclusion (the
  claim's limit 2), each handled. Question to conclusion: median 50 ms; on the slowed host 531 ms
  (max 7.2 s). Under the flood no question was answered (26 of 26 restart questions timed out;
  with two CPU loops 14 of 15; slowed host 15 of 16) and no rest question was ever asked.
- P5a: the worker's browser command passes for me with the claim's 18 rows exactly; timeline 44
  changes, 31 answers, none wrong (`browser/result.json`, sha256 `4422291a2b53…`).
- P5b, what the proof's 20 idle seconds hide: the claim's limit 1 and nothing else. Without the
  wait, right after the session is up (`premise-1`, phase `early`): 15 reads, 10 right, 5 none,
  0 wrong.
- P5c, continuous approaches of my own, each starting inference over, every answer the page
  showed recorded (8 ms recorder). `premise-1` (sha256 `8e2dfae834ad…`), 32 approaches, 160
  reads: idle 20 of 20 right (the kernel's plane + hotspot on the sent pixel in all 20), bursts
  60 of 60, flood 0 of 30 answered, flood + CPU loops 0 of 20, after the load 15 of 15; 106
  answers in the timeline, none wrong. `premise-slow-host` (Chrome under `taskpolicy -b`,
  session restart 56 s; sha256 `ef2a6e74abc5…`), 20 approaches, 100 reads: 79 right, 21 none
  (20 of them under the flood), 0 wrong; 89 answers, none wrong.
- P6, unit, real controller (`attacks-r3.log`, 22 checks): a restart while a rest question is
  in flight answers nothing (three ways; the control without the restart is answered); 300
  approaches then 1-6 flips hand/caret at rest, 0 wrong; settled hotspots are right at once
  after a mode or size change; a guest 600-900 positions behind in a 40x30 px area drops the
  right answer in 7 of 40 runs, shows a wrong one in 0, is right at rest in 40 of 40 (limit 3
  as stated); a count that goes down, is NaN, Infinity, a string, rejects, hangs or alternates
  with null gives no answer and no throw; three restarts back to back with answers in flight.
- No counter in the real page (`pace0-1`, `&pace=0`, sha256 `ede417b7ca71…`): `idleYield`
  false, `idleSleeps` 0; five restarts end after 1032-1036 ms; 22 reads, 18 right, 4 none (first
  straight approaches), 0 wrong; 26 answers, none wrong.
- Regression, judged on the worker's files: click 265.2 ms and key echo 44 ms against
  E5-T37b's 267.7 / 270.6 / 267.9 and 45.4 / 48.8 / 44.2; demo page 127 of 127. With the image as
  published no rest wait is armed (no image to infer for), so the page asks the guest nothing.
  `web/tests/e5-t37b-*.test.mjs`: 22 of 22 with the extra stats field.

**The claim's limits**

- Limit 1 is true and is what the flood phases show, with two corrections. It takes ONE idle
  wait within 2 s of the question, not 2 s of idleness. And "hotspots are then settled by moves
  alone" holds only without a restart: while a restart has not ended, moves are not evidence
  either, so after `resetHotspotInference()` or a mode or size change under continuous load
  nothing is inferred at all (0 of 70 reads under the flood here; round 2 had 339 of 342 by
  moves). Settled hotspots are kept across mode and size changes, so a user loses only shapes
  not yet met.
- Limit 2 true (seen six times, handled; unit §c). Limit 3 true as far as I tried (§e).
- Limit 4 true; what "trusts moves" means: a guest one position behind and silent for 1.2 s
  across a restart leaves the hand at (0,4) at rest (`attacks-r3.log` §f). Also, in the page
  the rest wait IS armed without the count (`web/main.js:864` always passes a function): 23
  questions, each answered "no counter" at its first reading; no effect on what is shown.
- Missing: P3. And, a delay only: after a restart at rest nothing is known about the image
  shown until its plane moves again (`cursor-controller.js:480`).

**Coverage of the diff** (`coverage-unit-tests.txt`; the browser runs above)

- `cursor-hotspot.js`: every block executed by the tests.
- `cursor-controller.js`, by no test: `:476` (a restart during the one-second fallback) and
  `:506` (the count disappearing during a question; my §g "alternates" runs it, right) — needs
  evidence, one assertion each; `:479` — unreachable as far as I can see (after `:472` nothing
  awaits, and a fallback wait that elapsed was not ended), delete or waive as a guard; `:517`
  and `:602` waived (a timer firing after its wait ended; a diagnostic); `:114` the default
  timer, executed in every browser run.
- `web/main.js:864-867` and `web/loader.js:1843`: both arms executed in a browser (paced: 5929
  readings in the four instrumented runs; `&pace=0`: null, `idleYield` false).

SUITE: n/a until the refutation clears.

Commands (repo root):
`cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`;
`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/verifier-r3/browser`;
in `evidence/e5-t36a/verifier-r3/`: `node p2-handworked-r3.mjs`; `node p3-stale-rereport.mjs`;
`node attacks-r3.mjs`; `node make-plans-r3.mjs`;
`node premise-browser-r3.mjs --plan plan-r3-premise.json --out premise-1 --instrument` (likewise
`plan-r3-stale.json` into `stale-1`, `plan-r3-stale-short.json` into `stale-short-1`,
`plan-r3-slow-host.json` into `premise-slow-host` with
`--chrome ../verifier-r2/chrome-background-qos.sh`, `plan-r3-pace0.json` into `pace0-1` with
`--query '&pace=0'`); `node analyze-premise.mjs DIR --phases`; `node analyze-stale.mjs DIR`;
`python3 evidence/e5-t36a/mutants.py SCRATCH`; `python3 mutants-r3.py SCRATCH`; the four test
files with `NODE_V8_COVERAGE` and round 1's `coverage-uncovered.mjs`;
`cd web && node --test tests/e5-t37b-paced-idle.test.mjs tests/e5-t37b-run-loop.test.mjs`.

Not checked: a pristine clone (medium risk); the whole web unit suite, the demo page and the
latency run (taken from `gates.log`, `demo-suite.json`, `browser-unchanged.json`); P3 through a
pointer-mode change in a browser (unit only, case M), and a mode or size change in a browser at
all; E5-T37a's "a reported wait is always true" (leaned on as told; my check of the premise is
end to end and would see a false wait only as a conclusion with the plane behind); a guest with
more than one hart; a real mouse; how often a guest commits a frame between a position and its
move on other people's machines (9 of 48 and 4 of 32 trials here, under light terminal output);
Firefox and Safari; cursors above the CSS limit; E5-T36b's image.

### 2026-11-26 — worker — round 4 claim (head `b23468add`)

Round 3's refutation is right, and it showed the rule the first three rounds lacked rather than
one more case of it. Commit `b23468add`.

**What was wrong.** A cursor move does not say "the guest's pointer has just arrived for a
position the page sent". The device reports the plane's place on every commit, so a move says
"the pointer is here" — and comparing it with sent positions is sound only while the position
the pointer stands on is one of them. Round 3 forgot the positions (and what was not settled)
on every restart and then waited for the guest to be idle; but idle with nothing sent since
leaves the pointer exactly where it was, on a position the page no longer has. The next report
from that place was explained by the first position sent afterwards.

**What changed.**

- **Settling is the page not knowing where the guest's pointer stands**: from the page's
  start, after a guest reset, and after a change of pointer mode or of the output size. It ends
  when the guest has been idle after a position sent SINCE, and the guest is first asked when
  that position is sent (`notePointer` → `_settleHotspots`), not at the restart. Until then no
  move reaches the estimator. Round 3 took a new page and a reset guest for settled ("the
  guest has nothing of ours on its way") — the same hole.
- **The proof's hook keeps the positions sent** (`CursorHotspotEstimator.forget`: every image,
  nothing else). The pointer still stands on a remembered position, so there is nothing to
  wait for, and the hook now tests inference itself instead of the restart.
- **Without an idle counter nothing is inferred.** The fixed one-second fallback is gone (it
  trusted moves the page could not vouch for: your §f). A counter that says nothing is looked
  at again every two seconds, so one that appears later is used.
- A cursor move that hides the cursor (resource 0) ends the wait for the image it replaced; a
  rest question answered after it used a descriptor that was gone (found re-reading the code,
  not by a test of yours or mine).
- Conditions that could never decide are gone, so that what is left is what the tests pin:
  your `:479`; the `disposed` checks behind an epoch that `dispose` ends; a rest answer checked
  against an answer it would only repeat; the hotspot re-read at a restart (it cannot change
  there); the candidate lists written for settled images and never read (your V20, twice); the
  counter check in `_armHotspotRest` (settling never ends without a counter). The question to
  the guest now checks its epoch before it begins a poll wait, not after.

**Your demands, one by one.**

1. P3. `web/tests/e5-t36-cursor-hotspot.test.mjs`, "a run from where the pointer rests after
   each way of starting over": your case A (64x64, hand, 6 px steps, the guest one position
   behind, one commit that leaves the plane where it is before the first move) and your case B
   (the image flipped to the arrow and back where the plane stands), after each of the page's
   start, a guest reset, a pointer-mode change, an output-size change and the hook. For the four
   that forget positions: nothing is shown during the run, at rest with the guest behind, or
   when it has caught up; the page is settled at the next idle; one more position and a rest
   give (9,4). For the hook: never anything but none or (9,4), and (9,4) from moves alone when
   the guest catches up. Then 500 random such runs (steps of 1-8 px, 2-10 positions, lag 0-2,
   commits and cursor flips in between, the shape never met / met once / settled before): never
   more than a pixel off, known and right in the end. And at estimator level, the same run with
   `forget`, `restart` and `reset`, showing (15,4) for the two that forget positions — the
   reason the controller owes the estimator the wait.
2. The guest model reports update and move on every commit (`LegacyKmsGuest.show`; `commit()`
   is a commit for a reason of the guest's own). The one test that pinned "an update, no move"
   keeps that order and says whose it is not; a second one in that order pins that an update
   restarts the rest wait.
3. "The client changes the cursor while the guest is being asked": the caret's question is in
   flight, the hand appears, the guest answers — nothing is shown, then the hand's own wait
   gives (9,4), and the caret is still unsettled when it comes back.
4. Coverage. `:476` is now the look-again wait: run by "without an idle counter…" (a counter
   that is null, non-numeric or throws; a restart during the wait). `:506` (the count going
   away during a question): the same test, `late` and `gone`. `:479` is deleted.

**Tests and mutants.** 44 tests in the four cursor files, all pass. `python3
evidence/e5-t36a/mutants.py <scratch dir>` (`mutants.log`): 76 mutants,
75 killed; the survivor skips nothing observable (`_setCssHot` returning early for an
unchanged answer saves building the CSS string on the move path; `_setHostCursor` skips the
write either way). The list now carries your V1 (C37), the old rule "ask at the restart" (C36),
"the page starts settled" (C32), "a guest reset is settled" (C28), "the hook forgets positions"
(C4d, H29) and what a question in flight does when inference starts over (C34, C35, C38,
C41). C35 is killed by a counter whose readings the test delivers by hand, so that a restart
falls between two of them; C34 by a test run that never ends (the old question spins; the
runner gives up after 90 s) — the same hand-delivered readings would catch it by assertion,
after the point where it spins.

**Gates** (`bash evidence/e5-t36a/gates.sh`, log sha256 `621410cc4a8f…`, at `b23468add`): the four
cursor test files pass; shipped copies of the two sink files byte-identical to their sources;
web unit suite 652 tests, 624 pass, 28 fail — the same 28 names as before, `diff` empty.

**Browser proof, the committed bundle**: `node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/browser`
(`result.json` sha256 `8c13d2a81667…`; Chrome 158.0.8127.88 headless; session restart
16 s, idle after 33 s). The page was settling until the first position, and
settled 128 ms after it. The four plans start with the hook and no wait:

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

18 reads, 18 with the exact hotspot and the tip on the sent pixel. Then 48 even runs from where
the pointer rests, right after starting over, with the terminal printing in bursts (`seq 1 30;
sleep 0.15` in a loop, as in your `stale-short-1`; steps and lengths from your plans):

| started over by | runs | arrow known 0.4 s after the stop | 1.9 s after | after two more positions | wrong |
|---|---|---|---|---|---|
| hook | 24 | 24 | 24 | 24 | 0 |
| hook and pointer mode | 24 | 4 | 24 | 24 | 0 |

The timeline of the canvas's cursor over the whole run (sampled every 8 ms): 142 changes,
80 answers shown, none more than a pixel from the truth. No painted pointer, no console
errors, no cursor diagnostics.

**Unchanged with the image as published** (two runs, n = 8 each; `browser-unchanged.json`,
`browser-unchanged-2.json`): click result median 278 and 271.1 ms, key echo median
45.7 and 46 ms — rounds 2 and 3 measured 272.8 and 265.2 ms, 46 and 44 ms; E5-T37b
267.7 / 270.6 / 267.9 and 45.4 / 48.8 / 44.2. With that image there is no cursor image to infer
for: the page asks the guest after the first position until it has been idle once, and nothing
after that. Demo page
(`E5_DEMO_TASK=E5-T36a E5_DEMO_OUT=evidence/e5-t36a node evidence/e5-t36a/demo-suite.mjs`):
127 passed, 0 failed of 127; no errors. Round 3's evidence is kept in
`evidence/e5-t36a/round-3/`.

**Limits, as they are.**

- **A busy guest.** "Caught up" takes one idle wait within the two seconds of a question
  (asked again when it times out). While the guest takes none, there are no rest answers; and
  while the page is settling — from its start, after a guest reset or a change of pointer mode
  or output size — nothing is inferred at all, moves included, until the first idle wait after
  a position sent. Hotspots settled before a mode or size change are kept, so a user loses only
  shapes not met yet. Not settling, moves alone settle a shape as soon as the pointer turns.
- **Rest needs 150 ms without a position sent and without a cursor event.** A guest that
  commits frames without pause (an animation, a scrolling terminal) reports the cursor on each
  and gives no rest answer; moves decide then. (Under the bursts above every run was answered.)
- **After starting over at rest, nothing is known about the image shown until it is reported
  again** — by the next commit of the guest's own or the next pointer position. (Your
  "a delay only".)
- "The guest has been idle" proves it has acted on the pointer positions. It does not prove a
  client has finished changing the cursor image; that is why a rest answer needs a move of the
  image since it was installed and is dropped if the image changed while the guest was asked.
- **The page assumes the guest's pointer goes where the page sends it, and nowhere else.** A
  guest that moves or holds its pointer itself — a compositor warp, a client's pointer lock
  inside the guest — reports planes no sent position stands for; a wrong answer is then
  possible until three moves contradict it. The Replay desktop's session does neither by
  itself (sway's default warps only between outputs, and there is one).
- A guest more than 512 sent positions behind makes moves that nothing truthful explains; in a
  small area other positions may explain them, and a right answer can then be dropped after
  three such moves. It is found again by moves or at rest.
- **Output size.** The page learns a new output size from the frames it presents; positions
  sent before that were computed for the old size, and moves reported between the change and
  the next position sent are compared with them (what is not settled by then is forgotten at
  that position; an answer settled in between is kept). The Replay desktop's output is fixed
  at 1280x800 and nothing in the page changes it.
- Without the paced clock (`?pace=0`) nothing is inferred: the guest's cursor image is drawn
  with the device's (0,0), off by its real hotspot.

### 2026-11-26 — verifier (round 4) — VERDICT: needs-evidence

Fresh session; I implemented nothing here and verified none of rounds 1-3. Head `dfa9ef902` (the
claim's `b23468add` plus one commit of claim and evidence only). My predictions were written
before I ran anything or opened round 4's evidence (`evidence/e5-t36a/verifier-r4/predictions.txt`;
one addendum, in the header of `make-plan-r4-nohook.mjs`, written before the two runs it
predicts); every file named below is in that directory unless its path says otherwise. Browser
runs: the committed bundle from `tools/serve-dist.sh` on 8125 (`main.js`, `loader.js`,
`idle-sleep.js`, `src/input/pointer.js` and both sink files hash as `web/dist` at this head, which
equals the sources: `orient.log`), Chrome 158.0.8127.88 headless, the session restarted on legacy
KMS as the worker's script does it. Instrumented runs change the sink file in memory only.

Round 3's refutation is fixed: its sequences and its two browser plans show no wrong hotspot, the
stale report of the plane occurred 20 times in my runs and was right every time. All three
acceptance commands pass for me, round 3's four demands are met, the worker's 76 mutants
reproduce (75 noticed), and nothing I tried with what the page lets a user of the Replay desktop
do showed a hotspot more than a pixel from the truth. What does not hold is the last step of the
rule this round rests on, for one of the ways of starting over it names: after a change of pointer
mode, "the guest has been idle after a position sent since" is not "its pointer stands on that
position". The guest's kernel drops an absolute position equal to the tablet's last one, and
relative motion (another device) leaves that last one where it was. I predicted it, and produced it
in a browser on the committed bundle, with and without the proof's hook: the arrow drawn with
(4,3), (3,5), (12,6), (4,3), (7,5) for its (1,1), at rest, for as long as my scripts waited.

Why not `refuted`: the rule I wrote down before running (end of `predictions.txt`) asks for a
sequence a user can reach. Relative mode cannot be entered from the Replay desktop's page: its
toggle `#ide-pointer-toggle` is inside `#ide-term-pane`, not displayed in the desktop layout (zero
size in all three runs: `ui` in each `result.json`), and nothing else calls `setMode`
(`web/main.js:935`, `:941-944`). I entered it through `window.__pointer.setMode`, the call the
proof script makes. And what the page then shows is what the claim's fifth limit says it shows when
the guest's pointer is not where the page sent it. Why not `verified`: that limit is not true as
written, the Boundary says the opposite for a pointer-mode change, neither the test guest nor the
proof can see it, and four mutants that are behaviour survive the tests. Status `evidence-needed`;
nothing promoted.

**Needs evidence**

- P9, my one novel attack: the premise "idle after a position sent since = the pointer stands on
  it", after a pointer-mode change — HELD as predicted, that is, the claim does not hold there.
  - Predicted before any run: Linux's input core ignores an absolute-axis value equal to the
    device's current one (`input_handle_abs_event`), so a frame of two unchanged axes reaches no
    compositor; the page settles all the same; the plane reported where it stands is then
    compared with that one position, and "last sent - plane" is taken at rest.
  - Unit, the real controller, a guest that does not act on a repeated absolute position
    (`p9-p11-unit.log`): 64x64 arrow, pointer at rest on (400,640), relative motion (-7,-5), back
    in absolute mode on (400,640): settled; (8,6) for a true (1,1) at rest, 5 s later, and after
    one more position (tip 7,5 off the sent pixel); dropped at the third move it cannot explain.
    The same without the hook for a shape first met during relative motion: caret (11,13) for
    (4,8). Controls (a guest that acts on every position; a return one pixel away): right.
  - Browser, `kernel-drop-1` (`result.json` sha256 `0adcf9483bfc…`, `kernel-drop-1-analysis.log`;
    the kernel's plane read from debugfs before and after each step). In 8 of 8 trials the return
    to the same page point moved the plane by (0,0) — relative motion had moved it by 3 to 12
    pixels — and the page concluded "caught up" 44-134 ms after noting the position. With the
    terminal printing in bursts (the worker's load) and the arrow forgotten by the hook: (4,3),
    (3,5), (12,6) shown at the read 2.2 s later (the first two also at 0.7 s) and kept through an
    even run of two more positions (tip off the sent pixel by (3,2), (2,4), (11,5)); gone after
    two jumps elsewhere. `events.json` #498-#519: S(420,670) at t=115808.2 and the question; "caught up" at
    115902.9 with the plane at (408,664); that plane reported again at 116104.7, 116217.2,
    116372.4, now as evidence; the rest question at 116528.5; (12,6) shown at 116623.1.
    On an idle desktop (three trials) the page settled likewise and showed nothing: no commit
    reported the plane in 2.2 s. An offset outside the image: nothing. A settled arrow: (1,1) kept.
    Controls (the return one guest pixel away): the plane moved, (1,1).
  - Without the hook, `nohook-a` (sha256 `fea26e4f39dc…`) and `nohook-b` (`a794c669d0dd…`), predicted
    in the addendum: the session's first position, relative mode, relative motion, absolute mode,
    the same page point, bursts running: (4,3) shown for 7.2 s and (7,5) for 7.3 s, through two
    more positions and 5 s of rest after them (tip (3,2) and (6,4) off), until the jumps.
  - Over the three instrumented runs with a restart (`p6g-browser-order.log`): of 12 conclusions
    "caught up" after starting over, the plane stood for the last position sent in 4 (the two
    controls and the two plans without a mode change) and not in 8.
  - The claim: Boundary, "after a change of pointer mode … no move is evidence until the guest
    has been idle after a position sent SINCE: its pointer then stands on that position or a
    later one"; fifth limit, "the Replay desktop's session does neither by itself". The session
    holds its pointer whenever a position repeats the tablet's last; that is harmless until
    relative motion has moved the pointer. Code: `web/src/sink/cursor-controller.js:442`
    (any noted position starts the question) and `:502`.
  - Reach: the page's relative mode and the mouse back on the pixel it left; no user of the
    Replay desktop has the first. With the toggle shown it would also need the shape under the
    guest's pointer not settled, the guest's pointer left above and to the left of the mouse by
    less than the image's size, and a guest that commits frames.
  Demand: say what the page knows after a pointer-mode change as it is — or make a position the
  guest will not act on (one that repeats the last absolute position sent before relative mode)
  not end settling; either way a controller test whose guest does not act on a repeated absolute
  position after relative motion (`p9-p11-unit.mjs` and `harness-r4.mjs` may be taken as they are).
- P10, mocks — the test guest is not the device in the respect this round's rule depends on.
  `LegacyKmsGuest.pump` puts the pointer on every position it is given and `idleCount` is "the
  queue is empty" (`web/tests/e5-t36-cursor-hotspot.test.mjs:423-434`): "idle, so it acted, so its
  pointer is there" is the model's definition, not something a test could find false. The proof's
  24 runs "by the hook and a pointer-mode change" enter and leave relative mode in one call with
  no relative motion (`tools/verify/e5-t36-hardware-cursor-browser.mjs:231`). No expected value is
  computed by the code under test (truths are constants, the fixture is a recorded log, the
  browser's truth is the kernel's plane position). Demand: as above.
- P13, mutants of my own, scratch copies only (`mutants-r4.py`, `mutants-r4.log`): 9 of 15
  noticed; I predicted at least 12 of 16 (FAILED, and I ran 15). Survivors that are behaviour,
  each told from the sources by a sequence of mine in which the sources are right
  (`mutants-r4-vs-my-attacks.log`): M1, the position that carries an output-size change noted
  before the restart instead of after — round 3's bug by the size door, hand (15,4) at rest
  (the worker's size runs change size on the first position of a run that continues, so the
  guest's pointer is on a later, remembered one by the time it is idle); M23, the hook ending the
  page's settling — (15,4) after a mode change followed by the hook (the proof calls them in the
  other order); M6, a count that went down taken for an idle wait; M17b, a width-only change of
  output size not restarting. M3 (the guest asked before the position is noted, same tick) and
  M31 (a rest wait left armed when inference starts over) change nothing shown. Demand: tests
  that fail on M1 and M23, and one assertion each for M6 and M17b (S1-S4 of
  `mutants-r4-vs-my-attacks.mjs` may be taken as they are).

**Held**

- P0: the worker's `evidence/e5-t36a/gates.log` names `b23468add` (sha256 `621410cc4a8f…`) and
  `evidence/e5-t36a/browser/result.json` hashes `8c13d2a81667…`; `b23468add..dfa9ef902` touches nothing
  under `web/` or `tools/`; sources, `web/dist` and the server on 8125 agree (`orient.log`). The
  worker's 76 mutants: 75 noticed, the survivor the one named (`mutants-worker-rerun.log`).
- P1: the four cursor test files, 44 of 44 (`unit-acceptance.log`). P2: the whole web unit suite,
  652 tests, 624 pass, 28 fail, the same 28 names as before (`gates.log`, my run).
- P3, round 3's refuting sequences through the new controller, the page settled first
  (`p3-r3-sequences.log`): A by the hook, hand / arrow / caret: nothing during the run, the truth
  at the move for the last position and at rest (round 3: (15,4), (6,4), (0,6)); M: nothing during
  the run nor at rest, (9,4) after one more position; B: nothing after the flip, (9,4) when the
  guest reports; C, D right. Round 3's `attacks-r3.mjs` and `p2-handworked-r3.mjs` as they stand
  (`attacks-r3-on-r4.log`, `p2-handworked-r3-on-r4.log`): no wrong hotspot in any section; its
  model §i 0 of 3000 runs (round 3: 86-94 % for a guest behind); 4 and 7 of their checks no
  longer hold as checks of round 3's behaviour (the one-second fallback is gone, the page starts
  settling, the hook no longer restarts).
- P4, browser, round 3's two refuting plans and runner unchanged: `stale-short-r4` (sha256
  `5e641ca576e0…`), 48 trials, the plane reported where it stood after a newer position in 12 of
  them and taken as evidence, 0 wrong in the timeline (round 3: 3 of 48 kept for 5 s), 144 reads:
  143 right, 1 none; `stale-r4` (`1fc7eae66a55…`), 38 trials, 8 such reports, 0 wrong (round 3: 4 of
  32), 76 reads: 65 right, 11 none.
- P5: the worker's browser command passes for me with the claim's 18 rows exactly; 48 runs from
  the rest position, none wrong, known after two more positions in all (0.4 s after the stop:
  24 of 24 by the hook, 0 of 24 by hook and pointer mode; 1.9 s after: 48 of 48); timeline 142
  changes, 81 answers, none wrong; settling before the first position, settled 129 ms after it; no
  errors, no diagnostics (`browser/result.json`, sha256 `b4457428714e…`).
- P6, settling cannot end without an idle wait after a position noted in the live epoch — unit,
  the readings of the count delivered by hand (`p6-settling.log`, 29 checks): starting over while
  the first reading, the poll wait or the second reading is in flight (also with the stale
  reading coming back greater after the next question was asked); three restarts back to back in
  four delivery orders; a restart with no position after it; `reset()` in each phase; a count
  that goes down, stays, is NaN, Infinity, a string, a BigInt, null, undefined, an object,
  alternates with null, rejects or never answers — no conclusion, no throw, at most one wait
  armed. In the browser every question after starting over directly follows a noted position (13
  of 13, `p6g-browser-order.log`); `pointer.js:222-231` calls the frame hook after send and sync.
- P7 and P8, 2000 random sessions through the real controller, an estimator wrapped to count
  (`p7-p8-fuzz.log`): 0 of 54,261 moves reached the estimator while settling, 0 rest answers
  taken while settling; 3062 hooks at random moments (1508 with a wait armed), 2656 mode and size
  restarts, 513 resets, 1411 hides: 0 wrong in 8087 answers shown, known and right in the end in
  2000 of 2000. A cursor hidden by a move with resource 0 while a rest question is in flight and
  shown again (three ways), and the hook while one is in flight (two ways): none or the truth.
- Carried forward, the code and evidence they rest on unchanged: the estimator-level results of
  rounds 1-3 (`noteMove`, `_candidates`, `noteInstall`, `notePointer` are byte for byte as they
  were; round 4's diff of `cursor-hotspot.js` is comments, `forget`, and two writes nothing read)
  and round 3's P4 for the channel (`web/loader.js`, `web/idle-sleep.js`,
  `web/linux-worker-protocol.js` untouched; `web/tests/e5-t37b-*.test.mjs` 22 of 22 again). Not
  carried, the controller having changed, and re-done above: round 3's P1, P2, P5a, P6 and its run
  without a counter. Regression, judged on the worker's files, both written after `b23468add`:
  click 278 and 271.1 ms, key echo 45.7 and 46 ms; demo page 127 of 127, no errors.

**The claim's limits**

- A busy guest: true (`p9-p11-unit.log` §1; in the real page settling ended 44-134 ms after a
  position in `kernel-drop-1` and 129 ms after the first one in the proof run).
- Rest needs 150 ms without a cursor event: true — a guest committing every 100 or 140 ms gives
  no rest answer in 10 s, every 200 or 400 ms it does (§2). An answer is taken although a commit
  arrived while the guest was being asked; the plane is then the later report, which is right.
- Nothing known after starting over at rest until reported again: true (§3) — and on an idle
  desktop that can take seconds (`kernel-drop-1`, trials T1-T3: nothing in 2.2 s).
- "The page assumes the guest's pointer goes where the page sends it … the session does neither
  by itself": not true as written — P9. Read: the image's sway configuration sets no warp and
  hides no cursor (`tools/replay-desktop/rootfs/etc/replay-desktop/sway.conf`); sway puts its
  pointer at (100,100) when the session starts (plane (99,99) before any position, three runs).
- Output size: true as written — two reports at a new size against positions of the old one
  settle (12,5) for the hand's (9,4), kept at the next position (§7).
- Without the paced clock: true — `pace0-r4` (`&pace=0`, sha256 `df060c2bbfca…`): `idleYield`
  false, 22 reads over three shapes, settling at every one, CSS hotspot (0,0), 0 answers.
- Missing: P9. Nothing a user of the Replay desktop would meet that I could find: buttons carry
  no position (`pointer.js:499`), frames are noted only when sent (`:206-231`), nothing else
  sends tablet events to this guest, and the boot overlay passes pointer events only after the
  desktop marker (`web/ide.js:774-780`).

**My predictions that failed** (besides P13)

- P3, three rows: after a mode change on a hotspot settled before it I predicted nothing shown
  until a later jump; the page keeps showing the settled, right hotspot, as the claim says.
- P11 §2, first version of my script: 140 ms "failed" because my script's first commit came
  156 ms after the approach (`p9-p11-unit-first-version.log`); corrected in the script, not the
  product. My fuzz first counted the rig's missing DOM as diagnostics, and sampled answers only on
  timer ticks; both corrected and re-run (the numbers above are the re-run).
- P13: I named the worker's C42 (a move with resource 0) as a likely survivor; it is noticed.
- P7: I wrote "over the worker's whole test file"; I ran my own sessions only.

**Coverage of the diff** (`coverage-unit-tests.txt`; the browser runs above)

- `cursor-hotspot.js`: every block executed by the tests.
- `cursor-controller.js`, round 4's hunks, by no test: `:512` (no counter function inside a
  question — unreachable: without one no question is asked, `:490`, and settling never ends, so
  no rest wait is armed) — dead, delete it or keep it as a guard and say so; `:539` (a timer
  firing after its wait ended) and `:624` (a diagnostic for an estimator that throws) waived;
  `:111-112`, the default timers, executed in every browser run. The hook's and the restart's
  catch arms and the move that hides the cursor (`:388-397`) are executed by the tests now.
- `web/main.js:864-867`: both arms executed in a browser (paced: 279 readings and 103
  conclusions "caught up" in my five instrumented runs; `&pace=0`: no counter, `idleYield` false).

SUITE: n/a until the demands are met. My sequences are in the directory for the taking.

Commands (repo root):
`cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs`;
`bash evidence/e5-t36a/gates.sh`;
`node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --legacy-kms-session --out evidence/e5-t36a/verifier-r4/browser`;
in `evidence/e5-t36a/verifier-r4/`: `node p3-r3-sequences.mjs`; `node p6-settling.mjs`;
`node p7-p8-fuzz.mjs`; `node p9-p11-unit.mjs`; `node ../verifier-r3/attacks-r3.mjs`;
`node ../verifier-r3/p2-handworked-r3.mjs`;
`node ../verifier-r3/premise-browser-r3.mjs --plan ../verifier-r3/plan-r3-stale-short.json --out stale-short-r4 --instrument`
(likewise `plan-r3-stale.json` into `stale-r4`, `plan-r3-pace0.json` into `pace0-r4` with
`--query '&pace=0'`); `node ../verifier-r3/analyze-stale.mjs DIR`; `node make-plan-r4.mjs`;
`node browser-r4.mjs --plan plan-r4-kernel-drop.json --out kernel-drop-1 --instrument` (likewise
`plan-r4-nohook-a.json`, `plan-r4-nohook-b.json` from `make-plan-r4-nohook.mjs`);
`node analyze-kernel-drop.mjs DIR`; `python3 evidence/e5-t36a/mutants.py SCRATCH`;
`python3 mutants-r4.py SCRATCH`; `node mutants-r4-vs-my-attacks.mjs` (and with `SINK_DIR`); the
four test files with `NODE_V8_COVERAGE` and round 1's `coverage-uncovered.mjs`;
`cd web && node --test tests/e5-t37b-paced-idle.test.mjs tests/e5-t37b-run-loop.test.mjs`.

Not checked: a pristine clone (medium risk); the latency run and the demo page (taken from
`browser-unchanged.json`, `browser-unchanged-2.json`, `demo-suite.json`); P9 through the page's own
toggle and Pointer Lock (not in the desktop layout; `requestLock: false` as the proof does it);
that the kernel is what drops the position (I saw the plane not move, eight times of eight and
twice more, and read the rule from memory of `drivers/input/input.c`, not from the guest's
source); a compositor restarted under a running page, and positions sent before a compositor
reads the tablet (the page would settle on them: the same class as P9; the proof sends none
before its restart and the boot overlay lets a user send none); a slowed host and a guest under
a terminal flood (round 3's runs, not repeated on this code); what the 20 idle seconds of the
proof hide on this code (round 3's P5b); a pointer-mode or output-size change by a real resize;
E5-T37a's "a reported wait is always true"; a guest with more than one hart; a real mouse;
Firefox and Safari; cursors above the CSS limit; E5-T36b's image.
