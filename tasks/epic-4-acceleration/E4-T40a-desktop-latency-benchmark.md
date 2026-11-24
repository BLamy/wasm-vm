---
id: E4-T40a
epic: 4
title: Interaction-latency benchmark for the in-browser Replay desktop, with a recorded baseline
priority: 0.38761
status: implemented
depends_on: [E5-T34e]
estimate: S
risk: low
capstone: false
---

## Boundary

Tooling and recorded numbers only. No emulator, loader or guest change.

`tools/perf/desktop-latency.mjs` drives the built page with real DOM pointer and
keyboard events and timestamps, per animation frame, the first change of the
affected pixels on the host canvas. Nothing is typed or read over the serial console
while a latency is being timed, so the measurement adds no guest work. It reports
guest instructions and MIPS from the page's scheduler counters for the same window.

Scenarios: `idle`, `click` (pointer resting on Chrome's "Run again"), `sweep` (a
0.5 s pointer sweep then an immediate click), `type` (one key into foot), `node`
(`node -e 'console.log(6*7)'` to the next prompt), `mips` (CPU-bound loops).

## Deterministic acceptance

```
bash tools/serve-dev.sh 8123 &
node tools/perf/desktop-latency.mjs --label baseline --n 3 --out evidence/desktop-latency/check.json
```

exits 0, reports every scenario with no missing sample, and writes the JSON. The
recorded baseline is `evidence/desktop-latency/baseline-{1,2,jit0}.json`.

Required samples are the result of a click, the result and pointer arrival of a sweep,
the key echo and the Node prompt; the tool exits 1 if any is missing. A pressed-state
frame of the button before the result is optional (a 60 ms press can be released before
the guest paints it) and is reported as seen/none, never as a missing sample.

## Adversarial verification

Low risk: inspect the direct result. Confirm the timestamps come from canvas pixels
and DOM events (not the serial console), and that a region that never changes
reports a missing sample rather than a latency.

## Verification log

### 2026-11-24 — worker — implemented

Head: the commit that adds this entry. Local build: `web/pkg/wasm_vm_wasm_bg.wasm`
SHA-256 `c6cc669227845cf18f0587bd84e40f3fca7ef2af3f024ac58904ef164da5ddd5` (identical
to `web/dist`), Chrome 158.0.8127.88 headless, Apple M4 Max, `bash tools/serve-dev.sh 8123`.

Commands (each exited 0):

```
node tools/perf/desktop-latency.mjs --label baseline --n 3 --scenarios idle,click,sweep --out evidence/desktop-latency/baseline-a.json
node tools/perf/desktop-latency.mjs --label baseline --n 3 --scenarios type,node --out evidence/desktop-latency/baseline-b.json
node tools/perf/desktop-latency.mjs --label baseline --n 1 --scenarios mips --out evidence/desktop-latency/baseline-mips.json
node tools/perf/desktop-latency.mjs --label jit0 --query "&jit=0" --n 3 --scenarios idle,click,mips --out evidence/desktop-latency/baseline-jit0.json
```

Recorded baseline (median of 3 unless noted; all samples present):

| Measure | Shipped (JIT on) | `?jit=0` |
|---|---:|---:|
| Idle guest speed | 40.6 MIPS | 59.0 MIPS |
| Click: first repaint of the button | 652 ms | 381 ms |
| Click: "runs" line repainted | 2,429 ms (1,283–2,561) | 1,265 ms (714–1,589) |
| Sweep then click: "runs" repainted | 1,152 ms (1,021–2,819) | — |
| Key echo in foot | 1,608 ms (84–2,620) | — |
| `node -e 'console.log(6*7)'` to prompt | 14,979 ms (14,542–24,854) | — |
| Node integer loop (wall) | 54.0 s | 46.5 s |
| Shell loop (wall, 762 M instructions) | 16.5 s, 46.2 MIPS | 14.2 s, 53.6 MIPS |

A click retired 50–101 M guest instructions before its result was painted; the
Node command retired 580–947 M. The Node integer loop retired a different number of
instructions in the two modes (2,380 M vs 1,445 M), so compare its wall time, not its
MIPS. Each file records one console error, a 404 for a resource the page probes;
the benchmark does not assert on console errors.

What the recording demonstrates: the tool measures the interaction latencies a
person sees on the built page, from the DOM event to the canvas pixels, and the
shipped configuration is slower than the same build with the JIT off.

### 2026-11-24 — verifier — VERDICT: refuted

Scope: 47bcbe417 (tool, baseline files, claim). Low risk: direct result only, with no cold
clone, sabotage or novel attack. P1–P4 were predicted before reading the JSON or running
anything. P5 arose from the P4 result; its experiment's predictions were written before it
ran. Build checked first: `web/pkg/wasm_vm_wasm_bg.wasm`, `web/dist/pkg/…` and the bytes
served on :8123 all have SHA-256 `c6cc6692…5ddd5`, as claimed, and the tool on disk is the
committed one.

