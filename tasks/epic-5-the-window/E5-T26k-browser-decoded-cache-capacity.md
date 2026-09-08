---
id: E5-T26k
epic: 5
title: Bound and measure browser decoded-block cache capacity
priority: 526.596
status: implemented
depends_on: [E4-T30, E5-T26h, E5-T26j]
estimate: S
risk: high
capstone: false
---

## Goal

Test whether decoded-cache working-set pressure is a material contributor to F's
remaining latency. The resident 24/256-batch comparison at `45bff942` still builds
670993–807475 decoded blocks per endpoint interval with no bulk invalidation.
Compiled residency alone does not satisfy F. This is a controlled capacity
experiment, not an assumed optimization or permission to waive the deadline.

## Boundary

One bounded configuration boundary: explicitly select 4096 or 16384 decoded-block
cache entries for the owned browser Linux machine, before its first guest pump.
Expose the actual capacity in read-only worker statistics. Preserve the existing
4096-entry default, cache key/probe/replacement rules, decode/execute semantics,
PMP/SMC/DMA invalidation, JIT policy, guest clock and snapshot wire format. Do not
change F's fixture, physical input, original restore T0, 2000-ms cap or FPS targets.

## Acceptance criteria

- Omission preserves existing behavior. Only numeric integers 4096 and 16384 are
  accepted at the WASM boundary; malformed, coerced or other values fail before
  mutation. Same-capacity selection is an exact no-op. Core test-only pathological
  capacities remain available to existing adversarial tests, not through the URL.
- The actual core capacity is reported, not echoed from requested options. A real
  size change clears decoded cursor/discovery/compiled caches through the existing
  coherent resize path while preserving architectural registers, RAM, time and
  devices. Deterministic tests cover live decoded/compiled state, aliases, page
  invalidation, hostile same-page stores, reset and resume.
- The browser option forwards through the whole-machine worker and applies before
  any guest execution on both cold boot and stored restore. Invalid selection or
  missing supported WASM method fails closed, never silently falls back. Omission
  must not resize an already configured machine or change the normal restore path.
- Record the exact built Chromium path and one newly authenticated cold seal.
  Compare independent copies in 4096/16384/16384/4096 order, with unchanged JIT
  repack-off/24, divider ten, resident `play` at 5-ms edges and the original cap.
  Retain all actual capacity/counter/input/audio/CRC/timing records, including
  negative outcomes. This experiment alone neither verifies F nor promotes a new
  production default. Do not rebind the old runtime seal to new WASM bytes.

## Verification command

make verify-E5-T26k

## Adversarial verification

Fresh Daybreak Blue carries unchanged architecture and F functional evidence.
Attack NaN/infinity/fractions/strings/arrays/null/empty/oversized inputs, no-op
selection, mutation on rejection, reported-versus-real capacity, missing worker
forwarding, application after the first pump, restore-time loss of selection,
PMP/SMC/DMA coherence, stale compiled handles and changed snapshot semantics.
Compare guest trace/state digests and run the affected native/WASM/browser gates;
sabotage one selection or coherence regression. Run the final exact-head pristine
clone once. No rr, independent machine, WebKit, GitHub Actions or production
deployment is required for this diagnostic prerequisite.

## Verification log

### 2026-09-08 — worker — IMPLEMENTED, measured negative performance outcome

Frozen implementation/build `a53e51a6caf6eb542e4fa2ef4c039f84298a5ec6` is indexed in
`evidence/e5-t26k/README.md`. `make verify-E5-T26k-runtime`, the 19-test real-WASM
selection/clock run, and local `make web-dist` pass; the pristine Daybreak clone
reproduces all scoped gates. New native SMC trace `568b64d33599f3f5` retires 20
instructions identically with legacy/4096/16384, including final snapshot bytes.
The recorded new Chromium cold seal and actual 4096/16384/16384/4096 replay are
`E5_T26K_OUT=evidence/e5-t26k/capacity-a53e51a6 node tools/verify/e5-t26k-browser-capacity.mjs`.
No checkpoint override was supplied. Full invocation, per-child JSON/PNG/logs,
and aggregate survive in that directory; outer transcript is adjacent `.log`.

Actual capacities, repack-off/24 executor, divider ten, independent profile copies,
CRC `f43155a5`, ten real key edges and 1440 fresh non-silent PCM frames hold in
every arm. Original times are 4864.945/4687.215/4685.490/4885.200 ms: all four F
2000-ms checks fail, retained as child exit 1. The collector exits 0 only because
all four configuration measurements are complete. Decoded builds fall about 80%
at 16384, but local mean elapsed improves only 3.87%; no causal host-cost attribution,
F verification, default promotion or deadline waiver follows. Aggregate SHA-256
`408f0e39bcdee9b7766b96557f615e8af49ea1e8fc5e652ca32159e8c7a214e4`.

`E5_DEMO_TASK=E5-T26k E5_DEMO_OUT=evidence/e5-t26k/demo-a53e51a6 node tools/verify/e5-t18e-demo-smoke.mjs`
passes 126/126, zero console/HTTP errors and K in-progress display. The critic's
fresh pending-patch attack and executor-invalidation sabotage are retained under
`evidence/e5-t26k/verifier/`; final browser verdict remains the separate critic's
responsibility. No production deployment or Omarchy image change occurred.

### 2026-09-08 — coordinator — start one bounded configuration boundary

Worker contract: `decodedCacheEntries` is the optional loader/desktop query
selection; `setDecodedCacheEntries(number)` is the strict WASM method; the
read-only `jitStats().decodedCacheEntries` field reports actual core capacity.
Admit only 4096 or 16384. Omission and same-size selection must not resize.
Keep selection outside the permissive JIT-enable fallback catch. Run all actual
browser builds/measurements centrally after the disjoint Rust and JS workers
finish; never combine browser timing with another active benchmark or change an
existing cold seal's binding. This task's status is not a performance claim.

### 2026-09-08 — coordinator — measured prerequisite, no default decision

The closed F comparison is indexed at
`evidence/e5-t26f/resident-residency-replay-45bff942/comparison.json`.
Larger compiled residency raises interval JIT share from roughly 39% to 61–62%
and removes recorded eviction/retranslation churn, but all four interactions
still take 4013.55–4745.285 ms. Decoded builds remain high even in the no-churn
arms. Capacity is a falsifiable candidate; these counts alone establish neither
a cache-conflict cause nor a host-time saving. Keep the normal default unchanged
until an independently reviewed product-level result justifies a later decision.
