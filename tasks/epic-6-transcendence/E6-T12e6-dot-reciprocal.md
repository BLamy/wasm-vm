---
id: E6-T12e6
epic: 6
title: Preserve captured dot-product and reciprocal float operations
priority: 525.0269906
status: pending
depends_on: [E6-T12e5]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit plain DP3, RCP and RSQ with their pinned TGSI source-lane use and result
replication semantics. Record explicit accepted numeric domains and the measured
ESSL300 guarantees, rather than assuming host floating-point arithmetic is an
exact oracle. PRECISE operations and PRECISE-bearing originals remain rejected.

## Deterministic acceptance

`make verify-E6-T12e6` requires native sanitizer/Wasm parity and hardware draws
with independent lane-distinguishing DP3 values and reciprocal/reciprocal-square-
root inputs. Include exact representable controls and a documented independent
bit/ULP oracle for the admitted nonexact cases. Preserve earlier tests and the
12/19 original outcome; record final exact-head and clean-clone evidence.

## Adversarial verification

Attack xyz versus xyzw reduction, per-destination replication and swizzling,
partial output lanes and numeric-domain edges. Sabotage the reduction lane or
reciprocal operation. Do not present approximate-operation tests as PRECISE proof.

## Verification log

(empty)
