---
id: E6-T03
epic: 6
title: Linux SMP boot on the single-threaded round-robin hart scheduler
priority: 603
status: pending
depends_on: [E6-T02]
estimate: M
capstone: false
---

## Goal
An SMP-enabled Alpine kernel boots with 2–4 harts on a deterministic, single-threaded
round-robin scheduler that interleaves hart execution — proving multi-hart architectural
correctness (HSM, IPIs-as-msip, per-hart timers) before any real parallelism, while
preserving the reproducible-execution property we rely on for differential debugging.

## Context
Separating "SMP is architecturally correct" from "SMP is actually parallel" halves the
debugging surface: on one thread, every interleaving is replayable. Kernel needs
CONFIG_SMP=y, CONFIG_NR_CPUS>=8, CONFIG_HOTPLUG_CPU=y (stock Alpine linux-lts riscv64 has
SMP on — verify; else ship our test-kernel build from Epic 2 infrastructure). The
scheduler steps hart i for a quantum Q (default 1024 instructions), skipping harts that
are HSM-STOPPED or in WFI with no pending enabled interrupt. Linux uses the SBI IPI/timer
paths heavily during secondary bringup (`smp_callin`), so CLINT banking from E6-T01 gets
its first real workout here.

## Deliverables
- `Machine::step_round_robin(quantum)` driving all harts on one thread; WFI/STOPPED harts
  are skipped via a runnable-set, with wakeup on interrupt-pending transitions.
- Quantum configurable via machine config and the debug UI; interleaving is a pure
  function of (config, inputs) — no wall-clock dependence (mtime advances by retired
  instruction count in this mode, as in earlier epics).
- Kernel config fragment + image build script if the stock kernel lacks SMP/hotplug.
- Boot documentation update: `smp=N` machine parameter plumbed to DTB cpu nodes.

## Acceptance criteria
- [ ] With `smp=4`: `nproc` prints 4; `/proc/cpuinfo` lists four harts with correct hart
      ids; dmesg shows `smp: Brought up 1 node, 4 CPUs` and no lost-IPI stalls.
- [ ] `taskset -c 2 sh -c 'cat /proc/self/stat'` reports the task on CPU 2; `stress-ng
      --cpu 4 -t 10s` shows all four CPUs accumulating time in `/proc/stat`.
- [ ] `echo 0 > /sys/devices/system/cpu/cpu1/online` then `echo 1 > ...` completes a full
      HSM stop/start hotplug cycle; the machine survives 20 consecutive cycles.
- [ ] Two boots with identical config and scripted input produce identical instruction
      counts per hart (determinism check via trace counters).
- [ ] `smp=1` boot time regresses < 3% vs the pre-task build.

## Adversarial verification
Attack determinism first: run the boot 10 times with a scripted `init`, hash per-hart
retired-instruction counts and the final RAM image — any divergence refutes the
determinism claim. Then starve the scheduler: set quantum to 1 and to 10^6 and reboot; a
hang at either extreme (lost wakeup, timer starvation, IPI delivered to a skipped hart)
is a refutation. Hotplug torture: script 200 offline/online cycles across all secondary
harts while `stress-ng --cpu 4` runs; any kernel oops, hung task warning, or hart stuck
in START_PENDING refutes. Finally boot the same kernel/DTB in QEMU `-smp 4` and diff
dmesg SMP bringup lines for missing/extra warnings (e.g. `riscv: IPI` errors) that
indicate we're papering over a delivery bug.

## Verification log
(empty)
