# E5.5-T03x independent verifier predictions

Written 2026-09-15 before inspecting any T03x execution evidence. Starting head:
`c0e29a92` (activation), independently verified parent `51dd9864`.
Only activation metadata exists in the scoped implementation diff at orientation;
the implementation diff will be audited after the worker freezes it.

## P1 — literal integer conversion results

For each actual native/private-WASM/shared-WASM generated conversion, preserve every
integer register and every FPR except the destination, box the binary32 result with
upper word `ffffffff`, set FS=Dirty and SD, preserve frm, and OR NX into prior fflags
only when integer information is lost. No integer magnitude overflows binary32.
The result order below is RNE, RTZ, RDN, RUP, RMM; all non-exact rows add NX=1.

| Input interpretation | Predicted binary32 words |
| --- | --- |
| W/WU/L/LU zero | 00000000 in every mode, flags=0 |
| W/L -1 | bf800000 in every mode, flags=0 |
| W/L -2^31 | cf000000 in every mode, flags=0 |
| L -2^63 | df000000 in every mode, flags=0 |
| W/L 2^24+1 | 4b800000,4b800000,4b800000,4b800001,4b800001 |
| W/L -(2^24+1) | cb800000,cb800000,cb800001,cb800000,cb800001 |
| W/L 2^24+3 | 4b800002,4b800001,4b800001,4b800002,4b800002 |
| W/L -(2^24+3) | cb800002,cb800001,cb800002,cb800001,cb800002 |
| W 2^31-1 | 4f000000,4effffff,4effffff,4f000000,4f000000 |
| WU 2^32-1 | 4f800000,4f7fffff,4f7fffff,4f800000,4f800000 |
| L 2^63-1 | 5f000000,5effffff,5effffff,5f000000,5f000000 |
| LU 2^63 | 5f000000 in every mode, flags=0 |
| LU 2^63+1 | 5f000000,5f000000,5f000000,5f000001,5f000000 |
| LU 2^63+2^39 | 5f000000,5f000000,5f000000,5f000001,5f000001 |
| LU 2^64-1 | 5f800000,5f7fffff,5f7fffff,5f800000,5f800000 |

W/WU consume only low 32 bits even with unrelated high words; L/LU consume all 64.
An rs1=x0 conversion writes +0 to writable f0/f31 despite a write attempt to x0.
Static rm=0..4 ignores even a reserved frm; rm=7 resolves current frm each entry.

## P2 — deterministic bounded attack

Use independent xorshift seed `0x6d42a8c9f03175be`. Construct integer magnitudes
from a chosen 24-bit significand, a binary exponent, and remainder drawn from
zero/below-half/exact-half/above-half/all-low-bits. The predicted binary32 word
comes from that construction and IEEE directed/tie rounding, never the interpreter,
Rust float casts, or the repository's softfloat routine. Vary signs, upper words,
rs1/rd indices including 0/31 and equal-numbered X/F registers, all encoded rounding
modes, FS, frm and previous fflags. An addi prefix changes x12 before rs1=x12 use;
conversion must observe that current integer value. All valid paths preserve other
registers; all illegal paths stop after the prefix and preserve FPR/control state.

## P3 — guards and pure helper boundary

For all four conversion selectors and rm=0..7, FS=0 or resolved rm>=5 returns
IllegalInstruction with the original 32-bit parcel, entry virtual PC+4 and exactly
one retired prefix where the executor exposes retirement. It makes zero conversion
helper calls. Legal paths make exactly one pure helper call containing the exact
64-bit X source, format selector and resolved rm. The helper has no hart/bus/memory/
device/scheduler object; memory/atomic imports are fatal if unexpectedly called.
Only allowed architectural output bytes in the frozen ABI may change. The emitted
code uses integer WASM only.

## P4 — optional imports and successor indices

Integer-only modules retain five function imports. Conversion-only modules import
`fp_from_int_s` at index 5 (actual final helper spelling to be audited); modules
that also contain arithmetic place `fp_arith_s` at 5 and conversion at 6. Every
local function export/call follows that optional import count. Actually executing
an integer -> conversion -> arithmetic -> conversion chain must consume the new
X/F values and deliver predicted bits/flags; encoding inspection alone is insufficient.
Fused operations, divide/subtract, double precision and float-to-integer remain
unsupported. Native/private/shared executions exercise independent generated modules.

## P5 — handoff, fuel, faults and memory growth

A direct successor conversion reads its predecessor's updated integer register.
Same-module and cross-module calls obey whole-block budgets, retire only a legal
prefix on a later memory/illegal fault, preserve already-written FPR/fflags and
never execute the suffix. A real host WASM memory.grow from a guest MMIO write
between conversions occurs exactly once; both private/shared views refresh and
subsequent conversion and memory access retain the exact values. Faulting stores
and later loads preserve the exact fault PC/tval and retired prefix.
Interpreted CSR writes clear prior NX and update frm; re-entry must use the new
frm and accrue only newly generated flags. Re-read fflags through the interpreter.

## P6 — evidence provenance and product scope

The final acceptance must be from the frozen source head, with current file/artifact/
guest SHA-256 digests, scoped native/wasm acceptance, the prescribed local gauntlet
with explicit platform limitations, 127/127 live ISA cases, zero browser errors,
compiled conversion guest, matching public bundle bytes and a final scrubbed-env
pristine-clone acceptance. A single independent wrong literal in an isolated test
copy must make the new verifier suite fail at that assertion.

The actual physical-input trial has its unchanged 120-second deadline. A desktop
responsiveness claim requires both independent nonce readback and the visible typed
terminal image; successful conversion compilation alone cannot satisfy T03q. A
failed trial must leave T03q gated.

## Incremental carry-forward

Carry T03t/u/v/w HELD predictions only where implementation/dependency boundaries
and evidence digests are unchanged. New conversion imports and generated call
indices require new coverage; existing arithmetic/move/memory/comparison semantic
proofs are not re-litigated without a relevant boundary change.

## State

P1-P6: awaiting implementation freeze and recorded evidence. No verdict yet.

### Harness correction before final submission

The first raw-ABI probe reused the old rd=f31-only upper-word mask assertion.
With new rd=f0 coverage, the frozen FP_STATE upper word is a destination write
mask (bit 32+rd), not mstatus.SD. The actual Hart literal test already checks SD.
Corrected this independent harness assumption to assert the per-destination mask;
the initial failure is retained in native-initial.log and is not a product finding.
