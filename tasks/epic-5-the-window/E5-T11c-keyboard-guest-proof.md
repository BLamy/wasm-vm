---
id: E5-T11c
epic: 5
title: keyboard evdev stream and repeat-policy proof
priority: 511.3
status: implemented
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

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `ba49df3` attaches the concrete slot-3 keyboard to native and wasm boot
assembly, exposes the host keyboard-event/sync API, adds the native guest eventq stream fixture and
wasm32 mirror, and checks in `tools/verify/e5-t11c-keyboard-evdev.sh` plus its serial fixture. The
extra-drive path now starts at slot 4 so the keyboard reservation cannot be overwritten.

The final native guest command was `tools/verify/e5-t11c-keyboard-evdev.sh`; it booted the pinned
Alpine riscv64 guest, observed `/dev/input/event0` as `wasm-vm virtio keyboard` with
`Bus=0006/Vendor=feed/Product=0001/Version=0100`, `EV=20013`, `LED=7`, and `MSC=10`, and captured
four 64-bit evdev records whose trailing fields were exactly KEY_A make, SYN_REPORT, KEY_A break,
SYN_REPORT. The same command also verified that EV_REP was absent. The native guest stream test
asserted the one-down/no-repeat behavior across 33 Machine boundaries; the wasm32 mirror asserted
the same behavior through the eventq transport.

Final checks: `cargo fmt --all -- --check`, `git diff --check`, the 2-test
`virtio_keyboard_guest_stream` integration test, the 2-test `virtio_keyboard` integration test,
the 15 focused input unit tests, the full 234-test core library, the 22-test virtio regression
sweep, native core/integration clippy with `-D warnings`, `cargo check -p wasm-vm-cli`, the wasm32
core build and clippy, and wasm-pack tests `keyboard_guest_stream` (2), `keyboard_registration`
(1), `keyboard_spec` (1), `input_config` (1), and `input_queues` (2). The only output outside the
asserted results was the pre-existing `hart_ctrl.rs` unused-import warning and wasm-bindgen's
platform fallback install warning.

Evidence: `evidence/e5-t11c/keyboard-evdev-2026-09-03.json`, SHA-256
`8145c0a6c5f7b80b90645b050b5acbb5098ad2407bb5b08964aa51806d5e16d6`; serial fixture
`evidence/e5-t11c/keyboard-evdev-serial.txt`, SHA-256
`1f6e85bac3d506eeede576457177c87288be65da96c18f503393095ef7665429`.
