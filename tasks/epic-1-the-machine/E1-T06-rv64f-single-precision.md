---
id: E1-T06
epic: 1
title: RV64F single-precision FPU with NaN-boxing, rounding modes, and fcsr
priority: 106
status: implemented
depends_on: [E1-T05, E1-T02]
estimate: L
capstone: false
---

## Goal
Complete F-extension execution: the 32-entry f-register file with NaN-boxing of 32-bit
values, all RV64F compute/convert/compare/classify/move instructions, dynamic and static
rounding modes, and the fflags/frm/fcsr CSR triad wired through the T02 CSR file with
mstatus.FS dirty tracking — sufficient for rv64uf to go green.

## Context
Unprivileged spec "F" chapter plus RV64-specific FCVT.L/LU forms. The traps here: (1)
NaN-boxing — a 32-bit value lives in an f-reg as {32 ones, value}; any f32 operand whose
upper 32 bits are not all-ones must be treated as the canonical qNaN (0x7fc00000), and
FLW/FMV.W.X must box; (2) rm field — values 5/6 are reserved and rm=7 (DYN) with a
reserved frm must raise illegal instruction *at execution*; (3) FMIN.S/FMAX.S: sNaN input
sets NV, -0.0 < +0.0, two-NaN input yields canonical NaN; (4) FCVT to integer saturates
and sets NV on NaN/out-of-range (NaN → maximum value, not minimum); (5) mstatus.FS=Off
makes every FP instruction (including FLW/FSW and fcsr access) trap illegal.

## Deliverables
- f-register file (u64-backed) with `read_f32` performing NaN-box checking and `write_f32`
  boxing; FLW/FSW/FMV.W.X/FMV.X.W (FMV.X.W sign-extends bit 31 per spec).
- FADD/FSUB/FMUL/FDIV/FSQRT/FMADD/FMSUB/FNMADD/FNMSUB.S via the T05 backend; FSGNJ[N,X].S
  as pure bit ops (no flags, no NaN canonicalization); FEQ/FLT/FLE (FLT/FLE signal NV on
  any NaN, FEQ only on sNaN); FCLASS.S 10-bit mask; FCVT.{W,WU,L,LU}.S and inverses.
- fflags (0x001), frm (0x002), fcsr (0x003) with aliasing (fcsr = frm[7:5]|fflags[4:0]);
  writes to any of the three set mstatus.FS = Dirty.
- rv64uf-p-* passing.

## Acceptance criteria
- [ ] An f-reg holding a non-boxed value (upper bits != all-ones) used as f32 operand
      behaves exactly as canonical qNaN input (test via FADD.S and FEQ.S).
- [ ] FCVT.W.S of NaN returns 0x7FFF_FFFF with NV; of -inf returns 0x8000_0000 with NV;
      results sign-extended into the x-register.
- [ ] Static rm=5 or rm=6 in any FP-compute encoding traps illegal instruction; rm=DYN
      with frm=5/6/7 traps at execution time, not decode time.
- [ ] FMIN.S(-0.0, +0.0) = -0.0; FMAX.S(sNaN, 1.0) = 1.0 with NV set.
- [ ] With mstatus.FS=Off, FLW and `csrr x1, fflags` both raise illegal instruction; any
      executed FP op flips FS to Dirty (visible in mstatus and SD bit 63).
- [ ] fflags are sticky across instructions and only cleared by explicit CSR writes.
- [ ] rv64uf-p suite passes natively and in wasm32.

## Adversarial verification
Run TestFloat level-2 vectors for every F op through the *decoded instruction path* (not
the backend directly) so boxing/rm plumbing is exercised; any mismatch vs SoftFloat-3e
refutes. Attack NaN-boxing: use FMV.X.D-style 64-bit stores (once D lands, or FSD of a
sneaked value) — pre-D, write raw u64 patterns into f-regs via the test API — and confirm
f32 ops canonicalize. Attack flag accumulation ordering with FMADD.S producing OF+NX
together. Diff FCLASS.S against Spike for the 10 canonical class representatives plus
subnormal boundaries (0x00000001, 0x007fffff). Attack FS tracking: trap on FS=Off must
leave fflags and f-regs untouched (dump before/after). Compare a 50k random-instruction
F-only stream against Spike lockstep — first divergence refutes.

