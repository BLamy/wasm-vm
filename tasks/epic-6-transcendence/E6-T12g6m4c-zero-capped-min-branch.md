---
id: E6-T12g6m4c
epic: 6
title: Prove zero-capped MIN cannot enter an ordered positive branch
priority: 525.0270105895
status: implemented
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

### 2026-10-05 — worker — exact-head submission

Source head `9484685b2346c9152da5de25cb55ce568f6b3ec9`. `make verify-E6-T12g6m4c` passed there; `python3 tools/virgl-zero-cap/cold.py target/evidence/virgl-zero-cap-cold` passed from a scrubbed pristine clone of the same head. Sealed evidence: `evidence/virgl-zero-cap/worker/recording.tar.gz` SHA-256 `0ef8c10d2c4f894328adec33d2959d2c0725cc1ab5c02260e02e204c1a33337c`, `records.json` SHA-256 `d5acbea85f0fb773e0623593bbd4f730a99504cc6f9cdbbee920c37f2f7c7966`, 69 recorded members; hot and cold receipts are inside. `make ci` was attempted at the same source head and stopped at existing macOS-incompatible Linux-only `wvseccomp` symbols and an existing `items_after_test_module` clippy finding in `crates/core/src/dev/virtio/gpu/mod.rs` (`hot/make-ci.log`).

The native sanitizer and Wasm audit programs print byte-identical outcomes for three authenticated 136-word banks with both +0 and post-modifier -0 caps. The checked IR carries the prior finite pc27 certificate through structured float shadows, marks only the exact pc28 MIN result nonpositive, and materializes false for the adjacent original pc29 ordered test. Recorded negatives cover an altered prefix, missing coordinate authority, NaN-capable source, source/cap/modifier/mask/swizzle changes, overwritten and joined versions, wrong and short banks. The physical ANGLE/Metal browser run checked 192 pixels across three banks, both cap signs and two viewport origins, including finite positive and negative dynamic inputs; its coordinate and branch-output fault runs each contradicted the independent pixel oracle. Ordinary MIN still computes and stores its runtime winner. The unchanged 92cb original pair still rejects. This proves only the private c580 branch boundary, without a full original-pair, live guest graphics, or MIPS claim.
