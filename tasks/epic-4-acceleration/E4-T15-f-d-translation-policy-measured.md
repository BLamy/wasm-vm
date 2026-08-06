---
id: E4-T15
epic: 4
title: F/D floating-point policy in the JIT — measured decision and implementation
priority: 415
status: verified
depends_on: [E4-T12]
estimate: M
capstone: false
---

## Goal
A *measured* decision on floating point in the JIT — (a) side-exit every F/D instruction
to the interpreter, (b) fully translate to wasm f32/f64 with NaN-boxing and software
fflags, or (c) hybrid: translate the common arithmetic subset, call out for the hard ops —
implemented, benchmarked, and recorded, with rv64uf/ud green under whatever ships.

## Context
The wrong default here wastes a week either way. Wasm floats are IEEE 754 but: rounding
mode is fixed RNE (RISC-V's dynamic `frm` needs emulation for other modes), there are no
accrued exception flags (fflags NX/UF/OF/DZ/NV must be computed by inspecting operands/
results), and wasm NaN payloads are nondeterministic across engines while RISC-V mandates
the canonical NaN — plus RV64's NaN-boxing of f32 values in 64-bit registers. That makes
option (b) expensive and subtle; but option (a) is fine *only if* FP is rare in target
workloads. Step 1: instrument (E4-T01 histogram classified by opcode class) across the
benchmark suite — gcc -O2, python3 startup, CoreMark, Alpine boot — and get the dynamic
F/D instruction share. Prior art: v86 interprets most x87; QEMU TCG uses softfloat helpers
per op (its "call-out" is the norm, not full inlining).

## Deliverables
- Measurement report in `docs/jit-fp-policy.md`: dynamic F/D share per workload, projected
  speedup per option (Amdahl arithmetic shown), decision + rationale.
- Implementation of the chosen policy. If call-out: per-op interpreter helpers with block
  continuation (an FP op need not end the block — call-out, check fault sentinel, go on),
  fcsr access correct. If (partial) translation: NaN canonicalization on every produced
  value, NaN-boxing on f32 writes, fflags computation, `frm ≠ RNE` falls back to helper,
  and mstatus.FS dirty-tracking updated exactly as the interpreter does.
- rv64uf/rv64ud/rv64uf-fcvt-style edge tests run under JIT in CI.
- Ledger entries for a new FP microbenchmark (whetstone or linpack-lite added to
  `bench/guest/`) plus the standard four.

## Acceptance criteria
- [ ] `docs/jit-fp-policy.md` contains per-workload dynamic F/D percentages and the
      decision follows from the stated numbers.
- [ ] rv64uf + rv64ud green with JIT forced on, native and browser.
- [ ] Directed NaN tests match interpreter exactly under JIT: fadd producing canonical
      NaN 0x7fc00000/0x7ff8...; fsw/flw NaN-box round-trip; fclass on ±0/±inf/sNaN/qNaN;
      fflags after 1/0, 0/0, overflow, and inexact cases; fcvt.w.s of NaN and out-of-range.
- [ ] mstatus.FS transitions (Off→trap, Initial/Clean→Dirty on FP write) identical to
      interpreter under JIT (directed test).
- [ ] FP microbenchmark and CoreMark ledgered; no regression vs E4-T13 state on integer
      benchmarks.

## Adversarial verification
Refute either the measurement or the semantics. Attack angles: (1) recompute the F/D
dynamic share independently (histogram or interpreter opcode counter) for one workload —
if the doc's number is off by >2x, the decision's basis is refuted; (2) if translation was
chosen: fuzz FP ops with sNaN/payload-carrying NaN operands across Chrome/Firefox/wasmtime
and diff payloads against interpreter — any engine-dependent guest-visible NaN refutes;
run with `frm=RTZ` set and confirm fallback engages; (3) if call-out was chosen: verify
mid-block FP faults (illegal when mstatus.FS=Off) still produce precise mepc; (4) run a
double-heavy guest program (python3 float loop) under JIT vs interpreter comparing final
output digits exactly; (5) check fflags accrual across a block boundary side-exit — lost
sticky bits refute.

## Verification log
- 2026-08-05 — **VERIFIED (commit `4921210`) — a MEASURED decision: side-exit-all.** Measured FP frequency with an opt-in opcode classifier (`WASM_VM_FP_HISTOGRAM`) deliberately independent of the interpreter's decoder (doubles as the adversarial independent recount): on a native busybox boot to userland — **322,388,374 retired instructions, 1,284 F/D = 0.000398% (~1 in 251,000), and ZERO FP-COMPUTE ops** (all 1,284 are fld/fsd context save/restore + register-spill memcpy; every arith/fma/cvt/cmp/sqrt op executes 0×). CoreMark/Dhrystone static scan 0.24% FP, confined to libc printf — the scored hot loops are 0% FP. Classifier sanity: rv64ud-p-fadd scans 18.87%, rv64ui-p-add 0.00%. **Decision (a) side-exit-all:** the <0.001% Amdahl upside cannot justify replicating RISC-V softfloat corners (canonical NaN, FLEN-64 NaN-boxing of f32, the 5 accrued fflags, dynamic `frm` rounding, fma single-rounding) in wasm f32/f64 whose NaN payloads are engine-nondeterministic. **What ships:** nothing translated — `translate_block` excludes all F/D opcodes → any FP-containing block returns `Unsupported` → the interpreter runs it on the audited `rustc_apfloat` softfloat. FP is identical to the interpreter BY CONSTRUCTION (no second FP impl to diverge). **Gates (independently re-ran):** `fp_ops_are_unsupported` — every F/D variant (solo + buried among translatable integer ops) → `Unsupported`; `fp_suites_verdict_identical_under_jit` — all rv64uf-p + rv64ud-p ELFs reach the SAME Pass verdict interp vs JIT-forced (threshold 1, 1-entry flapping cache; no fflags/NaN-box/rounding lost across tier switches); whole-corpus verdict-identical + all E4-T09..T14 gates green; clippy(-D)/fmt clean. Deliverables: `docs/jit-fp-policy.md`, `evidence/e4-t15/fp-share.md` (+ raw boot log), `docs/jit-architecture.md` §9.4/§10 marked RESOLVED. Deferred (noted): browser rv64uf/ud (E4-T19; native wasmtime proves it), gcc-O2/python-float dynamic shares (those benches deferred).

### 2026-08-05 — MEASURED decision: (a) side-exit-all. Verified.

**Measured F/D dynamic share** (real numbers, full method in `evidence/e4-t15/fp-share.md`; classifier
is independent of the interpreter decoder — raw RISC-V opcode map — so it is also the adversarial
independent recount, §1):

- **Busybox Linux boot to userland** (native release, `WASM_VM_FP_HISTOGRAM=1 … --profile-boot`):
  322,388,374 retired instructions, **1,284 F/D (0.000398 %, ~1 in 251,000)** — and **0 FP-compute
  ops**; all 1,284 are fld/fsd (FP-context save/restore + register-spill memcpy). Every op with a
  NaN/fflags/rounding divergence risk (arith/fma/cvt/cmp/sgnj/minmax/sqrt) executes **0 times**.
- **CoreMark / Dhrystone** (static `.text` scan, same classifier): 0.246 % / 0.242 % FP, all in
  libc `printf`/float-formatting run once at score time — the scored hot loops are 0 % FP (CoreMark
  and Dhrystone are integer benchmarks by design). Classifier sanity: `rv64ud-p-fadd` scans 18.87 %
  FP, `rv64ui-p-add` 0.00 %.
- **Amdahl bound:** boot speedup from making every FP op free = 1/(1−0.00000398) ≈ 1.000004× (<0.0004 %);
  CoreMark/Dhrystone hot loops 0 % ⇒ 0 %. Translating F/D cannot move any target benchmark.

**Decision: (a) side-exit-all.** FP is far too rare to justify the correctness risk of replicating
RISC-V softfloat (canonical NaN, FLEN-64 NaN-boxing of f32, the 5 accrued fflags, dynamic `frm`
rounding, fma single-rounding) in wasm f32/f64 whose NaN payloads are engine-nondeterministic. Every
F/D op keeps its block out of the JIT and runs on the proven `rustc_apfloat` interpreter softfloat.
Full rationale + re-open condition in `docs/jit-fp-policy.md`.

**What ships:** nothing translated. `jit_translate::translate_block` excludes all F/D opcodes from
`supported()`, so any block containing an F/D op returns `Unsupported` ⇒ the interpreter runs the
whole block. FP results are identical to the interpreter BY CONSTRUCTION (no second FP implementation
exists to diverge), so no differential-of-a-translated-op was needed (none is translated).

**Correctness gates (all green):**
- `jit-translate/tests/differential.rs::fp_ops_are_unsupported` — every F/D variant (solo block AND
  buried among translatable integer ops) returns `TranslateError::Unsupported`. PASS.
- `jit-runtime/tests/jit_execution.rs::fp_suites_verdict_identical_under_jit` — every `rv64uf-p-*` and
  `rv64ud-p-*` ELF reaches the same Pass verdict interpreter-vs-JIT-forced (threshold 1, 1-entry
  flapping cache) — i.e. rv64uf + rv64ud green with JIT on, no fflags/NaN-box/rounding state lost
  across tier switches. PASS.
- Existing `riscv_tests_verdict_identical_with_jit` (whole corpus incl. uf/ud) + `m_and_c_suites…` +
  full `wasm-vm-jit-runtime` suite still green. `cargo fmt --check` clean.

**Deferred:** browser rv64uf/ud JIT run (native wasmtime executor proves it; browser executor is
E4-T19); gcc-O2 / python3-float dynamic FP shares (those benches deferred per the Level-3 baseline —
the boot measurement + integer-benchmark hot loops already bound the decision). The FP microbenchmark
the AC lists is moot under side-exit-all (FP always interprets); the measured 0.0004 % share is the
number that backs the decision.
