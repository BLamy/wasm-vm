---
id: E6-T12g6m4b
epic: 6
title: Prove zero-capped MIN cannot enter an ordered positive branch
priority: 525.027010589
status: in-progress
depends_on: [E6-T12g6m4a]
estimate: S
risk: high
capstone: false
---

## Boundary

In the private exact-bank branch retry only, derive a versioned nonpositive-or-unordered predicate fact for `MIN` with one directly authorized exact +0/-0 constant-bank operand. An unmodified ordered `FSLT` of zero against that result may materialize false, so existing whole-text branch liveness can skip its dead arm. Preserve numerical access/output authority, source/destination lane versions, masks, aliases, joins and ordinary result bytes. A changed or short bank rejects at the shared consumer. No dynamic numeric range, general geometry bound, arbitrary MIN/MAX inequality system, other comparison proof, full original admission, public import, guest offload or MIPS claim.

## Deterministic acceptance

`make verify-E6-T12g6m4b`: source-bound native/Wasm/physical-browser proof of the exact-bank zero cap and ordered branch, including both zero signs, operand order, unknown positive/negative/NaN inputs, masks/swizzles/aliasing, overwrites and joins. Use authenticated c580 original bank packets to establish the captured zero precondition and unchanged full-original rejection. Compare complete ordinary winner bytes, strict wrong/short bank rejection and compiler-generated metadata, and prove a source fault or altered physical pixel is detected. Record unfiltered changed-hunk coverage and final exact-head hot/pristine-clone evidence; carry unchanged predecessor proofs. A fresh critic must attack version staleness and NaN/zero ordering before verification.

## Adversarial verification

Predict the ordered comparison result before inspecting it. Attack `MIN` with either operand, both zero signs, NaN, negative values, a modifier that changes sign, an overwritten cap/result, branch join and destination-lane reuse. Falsify any inference that survives a missing exact word or crosses an ordinary compiler call. Hold every changed runtime hunk against recorded native and actual browser execution; unexecuted semantics need another run or deletion.

## Verification log

### 2026-10-05 — worker — activation

The c580 original command stream has three fragment-bank variants; all sampled draw packets bind `CONST[29].x` to zero, while its full fragment still rejects at the early bounded `POW`. This leaf is limited to proving the zero-capped branch dead under an enforced exact-bank assumption.
