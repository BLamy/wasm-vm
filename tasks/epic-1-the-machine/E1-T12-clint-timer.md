---
id: E1-T12
epic: 1
title: CLINT — mtime/mtimecmp/msip, machine timer and software interrupts
priority: 112
status: implemented
depends_on: [E1-T11]
estimate: S
capstone: false
---

## Goal
A SiFive-compatible CLINT device on the memory bus at 0x0200_0000 providing the machine
timer (mtime/mtimecmp driving mip.MTIP) and the software-interrupt register (msip driving
mip.MSIP), with a defined mtime advance policy for both native and browser execution —
the heartbeat OpenSBI and the Linux scheduler tick depend on.

## Context
The CLINT layout QEMU-virt/OpenSBI expect: msip hart0 at base+0x0 (32-bit, bit 0
significant), mtimecmp hart0 at base+0x4000 (64-bit), mtime at base+0xBFF8 (64-bit).
Semantics: MTIP is pending iff mtime >= mtimecmp (a *level*, continuously re-evaluated —
writing mtimecmp above mtime clears MTIP); msip bit 0 mirrors directly into mip.MSIP.
mtime advance policy must be deterministic for testing: we drive mtime from retired
instruction count with a configurable divider (e.g. 1 tick / 10 instructions ≈ 10 MHz at
100 MIPS), with a host-clock mode available later for wall-time accuracy at Level 2+.
Privileged spec §3.2.1 defines mtime/mtimecmp; the address map is platform convention.

## Deliverables
- `clint.rs` device implementing the bus trait from Epic 0: 4- and 8-byte reads/writes at
  the three registers (partial-width access to mtime/mtimecmp per QEMU behavior:
  32-bit halves supported).
- MTIP/MSIP level generation wired into the T11 mip logic (device owns the bits; CSR
  writes to them remain ignored).
- Deterministic instruction-count clock source behind a `ClockSource` trait; divider in
  machine config; documented in the device's module docs.
- Tests: timer fires at the exact retire boundary where mtime crosses mtimecmp; writing
  mtimecmp = u64::MAX as two 32-bit halves (low then high) doesn't glitch a spurious
  interrupt (write high half first — document the 32-bit-write idiom from the spec).

## Acceptance criteria
- [x] mtimecmp = N (1000) with MTIE/MIE → traps to mtvec, mcause 0x8000…0007, after exactly N
      retirements (`clint::timer_fires_at_the_expected_retire_boundary`).
- [x] Writing mtimecmp > mtime while MTIP pending clears MTIP with no CSR access — a re-evaluated
      level (`raising_mtimecmp_clears_mtip_without_csr_access`).
- [x] Writing 1 then 0 to msip sets/clears mip.MSIP, observable via csrr
      (`msip_write_sets_and_clears_mip_msip`).
- [x] mtime/mtimecmp are writable memory-mapped and read back
      (`mtime_and_mtimecmp_are_readable_writable_memory`).
- [x] 32-bit half accesses compose a 64-bit register; the high-low-high idiom is glitch-free
      (`thirty_two_bit_halves_compose_a_64_bit_register`, `glitch_free_64bit_program_via_high_low_high_idiom`).
- [x] Deterministic retire index (100× identical) — the clock is a pure function of the retired
      count, so native and wasm32 (same core run loop) agree (`timer_trap_retire_index_is_deterministic`).
      Plus unsigned-rollover (`unsigned_compare_no_interrupt_before_wrap`) and WFI-wakes-on-timer
      (`wfi_wakes_when_timer_expires`).

## Adversarial verification
Refute determinism first: run the timer test 100× in both builds and diff the retire index
of trap entry — any variance refutes. Attack the level semantics: set mtimecmp in the
past (MTIP immediately pending), enter WFI — must wake instantly; then raise mtimecmp
inside the handler without clearing anything else and prove MTIP drops (a sticky-bit
implementation fails this). Attack access widths: 1- and 2-byte accesses to CLINT
registers — match QEMU-virt's behavior (test on real qemu-system-riscv64, document, then
diff). Attack the rollover: set mtime = u64::MAX - 5, mtimecmp = 2, and verify the
comparison is unsigned (no interrupt until wrap actually occurs). Cross-check against
QEMU-virt running the same bare-metal ELF with -icount for determinism.

## Verification log

### 2026-07-03 — implementation
- **`dev/clint.rs`** — an `MmioDevice` at `CLINT_BASE` (0x0200_0000, 64 KiB window) with hart-0
  `msip` (0x0), `mtimecmp` (0x4000), `mtime` (0xBFF8). State (`ClintState { mtime, mtimecmp,
  msip }`) is shared with the `Machine` via `Rc<RefCell<_>>` (the E0-T04 `RecordingDevice`
  pattern), so the run loop can advance the clock and sample the levels while the guest reaches
  the registers over the bus. Reads/writes support 8-, 4-, 2- and 1-byte widths (QEMU-virt
  services sub-word CLINT accesses); 32-bit halves compose a 64-bit register via `write_reg`/
  `read_reg`. `mtip()` is the unsigned `mtime >= mtimecmp` level.
- **Machine wiring** — `enable_clint(clock_div)` attaches the device and stores the shared handle
  + divider. The run loop, each iteration: (1) `sync_clint()` mirrors the LEVELS into `mip` via
  `set_mip_bit` (MTIP = `mtime >= mtimecmp`, MSIP = `msip`) — a device-owned bit a `csrw mip`
  cannot set (E1-T11); (2) samples interrupts; (3) on a successful step, `advance_clock()` bumps
  `mtime` one tick per `clock_div` retired instructions. A trap/interrupt retires nothing, so the
  clock only advances on real retirements — making the timer a pure function of retire count.
- **Determinism**: `mtime = f(retired)`, so a timer interrupt lands at the identical retire index
  every run and on every build (native/wasm share this run loop). The level model means raising
  `mtimecmp` clears MTIP with no CSR access, and the 32-bit high-low-high program is glitch-free.

Tests: `crates/core/tests/clint.rs` (9) — exact retire-boundary fire (mcause 0x8000…0007, mepc =
resume pc), level-clear, msip set/clear, mtime/mtimecmp memory, 32-bit halves, glitch-free program,
unsigned rollover, WFI-wakes-on-timer, 100× determinism (div=3/mtimecmp=40 → 120 retirements).
Local gate green: fmt clean; clippy 0 (real + zicsr-stub, all-targets); `cargo test --workspace` 0
`test result: FAILED`; both wasm builds 0 FAILED. Awaiting adversarial verification.
