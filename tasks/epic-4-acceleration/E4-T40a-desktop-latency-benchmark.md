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
recorded baseline is `evidence/desktop-latency/baseline-{a,b,mips,jit0}.json`.

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