- **P1 latencies come from DOM events and canvas pixels, not the serial console — HELD.**
  - Start times are capture-phase `window` listeners stamping `performance.now()`
    (`tools/perf/desktop-latency.mjs:92-94`), read at :184, :206, :222 and :242.
  - End times are a per-animation-frame hash of each named region, recorded only when it
    differs from the previous hash (:83-90, :96-105). `latency()` reads nothing else (:135-140).
  - The only serial call is `window.wvmDemo.exec` at :259, inside `mips()`, which reports wall
    time and instructions and no latency.
  - The display canvas defaults to the Canvas2D backend (`web/main.js:105`), so the `drawImage`
    readback at :85 sees persistent pixels.
  - Data cross-check: the independent `sched()` bracket is 12–57 ms longer than each pixel
    latency. `baseline-a.json` `scenarios.click.raw`: wallMs 2604/2441/1305 against answered
    2561.1/2428.8/1283.2. `baseline-b.json` `scenarios.node.raw`: 24911/15012/14565 against
    24853.8/14979.2/14541.8.
- **P2 a region that never changes gives a missing sample, not a number — HELD, demonstrated.**
  - Scratch Playwright experiment (not committed): the tool's own probe, `latency()` and
    `stats()` source, sliced out of the file at run time, against a static 1280×800 canvas
    with no guest and no `wvmDemo`. A real `page.mouse.down()` repaints only the `button`
    region 300 ms later.
  - Predicted a `button` latency of 300–450 ms and `runs` null. Observed `button`
    315.4/315.2/316.0 ms; `runs` null three times with 0 recorded changes;
    `stats([null,null,null])` gives `{n:0, missing:3}` with no median.
  - Code path: `waitForFunction` timeout → `catch { return null }` (:136-138) → `stats()`
    drops nulls and counts them as `missing` (:151-155).
  - The same thing happened on the real desktop in P4.
- **P3 log numbers match the files — table HELD; one prose number FAILED.**
  - Every table cell matches after rounding: idle 40.6/59 MIPS; click feedback 651.9/380.7;
    click result 2428.8 (1283.2–2561.1) and 1264.8 (714–1589.2); sweep 1151.5 (1020.7–2818.8);
    key echo 1607.7 (84.4–2619.5); node 14979.2 (14541.8–24853.8); Node loop 54047/46532 ms;
    shell loop 16505 ms, 46.2 MIPS and 14211 ms, 53.6 MIPS, both 762 M. Also correct: 2,380 M
    against 1,445 M, 50–101 M per click (`baseline-a`), one 404 console error per file,
    `missing: 0` everywhere, Chrome 158.0.8127.88.
  - FAILED: "the Node command retired 580–947 M". `baseline-b.json`
    `scenarios.node.raw.rates[].instructionsM` is 946.5, 580, 572, so the range is 572–947 M.
    Correct the sentence.
- **P4 acceptance command reports every scenario with no missing sample — FAILED.**
  - Ran it once: `node tools/perf/desktop-latency.mjs --label verifier --n 3 --out evidence/desktop-latency/verifier-check.json`.
    It exited 0, reported all six scenarios and wrote the JSON and PNG.
  - `verifier-check.json` `scenarios.click.feedbackMs` is `{n:1, missing:2}`, with
    `raw.feedback` `[436.2, null, null]`. Every other measure has `missing: 0`.
  - In the two failing trials the button region did not change between the press and the
    start of the next trial. Each following `settle()` returned about 2.5 s after the result
    (tool stdout: click #2 at 20:02:12.792, click #3 at 20:02:17.519 with a 2172.2 ms result,
    `scenario sweep` at 20:02:20.046), so nothing repainted after the result either. The
    guest painted no pressed state for a 60 ms press (:183), and :186 reads the button once,
    right after `runs` changes.
  - Re-check: two click-only reruns (scratch output) had all 6 feedback samples present
    (153.6/1954.8/410.2 and 121.7/1830.4/581.8). The failure is intermittent: 2 of 15
    feedback samples across the worker's runs and mine.
  - Not attributed to host load: the guest ran at 33.6–42.8 MIPS in these trials against
    34.2–41.6 in `baseline-a`. I cannot exclude load as a contributor.
  - `verifier-check.png` shows the Replay desktop: Chromium on `smoke.html` with `"runs": 7`
    (1 + 3 clicks + 3 sweep clicks) and the foot terminal with
    `desktop$ node -e 'console.log(6*7)'`, `42` and a new prompt.
  - Demand: make the feedback measure reliable, or report "no feedback frame before the
    result" as a result of its own instead of a missing sample. Then record the literal
    acceptance command, all six scenarios in one run, more than once.
