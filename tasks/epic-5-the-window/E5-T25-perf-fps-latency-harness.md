---
id: E5-T25
epic: 5
title: Performance harness — window-drag FPS and input-to-photon latency, measured
priority: 525
status: pending
depends_on: [E5-T09, E5-T18]
estimate: M
capstone: false
---

## Goal
Two repeatable, scripted measurements with committed baselines: (1) sustained FPS while
dragging a real window across the T18 desktop, and (2) input→photon latency from
host-side event injection to the resulting pixel change being presented — the numbers
the capstone's "usable FPS" claim and all future perf work will be judged against.

## Context
Both metrics are host-observable, so no guest clock sync is needed. **Drag FPS**:
inject a deterministic T14 pointer script (press on a foot window's titlebar, 300
smooth move steps along a fixed path, release) and count sink presents (T09's
frames-presented counter) over the drag's wall time; also record bytes-uploaded/frame
and guest instructions/frame (E4 counters) to attribute bottlenecks (emulation vs
transfer vs present). **Input→photon**: inject a keypress into a focused terminal
running `cat`; timestamp t0 at `inject_event`, t1 at the first present whose damage
rect intersects the cursor cell *after* t0; latency = t1 - t0, plus rAF-to-vsync as
measured error bar. Report p50/p95 over ≥ 100 trials, discard warm-up. Harness runs
headed (real rAF) via Playwright with `--disable-frame-rate-limit` OFF (we want real
vsync), pinned browser version recorded. Baselines go in `docs/perf/desktop.md` with
the exact commit/config; CI runs a smoke variant (relaxed thresholds, catches 2x
regressions, tolerates CI noise).

## Deliverables
- `web/bench/desktop-perf.ts`: drag-FPS and key-latency scenarios, deterministic
  scripts, JSON output {fps_p50, fps_p95, lat_p50_ms, lat_p95_ms, bytes_per_frame,
  instr_per_frame}.
- Injection hooks on the input devices (test-only, feature-gated out of release).
- Damage-rect intersection latency detector in the sink (test-gated).
- Committed baselines + a regression gate script (`tools/perf_gate.py`) comparing runs
  to baseline with documented noise margins.
- `docs/perf/desktop.md`: methodology, error sources (rAF quantization, compositor
  double-buffering), numbers on the dev machine.

## Acceptance criteria
- [ ] Drag-FPS scenario runs unattended 5x with coefficient of variation < 15% on the
      dev machine (repeatability proven before any number is trusted).
- [ ] Baselines recorded: drag FPS ≥ 15 and key latency p95 ≤ 150 ms on the dev
      machine (or current-reality numbers committed with an explicit gap-to-target
      note — honesty over aspiration; capstone gates on ≥ 15 FPS).
- [ ] Latency detector validated against ground truth: a 240 fps camera phone or
      screen-recording cross-check on one run agrees within ±1 frame (methodology
      sanity check, documented).
- [ ] Bottleneck attribution present: the report splits time into guest-exec /
      transfer / present buckets and the doc names the current top cost.
- [ ] CI smoke variant runs green on the current build and red when an artificial
      10x present-throttle is injected (gate actually gates).

## Adversarial verification
Refute the harness before the numbers: run the drag scenario with the display sink
replaced by a null sink that lies (presents without drawing) — if reported FPS doesn't
crater, the counter measures the wrong thing (refuted). Inject a known 100 ms
artificial delay into the present path and confirm latency p50 shifts by 100±10 ms
(end-to-end calibration). Then attack the numbers: run with 4x CPU throttle, a busy
guest (`yes > /dev/null &`), and DPR 2 — the doc must state which configuration the
baseline claims, and the capstone threshold must hold under the *stated* config, not
the fastest one. Check the injection hooks are compiled out of release builds
(`wasm-objdump`/feature audit). p95 hiding: plot the full latency distribution — a
bimodal distribution with a 500 ms mode that p95 happens to miss refutes the summary's
honesty; require the histogram in the report.

## Verification log
(empty)
