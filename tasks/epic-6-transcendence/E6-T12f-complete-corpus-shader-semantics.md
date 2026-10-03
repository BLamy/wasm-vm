---
id: E6-T12f
epic: 6
title: Close faithful WebGL2 translation for every original captured shader
priority: 525.02700
status: pending
depends_on: [E6-T12e]
estimate: S
risk: high
capstone: false
---

## Boundary

Resolve the remaining captured shader precision boundary, including TGSI
_PRECISE, with a defensible WebGL2/ESSL300 implementation and explicit semantic
proof. ESSL300 does not accept the upstream precise qualifier on the measured
backend. Dropping it, tolerating changed arithmetic, substituting a recaptured
shader or restricting the test to already-supported hashes is not completion.
Preserve instruction ordering/contraction and required float behavior with a
validated lowering, or record the exact external/semantic blocker and keep the
dependent milestone gated. A speculative feasibility argument cannot pass.

## Deterministic acceptance

`make verify-E6-T12f` requires every one of the original 19 E6-T10b TGSI hashes
to translate unchanged into golden GLSL and compile/link in the measured WebGL2
browser. This preserves the original full-corpus shader criterion, replacing
obsolete WGSL/naga validation with actual ESSL300 execution validation. Exercise
every newly supported operation/precision path with independent bit/ULP/pixel
oracles appropriate to its specified semantics, including contraction-sensitive
inputs. Run native sanitizer/Wasm/browser parity, existing regressions, bounded
attacks and final pristine-clone proof. No production capability is inferred
from compilation alone; unsupported resource/state behavior remains rejected.

## Adversarial verification

Audit pinned TGSI and language precision requirements before judging results.
Attack cancellation, signed zero, subnormals, infinities/NaNs where admitted,
rounding boundaries, modifiers and optimization/contraction. Verify the tests
do not derive expected results from the lowering under test. Sabotage a rounding
or contraction barrier and require failure. If additional independent feature
families prove necessary, split and verify ordered S prerequisites before
activation rather than expanding this task into an unbounded translator rewrite.

## Verification log

(empty)
