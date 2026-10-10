---
id: E6-T12g6m5b
epic: 6
title: Bound the first geometry-dependent power in the original 92cb compositor
priority: 525.027010582
status: pending
depends_on: [E6-T12g6m5a]
estimate: S
risk: high
capstone: false
---

## Boundary

Under complete authenticated 7bf4d0d0/92cb866a source, paired bank and geometry provenance, prove or soundly reject the original pc221/222 `POW` base domain. The base is computed from varying coordinates via `MAX(x, -x)`, with captured exponent `CONST[6].x = 2`. Exact bank values alone do not bound varying inputs. Keep all other original operations gated unless separately proven; do not grant general `POW` authority.

## Deterministic acceptance

`make verify-E6-T12g6m5b` records native/Wasm identity and physical WebGL2 for the exact original pc0..222 path with independently bounded geometry, varied boundaries, negative and nonfinite cases, a handwritten numerical oracle, fault sensitivity, and exact-head pristine-clone evidence. Existing corpus and default rejection remain unchanged; submit to a fresh critic.

## Adversarial verification

Attack geometry ownership, viewport extremes, NaN/overflow, base sign, exponent source, bank/source substitutions, and live branch reachability. Inspect actual numeric values and generated hardware reflection before claiming a domain. Reject any evidence that only assumes sampled pixels bound every accepted geometry input.

## Verification log

### 2026-10-05 — worker — prerequisite discovery

Under all three complete paired banks reconstructed from 1,957 original draws, the unchanged full pair still rejects. A controlled source-prefix probe reached pc220, then first rejected at pc221 `POW` on geometry-dependent `TEMP[171]`; this is an exploratory locator, not an admission claim. E6-T12g6m5a precedes this leaf in the one-task lane.
