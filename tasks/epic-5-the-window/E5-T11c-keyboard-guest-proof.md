---
id: E5-T11c
epic: 5
title: keyboard evdev stream and repeat-policy proof
priority: 511.3
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- Guest identity and capabilities — HELD. Predicted the rebuilt Alpine guest would register the
  slot-3 device as `/dev/input/event0` with the T11a identity and `EV=20013`, `LED=7`, and
  `MSC=10`, without `EV_REP`; the serial capture observes those exact values. Evidence:
  `evidence/e5-t11c/keyboard-evdev-2026-09-03.json` and the checked-in serial fixture.
- Make/break framing — HELD. Predicted the host hook's KEY_A down/up pair would produce exactly
  `EV_KEY KEY_A 1`, `EV_SYN SYN_REPORT 0`, `EV_KEY KEY_A 0`, and `EV_SYN SYN_REPORT 0`; the real
  guest raw-record capture and native/wasm32 eventq tests observe that sequence with no pending
  events left behind.
- Repeat policy — HELD. Predicted one injected down frame would yield one guest KEY_A event after
  repeated service boundaries; the native and wasm32 no-repeat fixtures observe one down plus one
  SYN_REPORT and zero additional events, while the spec's EV_REP bitmap is all zero.
- Coverage — HELD. The changed native/wasm assembly, slot-4 extra-drive relocation, host injection
  seam, eventq path, serial validator, and fixture are exercised by the final boot proof or the
  focused native/wasm tests. The existing T11b LED/reset findings carry forward unchanged; the
  lean Alpine image has no tty1 getty, so the parent task's tty1 `ls` probe is not an applicable
  acceptance path for this serial evdev slice. Undeclared DOM-code filtering remains scoped to
  E5-T12's keymap layer; T11c does not claim that the generic T10c transport API filters arbitrary
  host-supplied event codes.
- Evidence integrity — HELD. The evidence JSON digest and serial-fixture digest in the worker
  entry match the checked-in artifacts for implementation commit `ba49df3` plus evidence commit
  `0efb0f3`.
- SUITE — HELD. The deterministic native guest stream test, wasm32 mirror, and real Alpine serial
  validator are the permanent proof artifacts for this slice.

Commands: `tools/verify/e5-t11c-keyboard-evdev.sh`; `cargo test -p wasm-vm-core --test
virtio_keyboard_guest_stream`; `wasm-pack test --node crates/wasm --test keyboard_guest_stream`.