- **P5 click: "pointer already resting on the button" — FAILED for trial 1.**
  - `click()` calls `moveTo(BUTTON); settle()` (:178). `settle()` returns at once when no
    watched region changed in the last 2.5 s (:142-149), which is the state `idle` leaves.
  - Scratch experiment on the real page, using the tool's own probe and `settle()`: after
    6 s parked at (640,700), a pointer move onto the button with no press. `settle()`
    returned after 1 ms in both rounds. The `button` region then changed 416.2/732.8/1082.4 ms
    and 216.6/233.3 ms after the move; `runs` did not change.
  - In my acceptance run the trial-1 press came within about 60 ms of `scenario click`
    being logged (20:02:06.082; click #1 logged at 20:02:08.284 with a 2136.6 ms result).
  - So a trial-1 feedback sample (394.4 in `baseline-a`, 256.1 in `baseline-jit0`, 436.2 in
    mine) cannot be told apart from the pointer's own arrival repaint. The table medians,
    651.9 and 380.7, are both trial 3 and are not affected.
  - Demand: wait for the move's repaint to finish before the first press.
- **COVERAGE — HELD.** Every scenario function ran across the four baseline runs and
  `--query` ran in `baseline-jit0`. The timeout-to-null path (:138) ran only in my P2
  experiment. Waived as configuration: `--url`, `--app`, `--headed`, `--chrome` and the two
  timeout options.
- **Carried forward for the next verifier:** P1, P2 and the P3 table are HELD and need no
  re-check unless the probe, `latency()`, `stats()` or the baseline files change.
- **Notes, not findings.**
  - The worker recorded four partial-scenario runs, never the literal acceptance command.
  - The Node integer loop depends on what ran before it. In my six-scenario run it took
    19,130 ms and 1,103 M instructions (`verifier-check.json` `scenarios.mips.nodeIntLoop`),
    against 54,047 ms and 2,379.9 M in `baseline-mips.json`, where `mips` ran alone. The shipped
    and `?jit=0` rows for this loop also came from different scenario lists (`mips` against
    `idle,click,mips`). Cause not investigated. The shell loop is stable at 762–762.5 M.
  - Timings in my run are not compared with the baseline; other jobs were running.
- **SUITE:** n/a until the refutation clears.

Commands:
- `shasum -a 256` on `web/pkg`, `web/dist/pkg` and the served wasm;
- the acceptance command above, once;
- `node tools/perf/desktop-latency.mjs --n 3 --scenarios click --out <scratch>` twice;
- a scratch static-canvas Playwright script (P2) and a scratch move-without-press script (P5);
- a Python comparison of the log table with the four baseline JSON files.

### 2026-11-24 — worker — rework after the refutation

All four demands are addressed; P1, P2 and the P3 table carry forward (the tool's
probe, `latency()` and `stats()` are unchanged).

- **P4 (pressed-state sample missing).** The measure is redefined, not made to look
  reliable: a button repaint strictly before the result is an optional pressed-state
  frame, reported as `pressedFrame.{seen,none,ms}`. It is no longer a required sample,
  so it can never be "missing". The tool now exits 1 when a required sample is missing
  (`result.missing`), which the first version did not enforce.
- **P5 (first press not on a resting pointer).** `settle()` now counts its quiet period
  from the call at the earliest, so it cannot return before a repaint the caller just
  provoked. `click` parks the pointer on the terminal, moves it onto the button, waits
  for the guest to draw it there (`pointerArrivedMs`, asserted present) and then for
  quiet, before the first press.
- **P3 (wrong prose number).** The earlier entry's "580–947 M" should have read
  572–947 M; that entry's files are superseded by the runs below.
- **Acceptance command.** Recorded twice, literally, on the unchanged build (`web/pkg`
  restored to `web/dist`'s `c6cc6692…` wasm for these runs), plus once with `?jit=0`:

```
node tools/perf/desktop-latency.mjs --label baseline --n 3 --out evidence/desktop-latency/baseline-1.json
node tools/perf/desktop-latency.mjs --label baseline --n 3 --out evidence/desktop-latency/baseline-2.json
node tools/perf/desktop-latency.mjs --label baseline-jit0 --query "&jit=0" --n 3 --out evidence/desktop-latency/baseline-jit0.json
```

All three exited 0 with `missing: []`. Median of 3 (range):

| Measure | Shipped, run 1 | Shipped, run 2 | `?jit=0` |
|---|---:|---:|---:|
| Idle guest speed | 46.0 MIPS | 44.3 MIPS | 70.2 MIPS |
| Click: "runs" line repainted | 1,965 ms (1,060–2,379) | 1,492 ms (1,021–2,964) | 931 ms (762–1,822) |
| Click: guest instructions | 33–114 M | 35–146 M | 34–42 M |
| Sweep then click: "runs" repainted | 1,119 ms (1,019–1,233) | 900 ms (887–1,702) | 849 ms (768–898) |
| Key echo in foot | 82 ms (55–252) | 92 ms (81–237) | 83 ms (62–184) |
| `node -e 'console.log(6*7)'` to prompt | 14,249 ms (13,910–41,492) | 13,719 ms (13,531–39,368) | 11,472 ms (11,428–40,517) |
| Node integer loop (wall) | 17.5 s | 17.7 s | 21.6 s |
| Shell loop (wall, 762 M instructions) | 16.3 s | 15.7 s | 13.7 s |

The first Node run of a session is the cold one (878–892 M instructions, 39–41 s);
the next two are warm (564–582 M). The earlier entry's 1.6 s key-echo median does not
reproduce with the corrected settle and is withdrawn. The Node integer loop is
order-dependent, as the verifier noted: 1,105 M instructions here after the `node`
scenario, 2,380 M when `mips` ran alone. Each file records one console 404.
