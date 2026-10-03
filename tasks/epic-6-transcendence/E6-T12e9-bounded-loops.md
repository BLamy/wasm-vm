---
id: E6-T12e9
epic: 6
title: Execute structured loops only with established execution and address bounds
priority: 525.0269909
status: pending
depends_on: [E6-T12e8]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only the inventoried BGNLOOP, BRK and ENDLOOP structured family, with checked
labels, nesting and lane facts. Establish a finite execution bound and all
indirect-address bounds for each admitted form. The two captured loop bodies
(`616a643d02f33f502b08d9bd6368de93ba1bd9c7e6bacdee0e0aa946a2c3e4ad`
and `e911b393909ab041c24f608b41497143eba765cc8d7db1206a47896934d43c51`)
depend on runtime CONST[9], integer updates and indirect table reads. Their form
requires a real static proof or draw-time validated immutable uniform constraints.
An unproven form stays rejected before GPU dispatch.

Never insert a fixed iteration cutoff that changes a permitted execution. A
literal bounded-loop demonstration is only a separate profile proof; it does
not establish support for these original bodies. PRECISE remains rejected, so
neither captured loop body is counted as accepted by this prerequisite.

## Deterministic acceptance

`make verify-E6-T12e9` records the admitted loop-form contract, an independently
checked bound derivation, and hardware outcomes for independently authored loops
covering early/final break and maximum admitted iteration/address values. If
runtime uniform constraints are required, prove admission and dispatch consume
the same immutable bytes. Reject malformed, nonterminating and out-of-profile
forms without running them on the GPU. Preserve original 12/19 outcomes and
record native/Wasm parity, exact-head and pristine-clone evidence.

## Adversarial verification

Attack BRK outside a loop, mismatched labels, nesting, counter wrap/shift, zero
and boundary runtime counts, stale uniform validation, indirect access before
the break condition, and loop-carried uninitialized lanes. Sabotage the proved
bound/admission check and require a deterministic failure. If the captured form
cannot be safely proved, record its exact blocker; do not broaden the claim.

## Verification log

(empty)
