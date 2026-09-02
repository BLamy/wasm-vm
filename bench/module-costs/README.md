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
  size sweep, a 31-sample fresh-instance first-execution probe against the 5 ms E4-T06 pause target,
  then instantiates up to 10k live instances of a 64-func module to find the cliff (records
  `failedAt`, wall time, and `performance.memory.usedJSHeapSize` where available — Chromium only;
  `null` elsewhere, documented per row). A bounded follow-up may override the targets and
  output directory without changing the canonical run:

  ```
  E4_T19_CLIFF_TARGETS=10000,25000 \
    E4_T19_RESULTS_DIR=results/cliff-2026-09-02-corrected-25k \
    npx playwright test --project=chromium --project=firefox --project=webkit
  ```

  `E4_T19_CLIFF_TARGETS` accepts positive integer counts; every target is released before the next
  one, so the probe measures a held live set rather than accumulating prior tiers. The extended
  result directory is intentionally separate from the clean-checkout `results/*.json` matrix.
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

The committed rows were re-captured after fixing the harness to retain actual `WebAssembly.Instance`
objects. The canonical run reaches the requested 10,000 target in WebKit, while Chromium fails after
122 live instances and Firefox after 999 with an out-of-memory error. The corrected 25,000-target follow-up reaches
25,000 in WebKit and reproduces the Chromium/Firefox limits; the supplemental Chrome 152 screen
fails at 124. Production `BrowserExecutor` now caps live batches at 24, which is more than 4x below
the conservative 122-instance Chromium result. The true WebKit cliff beyond 25,000 and
independent-machine K robustness remain verification debt; the first-execution probe is recorded
and stays below the 5 ms E4-T06 target on every tested engine/version.
