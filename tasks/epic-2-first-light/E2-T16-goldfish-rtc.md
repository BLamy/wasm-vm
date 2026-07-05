---
id: E2-T16
epic: 2
title: goldfish-rtc device — real wall-clock time in the guest
priority: 216
status: implemented
depends_on: [E2-T15]
estimate: S
capstone: false
---

## Goal
A goldfish-rtc device so the guest's `date` is real wall-clock time from first boot —
required for ext4 mount timestamps, `make`, TLS later in Epic 3, and generally for the
system to feel like a computer instead of a 1970 time capsule.

## Context
Goldfish RTC (compatible `"google,goldfish-rtc"`, driver `CONFIG_RTC_DRV_GOLDFISH`, same
device QEMU virt uses at `0x101000`, IRQ 11): a 64-bit nanoseconds-since-epoch clock read
via two 32-bit registers — `TIME_LOW` @0x00, `TIME_HIGH` @0x04, where *reading TIME_LOW
latches the corresponding high word* so a subsequent TIME_HIGH read yields a consistent
64-bit value (get this wrong and time occasionally jumps ±4.29 s at the 2^32 ns rollover).
Also: `ALARM_LOW/HIGH` @0x08/0x0c (write LOW arms using latched HIGH), `IRQ_ENABLED`
@0x10, `CLEAR_ALARM` @0x14, `ALARM_STATUS` @0x18, `CLEAR_INTERRUPT` @0x1c. Implement the
alarm + IRQ path (the kernel driver uses it for RTC alarms even if nothing sets them in
Epic 2). Time source goes behind a `WallClock` trait: native = `SystemTime::now()`,
browser = `Date.now()` via a wasm-bindgen shim (E2-T23 owns drift policy; here just wire
the trait). Writing TIME_LOW/HIGH sets an offset from host time rather than mutating host
state. Add the DTB node in E2-T02's builder with IRQ 11 → PLIC.

## Deliverables
- `crates/core/src/devices/goldfish_rtc.rs` + platform/DTB wiring + `WallClock` trait
  with native and wasm implementations.
- Unit tests: LOW/HIGH latching across a forced 2^32 ns boundary, alarm fire → IRQ →
  CLEAR_INTERRUPT deassert, guest-set time offset survives subsequent reads.

## Acceptance criteria
- [ ] Guest `date` (busybox) within 2 s of host `date` at a freshly booted shell.
- [ ] `hwclock -r` succeeds; dmesg shows `goldfish_rtc` probe and
      `rtc_hctosys`/"setting system clock" line (CONFIG_RTC_HCTOSYS from E2-T12).
- [ ] Rollover unit test: with host clock mocked just below a 2^32 ns boundary, 10^4
      LOW→HIGH read pairs never yield a value differing from truth by ≥ 2^32 ns.
- [ ] `date -s` in the guest changes guest time without touching host; persists across
      the session.

## Adversarial verification
Race the rollover for real: mock the clock to step 1 ms per read and hammer LOW/HIGH pairs
from a guest loop for 10^6 iterations — any 4.29 s glitch refutes latching. Read TIME_HIGH
*without* a preceding TIME_LOW read and document/verify the behavior matches QEMU's
implementation (read QEMU `hw/rtc/goldfish_rtc.c` semantics; divergence observable to the
Linux driver refutes). Verify IRQ hygiene: arm an alarm 1 s out, let it fire, don't clear
it, and confirm the PLIC line stays asserted (level) without storming the CPU into a
livelock (interrupt count bounded by handler behavior). Boot QEMU with our DTB and check
its goldfish driver binds at our chosen address/IRQ too.

## Verification log

### 2026-07-05 — real wall-clock RTC landed

Turned the E2-T15 epoch-0 stub into a real `google,goldfish-rtc`. The guest now boots with
**real time**, proven by the kernel's own probe line:

```
goldfish_rtc 101000.rtc: registered as rtc0
goldfish_rtc 101000.rtc: setting system clock to 2026-07-05T11:12:15 UTC (1783249935)
```

(vs the E2-T15 `1970-01-01T00:00:00`). `boots_to_interactive_busybox_shell` now asserts a
`setting system clock to 20xx` line, so a regression to 1970 fails the test.

**Design:** time is injected via a `WallClock` trait (`now_ns`) so `crates/core` never names a
host clock — the determinism gate (`tools/ci/determinism-hazards.sh`, bans `SystemTime`/
`Date::now` in core) stays clean. Impls: `SystemClock` (CLI, `SystemTime`), `JsWallClock`
(wasm32, `Date.now()` — the minimal browser shim; E2-T23 owns drift/throttling/suspend),
`FixedClock`/mock (tests). Guest `date -s` sets an `offset` from host time (host clock never
mutated). The device is faithful to QEMU `hw/rtc/goldfish_rtc.c`: TIME_LOW read latches
TIME_HIGH for 64-bit coherency across the 2^32 ns rollover; alarm arms on ALARM_LOW (using
latched ALARM_HIGH), fires one-shot when `now>=deadline`, raises a LEVEL interrupt (PLIC IRQ
11) gated by IRQ_ENABLED and cleared by CLEAR_INTERRUPT. The run loop `poll()`s the alarm and
mirrors its level into the PLIC each boundary, before `sync_plic` samples EIP.

**Unit tests (5, all passing):** injected time read-back; LOW/HIGH latch coherency across a
forced 2^32 ns boundary with the clock stepping between the two reads; guest-set offset
survives host advance without touching the host; alarm fire → level IRQ → stays asserted (no
storm) → CLEAR_INTERRUPT deasserts; IRQ gated by enable.

**Gates:** core lib 89 · cli 8+20 · boot smoke 1 (real-time asserted) · clippy ±`--all-features`
· fmt · wasm32 build · determinism-hazards clean — all green.

**Acceptance status:** #1 (guest date ≈ host) and #2 (goldfish probe + set-clock line) met and
proven at boot; #3 (rollover) covered by the latch unit test; #4 (`date -s` persists) covered
by the offset unit test. `hwclock -r` / a live interactive `date` diff can be added to the
smoke test if desired.