## Verification log

### 2026-07-03 — worker (implementation claim)
Full RV64F execution built on the T05 softfloat backend:
- **`crates/core/src/hart/fregs.rs`** — FLEN=64 f-register file with NaN-boxing: `read_f32`
  returns the canonical qNaN for any non-boxed value (upper 32 bits ≠ all-ones), `write_f32`
  boxes. `f0` is ordinary (not hardwired zero).
- **`crates/core/src/csr.rs`** — fflags(0x001)/frm(0x002)/fcsr(0x003) with aliasing
  (fcsr = frm<<5 | fflags); a write to any marks mstatus.FS Dirty. `mstatus.FS` accessors +
  `mark_fp_dirty` (sets FS=3 and SD bit 63) + `accrue_fflags` (sticky) + `resolve_rm`
  (rm=7→frm, reserved→None). FS=Off makes fcsr access illegal. Added stvec(0x105) and
  mnstatus(0x744) as WARL-stored — the rv64uf p-env's machine-init writes them (the stub
  build was lenient; the real CSR file is strict).
- **`crates/core/src/decode.rs`** — 13 variants across 7 opcodes (LOAD-FP/STORE-FP funct3=010,
  OP-FP, the 4 fused opcodes). rm-carrying ops decode with any rm value (reserved traps at
  *execution*); FSQRT/FMV/FCLASS/FCVT-to-int require rs2=0/width; fused fmt=00 (double is
  E1-T07). Round-trip + reserved-encoding proptests added.
- **`crates/core/src/hart/mod.rs`** — execute arms via `F32::{add,sub,mul,div,sqrt,fma,eq,lt,le}`
  + `f32_minmax`/`fclass_f32`/`f32_to_int`/`f32_from_int` (softfloat). FS!=Off checked once
  before any state read (trap purity). FMV.X.W/FSW use raw bits; compute/convert/sgnj use
  NaN-box-checked operands; results boxed. FCVT-to-int saturates (NaN→max, ±ovf→bound) with
  NV, sign-extends W/WU.

Evidence (local, macOS + reference toolchain):
- **Official riscv-tests rv64uf-p: all 11 ELFs pass** via `tohost` under the REAL-CSR build
  (`crates/core/tests/riscv_tests_f.rs::rv64uf_p_suite_all_pass`; fadd/fclass/fcmp/fcvt/
  fcvt_w/fdiv/fmadd/fmin/ldst/move/recoding). Built by `tools/riscv-tests/build-rv64uf.sh`
  (`-march=rv64if_zicsr`), committed. rv64ui/um/ua still pass.
- `crates/core/tests/rv64f.rs` — 6 acceptance tests: non-boxed operand → qNaN (FADD/FEQ);
  FCVT.W.S NaN→0x7FFFFFFF+NV / -inf→0x80000000+NV (sign-extended); reserved static rm=5/6 &
  DYN-with-frm=5 trap at execution; FMIN(-0,+0)=-0, FMAX(sNaN,1.0)=1.0+NV; FS=Off traps FLW
  and fflags read, FP op → FS Dirty + SD; fflags sticky, cleared only by explicit write.
- `crates/core/src/hart/fregs.rs` — 4 NaN-box unit tests.
- wasm32: `crates/wasm/tests/rv64f.rs` bit-identical to native under both feature builds.
- Decoder space: exhaustive 2^32 sweep passes with the analytic tally **282,053,637**
  (brute-force verified; +F contributions documented in the table). decode_props FP
  round-trip (incl. all rm values) + reserved-encoding negatives pass.
- Gate: fmt clean, clippy 0 warnings, `cargo test --workspace` 0 FAILED, both wasm builds
  0 FAILED.

Pending: adversarial verification (TestFloat/Spike lockstep over the decoded FP path;
NaN-boxing, FS-tracking, FCLASS, and flag-accumulation attacks).
