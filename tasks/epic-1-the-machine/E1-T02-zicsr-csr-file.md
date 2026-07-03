---
id: E1-T02
epic: 1
title: Zicsr CSR file with WARL/WLRL masking, privilege checks, and Zifencei
priority: 102
status: implemented
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
### 2026-07-03 — worker claim — branch task/e1-t02-zicsr (stacked on e1-t01)
Deliverables: the real table-driven Zicsr CSR subsystem.
- csr.rs: Csrs::access(addr, op, src, src_is_zero, rd_is_zero, illegal_tval) is the ONE authority.
  Metadata derived per address (Privileged §2.1): min-priv = addr[9:8], read-only = addr[11:10]==0b11;
  a per-addr WARL mask (misa mask 0 = hardwired; mstatus/mcause/mepc/mtvec/mie/mip/medeleg/mideleg/
  mscratch/mtval/satp/pmp* mask !0; mvendorid/marchid/mimpid/mhartid + user counters 0xC00-0xC1F
  read-only). Unimplemented addr → IllegalInstruction. WLRL (mcause codes) left fully writable
  (documented). Side-effect suppression: CSRRW writes always, reads only if rd!=x0; CSRRS/C write
  only if src!=0 (rs1!=x0 / uimm!=0). Illegal traps carry cause=IllegalInstruction (mcause=2) and
  tval = faulting instruction word.
- decode.rs: new Instr variants FenceI, Csrrw/s/c, Csrrwi/si/ci, Mret, Wfi. decode_system() decodes
  SYSTEM funct3 1/2/3/5/6/7 → CSR ops, plus MRET/WFI as exact words; FENCE.I = canonical 0x0000100F
  ONLY (reserved-zero fields keep decode injective for the round-trip oracle). CRITICAL: the CSR/
  FENCE.I/MRET/WFI decode is gated #[cfg(not(feature="zicsr-stub"))] so E0-T19's rv64ui-p stub path
  is byte-identical — CSR space still decode-fails → stub there.
- hart/mod.rs: execute() gains insn: u32 (for tval) + arms for FenceI/Wfi (no-op retire), Mret
  (pc←mepc via access), and the six CSR ops (old value retires into rd; the CSR side effect happens
  in access()). Disjoint borrow of self.regs (r) and self.csr.
DECODER-SPACE UPDATES (E1-T02 legitimately extends the decoder): exhaustive tally recomputed +
derivation updated to 56·2^22 + 3·2^16 + 18·2^15 + 5 = 235_667_461 (adds 6·2^22 CSR + 1 FenceI +
2 MRET/WFI; sweep matches). decode_props encode() + a csr_ops round-trip strategy added (21/21).
E0 illegal-word assertions that became legal updated: decode_golden NEGATIVE (removed FENCE.I/CSRRW/
WFI), verifier_e0t06 fence policy (canonical FENCE.I now Ok), hart_semantics illegal probe (→0x200F),
wasm decode negatives. All noted as "legal in default Zicsr; still illegal under zicsr-stub".
TESTS: crates/core/tests/csr.rs (8) — full side-effect suppression matrix (6 ops × rd/src zero/
nonzero via the PROBE read-hook CSR); privilege check (U-mode → mtvec illegal, mcause=2, tval=insn);
read-only 0xC00-0xC1F + mhartid writes trap, csrrs rs1=x0 reads ok; unimplemented CSR traps; WARL
write-all-ones round-trip (misa legalizes to the const, others keep the value); decode+execute:
csrrw x0/csrrs x0 suppression, fence.i/wfi no-op retire, mret→mepc. crates/wasm/tests/csr.rs (wasm32):
same suppression/priv/WARL + a decode+execute check (full 64-bit misa, no bindgen truncation).
Gates: fmt; clippy --workspace --all-targets --all-features -D warnings 0; workspace 0 FAILED;
exhaustive tally == analytic; wasm-pack node all green; feature matrix (default + zicsr-stub +
wasm32) builds; zero-cost --selftest OK; E0-T19 riscv-tests (stub) still green; E0-T25 self_check
green; E0-T20 Spike diff hello still MATCH 83 (decoder change transparent to CSR-free guests).
rr: N/A (macOS). Verifier angles open: 4096-CSR-address sweep vs Spike (which addrs trap), side-
effect suppression on side-effectful CSRs (csrrsi x0/csrrw x0 satp patterns), degenerate encodings
(csrrwi uimm=31), misa WARL hardwired (write must not change it), FENCE.I self-modifying-code test.
