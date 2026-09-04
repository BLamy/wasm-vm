---
id: E5-T06c
epic: 5
title: Presentation benchmark and measured backend decision
priority: 506.3
status: verified
depends_on: [E5-T06a, E5-T06b]
estimate: S
risk: medium
capstone: false
---

## Goal
Measure Canvas2D and WebGL2 on the same deterministic workloads and publish a data-backed
default choice with a documented fallback order.

## Boundary
This slice owns only `web/bench/present-bench.html`, its machine-readable result schema, and
`docs/perf/present-paths.md`. It consumes the two backend contracts but does not change runtime
selection or context-loss behavior; E5-T06d owns that integration.

## Deliverables

- Full-frame and 64x64 damage workloads at 1280x800 and 2560x1600, each reporting at least 300
  frames, p50/p95 present time, and copies per frame.
- A repeatable browser harness whose JSON output is stable enough to compare runs and whose
  results identify browser, DPR, backend, workload, and sample count.
- A performance document recording the measured default, its margin for the 1280x800 damage
  workload, and the conditions under which staging/fallback is required.

## Acceptance criteria

- [ ] The benchmark emits valid machine-readable JSON for all four backend/workload combinations.
- [ ] The committed matrix includes the supported browser runs and at least 300 samples per cell.
- [ ] The default is the measured faster path for 1280x800 damage, with the margin and variance
      recorded in `docs/perf/present-paths.md`.
- [ ] Copy counts and the warm-up/sample policy are explicit, so reruns cannot hide setup cost.

## Verification command

`node tools/verify/e5-t06c-present-bench.mjs`

## Adversarial verification

Repeat with DPR=2, a backgrounded tab, and a throttled CPU. If the ranking changes, the document
must record the inversion and the runtime policy must remain honest. Reject runs with fewer than
300 samples or missing backend/workload/browser fields.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- P1 matrix completeness — HELD. The exact-head Chromium run at `5e1cb046b1076cdb5e7df5c6311922ecc540c1ce` emitted eight `ok` cells covering both backends, both workloads, and 1280x800 plus 2560x1600; every cell reports `sampleCount: 300`, browser, DPR, warmups, copy count, and finite p50/p95 timings.
- P2 measured default — HELD. For 1280x800 `damage-64x64`, Canvas2D measured 0.010 ms p50 / 0.015 ms p95 versus WebGL2 at 0.060 ms p50 / 0.070 ms p95. The recorded decision is Canvas2D → WebGL2 with a 0.050 ms / 83.333% p50 margin; full-frame results remain documented separately because WebGL2 wins that workload.
- P3 adversarial profiles — HELD. DPR=2 and 4x CPU throttling each completed the full 300-sample matrix with Canvas2D still first and no ranking inversion. The background-tab attempt was made with a second page brought to front; this headless Chromium run honestly reported `document.visibilityState: "visible"`, so the evidence and performance document do not claim hidden-tab coverage. WebKit and independent-machine runs are outside this task's scope.
- P4 copy/setup policy — HELD. The page and JSON make the 30-frame warm-up, 300-frame sample count, deterministic full-resource source, 64x64 damage rectangle, `performance.now()` timing, WebGL `finish()`, and two-copy model explicit.
- Coverage — HELD. The public benchmark button path was clicked by Playwright; the source and deployable `web/dist` page were asserted byte-identical; `make web-dist` exercised the dist assembler; the verifier exercised the benchmark and all result-validation paths. Defensive error branches are intentionally retained as failure handling.

Commands:

```text
make web-dist
make verify-E5-T06c
node tools/verify/e5-t06c-present-bench.mjs --output evidence/e5-t06c/present-bench-2026-09-04.json
```

Evidence:

- JSON: `evidence/e5-t06c/present-bench-2026-09-04.json`, SHA-256 `eaeae3cbe8847dc6376b91962032299761d6acd6028bd94541035b5274e50ca1`.
- Screenshot: `evidence/e5-t06c/present-bench-baseline.png`, SHA-256 `1c27af9a8568639640da335f61ae835b2394cab0ef9aeda3cfdd19f9f92a4ba4`.
- The evidence envelope records `distParity: {"equal":true}`, zero console/page/request errors, the Chromium version, and all adversarial observations.
