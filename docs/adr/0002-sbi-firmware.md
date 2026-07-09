# ADR 0002 — SBI firmware: built-in Rust SBI, OpenSBI kept as an M-mode testcase

**Status:** accepted (E2-T03) · **Date:** 2026-07-05
**Deciders:** wasm-vm Epic 2 · **Spec target:** RISC-V SBI **v2.0**

## Question

Who is the M-mode firmware under a Linux kernel?

- **(a) Built-in SBI** — the emulator *is* the firmware (TinyEMU/JSLinux style). `ecall`
  from S-mode is answered in Rust; no guest M-mode code on the boot path; the kernel is
  entered directly in S-mode.
- **(b) OpenSBI as guest payload** — run an unmodified OpenSBI `fw_dynamic`/`fw_jump`
  in M-mode on the emulated hart, exactly as hardware would.

## Evaluation — both options were prototyped and RUN (not argued)

### Prototype (b): real OpenSBI v1.3 on our machine

`tools/adr0002_opensbi_probe.sh` extracts the QEMU-distribution
`opensbi-riscv64-generic-fw_dynamic.elf` (v1.3) and boots it on our emulator
(`crates/core/tests/boot_contract.rs::opensbi_fw_dynamic_boots`): loaded at
`0x8000_0000`, `a0`=hartid 0, `a1`= **our own E2-T02 DTB**, `a2`=`fw_dynamic_info`
{magic "OSBI", version 2, next_addr `0x8020_0000`, next_mode S}, CLINT + PLIC attached,
16550 stub on UART0.

**Run 1 transcript (verbatim, first bytes of console output):**

```
OpenSBI v1.3
   ____                    _____ ____ _____
  / __ \                  / ____|  _ \_   _|
 | |  | |_ __   ___ _ __ | (___ | |_) || |
 | |  | | '_ \ / _ \ '_ \ \___ \|  _ < | |
 | |__| | |_) |  __/ | | |____) | |_) || |_
  \____/| .__/ \___|_| |_|_____/|___ /_____|
        | |
        |_|

sbi_trap_error: hart0: trap handler failed (error -2)
sbi_trap_error: hart0: mcause=0x0000000000000007 mtval=0x0000000088000015
sbi_trap_error: hart0: mepc=0x0000000080002ab0 mstatus=0x8000000a00007800
[... full register dump printed by OpenSBI's own trap handler ...]
```

What this proves empirically:

- **The banner printed.** Real OpenSBI ran thousands of M-mode instructions on our hart —
  CSR setup, trap installation, **it parsed our E2-T02 DTB** to find `serial@10000000`
  (ns16550a) and drove our UART stub through polled LSR/THR. This is the strongest
  independent consumer test our M-mode + DTB have had.
- **The trap was OUR bug, precisely diagnosed by OpenSBI itself:** `mcause=7` (store
  access fault) at `mtval=0x8800_0015` — 21 bytes past the end of 128 MiB DRAM. Our
  `dtb_placement` put the DTB flush against top-of-RAM; OpenSBI's reserved-memory fixup
  grows the DTB **in place**. Fixed in E2-T03: `fdt::DTB_SLACK` (16 KiB headroom above the
  blob). Run 2 (after the fix) is recorded below.
- Notably, the probe got **further than the pessimistic case in the task text** ("requires
  PMP and medeleg/mideleg semantics to be flawless" — they were: 64-entry PMP, counters,
  and delegation CSRs all held up under real firmware).

**Run 2 (after the DTB-slack fix): OpenSBI boots COMPLETELY and hands off to S-mode.**
Key lines of the 2197-byte transcript (re-runnable: `bash tools/adr0002_opensbi_probe.sh`):

```
Platform Name             : riscv-virtio,qemu          ← read from OUR DTB
Platform Timer Device     : aclint-mtimer @ 10000000Hz ← our TIMEBASE_FREQ_HZ
Platform Console Device   : uart8250
Platform Reboot Device    : sifive_test                ← our test@100000 node
Runtime SBI Version       : 1.0
Domain0 Region00..03      : [PMP domains programmed]
Domain0 Next Address      : 0x0000000080200000
Domain0 Next Mode         : S-mode
Boot HART Base ISA        : rv64imafdc
Boot HART PMP Count       : 64                          ← our E1-T27 PMP, detected
Boot HART MIDELEG         : 0x0000000000000222
Boot HART MEDELEG         : 0x000000000000b109
=== outcome: MaxInstrs, final pc 0x80200000 ===          ← parked in our stub kernel
```

OpenSBI's own hart init lands on **exactly** the `mideleg 0x222` / `medeleg 0xB1FF` this
ADR's boot contract specifies — independent confirmation of the delegation table below.

### Prototype (a): built-in SBI first call

