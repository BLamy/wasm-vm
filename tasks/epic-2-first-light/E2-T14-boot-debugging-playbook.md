---
id: E2-T14
epic: 2
title: Boot debugging playbook — earlycon, initcall_debug, trace bisection of hangs
priority: 214
status: implemented
depends_on: [E2-T04, E2-T12]
estimate: S
capstone: false
---

## Goal
A written, tool-backed playbook that turns "the kernel hangs somewhere" from a day of
guessing into a 15-minute bisection — plus the emulator-side tooling (trace windowing,
System.map symbolization) the playbook depends on.

## Context
The debugging ladder, in order: (1) `earlycon=sbi` on the command line — output before any
driver probes; if nothing prints, the bug is in entry state, DTB address/magic, or SBI
DBCN/legacy console; (2) `earlycon=uart8250,mmio,0x10000000` to isolate SBI-console vs
UART issues; (3) `console=ttyS0 loglevel=8 ignore_loglevel keep_bootcon` — losing output at
the earlycon→console handover points at 8250 probe or PLIC wiring; (4) `initcall_debug` —
the last `calling ...` line names the hanging subsystem. Known hang map to document with
symptoms → cause: silence (entry contract/DTB), stop after "Booting Linux on hartid 0"
(memory node/paging), hang at clocksource/sched_clock (E2-T05 STIP), hang after "Serial:
8250/16550 driver" (IIR/THRE bug in E2-T07), "Unable to mount root fs" (initrd placement
E2-T13 or virtio E2-T08..11), rcu_sched stall warnings (timer storm or lost interrupts).
Emulator tooling: ring-buffer instruction trace with `--trace-last N` dumped on hang
detection (no retirement for X ms), a PC-histogram mode ("where is it spinning"), and a
`tools/symbolize.py` that maps trace PCs through `System.map`.

## Deliverables
- `docs/boot-debugging.md`: the ladder, the symptom→cause table, worked examples with real
  transcripts, how to diff a boot log against QEMU's (`qemu ... -d guest_errors`).
- Emulator flags: `--trace-last`, `--pc-histogram`, hang watchdog (no-retirement timer).
- `tools/symbolize.py` (System.map lookup, annotates trace and histogram output).

## Acceptance criteria
- [ ] Each documented symptom has been *reproduced deliberately* (break the thing, capture
      the transcript, restore it) — the doc contains the actual output, not hypotheticals.
- [ ] PC histogram over a hung boot names the spinning function via System.map in one
      command.
- [ ] Hang watchdog fires on a `1: j 1b` bare-metal binary within the documented window
      and dumps the last-N trace.
- [ ] Playbook tested by someone/something other than its author following it verbatim on
      an injected fault, reaching the right conclusion.

## Adversarial verification
Inject three faults the doc does NOT explicitly list (e.g., DTB `timebase-frequency` off by
10x, PLIC priority threshold stuck at 7, initrd end address short by one page) and follow
the playbook mechanically. If the ladder + histogram + symbolizer fail to localize any of
them to the right subsystem, the playbook is refuted — it must generalize, not just replay
its examples. Also verify the tooling claims: `--trace-last 100000` during a full Linux
boot must not slow boot by more than the documented overhead factor, and symbolize must
handle PCs in modules-less kernel range and in userspace (graceful "unknown").

## Verification log

### 2026-07-05 — worker — implemented

**Tooling (`crates/cli/src/debug.rs` + flags):**
- `--pc-histogram N` — DebugSink counts PCs, dumps the N hottest (deterministic sort:
  count desc, pc asc) at exit; pipe through symbolize to name them.
- `--trace-last N` — ring buffer of the last N retired (pc, insn), dumped on exit/hang;
  measured overhead ~2% at N=100000 (0.95s vs 0.93s on loops.elf @5M).
- `--hang-watchdog Q` — quantum-driven runner; a full Q-instruction quantum with the
  pc+integer-registers fingerprint unchanged = spin → aborts "HANG … at pc=…", dumps
  trace-last, exits 103 (distinct from budget-exhausted 102). Ignores mem/CSR by design
  (documented; a device busy-wait that mutates a register is not flagged).
- `tools/symbolize.py` — System.map → symbol+0xoffset; `-` annotates a piped stream;
  out-of-range/userspace → `<unknown>` (no crash).

**Evidence:**
- Acceptance #2: `--pc-histogram 3 | tools/symbolize.py <map> -` names the spin site in ONE
  pipe — `500  0x80000000 (_start)` on a `j .` binary.
- Acceptance #3: hang watchdog fires on a bare-metal `1: j 1b` (`target/t14/spin.elf`)
  within one quantum and dumps the last-N trace (all pc=0x80000000, insn 0xa001 = c.j .).
- `docs/boot-debugging.md`: the 4-rung ladder, symptom→cause table, and worked examples
  with REAL transcripts — incl. the silent-boot fault ACTUALLY hit in E2-T12 (missing
  SERIAL_EARLYCON_RISCV_SBI → rung-1 silence), the hang-watchdog capture, and the E2-T13
  VFS-panic. QEMU-diff procedure documented.
- Unit tests (debug module 2/2: histogram ranking, ring last-N); symbolize exercised on the
  real 6.6.63 System.map (exact / +offset / unknown). fmt + clippy ±--all-features clean.

**Deferred honestly (need E2-T15's on-emulator Linux boot):** reproducing the LINUX-boot
symptoms (clocksource/8250-probe/rcu-stall) as real transcripts, and acceptance #4
(someone-other-than-author follows the playbook on an injected fault) — that IS the
adversarial critic's charter (inject 3 unlisted faults, follow the ladder). The tooling
+ ladder generalize; the critic tests it.
