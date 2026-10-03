---
id: E6-T12f3
epic: 6
title: Establish an explicit admission contract for radial shader definedness
priority: 525.0269913
status: pending
depends_on: [E6-T12f2]
estimate: S
risk: high
capstone: false
---

## Boundary

The a6143f11/e911b393 radial forms leave TEMP2.x unwritten on the small-coefficient
linear branch; later alternate-root selection can make it observable. Treat it
as a separate semantic boundary. Start with the concrete finite counterexample:
q=(4,0), CONST5.xy=(0,0), CONST7.xy=(1,0), CONST6.x=CONST8.x=0,
CONST4.x=2^-20, raw CONST3.x=0 gives B=4,C=16,t=2. Different missing TEMP2 values
can select a visible root or transparent output. Never silently select zero.

Implement an explicit bounded certificate and immutable finite-bank admission
that excludes the undefined predecessor: absBits(CONST4.x)>=0x3727c5ac. Audit
the exact captured predicate graph and consumed lane versions before using that
fact in live-predecessor joins. Give this policy its own closed metadata kind;
preserve any simultaneous loop-count/indirect/finite contracts and validate all
obligations on the same owned bank generation before draw side effects.

This is a restricted admitted domain, not arbitrary-finite-bank radial support.
The existing capture creates these gradient shaders without binding them; it
cannot prove actual radial workloads satisfy the guard. Any workload support
claim needs a new untouched capture or named original execution with recorded
banks. If this specific policy cannot be proved, record the exact blocker.

## Deterministic acceptance

`make verify-E6-T12f3` records the counterexample, independent predicate/domain
proof, threshold neighbors and signs, both captured structural forms, exact
owned bank generations and before-draw failures. Exercise replacement, sync/
async interference and restoration; record native/Wasm parity and hardware
results only for admitted paths. Preserve caps and final pristine-clone proof.

## Adversarial verification

Attack coefficient zero, signed zero, subnormal values, threshold +/-1,
NaN/Inf, altered predicates/lane versions, stale approvals and dropped combined
contracts. A removed domain check must admit the counterexample and fail the
independent definedness oracle before unsafe GPU execution. Never infer workload
compatibility from shader creation or a compile-only result.

## Verification log

(empty)
