---
id: E1-T02
epic: 1
title: Zicsr CSR file with WARL/WLRL masking, privilege checks, and Zifencei
priority: 102
status: pending
depends_on: [E1-T01]
estimate: L
capstone: false
---

## Goal
A single, table-driven CSR subsystem implementing CSRRW/CSRRS/CSRRC and their immediate
forms with spec-exact read/write side-effect suppression, per-CSR WARL/WLRL legalization
masks, privilege and read-only checks derived from the CSR address encoding, plus
FENCE.I (Zifencei) — the substrate every later task (mstatus, satp, counters, PMP) plugs
into instead of open-coding CSR behavior.

## Context
Unprivileged spec chapter "Zicsr" and privileged spec §2.1–2.2 (CSR address map) define
the mechanics: bits [11:10] of the address encode read-only (0b11), bits [9:8] the minimum
privilege. CSRRW with rd=x0 must not perform the read (no read side effects); CSRRS/CSRRC
with rs1=x0 (or uimm=0) must not perform the write. riscv-tests rv64si/mi and RISCOF probe
these aggressively. FENCE.I is a no-op for an interpreter but must decode and retire.

## Deliverables
- `csr.rs`: a registry mapping address → { read fn, write fn, legalization mask, min-priv,
  read-only flag }, with a `Csr` trait or table entries for hardwired, masked, and
  side-effectful registers.
- Illegal-instruction exceptions for: unimplemented CSR address, write to read-only CSR
  (including CSRRS/C with rs1!=x0 against e.g. cycle), access above current privilege.
- WARL policy: illegal writes to WARL fields silently legalize (documented per-CSR mask);
  WLRL fields (mcause/scause exception codes) documented with our chosen legal behavior.
- FENCE and FENCE.I decode/retire (FENCE fully permissive on fm/pred/succ per spec).
- Unit tests: side-effect suppression matrix (all 6 CSR ops × rd/rs1 zero/nonzero).

## Acceptance criteria
- [ ] `csrrw x0, mcause, x5` performs no read side effect (verified via a test CSR with a
      read-counting hook); `csrrs x5, mcause, x0` performs no write.
- [ ] Access to a CSR with encoded min-priv above the current mode raises illegal
      instruction with correct mcause=2 and mtval = the faulting instruction bits.
- [ ] Any write to addresses 0xC00–0xC1F (read-only user counters) traps.
- [ ] A write of all-ones to every implemented CSR followed by read-back returns only
      legal (masked) values — asserted by an exhaustive loop test over the registry.
- [ ] Same test binary passes native and wasm32.

## Adversarial verification
Attempt refutation by sweeping the full 4096-CSR address space with csrrs/csrrc/csrrw
(rs1 zero and nonzero) in a bare-metal probe program, recording {trap?, value} per address,
and diffing the map against Spike with identical misa. Divergences in *which* addresses
trap are refutations. Then attack side-effect suppression: use `csrrsi x0, mip, 0` and
`csrrw x0, satp, x1` patterns where suppressed reads/writes differ observably. Try the
degenerate encodings: csrrwi with uimm=31 vs csrrw, and CSR ops targeting misa (WARL
hardwired — write must not change it). Finally check FENCE.I with a self-modifying-code
test: store a new instruction, fence.i, execute — stale execution is a refutation.

## Verification log
(empty)
