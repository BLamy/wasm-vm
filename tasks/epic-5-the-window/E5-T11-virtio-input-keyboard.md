---
id: E5-T11
epic: 5
title: virtio-input keyboard device — EV_KEY map, EV_LED statusq, repeat policy
priority: 511
status: pending
depends_on: [E5-T10]
estimate: M
capstone: false
---

## Goal
A concrete keyboard instance of the T10 chassis that the Linux guest binds as a full
evdev keyboard: EV_KEY capability bitmap covering the PC-105 key range, EV_LED with
CapsLock/NumLock/ScrollLock state flowing back to the host UI, and a deliberate,
documented autorepeat policy.

## Context
The spec is QEMU's virtio-keyboard: name "wasm-vm virtio keyboard", BUS_VIRTUAL devids,
EV_KEY bits set for evdev codes 1..=248 that a physical keyboard can emit (KEY_ESC=1,
KEY_1=2, ... KEY_A=30, KEY_LEFTMETA=125, KEY_COMPOSE=127, media keys optional), EV_LED
bits LED_NUML/LED_CAPSL/LED_SCROLLL, EV_MSC/MSC_SCAN optional. Autorepeat: we do NOT
declare EV_REP — the host sends only make/break (value 1/0) and repeat is synthesized by
the guest stack (kernel repeats only if EV_REP is set; X/Wayland compositors do their own
repeat from make/break) — this avoids double-repeat and host-timer complexity; the
decision and its rationale get written down. LED changes arrive on statusq as
`{EV_LED, LED_CAPSL, 0|1}` and must update a host-side indicator (T12/T13 use it to
reconcile CapsLock divergence between host and guest).

## Deliverables
- `InputDeviceSpec` keyboard definition (own file, table-driven, commented against
  `input-event-codes.h` names) registered on the mmio bus alongside the GPU.
- LED state struct + host callback wiring, surfaced as `vm.stats.input.leds`.
- Decision note on EV_REP in the module doc-comment and `docs/input.md`.
- Guest-side verification script (serial, pre-desktop): `evtest /dev/input/event0`
  scriptable run + `/proc/bus/input/devices` capture, both checked in as fixtures.

## Acceptance criteria
- [ ] Guest `/proc/bus/input/devices` shows the keyboard with `B: EV=120013` (SYN, KEY,
      MSC if declared, LED, REP absent) and the expected KEY bitmap (fixture diff).
- [ ] Injecting KEY_A down/up (via a host test hook) produces `evtest` output
      `EV_KEY KEY_A 1` / `0` framed by SYN_REPORT — captured over serial.
- [ ] From serial, `setleds +caps < /dev/tty1` (or `evtest` LED write /
      `ioctl EVIOCSLED` equivalent) produces a statusq event and flips the host
      indicator within 100 ms.
- [ ] Holding a key (host injects only one down) yields exactly one guest key event —
      no kernel autorepeat (proves EV_REP absent works as designed).
- [ ] Native + wasm32 config-space tests green.

## Adversarial verification
Refute the bitmap: diff our EV_BITS payload against QEMU's virtio-keyboard
byte-for-byte; then in-guest, compare `udevadm info /dev/input/event0` key list — any
code we claim but never emit, or emit but don't claim (evdev drops undeclared codes
silently — inject KEY_F24 style edge codes and watch them vanish if the bitmap lies).
Attack LEDs: toggle CapsLock from inside the guest 100x in a loop and race host-side
injections — LED indicator must match guest state at rest (no lost statusq buffers).
Then start a getty on tty1, inject the byte sequence for `ls\n` via key events, and
prove the command executes — an off-by-one in any letter's code refutes.

## Verification log
(empty)
