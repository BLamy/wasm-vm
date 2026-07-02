---
id: E2-T16
epic: 2
title: goldfish-rtc device — real wall-clock time in the guest
priority: 216
status: pending
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
(empty)
