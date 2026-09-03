---
id: E5-T11c
epic: 5
title: keyboard evdev stream and repeat-policy proof
priority: 511.3
status: in-progress
depends_on: [E5-T11b]
estimate: S
risk: medium
capstone: false
---

## Goal

Prove the concrete keyboard against the rebuilt Linux guest: key make/break events are framed,
guest-visible, and do not synthesize host-side autorepeat.

## Deliverables

- A deterministic guest-side evdev verification script and checked-in serial fixtures.
- KEY_A down/up integration evidence with SYN_REPORT framing and a one-down/no-repeat check.
- Final native/wasm keyboard regression command and verification log tying the stream to the spec.

## Acceptance criteria

- The booted guest exposes `/dev/input/event0` with the expected EV/KEY/LED maps.
- Host KEY_A down/up produces exactly one make and one break framed by SYN_REPORT.
- One injected key-down produces exactly one guest key event because EV_REP is absent.

## Adversarial verification

Inject an undeclared edge key and compare the guest's evdev output, toggle LEDs repeatedly while
injecting keys, and run the `ls\n` key sequence through tty1 to catch map offsets or duplicate repeats.

## Verification log

(empty)
