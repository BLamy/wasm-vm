---
id: E4-T37
epic: 4
title: Bounded multi-target JALR return PIC
priority: 437
status: in-progress
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Replace one-entry monomorphic return behavior with a bounded two- or four-target PIC and explicit
hysteresis while keeping target authority validation in generated code.

## Acceptance criteria

- Fresh Node telemetry reports attempts, hits, refusals, retargets, live entries, and installs.
- Retarget bursts do not repeatedly arm/tear down dispatchers, and live state plateaus.
- Precise traps, interrupts, SMC, and checksum output remain identical to the interpreter.

## Adversarial verification

Alternate four return addresses, inject a target permission/PA mismatch, exhaust fuel at the target,
and invalidate one target while another remains hot. No stale call-indirect target may execute.

## Verification log
