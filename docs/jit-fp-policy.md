# JIT F/D floating-point policy — the measured decision (E4-T15)

**Status:** accepted · **Date:** 2026-08-05 · **Epic:** 4 (acceleration) · **Depends on:** E4-T06 §9.4,
E4-T12 · **Original decision:** side-exit-all (option a); measured Omarchy subsets in §§6–8

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

## 6. Measured Omarchy move subset (E5.5-T03t)

T03s independently recorded the current R3 renderer at 13,424,839 FP-compute
instructions among 99,998,678 retirements (13.425016%), including 3,545,385
FSGNJ.S-family operations. Complete 64-byte region counts support the reopening
condition; the truncated PC/insn pair list is not a full-workload distribution.
See `evidence/omarchy-profile/renderer-opcodes-r1/` and its critic audit.

The narrow hybrid now emits integer operations for **FSGNJ.S, FSGNJN.S,
FSGNJX.S, FMV.W.X and FMV.X.W**. Every other F/D operation retains the previous
interpreter policy. No host floating-point instruction, rounded arithmetic or
exception synthesis is introduced. This is instruction support, not a measured
speedup or a responsive-desktop verdict; the original physical-input deadline
still gates the Omarchy release.

Sign injection checks NaN boxes independently for both operands, preserves the
payload of a valid box, and boxes its result. FMV.X.W instead uses raw low bits
and sign-extends them; FMV.W.X boxes raw low integer bits. The sign operations and
FMV.W.X mark FS Dirty even for an unchanged value; FMV.X.W leaves FS unchanged.
All five preserve fflags and frm, including reserved frm values since they do
not round. These rules follow the [F specification](https://github.com/riscv/riscv-isa-manual/blob/main/src/unpriv/f-st-ext.adoc)
and [D NaN-boxing specification](https://github.com/riscv/riscv-isa-manual/blob/main/src/unpriv/d-st-ext.adoc).

### Handoff and precise exits

The formerly reserved `+0x108..+0x208` range holds all 32 raw FPR words, including
writable f0. `+0x208` retains fcsr in its low byte and adds host-only metadata:
bit 8 is FS-enabled, bit 9 records an FP-state write, and bits 32..63 are the
exact FPR write mask. This packed transport word is never exposed as a guest CSR.
Other offsets and the 568-byte transfer span stay unchanged. FP writes update
this memory immediately, so same-module and cross-module successors share it.
Only executed writes commit back, including an FP prefix before a memory fault.

Each translated block checks FS immediately before its first selected FP op.
FS cannot change inside the block: CSR instructions remain interpreter boundaries.
A failed check returns exit code 9 with the exact raw instruction in exit_info,
the virtual fault PC and the exact retired chain prefix. Core handles it through
the existing precise-trap path; no prefix instruction is replayed.

Native and browser handoffs skip the FPR copy only while both object identity
and mutation version agree. Defaults and clones allocate a new non-architectural
identity; FP writes increment only a local version. Neither stamp is serialized
or included in architectural equality. This covers equal write counts and
replacement at the same address without adding an atomic to each FP write.

## 7. Measured FP memory transfers (E5.5-T03u)

FLW/FSW and FLD/FSD, including RV64C's existing FLD/FSD expansions, now use
exactly the integer JIT memory imports and inline RAM path. FLW boxes its raw
32-bit result; FLD retains all 64 bits. Both dirty FS only after success. FSW
stores the raw low 32 bits even for a malformed NaN box; FSD stores all 64 bits.
Stores preserve FS. All transfers preserve fflags/frm and use the same FS-Off
guard and original instruction parcel as the measured move subset.

Integer base registers and FP source/destination registers remain separate even
when their indices alias. Raw stores enter the existing bounded commit log,
reservation invalidation, atomic barrier and code-page invalidation path. A
fault preserves the completed prefix and never replays its device side effects.

The independent memory attack found that a successful four-byte PMP check could
previously publish a whole-page inline tag. Both integer and FP refills now
require the entire 4 KiB physical page to be ordinary RAM with the required PMP
permission at the effective data privilege and with triggers idle. Subpage
permissions remain on checked imports. This changes cache eligibility, not the
result of the already completed access.

The renderer recorded 4,241,032 FP transfers in a 99,998,678-instruction window.
This slice removes that measured boundary; physical keyboard readback and a
visible application response remain the separate desktop acceptance gate.

## 8. Measured single-precision comparisons (E5.5-T03v)

The renderer recording contains 1,713,705 FEQ.S/FLT.S/FLE.S instructions in
99,998,678 retirements. These three operations now compile with integer bit
operations. NaN boxing is checked before classifying operands, signed zeros
compare equal, and negative values reverse the unsigned magnitude ordering.
There is no host floating-point arithmetic or rounded result in this path.

All comparisons with NaN produce integer zero. FEQ adds NV only for signaling
NaNs; FLT/FLE add NV for either kind of NaN. A malformed box becomes canonical
quiet NaN, including when its low bits resemble signaling NaN. These rules
follow the [F comparison specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/f-st-ext.html)
and [D NaN-boxing specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/d-st-ext.html).

Generated code ORs accrued flags and the FP dirty marker into the existing
handoff word immediately. Its FPR write mask and frm bits remain unchanged.
Native and browser exits accrue those flags before marking FS Dirty, including
comparisons writing x0 and prefixes before a later memory fault. A fresh entry
still reloads live fcsr, so an interpreted CSR clear cannot revive stale flags.
The existing FS-Off guard preserves the exact virtual PC and original word.

All source FPR bits survive. Double-precision comparisons, conversions and
rounded arithmetic remain interpreted. Exact instruction behavior does not
establish desktop latency; physical nonce readback and a visible application
response remain the release gate.
