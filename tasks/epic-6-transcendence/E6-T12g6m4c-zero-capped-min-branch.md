---
id: E6-T12g6m4c
epic: 6
title: Prove zero-capped MIN cannot enter an ordered positive branch
priority: 525.0270105895
status: pending
depends_on: [E6-T12g6m4b]
estimate: S
risk: high
capstone: false
---

## Boundary

Use the separately verified finite c580 prefix certificate and a directly authorized exact +0/-0 constant-bank operand to derive a versioned nonpositive result for pc28 `MIN`. Its unmodified pc29 ordered `FSLT` of zero against that result may materialize false; existing whole-text liveness then skips the dead arm. Preserve ordinary result bytes, versions, masks, aliases, joins and numerical/output authority. No arbitrary dynamic MIN/MAX inference, general geometry bound, full original pair claim, public import, guest offload or MIPS claim.

## Deterministic acceptance

`make verify-E6-T12g6m4c`: native/Wasm/physical source-bound proof of the exact-bank zero cap and ordered branch with both zero signs, operand order, finite positive/negative inputs, masks, swizzles, overwrites and joins. Check strict wrong/short bank rejection, a mutated prefix, changed/NaN-capable source, ordinary winner bytes, original c580 branch slots and unchanged 92cb original rejection. Record fault-sensitive pixels, coverage, exact-head hot/pristine clone and a fresh critic verdict.

## Adversarial verification

Try NaN/nonfinite source injection, zero-sign changes, sign-changing modifiers, stale results, branch joins and alternate shader text. A finite provenance failure must not reuse the earlier zero-cap fact; hold the complete transformed diff against recorded execution.

## Verification log

### 2026-10-05 — worker — decomposed from parent

The captured zero constant is useful only after the pc28 dynamic input is certified non-NaN. E6-T12g6m4b supplies that prerequisite without itself pruning a branch.
