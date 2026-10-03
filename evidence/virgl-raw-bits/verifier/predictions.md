# E6-T12e4a independent pre-evidence predictions

Recorded 2026-10-03 by `/root/raw_bits_verifier` before reading the in-progress
implementation, worker fixtures, worker output or recorded acceptance evidence.
These are falsifiable predictions, not results. Every result remains **PENDING**.
No implementation or test files were edited and no task status was changed.

## Scope and references read

- `AGENTS.md`, including the local deterministic/browser evidence waiver of rr.
- Active `tasks/epic-6-transcendence/E6-T12e4a-raw-bit-storage.md` at activation
  `141d128214757039fb3646d9901f27b04fc3496c`.
- `/tmp/virgl-typed-integer-design.md`, treated as a proposal subordinate to that task.
- Verified parent `f643c50d3379e4e27a1daf1784f67287fe36d562`: complete
  `renderer/virgl-shader/bridge.c`, `index.mjs`, and `build.sh` from `git show`.
- Exact Mesa 26.2.2 TGSI source `/tmp/virgl-mesa-26.2.2-tgsi.rst`, SHA256
  `6ec695d90ea0b3a5d471aab114352cc2431bcfc589f6b6e6ca88e4e1ca0caabe`,
  lines 1332–1374. SHL and USHR mask counts with `0x1f`; this is required even
  when a hardware driver happens to mask an otherwise undefined ESSL shift.

The active task selects the owned backend only when validated new bitwise
operations occur. The proposal's suggestion that a newly admitted literal alone
could select it is not the accepted boundary. All comparisons, UADD, UCMP,
float/integer mixing and arbitrary integer IO remain outside this task.

## Predictions and planned falsifiers

**P01 — backend selection and legacy identity (PENDING).** Every legacy-only
source has the exact prior complete result object, including profile, GLSL,
metadata and structured error. All 19 original captured texts retain their hashes,
12 successes and 7 PRECISE failures. A raw UINT32 word outside the prior float-bit
literal predicate does not alone select the new backend. A validated AND, OR,
NOT, SHL or USHR selects `virgl-webgl2-raw-bits-v1`; invalid spellings or text after
END cannot force alternate admission. Compare parent and submitted native outputs
for unchanged fixtures and independently authored neighboring programs.

**P02 — owned private storage (PENDING).** In admitted raw stages, private TEMP
and immediate words remain highp unsigned 32-bit data through MOV and every new
integer use. No raw NaN, Inf, subnormal, sign bit or all-ones value is routed through
float storage merely to preserve it. Inspect actual emitted statements and execute
literal and dynamic values `0`, `1`, `0x7fffffff`, `0x80000000`, `0xffffffff`,
`0xaaaaaaaa`, `0x55555555`, `0x7f800001`, `0x7fc12345`, `0xff800000`,
`0x00000001`, `0x007fffff`, `0x80000000` using lossless observable carriers.
An observed convenient float round trip does not prove this storage contract.

**P03 — integer operations and count masking (PENDING).** Each consumed lane
matches unsigned AND, OR, one's-complement NOT, low-32-bit SHL and zero-filling
USHR. Both shaders execute every operation on nonconstant GPU input. Counts
`0,1,31,32,33,63,0x80000000,0xffffffff` are masked independently per lane.
For raw input `[0x80000001,0xffffffff,0x7f800001,1]` and counts
`[32,33,0x80000000,0xffffffff]`, SHL gives
`[0x80000001,0xfffffffe,0x7f800001,0x80000000]` and USHR gives
`[0x80000001,0x7fffffff,0x7f800001,0]`.
Verify the count mask exists in emitted semantics as well as checking hardware.

**P04 — consuming lanes and initialization (PENDING).** The destination consumed
lanes select the source swizzle lanes before initialization is checked. A partial
write that consumes only initialized selectors succeeds even if unused selectors
name uninitialized components. Any consumed uninitialized TEMP component fails,
including first-write self-read. A trailing syntax failure publishes no usable
write. No emitter expression reads uninitialized unused components just to discard
them. Independently vary single/xy/xyz/full destinations and repeated/nonidentity
source swizzles; inspect accepted RHS expressions and recovery results.

