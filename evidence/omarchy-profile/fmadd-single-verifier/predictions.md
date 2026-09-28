# E5.5-T03an — independent predictions, before worker evidence

Fresh critic: `/root/fmadd_single_verifier`. Written on 2026-09-16 while the
task is still pending and before any AN worker result or implementation diff
was received. The implementation boundary is only FMADD.S through a pure
packed-result helper. Root owns build, deployment, final cold clone, and one
real desktop trial. This critic will not rerun those expensive proofs.

## Primary semantics checked

- [RISC-V F specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/f-st-ext.html):
  a fused operation rounds the combined product and sum once; `0 * infinity`
  raises NV even with a quiet NaN addend; RISC-V returns canonical NaNs.
- [RISC-V D NaN boxing](https://docs.riscv.org/reference/isa/v20260120/unpriv/d-st-ext.html):
  each malformed narrow operand is interpreted as canonical quiet NaN.
- [SoftFloat reference FMA](https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/s_mulAddF32.c):
  opposite exact zeros/cancellation choose negative zero only under RDN;
  same-sign zeros preserve their sign; invalid products precede NaN addend
  handling. The independent oracle will use exact integers, not this code.
- [SoftFloat reference rounding](https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/s_roundPackToF32.c):
  tininess after rounding is assessed with unbounded exponent precision-24
  rounding, separately from final subnormal encoding. A rounded normal output
  can therefore still carry UF. Overflow is determined by the unbounded
  rounded magnitude, including directed finite saturation.

## Falsifiable predictions

1. **P1 — single rounding and exact cancellation.** For all five modes,
   `FMADD.S(3f800001, 3f7ffffe, bf800000)` returns `a8800000`, flags `00`.
   `(max_finite * 2) - max_finite` returns `7f7fffff`, flags `00`.
   A separate multiply/add implementation must fail these witnesses.

2. **P2 — exceptional values and independently checked boxes.** Correctly
   boxed `0 * infinity + qNaN` returns boxed `7fc00000`, new flags `10` in
   all modes. Each signaling source independently raises NV; a malformed
   source containing sNaN low bits becomes quiet NaN and does not alone raise
   NV. A malformed addend does not suppress NV from a valid zero/infinity
   product. Opposite infinite sum raises NV. Other quiet NaNs do not raise NV.

3. **P3 — normal, subnormal, overflow, and zero boundaries.** Exact rational
   literals independently determine all modes before execution. Half of the
   minimum subnormal yields `[0,0,0,1,1]`, flags `03`. The positive halfway
   value `2^-126 - 2^-150` yields `[00800000,007fffff,007fffff,00800000,00800000]`
   with flags `03` in all modes, including normal outputs. Exact subnormals
   do not raise UF/NX. Values immediately on either side of unbounded-rounding
   tininess and overflow thresholds distinguish the flags; signs reverse
   directed rounding. Finite overflow never raises DZ. Exact cancellation
   selects negative zero only in RDN, while same-sign zero terms retain sign.

4. **P4 — every operand is read before publication.** Destination aliases
   each of rs1/rs2/rs3, all source equality partitions, f0, and f31 preserve
   pre-instruction inputs. Only the destination FPR and its exact dirty bit
   change. New flags OR into every selected prior flag pattern; frm is
   unchanged; legal execution dirties FS even for an exact result.

5. **P5 — precise rejection and purity.** In an actual emitted module,
   FS-Off, static rm 5/6, and dynamic frm 5/6/7 make zero helper calls. The
   original parcel and virtual fault PC are retained, completed integer prefix
   remains, suffix is absent, destination/fflags/FS remain unchanged. A legal
   call receives the three canonicalized u32 inputs and resolved mode exactly
   once. The helper has no execution context, memory/device/CSR callback,
   host FP opcode, or extra write beyond packed result publication.

6. **P6 — actual optional indices and admission.** Standalone FMADD.S imports
   helper at function index 5 and exports run at index 6. Every subset of the
   four preceding optional helpers keeps the allocated FMADD import index,
   and mixed block/batch modules call the actual corresponding helper. The
   full five-helper batch has FMADD at index 9 and defined functions starting
   at 10. Other fused S operations and every D fused operation remain rejected;
   existing integer/FP admission and helper layouts are unchanged without FMA.

7. **P7 — executor publication across boundaries.** Native, private browser,
   and shared browser emitted modules agree with independent literals and the
   interpreter. CSR writes between blocks alter dynamic rounding/FS as
   specified. Same/cross-module direct successors respect budgets, carry FPRs,
   exact dirty masks and flags, and preserve completed FMA prefixes across
   later memory faults. Actual browser memory growth between FMA operations
   cannot leave stale publication views or replay a helper.

8. **P8 — independent seeds and fault injection.** A fixed, bounded set of
   independent seeds varies integer-derived operands, boxes, alias partitions,
   modes, initial flags and FS state. Expected literal bits/flags never come
   from the interpreter/backend under test. One isolated mutation of a new
   assertion or a generated publication boundary must be detected. Record
   the original failure and restore/check the source digest.

9. **P9 — frozen evidence and changed-code sufficiency.** Each changed hunk
   is linked to executed evidence or a narrow documented waiver. Source and
   WASM hashes bind worker, browser, public bytes and final cold build. No
   ignored tests or modified unrelated admission rule may create a false pass.
   Unchanged HELD proofs carry forward only with equal dependency/source/seal
   digests. Pre-existing platform failures remain disclosed.

10. **P10 — physical responsiveness is separate.** The real candidate differs
    from verified AM only in the new runtime, using AJ R2, cap256, recycling ON,
    original geometry and unchanged deadlines. Success requires actual trusted
    keyboard input, independent nonce readback by Enter+120 seconds, and an
    inspected fresh image showing typed command and returned prompt. A failing
    physical trial is retained as negative evidence and leaves release Q gated;
    correctness of FMADD.S alone is not responsiveness.

## Planned independent implementation

Reserved verifier files, coordinated with root:

- `tests/support/jit_fp_fmadd_verifier.rs`
- `crates/jit-runtime/tests/fp_fmadd_verifier.rs`
- `crates/wasm/tests/jit_fp_fmadd_verifier.rs`

Derive boundary literals using Python arbitrary-precision integer/rational
arithmetic in this evidence directory. Use generated modules with an
instrumented linker for purity, exact calls, all helper subsets and full
memory-byte comparisons. Reuse established executor harness shapes without
importing worker arithmetic expectations. Do not start heavy execution until
root coordinates with the current trial. Predictions remain immutable; append
observations and verdicts separately.
