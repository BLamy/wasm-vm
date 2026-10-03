---
id: E6-T12e9
epic: 6
title: Execute structured loops only with established execution and address bounds
priority: 525.0269909
status: in-progress
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

Loop counts, address bounds and finite numeric constant obligations must derive
from the same immutable current bank generations. Integer loop/count values
remain exact raw-u32 data, including encodings that are subnormal as floats.

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

## Execution notes

Start from independently verified E8 `62e90790d5c6f0a5da5fa528c482679c16c74290`.
Implement one structural certificate for the common captured counted-table
recurrence, with TEMP/IMM renaming and checked consumed lanes rather than shader
hashes. Require the actual initial j/a/b values 1/11/16, the signed count test
against raw CONST9.x, the sole OR-guarded BRK, the exact integer recurrence and
the matching post-loop USNE/true-tail address graph. Unsupported graphs, nested
loops, extra exits, CONT, clobbered roles and unsupported labels reject. Keep the
existing loop-free language and full serialized outcomes unchanged.

For signed n>=1 the header invariant is a=j+10, b=16*j and j=1..n; the signed
comparison forces the final break. For n<=0 it breaks at j=1. The mandatory
raw-word constraint signed_i32(CONST9.x)<=18 therefore proves at most 18
iterations without inserting a cutoff. The exact true edge j!=n narrows tail j
to 1..17. Complete site sets are header11..28, tail predecessor10..26, upper
color29..45 and lower color28..44, union10..45. Count19 can early-break at j18
and read CONST46, so it is rejected before drawing. Zero and signed-negative
counts are loop-safe; finite-bank validity is a separate requirement.

Use shared typed syntax helpers and the bounded existing instruction storage to
recognize the graph, then ordinary checked validation over universal header
facts. Syntax-only IR cannot be emitted. Do not narrow a complete certified set
using first-iteration facts. BRK has no fallthrough; joins include only live
predecessors. Restore the checked universal exit state at ENDLOOP. Keep one
state snapshot per structural level and combined depth8, without regressing
old loop-free depth8. Protected roles and source versions must still match at
each certified indirect use; all other reads use E8's ordinary proof.

Add one closed raw-bits-v12 profile with mandatory finite constantDomains,
existing constantAccesses and one constantConstraints record:
`{kind:"constant-bank-counted-table-i32-v1",stage,slot:0,name,count,register:9,component:0,maximum:18}`.
The declared extent is 46 or47, with all certified indices in0..45. This profile's
finite obligation derives explicitly from its checked loop policy; FSLT is a
raw comparison and does not by itself establish a numeric-bank retry or set the
existing actual-numeric-use feature bit. Ordinary output authority is unchanged.
Old profiles forbid the new record. Preserve old return shapes and inventory
only genuine unknown-v12 diagnostic changes in successor proof adapters.

The consumer checks the count word36 on the same owned complete finite prefix
used by E8. The exact signed predicate on a checked u32 is word>=0x80000000 or
word<=18, never float conversion. Validate before draw linking/allocation, keep
the existing immutable bank identity guard, and skip invalid new-profile uploads
on non-draw restoration. Metadata must bind the same stage/slot/name/extent.

Widen opcode masks and all opcode-dependent shifts explicitly to uint64_t for
BGNLOOP/BRK/ENDLOOP; preserve unrelated bit positions. Keep raw_lane12, source24,
instruction112, source16KiB, 179 instructions, IR<=32768, profile<=8192,
flow<=53248, GLSL<=65536, fixed Wasm16MiB/stack256KiB. Measure actual layout and
allocation growth; planning size estimates are not proof. Use independently
authored loop fixtures, mathematical exit enumeration and hardware word/pixel
oracles. Invalid/unbounded compiler faults never execute on the GPU; a GPU fault
must preserve the forced bound while changing observable early-break behavior.

Both original bodies remain untouched PRECISE rejections. The second capture's
TEMP2.x is not written on one predecessor at TGSI21–40 but is read at49/60;
resolving conservative definedness or observational irrelevance is a separate
later boundary, not an E9 or PRECISE claim. Production guest negotiation stays
disabled. Final exact-source recording, one pristine clone and a fresh critic
remain required before this task becomes verified.

## Verification log

(empty)