**P05 — aliasing and retained neighbors (PENDING).** All source lanes of one
instruction are evaluated against the pre-instruction state; partial writes leave
untouched lanes bit-identical. With TEMP initially
`[0x80000001,0xffffffff,0x7f800001,1]`, executing
`SHL TEMP.xy, TEMP.yxwz, counts.xyzw` with counts `[32,33,...]` produces
`[0xffffffff,2,0x7f800001,1]`, not a sequentially overwritten result. Exercise
TEMP 9, 17 and 117 and CONST 45, including a raw NaN neighbor that survives until
its own safe encoding. The prediction also applies to MOV, AND, OR, NOT and USHR
where overlapping selectors are meaningful.

**P06 — UINT32 lexical guard (PENDING).** Decimal raw literals cover 0 through
4294967295 exactly in owned programs. 4294967296, more than ten digits, signs,
hexadecimal, exponent/fraction/suffix spellings and missing delimiters reject
before upstream or IR publication. Existing allowed decimal spelling behavior
(including bounded leading zeroes if accepted by the parent) remains stable.
FLT32 has its prior separate policy. Test each malformed component position,
8 versus 9 immediates, duplicate/out-of-order declarations and success immediately
after each failure in single and pair conversion.

**P07 — no unsupported semantic expansion (PENDING).** Raw programs with
ADD/MUL/MAD/TEX reject explicitly; UADD, comparisons, UCMP, PRECISE, saturation,
negation/absolute modifiers, control flow, ADDR and indirect access remain rejected.
A legacy program cannot gain unsupported behavior through one harmless bitwise
instruction. Vendored source digests remain unchanged. Check exact parent error
identity where the whole program remains legacy-only.

**P08 — output knowledge is conservative (PENDING).** Unknown CONST data or an
arbitrary raw TEMP cannot reach POSITION, COLOR or a GENERIC float output solely
because it was MOVed or renamed. Raw Inf, NaN and nonzero subnormal words reject
when used as float outputs. Finite normal words and either signed zero can be
proven safe; a byte carrier `0x3f000000 | ((word_byte & 255) << 15)` is admitted.
Known-bit proofs must hold for every runtime value represented by the analysis,
not merely the supplied fixture value. Attack per-lane state replacement, stale
known bits after partial writes, AND/OR with unknown operands, NOT and dynamic
shifts. For every admission used in hardware, independently prove exponent safety.
A conservative rejection beyond the documented minimum is not a semantic failure
unless it rejects a required carrier or float-origin path.

**P09 — float-origin identity (PENDING).** Existing float input lanes may pass
through MOV under the ordinary ABI without becoming an arbitrary-bit transport
promise. Swizzles and masked MOV preserve the correct origin per lane; a raw write
to one lane cannot borrow another lane's origin. Integer-transformed values do not
become float-origin merely by a subsequent MOV. Identity propagation, if supported,
must be justified for all bits and not by numeric test coincidences. Test mixed
float-origin/raw TEMP lanes and output swizzles that select safe and unsafe lanes.

**P10 — observable IO is still float (PENDING).** Attributes, GENERIC varyings,
POSITION and COLOR retain the established declaration types and renderer names.
The raw backend does not smuggle an integer varying/test-only production export.
Input-bit observations refer to the float values actually delivered by that ABI.
Constant command transport remains finite-pattern validated; direct test injection
of all-bit host uniforms is explicitly labeled compiler evidence. Inspect source
diff boundaries and keep guest wire regressions unchanged.

**P11 — all bits are observed (PENDING).** Vertex byte carriers represent four
independent bytes as exact finite-normal floats and actual transform feedback
reconstructs each complete 32-bit result. Fragment bit planes yield actual RGBA8
bytes 0/255 for each of 32 selected bits and reconstruct every lane. Expected words
come from independently authored unsigned/BigInt logic or literal witnesses, never
the compiler or its generated GLSL. Check carrier bytes and bit-plane bytes before
reconstruction, including signs, NaN payloads and low bits; avoid accepting an
aggregate framebuffer hash or a single normalized channel as sole bit proof.

**P12 — dynamic execution and novel attack (PENDING).** The same linked program
receives at least two distinct uniform payloads and mixed per-lane counts; output
changes according to the oracle without recompilation. I plan an independent
hardware attack combining P05's overlapping SHL with dynamic count changes
`[32,33,0x80000000,0xffffffff]` to `[0xffffffff,32,33,0x80000000]`, retention of
unwritten high-bank raw sentinels, and separate byte/bit-plane observation. It must
exercise actual WebGL2 compilation/linking/drawing rather than a JS simulation.
No worker oracle or fixture generator will supply this attack's expected words.

