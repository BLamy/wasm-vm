---
id: E2-T23b
epic: 2
title: Deterministic WFI fast-forward (tickless idle) — fix idle/sleep slowdown, keep determinism
priority: 223
status: pending
depends_on: [E2-T23]
estimate: S
capstone: false
---

## Goal
Eliminate the ~20× wall-clock cost of a guest `sleep`/idle in the browser (E2-T23 measured
`sleep 2` ≈ 40 s wall) WITHOUT giving up the deterministic retire-count clock. When the hart
executes `WFI` with no interrupt pending and a timer armed, jump `mtime` straight to the nearest
armed deadline instead of spinning `WFI` for `deadline_ticks × clock_div` retirements.

## Context
`mtime` is a deterministic retire-count clock (`clock_div` retirements per tick, 10 MHz timebase).
An idle guest spins `WFI` (a nop that retires), advancing `mtime` one tick per `clock_div` spins,
so a sleep of D ticks burns `D × clock_div` instructions of pure spin — ≈20× real time at the
slow browser interpreter speed. The fix is the standard "tickless idle": on an idle `WFI`, advance
`mtime` to `min(mtimecmp, stimecmp)` among armed future deadlines so the timer fires the next
boundary. Because the jump is a pure function of machine state (`mtime`/`mtimecmp`/`stimecmp`, no
host clock), native and wasm fast-forward identically → the timer lands at the same retire index
on both → determinism (RISCOF signatures + native==wasm + Level-1) is preserved. No timer armed
(a real deadlock, caught by the WFI watchdog) → no-op.

## Deliverables
- `Machine::wfi_fast_forward()` in core, called after an idle `WFI` retires (no interrupt pending).
- Full workspace test suite + RISCOF green (signatures unchanged); determinism gate clean.
- Browser measurement: guest `sleep` drops from ~20× to near-real-time (Playwright).

## Acceptance criteria
- [ ] Guest `sleep 5` in the browser completes in roughly real time (≪ the prior ~100 s).
- [ ] RISCOF signatures unchanged (final state identical — the jump changes only idle spin count).
- [ ] Full `cargo test --workspace` green; determinism-hazards + no-host-float clean.
- [ ] No interrupt-storm / WFI-watchdog false positive from the jump (E2-T20 detectors quiet).

## Adversarial verification
Confirm the jump is state-only (no host clock) so native and wasm agree. Verify a WFI with NO
timer armed still triggers the deadlock watchdog (no silent jump past a genuine hang). Verify a
pending non-timer interrupt (UART RX) is not skipped — external IRQs are sampled every boundary
regardless of the jump. Re-run RISCOF and diff signatures against the pre-change baseline.

## Verification log
(empty)