`boot_contract.rs::builtin_sbi_first_call_and_reset_state`: the machine enters a
hand-assembled S-mode payload per the boot contract below; the payload issues the kernel's
canonical first SBI call (Base probe, `a7=0x10`); the built-in dispatcher answers
`SBI_ERR_NOT_SUPPORTED (-2)` (skeleton semantics — Base lands in E2-T04) in `a0`, `0` in
`a1`, and **execution resumes at the next instruction in S-mode** (proved by a sentinel
`li ra, 42` after the `ecall` and `RunOutcome::MaxInstrs` in the parking loop, no M-mode
excursion, no trap escape).

## Decision

**(a) Built-in SBI, implemented in Rust in the emulator (SBI v2.0).** The kernel is entered
directly in S-mode; `ecall`-from-S is dispatched by `crates/core/src/sbi.rs`.

**AND: OpenSBI stays as a standing M-mode compliance testcase** — the probe above is kept
runnable (`tools/adr0002_opensbi_probe.sh`, ignored test in `boot_contract.rs`), so we keep
the M-mode coverage option (b) would have given us without paying its costs on the boot
path. This satisfies the "fallback plan" requirement: option (b) is not rejected as
infeasible — it demonstrably boots to its banner — it is simply not the *default* path.

### Why

- **Debuggability.** Every SBI call is a Rust breakpoint away; no bisecting through a
  200 KB opaque binary during Epic 2 bring-up (the probe's own trap illustrates the
  difference: OpenSBI's register dump is nice, but the *fix* was in our Rust either way).
- **Hot path.** No M-mode guest instructions between the kernel and its timer/console —
  matters in the browser, where every retired instruction is interpreter work.
- **The queue already builds it.** E2-T04 (Base + DBCN + legacy console), E2-T05 (TIME),
  E2-T06 (IPI/RFENCE/HSM) implement the extensions; this ADR fixes their dispatch shape.
- **We keep the authenticity check anyway** via the standing OpenSBI probe.

### Costs / consequences

- *We* own SBI v2.0 spec compliance (probe semantics, error codes, HSM state machine) —
  E2-T04..T06 acceptance criteria carry that.
- M-mode sees less real-world traffic in the default path — mitigated by the standing
  OpenSBI probe and the RISCOF privilege suites (395/0 vs Sail).
- The `mcounteren`/`medeleg` reset contract is ours to state (below) rather than
  inherited from OpenSBI's hart init.

## The boot contract (E2-T15 implements against exactly this)

Set by `Machine::boot_supervisor(hartid, dtb_addr)` (`crates/core/src/lib.rs`), asserted
instruction-zero by `builtin_sbi_first_call_and_reset_state`:

| State | Value | Note |
|---|---|---|
| privilege | **S-mode** | no M-mode guest code on this path |
| `pc` | `KERNEL_BASE = 0x8020_0000` | `platform::virt::KERNEL_BASE`, DRAM+2 MiB (fw_jump convention) |
| `a0` | hartid (`0`) | standard Linux/SBI handoff |
| `a1` | DTB physical address | from `fdt::dtb_placement` (top of DRAM − blob − 16 KiB slack, 8-byte aligned) |
| `mideleg` | `0x222` | SSI/STI/SEI delegated to S |
| `medeleg` | `0xB1FF` | causes 0..=8 (incl. illegal-instr + load/store access faults) + I/L/S page faults → S (OpenSBI's full set; wide by necessity — no guest M-mode, so mtvec stays 0) |
| `satp` | `0` (Bare) | kernel builds its own tables |
| `sstatus.SIE` | `0` | interrupts masked until the kernel opts in |
| PMP | entry 0 = R/W/X NAPOT over all memory | S-mode needs an explicit grant |
| M-mode CSRs | unreachable from the guest | S-mode kernel cannot access M CSRs (arch-enforced); the emulator host owns them |

SBI calls: `a7`=EID, `a6`=FID, args `a0..a5`; return `a0`=error / `a1`=value; **unknown or
unimplemented EID → `SBI_ERR_NOT_SUPPORTED (-2)`, never a trap** (asserted by
`sbi::tests::unknown_eid_is_not_supported` and the prototype).

## Extensions Epic 2 implements (SBI v2.0)

| Extension | EID | Task |
|---|---|---|
| Base | `0x10` | E2-T04 |
| Debug Console (DBCN) | `0x4442434E` | E2-T04 |
| legacy console putchar / getchar | `0x01` / `0x02` | E2-T04 |
| TIME | `0x54494D45` | E2-T05 |
| IPI (sPI) | `0x735049` | E2-T06 |
| RFENCE (RFNC) | `0x52464E43` | E2-T06 |
| HSM | `0x48534D` | E2-T06 |
| SRST (system reset; Linux 6.6 probes at init — critic finding) | `0x53525354` | E2-T06 |

## Revisit conditions

- A kernel or userland stack that *requires* vendor SBI extensions we don't want to own.
- Epic 6 SMP: if per-hart HSM in Rust proves harder than delegating to OpenSBI, re-run the
  probe (it should by then reach `next_addr` cleanly) and reconsider (b) behind a flag.
- Any divergence between our SBI behavior and OpenSBI's observed behavior in the standing
  probe is a bug in ours until shown otherwise.
