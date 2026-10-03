---
id: E6-T12e9
epic: 6
title: Execute structured loops only with established execution and address bounds
priority: 525.0269909
status: implemented
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

### 2026-10-03 — worker — implemented

Frozen source and harness: `bfcd3a4076a163648c67bf7674e94d616c42c1e1`, based on
verified E8 `62e90790d5c6f0a5da5fa528c482679c16c74290`.

Commands:

```sh
VIRGL_BOUNDED_LOOPS_EVIDENCE_DIR=evidence/virgl-bounded-loops/worker EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc make verify-E6-T12e9
python3 tools/virgl-bounded-loops/cold.py --output evidence/virgl-bounded-loops/cold-clone
```

Both complete gates passed. The local gate records guard checks, ASan/UBSan,
LLVM execution/stack counters, actual native and fixed-memory Wasm ABI calls,
consumer/metadata tests, decoded shared-renderer GPU paths, actual isolated
compiler faults, and retained shader/renderer leaf oracles. The final cold gate
ran once from the clean exact-source checkout `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-indirect-constants-cold-xi83qtie/wasm-vm` with scrubbed
build/runtime environment; checkout status was empty before and after. The
178 copied acceptance files include the complete recording and its receipt.

- Native: 743,022 calls; 4,012 stages and 264 pairs, including 198/12 new cases.
  All 3,814/252 retained full results and all original 12/19 outcomes are exact.
  6,115 truncations over six named bodies, 324 hostile envelopes, four independent
  seeds × 1,024 mutations, and 16 actual allocation failures each recover through
  the 26/24 single/pair anchor set. Recorded recoveries total 378,638/349,512.
- Measured IR/profile/flow sizes: 26,352 / 7,616 / 52,644 bytes. Lane/source/
  instruction sizes remain 12/24/112. IR grew 96 bytes and flow 32 bytes; existing
  caps hold. Maximum recorded single/pair serialization is 63,369/109,235 bytes.
- Wasm: 15,151 actual calls; complete native result equality, 5,590/5,160 recovery
  calls, 64 maximum-text/179-instruction runs and 33 real allocation-pressure
  attempts. The 16 MiB buffer identity stays fixed and all capacity is recovered.
- Consumer: 234 closed metadata cases, 157 bank cases, three ownership cases,
  and zero accessor calls. Existing profile fixtures retain their results;
  exactly two old unknown-v12 diagnostics now name the required count contract.
- GPU: 39 successful draws, 768 exact loop words and 159,744 checked pixels;
  96 completion fences, 144 withheld polls and 26 rejected draws. Decoder bypass
  adds 14 rejected draws followed by five successful recovery draws/20,480 pixels.
  Healthy browser console, page and request error arrays are all empty.
- Actual compiler faults: removing the recurrence check wrongly admits both
  increment-two inputs in native/Wasm translation only. Flipping the certified
  early comparison preserves the forced signed bound but produces 26 wrong
  hardware words; the independent atlas oracle fails. All retained fault seams
  and independent GPU leaf checks passed without claiming old complete gates.

Evidence: `evidence/virgl-bounded-loops/worker/` and
`evidence/virgl-bounded-loops/cold-clone/`. Warm receipt SHA-256
`0cda5d537e15773794904bf7d53c30ff4da55c1c6846e846875fee5915a22715`;
cold report `69a613e5cfa4d46b06f6a486ee60f757c9912068230abe5fd17fe003d34438a9`;
cold receipt `03fcb73473ee76e2472fde314a4591b0eceb179f57a6e115b877fc9b2d1f85d7`.
Warm native report `10cd0b59e6c2a8331cbb75dae216207be0a84fcccb49fe3f3cda1dfbb5099593`;
Wasm report `a48deff3775974d93775a7c87fd09e807a08eb6595bf247b02ead48d65e2797b`;
normal screenshot `6906d646fcbec6cae07d3493f652985cc948f3d69405a17e9af808bdf74d3639`.
Coverage reports are retained verbatim, including LLVM's terminal blank line.

The recording demonstrates the certified recurrence and complete access sets,
with signed count <=18 checked against the exact owned finite bank generation
used for upload. It covers zero/negative counts, first/interior/final exits,
maximum tail addresses, rejected count19, replacement, async interference and
cleanup. It establishes no PRECISE, radial-definedness, original19/19, live guest
GPU or performance claim. The isolated compiler/renderer remains unreachable
from the production demo, so no web/dist or deployment change is part of this
boundary. Fresh verifier findings and the final verdict follow separately.
