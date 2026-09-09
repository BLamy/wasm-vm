---
id: E5-T25
epic: 5
title: Performance harness — window-drag FPS and input-to-photon latency, measured
priority: 525
status: cancelled
depends_on: [E5-T09e, E5-T18e]
estimate: M
risk: medium
capstone: false
decomposed_into: [E5-T25a, E5-T25b, E5-T25c, E5-T25d]
---

> **DECOMPOSED 2026-09-06.** This M-sized planning container is cancelled before
> implementation as required by task policy. The work is replaced by four ordered S
> slices: T25a freezes the test-only instrumentation and injection boundary, T25b
> measures drag FPS, T25c measures and calibrates input-to-photon latency, and T25d
> publishes the baselines, bottleneck report, and regression gate.

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

## Execution slices

1. **E5-T25a — instrumentation and injection boundary.** Add the feature-gated
   pointer/key injection hooks, present/damage telemetry, and a deterministic fixture
   API. Prove release builds do not include the hooks.
2. **E5-T25b — drag-FPS harness.** Drive a real Foot window through 300 smooth pointer
   moves, count drawn presents rather than null-sink calls, and retain five runs with
   coefficient of variation below 15% plus guest/transfer/present counters.
3. **E5-T25c — input-to-photon harness.** Measure 100 focused-terminal keypresses to
   the first intersecting presented damage rect, include rAF/vsync error bounds, and
   calibrate the detector against a known 100 ms present delay and one high-frame-rate
   screen recording.
4. **E5-T25d — baseline and regression gate.** Combine T25b/T25c outputs into the
   documented desktop baseline, publish the full latency histogram and bottleneck
   attribution, and add a smoke gate that passes normally and fails under a 10x
   present throttle.

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

### 2026-09-06 — coordinator — decomposed

The M-sized performance container is cancelled before implementation. The children
keep the host-observable metrics in one chain with one boundary and one deterministic
acceptance command per slice; T25d is the only child that owns the published baseline
and regression threshold. E5-T28 remains gated on the final T25 child.
