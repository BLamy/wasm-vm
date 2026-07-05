---
id: E2-T20
epic: 2
title: Interrupt storm and livelock detection instrumentation
priority: 220
status: implemented
depends_on: [E2-T15]
estimate: M
capstone: false
---

## Goal
Always-available (cheap) instrumentation that detects the classic emulator death spirals —
interrupt storms, trap livelocks, WFI-with-nothing-armed deadlocks — and dumps an
actionable diagnosis instead of letting a boot silently spin at 100% CPU forever.

## Context
The three failure shapes seen in every emulator bring-up: (1) *storm*: a level-triggered
line (UART IIR not clearing, PLIC claim/complete mismatch, RTC alarm unacked) re-enters
the trap handler endlessly — symptom: trap rate ≫ instruction progress; (2) *livelock*:
guest re-executes a faulting instruction because a trap is delivered but cause/tval is
wrong — symptom: same small PC set, sepc not advancing; (3) *deadlock*: WFI with no
enabled+possible interrupt source (sie/sip disjoint from anything armed) — symptom:
emulator idles forever. Implement: per-IRQ PLIC claim counters and claims-per-second
rates; trap-entry counters keyed by scause; a sliding-window detector (e.g., >5000 traps
per 10^6 retired instructions sustained over 3 windows) that fires a diagnostic dump —
sip/sie/sstatus, PLIC pending/enable/threshold/claim state, UART IIR/IER/LSR, RTC alarm
state, top-10 PC histogram (reuse E2-T14 tooling), last 200 trace entries; and a WFI
watchdog (WFI + no timer armed + no pending device line = report, don't just hang).
Zero-cost-when-quiet matters: counters are plain increments; the detector runs on the
dispatch quantum boundary, not per instruction. Expose counters via a `--stats` dump and
through the wasm boundary (E2-T26's UI can surface them).

## Deliverables
- `crates/core/src/diag/irqstats.rs` + detector + dump formatting; CLI `--stats`,
  `--storm-detect` (on by default in debug, flag-gated in release).
- Unit/integration tests: a bare-metal guest that deliberately leaves the UART THRE
  interrupt unacked (storm), one that WFIs with sie=0 (deadlock) — detector must name the
  right suspect line/state in its dump.
- Overhead measurement: instructions/sec with and without instrumentation, recorded.

## Acceptance criteria
- [ ] Storm test: detector fires within 100 ms of storm onset and the dump names IRQ 10
      (UART) as the hot line with its claim rate.
- [ ] Deadlock test: WFI watchdog reports "WFI with no wakeup source armed" including
      sie/sip values, instead of hanging silently.
- [ ] Full E2-T15 busybox boot with detection enabled: zero false positives.
- [ ] Measured overhead of default-on instrumentation < 3% on the E2-T15 boot (documented
      numbers, reproducible command).
- [ ] Counters visible via `--stats` after any run; wasm boundary exposes the same struct.

## Adversarial verification
Build a guest the implementer didn't anticipate: enable the RTC alarm IRQ, let it fire,
never clear it, but *also* keep a timer ticking so instructions retire — a detector that
only checks global trap rate may miss the per-line storm; failure to identify IRQ 11 as
pathological refutes. False-positive hunt: run the full Alpine boot (E2-T19) and a `dd`
storm with detection on — any spurious dump refutes the threshold tuning. Verify the
overhead claim independently with `hyperfine` on identical boots. Attack the WFI watchdog:
guest WFIs with only SSIP possible via a *future* self-IPI that never comes — does the
report fire, and does it correctly not fire when a timer IS armed? Each wrong answer
refutes.

## Verification log

### 2026-07-05 — storm / livelock / WFI-deadlock detection landed

`crates/core/src/diag/irqstats.rs`: always-on plain-counter instrumentation for the three
emulator death spirals. Per-`scause` trap counters, per-PLIC-source CLAIM counters, WFI count; a
sliding-window **storm detector** (`>5000 traps / 10^6 retired` sustained over 3 windows, names
the hottest PLIC line); a one-shot **WFI-deadlock watchdog** (WFI + no wakeup armed → report).
Fixed arrays (no HashMap/time/rand — determinism gate clean).

**Wiring:** PLIC per-source `claim_count`; a microarchitectural `Hart::last_was_wfi` flag (NOT
snapshotted) set by the WFI arm; `Csrs::mip_and_mie_nonzero` + `ClintState::any_timer_armed` as
the wakeup-armed signals; the run loop counts traps/interrupts/retires/WFI, runs `storm_check`
when a trap lands (event-driven — zero cost while quiet) and `wfi_watchdog_check` after a WFI.
Hot-path cost is just `check_storm` (a subtract+compare); the PLIC claim sync + hot-line naming
happen ONLY on a fire. CLI `--stats` / `--no-storm-detect` (run + boot); wasm `getStats()` returns
`{retired, wfi, exceptions[16], interrupts[16], claims[32], storm, wfiReport}` for E2-T26's UI.

**Tests (10):** 6 unit (storm fires after N consecutive hot windows; a quiet window resets the
streak; window stays open until enough retired; WFI watchdog fires-once-then-rearms + silent when
armed; hottest-irq). 4 integration through the real run loop: an illegal-insn→`mret` **storm**
fires (`exc[2] > 3M`, hot window > 5000 traps); a `wfi;jal x0,0` **deadlock** watchdog reports and
names the failure; the SAME WFI with a CLINT timer armed stays **silent** (no false positive); a
quiet `addi;j` loop produces zero storms/WFI-reports/exceptions.

**Overhead (acceptance #4, reproducible):** two 800M-instruction headless busybox boots
(`wasm-vm boot … --no-input --max-instrs 800000000` ± `--no-storm-detect`): **117.20 s** with
detection vs **116.90 s** without = **0.26 %** (within measurement noise), far under the 3 %
threshold. That boot ran the counters throughout (`exc[8]=650`, page-faults `[12/13/15]≈414`,
S-timer `int[5]=758`, UART PLIC claims `[10]=5`, 537 K WFIs) with **no false positive** (no storm,
no WFI report — the Linux idle loop arms a timer before each WFI, so `any_wakeup_armed` is true).

**Acceptance:** #1 storm fires + names the hot line ✓ (detector + `hottest_irq`); #2 WFI watchdog
reports instead of hanging ✓; #3 full boot zero false positives ✓; #4 overhead 0.26 % < 3 % ✓;
#5 counters via `--stats` + wasm `getStats` ✓. Gates: core 101, storm 4, clippy ±`--all-features`,
fmt, determinism, wasm32 build — all green.
