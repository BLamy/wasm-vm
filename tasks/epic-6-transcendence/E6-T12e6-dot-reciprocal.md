---
id: E6-T12e6
epic: 6
title: Preserve captured dot-product and reciprocal float operations
priority: 525.0269906
status: in-progress
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

## Preparation notes

The scalar contract follows Mesa 26.2.2 TGSI documentation, opcode metadata,
source-use analysis and interpreter: DP3 consumes the first three post-swizzle
source lanes and broadcasts their dot product; RCP and RSQ consume the first
post-swizzle source lane and broadcast one result. The older pinned VirGL RCP
emission and source-use helper disagree with that scalar rule. Document this
limitation explicitly instead of copying the componentwise shortcut. Both
captured RCP instructions already write x from an xxxx source. The full captured
inventory is four DP3, two RCP and four RSQ across four unchanged PRECISE-bearing
originals; keep all nineteen full outcomes unchanged.

Retain the ordinary source authority and arithmetic contract from E5. Quantitative
oracle domains are not new shader-admission guards. No abs, clamp, divisor
replacement, finite/positive-value admission restriction or PRECISE shortcut is
introduced. Unknown raw numeric CONST remains a separate integration boundary.
Evaluate one scalar operation, broadcast it, capture the result once, and publish
only validated destination lanes. Share the consumed-lane rule between parser
initialization checks and numeric-authority checks. A reciprocal writing w reads
source x; a DP3 writing x still reads source xyz. Negation applies after swizzling
to only those consumed lanes, and all aliases observe pre-write operands.

Reserve opcode-mask bit 21, currently the validated E5 numeric-negation marker;
new scalar opcodes must not collide with it. Keep 112-byte instructions, the
26,232-byte IR, 179-instruction/text/output limits and fixed 16 MiB Wasm memory.
Earlier profiles and complete results remain exact except two explicit historical
DP3 admissions. Preserve those exact bodies as new positives and replace their
old negative slots with source-bound adjacent rejections. The four malformed
RCP/RSQ historical two-source bodies must retain their exact errors.

Use exact rational DP3 controls with distinguishable xyz and a poison w, plus
an independently justified enclosure for any nonexact reduction witness. RCP
uses the specified positive-denominator 2.5-ULP division enclosure. RSQ uses
integer-square-root rational bounds widened by the specified 2-ULP allowance;
JavaScript Math.sqrt or host float division is not the expected-value oracle.
An exact mathematical reciprocal or square root alone does not require exact
result bits. Record exceptional observations without unsupported payload,
computed-zero-sign, subnormal-retention or cross-stage-equality claims.

The two historical DP3 changes cannot pass E5's unmodified six-migration native
receipt. Use an explicitly named successor-owned compatibility adapter, pinning
the verified E5 baseline and reconstructing exactly those two substitutions.
Run the unchanged E5 native C harness with the complete predecessor stream and
its unchanged 12/10 recovery anchors and mutation schedule. Reuse every E5 GPU
oracle and sabotage check unchanged, and run the full C2 gate unchanged. New v6
programs belong only to the new workload. Do not weaken old checks, monkeypatch
source reads, fabricate an E5 full-gate receipt, or substitute old results for
current execution. Independently attack the adapter's names, transforms, full
results, stream bytes, anchors, seeds and digests.

## Verification log

(empty)
