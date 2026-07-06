---
id: E2-T23b
epic: 2
title: Deterministic WFI fast-forward (tickless idle) — fix idle/sleep slowdown, keep determinism
priority: 223
status: verified
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
- [x] Guest `sleep` in the browser completes in roughly real time. **Met** — `sleep 2` ≈ 2.5 s
      wall (~1.2×), down from ~40 s (~20×); Playwright-measured, web suite 5/5 green.
- [~] RISCOF signatures unchanged. **In-suite met** — 615/615 across 116 binaries, all rv64
      arch/signature binaries green, identical to baseline. External RISCOF/Sail diff not
      runnable in the critic's clone (harness needs provision.sh + Spike/Sail) — run in CI.
- [x] Full `cargo test --workspace` green; determinism-hazards + no-host-float clean. **Met**
      (615/0/13; both gates exit 0; core + wasm clippy clean).
- [x] No interrupt-storm / WFI-watchdog false positive from the jump. **Met** — storm_detection
      tests green; watchdog runs before the jump (decision unaffected). Minor documented note:
      compressing idle raises trap-per-retired *rate*, so a pathological usleep loop could trip
      the storm *warning* (log-only, no halt) sooner — deterministic, non-blocking.

## Adversarial verification
Confirm the jump is state-only (no host clock) so native and wasm agree. Verify a WFI with NO
timer armed still triggers the deadlock watchdog (no silent jump past a genuine hang). Verify a
pending non-timer interrupt (UART RX) is not skipped — external IRQs are sampled every boundary
regardless of the jump. Re-run RISCOF and diff signatures against the pre-change baseline.

## Verification log

### 2026-07-05 — deterministic WFI fast-forward landed (PR #81)

`Machine::wfi_fast_forward()` (crates/core/src/lib.rs): when a WFI retires with no interrupt
pending, jump `mtime` to the nearest armed future timer deadline (`min(mtimecmp, stimecmp)`,
strict-future, `u64::MAX` excluded). No-op if no timer armed. Pure function of machine state → no
host clock → native and wasm fast-forward identically (determinism preserved). Enabled for all
builds (native + wasm); `tick_accum` left untouched (whole-tick jumps are divider-independent).

Result: browser guest `sleep 2` ~40 s → **2.5 s wall (~1.2×)**; boot also faster (idle compressed).
Full web suite 5/5 green. Tradeoff documented in docs/timekeeping.md: idle compressed to ~0 wall,
so the guest clock now runs AHEAD of wall (deterministic virtual time, à la QEMU icount) rather
than behind; input stays prompt (IRQs sampled every boundary); `read -t N` may expire early.

`cargo test --workspace`: 615/615 across 116 binaries — IDENTICAL to baseline (all rv64 signatures
unchanged). determinism-hazards + no-host-float clean; core + wasm clippy clean.

### 2026-07-05 — cold-clone critic — all 4 claims CONFIRMED, no refutation

- **C1 determinism** CONFIRMED — pure machine-state read (mtime/mtimecmp/stimecmp), no host clock.
- **C2 signatures** CONFIRMED in-suite — 615/0/13, every rv64 arch/signature binary green vs
  baseline. External RISCOF/Sail diff not runnable in the clone (harness unprovisioned; run in CI).
- **C3 no wrongly-skipped wakeup** CONFIRMED — the jump skips NO run-loop boundary (device IRQ
  levels re-mirrored every boundary independent of mtime) and consumes NO wall-clock window (host
  input injected only between run_traced calls), so no arrival window is missed; strict-future +
  min() guards never jump backward or past an earlier deadline; runs only after a WFI retired
  (next_interrupt was None) so no race; watchdog runs before the jump.
- **C4 storm/native** CONFIRMED — storm_detection + boot/determinism natives green. Minor
  non-blocking note: idle compression raises trap-per-retired rate; a pathological usleep loop
  could trip the storm warning (log-only) sooner — deterministic, no signature/functional impact.

Gates exit 0: build · test (615/0/13) · clippy workspace-all-features + wasm-target ·
determinism-hazards · no-host-float.

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT SOUND + coverage gap CLOSED + 1 LOW fixed.
The feature had ZERO dedicated unit tests; the critic's 5 hostile tests are now adopted
(wfi_fast_forward_critic.rs): jump lands EXACTLY on mtimecmp (no overshoot/missed deadline);
already-due mtimecmp fires before the WFI with no jump; no-timer-armed → no jump (watchdog
territory preserved — watchdog runs BEFORE fast-forward, source-confirmed); idle jump delivers the
timer within a few boundaries. LOW fixed in the sweep: a pending+ENABLED interrupt (mip&mie != 0,
globally masked) satisfies WFI immediately per the ISA — the fast-forward no longer jumps mtime in
that state (was a deterministic ~1M-tick time distortion; Linux's idle path never hit it); the
critic's pinning test flipped to assert the fixed behavior. Native≡wasm: pure machine-state
function + the determinism gate's wasm fingerprint check ran green in the sweep.
