---
id: E6-T12e4b
epic: 6
title: Preserve wrapping integer arithmetic masks and selection
priority: 525.02699042
status: in-progress
depends_on: [E6-T12e4a]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend the verified private raw-lane backend with UADD, ISGE, USEQ, USNE and UCMP.
UADD wraps modulo2^32; ISGE compares two's-complement signed32 values. Comparisons
produce exactly0xffffffff or0. UCMP selects each raw payload lane using condition
bits!=0, including noncanonical true words. No float numeric conversion or float
mix may carry arbitrary raw results. Preserve swizzles, definite initialization,
partial writes, same-register snapshots and safe float-IO policy. Do not admit
FSLT/FSGE, float arithmetic mixed with raw operations, control flow or PRECISE.

## Deterministic acceptance

`make verify-E6-T12e4b` records native sanitizer/Wasm parity, actual hardware VS/FS
execution for every new operation and independent full-u32 oracles using the
proven lossless output encodings. Include wrap/carry, signedness disagreement,
all-ones masks, per-lane distinct conditions and payloads, dynamic operands and
mixed-backend pairs. Preserve prior gates, capacities and unchanged19 originals.
Record exact-head and pristine-clone evidence. Production stays off.

## Adversarial verification

Attack0,1,2,0x7fffffff,0x80000000,0xffffffff; wrap in every lane; signed/unsigned
comparison divergence; noncanonical true conditions; NaN/Inf/subnormal payloads
as raw words; source aliasing and masked writes; missing consumed initialization.
Sabotage signed comparison, all-ones mask or UCMP arm selection and require an
independent actual hardware bit failure. Audit all changed executable paths.

## Verification log

(empty)
