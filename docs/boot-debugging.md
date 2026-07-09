# Boot debugging playbook (E2-T14)

Turns "the kernel hangs somewhere" into a ~15-minute bisection. Follow the ladder top to
bottom; each rung either prints something (→ next rung) or stays silent (→ the cause is at
this rung). The emulator tooling the ladder leans on — the PC histogram, last-N trace, hang
watchdog, and `tools/symbolize.py` — is described at the bottom.

## The ladder

1. **`earlycon=sbi`** — kernel output BEFORE any driver probes, via the SBI console (our
   E2-T04 legacy putchar / DBCN). *Nothing prints* → the bug is upstream of the console:
   entry state (a0=hartid / a1=DTB address wrong), the DTB (bad magic / not where `a1`
   points), or the SBI console itself. **This is the rung E2-T12 tripped on** — see the
   worked example.
2. **`earlycon=uart8250,mmio,0x10000000`** — same output but through the 16550 directly.
   Prints here but *not* with `earlycon=sbi` → SBI console problem; the reverse → UART
   (E2-T07) problem.
3. **`console=ttyS0 loglevel=8 ignore_loglevel keep_bootcon`** — the full boot log through
   the real console. Output *stops at the earlycon→console handover* → 8250 probe or PLIC
   wiring (E2-T07 IIR/THRE, E2-T13 IRQ 10 routing). `keep_bootcon` keeps earlycon alive so
   you see the exact handover point.
4. **`initcall_debug`** — the last `calling <fn>+0x0/0x0 @ 1` line with no matching
   `initcall <fn> returned` names the hanging subsystem's init function.

## Symptom → cause

| Symptom (last thing you see) | Likely cause | Where |
|---|---|---|
| Total silence (not even earlycon) | entry contract (a0/a1), DTB address/magic, SBI console | boot contract (ADR 0002), E2-T04 |
| Stops after `Booting Linux on physical CPU 0x0` | memory node / paging / satp | DTB `/memory`, MMU |
| Hang at `clocksource:` / `sched_clock:` | S-timer never fires (STIP) | E2-T05 (`set_timer`), `mcounteren` |
| Hang right after `Serial: 8250/16550 driver` | IIR/THRE state machine, PLIC IRQ 10 | E2-T07, E2-T08/T13 |
| `VFS: Unable to mount root fs` | initrd placement or virtio-blk | E2-T13 initrd, E2-T08..T11 |
| `rcu_sched`/`rcu_preempt` stall warnings | timer storm or lost used-ring interrupts | E2-T05 storm, E2-T09/T11 |
| Guest wedged, console dead, no panic | tight spin loop | run under `--hang-watchdog` |

## Worked examples (real transcripts)

### 1. Silent boot → missing SBI earlycon (E2-T12, actually hit)

Building the 6.6.63 kernel from `defconfig` + our fragment, the very first boot was **totally
silent** on QEMU — OpenSBI printed its banner, jumped to the kernel, and then nothing, even
with `earlycon=sbi`:

```
Boot HART ID              : 0
...
Boot HART MEDELEG         : 0x0000000000f0b509
qemu-system-riscv64: terminating on signal 15 (timeout)      ← no "Linux version"
```

Ladder rung 1 (`earlycon=sbi` prints nothing) pointed at the SBI console. Root cause: the
config lacked `SERIAL_EARLYCON_RISCV_SBI`/`HVC_RISCV_SBI` (defconfig leaves them off), so
`earlycon=sbi` was a no-op. Adding them to `configs/wasm-vm.config` fixed it — the next boot
reached the banner and the VFS panic. Diagnosis time: one rung.

### 2. Tight spin → hang watchdog + histogram + symbolize (one command each)

A bare-metal `1: j 1b` binary (`target/t14/spin.elf`) wedges forever. The watchdog catches
it and the histogram + symbolizer name the site:

```
$ wasm-vm run spin.elf --hang-watchdog 1000 --trace-last 4
wasm-vm: HANG — no forward progress at pc=0x0000000080000000 after 1000 instrs
=== last 4 retired (pc  insn) ===
0x0000000080000000  0x0000a001      ← c.j . , the spin
...

$ wasm-vm run spin.elf --hang-watchdog 500 --pc-histogram 3 | tools/symbolize.py System.map -
         500  0x0000000080000000 (_start)      ← the spinning function, named
```

For a real kernel hang, swap in the kernel's `System.map` (built by E2-T12) — the hottest
PC symbolizes to the spinning function directly.

### 3. Missing userland → `VFS: Unable to mount root fs` (E2-T13)

Booting the kernel with a **corrupted** initrd (one byte flipped) reaches:

```
[    0.9] VFS: Cannot open root device "" or unknown-block(0,0): error -6
[    0.9] Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)
```

This is symptom-table row 5 — the userland (E2-T13 initramfs) isn't unpacking. A *good*
initrd instead reaches the busybox `~ #` prompt.

## Diffing against QEMU

QEMU virt is the reference. Boot the same Image+initrd on
`qemu-system-riscv64 -M virt -nographic -kernel Image -initrd initramfs.cpio.gz` (add
`-d guest_errors` to catch bad MMIO/CSR accesses), capture the log, and `diff` it against
our emulator's console (E2-T15). The first diverging line localizes the bug to the
subsystem printing around it.

## Emulator tooling

| Flag | What it does |
|---|---|
| `--pc-histogram N` | after the run, prints the N hottest PCs (spin site = row 0). Pipe through `tools/symbolize.py <System.map> -` to name them. |
| `--trace-last N` | keeps a ring buffer of the last N retired `(pc, insn)` and dumps it on exit/hang — the instructions leading INTO the hang. Overhead scales with N and INVERSELY with per-instruction work: worst case ~2× on a trivial-instruction spin (measured `spin.elf` @50M: ~2.35s → ~5.29s at N=100000, where the ring push rivals the whole interpreter step). On a real Linux boot — MMU walks, CSRs, MMIO per instruction — the relative cost is far lower; a precise boot figure awaits E2-T15. Keep N modest (10k–100k is plenty of pre-hang context). |
| `--hang-watchdog Q` | runs in Q-instruction quanta; if a full quantum retires with the pc + integer registers **unchanged** (a spin loop), aborts with `HANG — no forward progress at pc=…`, dumps `--trace-last`, and exits **103** (distinct from the plain budget-exhausted 102). It deliberately ignores memory/CSRs — a `j .` touches neither, and hashing RAM every quantum would dwarf a boot. A device-polling busy-wait that mutates a register each iteration is NOT flagged (it is making progress by this definition). |

`tools/symbolize.py System.map <hexpc>...` prints `symbol+0xoffset` for each PC; with `-` it
annotates every hex address in a piped stream. PCs below the first symbol or in userspace
print `<unknown>` rather than crashing.
