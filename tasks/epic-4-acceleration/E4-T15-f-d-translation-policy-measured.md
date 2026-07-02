---
id: E4-T15
epic: 4
title: F/D floating-point policy in the JIT — measured decision and implementation
priority: 415
status: pending
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
(empty)
