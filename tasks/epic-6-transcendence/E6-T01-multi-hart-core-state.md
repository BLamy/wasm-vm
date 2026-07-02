---
id: E6-T01
epic: 6
title: Multi-hart core state — hart array, per-hart CSRs, CLINT banks, PLIC contexts
priority: 601
status: pending
depends_on: [E5]
estimate: L
capstone: false
---

## Goal
The core crate models N harts (configurable 1–8) as first-class machine state — a
`Vec<Hart>` with fully independent architectural state per hart, banked CLINT registers,
and per-context PLIC enable/threshold/claim — so SMP is a property of the machine model
before any host-side concurrency exists.

## Context
The whole SMP track (HSM, kernel SMP boot, worker parallelism) needs correct multi-hart
state first. Single-hart assumptions are baked in everywhere: `mhartid` hardwired to 0
(E1-T01), CLINT modeled as one msip/mtimecmp pair, PLIC with one enable/claim context,
DTB emitting one cpu node. Reference layout is QEMU `virt`: CLINT msip at
`0x0200_0000 + 4*hartid`, mtimecmp at `0x0200_4000 + 8*hartid`, shared mtime at
`0x0200_BFF8`; PLIC context `2*hartid` (M-mode) and `2*hartid+1` (S-mode), enables at
`0x0C00_2000 + 0x80*ctx`, threshold/claim at `0x0C20_0000 + 0x1000*ctx`.

## Deliverables
- `Machine::new(cfg)` with `cfg.n_harts`; per-hart: full CSR file, software TLB, LR/SC
  reservation slot, interrupt input lines (MTIP/MSIP/MEIP/SEIP/SSIP/STIP) — plus an audit
  removing any `static` or machine-global state that is architecturally per-hart.
- `mhartid` returns the hart's index; per-hart `mip` bits driven independently.
- CLINT: banked msip and mtimecmp per hart, single shared mtime; correct read/write widths.
- PLIC: per-context enable bitmaps, threshold, claim/complete with gateway semantics
  (a source claimed by one context is masked for others until complete).
- DTB generator emits N `cpu@N` nodes with `riscv,cpu-intc` subnodes; CLINT and PLIC
  `interrupts-extended` properties wired to every hart's intc phandles.
- Unit tests covering register bank addressing at every hartid and both PLIC contexts.

## Acceptance criteria
- [ ] With `n_harts=4`, writing msip for hart 2 raises MSIP in hart 2's mip only; the
      other three harts' mip are bit-identical to before (asserted by a unit test).
- [ ] mtimecmp is independent per hart: setting hart 0's in the past and hart 3's in the
      future asserts MTIP only on hart 0; shared mtime reads identical from all harts.
- [ ] A PLIC source enabled in context 3 (hart 1 S-mode) and claimed there does not
      appear in context 1's claim register until completion.
- [ ] Generated DTB passes `dtc -I dtb -O dts` round-trip and contains N cpu nodes with
      correct `reg`/phandle wiring for CLINT and PLIC (golden-file test).
- [ ] With `n_harts=1`, the full Epic 1–5 test suite (riscv-tests, RISCOF, Linux boot)
      passes unchanged — zero single-hart regressions, native and wasm32.

## Adversarial verification
Boot QEMU `virt` with `-smp 4` and a bare-metal probe that, from each hart, dumps mhartid,
reads/writes every CLINT bank, and walks PLIC context registers; diff the register map
against ours — any addressing divergence is a refutation. Attack angles: (1) aliasing —
write mtimecmp for hart 3 with `n_harts=2` and prove it corrupts another bank or fails to
trap/ignore per our documented policy; (2) shared-state leakage — run a program on hart 0
that dirties satp/fcsr/TLB, then execute on hart 1 and find any leaked translation or CSR
value; (3) PLIC claim races in the single-threaded model — interleave claims from two
contexts and find a source delivered twice; (4) DTB — boot Linux with the generated DTB in
QEMU (`-machine virt,dumpdtb` swap trick) and see whether it enumerates N CPUs.

## Verification log
(empty)