**P13 — bounded IR and capacity edges (PENDING).** The IR is constructed from
validated operand records, not arbitrary GLSL fragments. All existing text/token/
line/register/instruction limits remain enforced: 16384 bytes, 8192 tokens,
256 nonempty lines, 512-byte lines, 179 non-END instructions, TEMP 117, CONST 45,
other banks 7 and 8 immediates. Every boundary and neighboring rejection is tested;
maximal accepted raw programs actually execute with output dependent on the tail.
GLSL and both JSON bounds remain unchanged. No profile silently truncates a valid
instruction or widens a limit to make a fixture pass.

**P14 — stack, allocation and cleanup (PENDING).** Native sizeof/compiler stack
accounting includes the new IR and both stage conversions. Pair helper lifetimes
fit the unchanged 256 KiB Wasm stack; repeated maximal pairs fit fixed 16 MiB
memory without growth or state leakage. Every new bounded allocation failure
returns a structured failure, frees earlier owned state, and is followed by exact
known-good single/pair recovery. Faults at the first and later stage allocations
are distinct cases. Native sanitizer runs use independently chosen mutation seeds
and no disabled assertions/ignored failing paths. Inspect ownership of all buffers
and record memory/stack/compiler parameters, not just absence of a crash.

**P15 — mixed backend pair semantics (PENDING).** Each stage selects its own
backend; raw/raw, raw/legacy, legacy/raw and legacy/legacy pairs use the same
canonical GENERIC semantic/component/interpolation key. Reordered register indices
cannot change semantic matching; incomplete masks fail. Returned FS result equals
its exact standalone result. Only the fragment-derived qualifiers may change VS
stage output. Smooth/flat/smooth alternation cannot retain stale flat variants or
keys, and caller overrides remain rejected. Record native/Wasm complete result
parity and actual hardware linkage for each mixed direction and interpolation.

**P16 — declaration/reflection compatibility (PENDING).** Raw programs retain
constant names, declared-count policy (including the order-sensitive 47 extent),
float32-bits metadata, and the vertex VirglBlock byte length 656 with
winsys_adjust_y at 640. Actual WebGL2 reflection agrees for declarations used by
the command renderer. Owned templates cannot accidentally drop system orientation,
move block members or mismatch partial GENERIC widths. Test or carry forward
unchanged renderer paths with exact boundary justification; no private raw integer
claim expands guest constant upload semantics.

**P17 — ownership and repeatability (PENDING).** Returned result strings and
metadata remain independently owned across later success/failure, pair and single
calls. No stage or mask/known-bit state leaks between requests; malformed raw input
followed by legacy success returns the exact legacy object and vice versa. Explicit
JS input/override rejection and Wasm malloc recovery remain intact. Inspect
new publication/reset paths and independently alternate results while retaining
old objects for deep comparison.

**P18 — sabotage sensitivity (PENDING).** At least one served-source sabotage
that loses raw high bits, routes private data through unsafe float storage, or
breaks shift masking must still compile/link and then fail an independent actual
GPU output oracle at a concrete TF word or pixel. A textual-source assertion or
compile failure alone is insufficient. Removing a shift mask may accidentally
retain output on this driver, so if that mutant survives it proves inadequate
mutation sensitivity, not TGSI correctness; use an output-changing legal mutant.
Record the original/mutated source digests and expected/observed values.

**P19 — exact-head and cold binding (PENDING).** Worker, browser, native parity,
Wasm artifact and cold-clone receipts bind the same frozen runtime/harness source
commit and their actual served bytes. No stale pre-rebuild shader module can pass
on old frontend behavior. Recompute referenced digests and compare complete
recorded translations. The pristine clone starts clean with scrubbed relevant
build environment and passes the exact task command once. Subsequent evidence-only
commits do not invalidate unchanged held runtime results but must be identified.

**P20 — coverage, regression and scope (PENDING).** Every changed executable
hunk is executed by recorded native/Wasm/hardware cases or explicitly classified
as needs-evidence, dead, or narrowly waived. Source changes outside this compiler
boundary require their own evidence; unchanged prior results carry forward.
Production GPU negotiation remains disabled, deployment/default VM behavior is
unchanged, and this task does not claim full Mesa corpus execution or FPS/MIPS
improvement. The final verdict will cite concrete report locations/digests and
will be set only after the frozen submission survives independent falsification.

## Planned result record

After the worker freezes the submission, each prediction will become HELD,
FAILED or NEEDS EVIDENCE with exact file/record/line and digest citations. Findings
will be rechecked once. Runtime changes require reassessing the affected
prediction set; proof-only repairs preserve already held unchanged boundaries.
