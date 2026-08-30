# E4-T19 — cross-browser WebAssembly module-cost matrix

Measures the per-`WebAssembly.Module` / per-`Instance` fixed costs the JIT's batching strategy is
designed around (`docs/jit-architecture.md` §7): compile latency vs module size (1..256 functions),
instantiate latency, memory per module, and the live-instance cliff (1k / 5k / 10k). These are the
numbers that justify the batching K and the E4-T20 budgets.

## Run (one command)

```
./run.sh
```

Installs the Playwright browsers, serves this directory, and runs the matrix on **Chromium**,
**Firefox**, and **WebKit** (the Safari substitute — no macOS CI runner). Output lands in
`results/<engine>.json`.

## What it measures

- `genModule(n, bodyOps)` (`gen-module.mjs`) emits a valid WASM module of `n` exported functions
  sharing one memory — the SHAPE of a JIT batch module — so byte size scales with function count.
- `harness.html` runs, per engine: median `WebAssembly.compile` and `WebAssembly.instantiate` over a
  size sweep, then instantiates up to 10k live instances of a 64-func module to find the cliff
  (records `failedAt`, wall time, and `performance.memory.usedJSHeapSize` where available — Chromium
  only; `null` elsewhere, documented per row).
- `cost-matrix.spec.mjs` drives the page in each browser and writes the JSON.

## Optional cross-version screen

The committed three-engine command uses pinned Playwright browser revisions. For a second Chrome
installation, set `E4_T19_CHROME_EXECUTABLE` and run the added `chromium-system` project:

```
E4_T19_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \\
  npx playwright test --project=chromium-system
```

This writes `results/chromium-system.json`; it is supplemental robustness evidence, not part of the
clean-checkout three-engine matrix.

## Status (verification debt)

The **harness is committed and runnable**; the **live capture is dev debt**: this development machine
(mac) OS-reaps long browser runs, so the committed `results/*.json` are produced on the Linux dev box.
`results/` ships **empty** — no fabricated numbers (see the E4-T19 ticket Verification log). Deferred
per the ticket: the committed cost-matrix JSON [AC1], the instance-count-cliff limits [AC4], and the
first-execution warm-up vs the E4-T06 pause target [adversarial #4].
