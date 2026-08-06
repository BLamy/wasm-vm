# JIT F/D floating-point policy — the measured decision (E4-T15)

**Status:** accepted · **Date:** 2026-08-05 · **Epic:** 4 (acceleration) · **Depends on:** E4-T06 §9.4,
E4-T12 · **Ships:** side-exit-all (option a)

`docs/jit-architecture.md` §9.4 flags FP as "the one place 'fast' and 'provably identical' conflict"
and defers it to *this* measured decision. The three options were (a) side-exit every F/D op to the
interpreter, (b) fully translate to wasm f32/f64 with NaN-boxing + software fflags, (c) hybrid. This
document records the measurement, the decision, and what ships.

## 1. The measurement (real numbers)

Full method + reproduction in `evidence/e4-t15/fp-share.md`. The classifier reads the raw retired
instruction bits against the RISC-V opcode map — independent of the interpreter's decoder, so it is
also the adversarial independent recount (E4-T15 verification §1).

### Dynamic — busybox Linux boot to userland (322.4 M retired instructions)

| metric | value |
|---|---:|
| F/D instructions retired | 1,284 |
| — FP load/store (fld/fsd + C forms) | 1,284 |
| — FP **compute** (arith/fma/cvt/cmp/sgnj/minmax/sqrt/mv/class) | **0** |
| **dynamic F/D share** | **0.000398 %** (~1 in 251,000 instructions) |

A Linux boot's entire FP footprint is 1,284 loads/stores (FP-context save/restore + FP-register
`memcpy` spills) and **zero** floating-point arithmetic. Every op whose wasm translation would risk
NaN/fflags/rounding divergence executes **0 times**.

### Static — the two committed integer benchmarks

| workload | `.text` insns | FP insns | static FP share |
|---|---:|---:|---:|
| `coremark.rv64` | 94,868 | 233 | 0.246 % |
| `dhrystone.rv64` | 93,245 | 226 | 0.242 % |

CoreMark and Dhrystone are integer benchmarks by design; the ~0.24 % of `.text` FP is `printf`/
float-formatting run once at score-report time, not in the scored hot loop (dynamic hot-loop FP ≈ 0).

*(gcc -O2 and python3-float dynamic shares are deferred with those benches per the Level-3 baseline;
the boot measurement plus the integer-benchmark hot loops already bound the decision — see §3.)*

## 2. Amdahl arithmetic

Boot: an FP-translation upper bound (every FP op made *free*) gives speedup
`1 / (1 − 0.00000398) ≈ 1.000004×` — below **0.0004 %**. CoreMark/Dhrystone hot loops are 0 % FP ⇒
**0 %** benefit. No target-workload benchmark moves measurably if F/D is translated.

## 3. Decision — (a) side-exit-all

**Every F/D instruction keeps its basic block out of the JIT and runs on the interpreter.** FP is
too rare to translate (measured upside < 0.001 %) and too subtle to translate *safely*: wasm f32/f64
differ from RISC-V in exactly the corners the interpreter gets right — canonical NaN
(`0x7fc00000` / `0x7ff8…`), FLEN-64 NaN-boxing of f32 in the 64-bit register file, the five accrued
`fflags` (NV/DZ/OF/UF/NX), dynamic `frm` rounding modes (RNE/RTZ/RDN/RUP/RMM), fma single-rounding,
and conversion saturation — while wasm NaN payloads are engine-nondeterministic across
Chrome/Firefox/wasmtime. Option (b)/(c) would trade a < 0.001 % win for a real cross-engine
divergence risk in a correctness-first codebase where every prior extension is byte-identical to the
interpreter. That trade is refused.

This matches prior art: QEMU TCG calls softfloat helpers per FP op (call-out is the norm, not
inlining); here the "call-out" is even cheaper — the block simply stays interpreted.

## 4. What ships (and why it is provably correct)

Nothing new is emitted. `jit_translate::translate_block` already excludes all F/D opcodes from its
`supported()` set, so **any block containing an F/D op returns `TranslateError::Unsupported`** and is
never compiled — the run loop interprets the whole block on the audited `rustc_apfloat` softfloat
path (`crates/core/src/softfloat.rs`, `crates/core/src/hart/`). Because FP executes *only* in the
interpreter, JIT-on and interpreter FP results are identical **by construction** — there is no second
FP implementation that could diverge. E4-T15 formalizes and gates this:

- **`translate_block` side-exits every F/D op** — directed unit test `fp_ops_are_unsupported`
  (`crates/jit-translate/tests/differential.rs`): a block containing each F/D variant returns
  `Unsupported`; the op is never emitted.
- **rv64uf + rv64ud verdict-identical, JIT forced on** — `fp_suites_verdict_identical_under_jit`
  (`crates/jit-runtime/tests/jit_execution.rs`): every `rv64uf-p-*` / `rv64ud-p-*` ELF reaches the
  same Pass verdict interpreted vs JIT-forced (threshold 1, 1-entry flapping cache), and its FP
  blocks do **not** compile (`compiled_count` attributable to FP stays 0 — they side-exit). This is
  trivially green precisely because FP falls to the interpreter, and the test *confirms* it.

The fflags-across-a-block-boundary worry (adversarial §5) does not arise: sticky `fflags` live in the
interpreter's `fcsr` and every FP op that touches them runs in the interpreter, so no accrual is ever
lost to a JIT block. The mstatus.FS dirty transitions and the FS=Off illegal-instruction trap
(adversarial §3) are likewise the interpreter's existing, tested behavior — unchanged by the JIT.

## 5. Re-open condition

Revisit only if a *measured* target workload shows a materially higher dynamic FP-compute share
(say > 5 %) in a hot loop that the JIT would otherwise carry. Then the correct first step is a NARROW
hybrid — translate only the trivially-identical ops (fld/fsd/fmv/fsgnj, and at most fadd/fmul in RNE
with a fflags side-exit) and differentially prove each byte-identical (result + fflags + NaN-box)
over the FP corner set — never a blanket full translation.
</content>
