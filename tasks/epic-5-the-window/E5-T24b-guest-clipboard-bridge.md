---
id: E5-T24b
epic: 5
title: Add the bounded guest clipboard bridge
priority: 524.2
status: pending
depends_on: [E5-T24a]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the static guest agent to the guest desktop clipboard with a bounded, restartable bridge
that emits guest copies and applies host copies without touching the serial console.

## Boundary

This slice owns only guest-side clipboard integration, child-process/watch recovery, bounded
clipboard-to-agent queueing, and guest unit/fixture coverage. Host browser permissions, gesture
staging, echo suppression policy, and cross-browser proof belong to E5-T24c–d.

## Deliverables

- A fixed-path guest clipboard adapter using the selected Wayland tool with an explicit fallback
  contract when the desktop helper is unavailable.
- CLIP_SET emission and CLIP_GET application through the verified agent session, with 256 KiB
  bounds, strict UTF-8 handling, and no key/UART queue aliasing.
- Child-process death, missing-display, malformed-input, and restart recovery tests with bounded
  polling/backoff.

## Acceptance criteria

- [ ] A guest clipboard change reaches the agent as one bounded CLIP_SET event and a host CLIP_SET
      is applied to the guest clipboard without using the serial console.
- [ ] 3-byte, emoji/CRLF, and exactly-256 KiB text survive the guest adapter byte-exactly; 257 KiB
      and invalid UTF-8 follow the explicit rejection policy.
- [ ] Killing or removing the clipboard helper causes bounded retry and recovery within 5 seconds;
      no child pile-up, busy loop, or unbounded queue is possible.

## Verification command

`cargo test -p wasm-vm-guest-agent -- --nocapture`

## Adversarial verification

Kill the watcher mid-copy, remove/recreate the display socket, flood 256 KiB through the guest
terminal, inject invalid UTF-8, and restart the agent during an in-flight CLIP_SET. Assert recovery
and explicit discard without dropping key frames or writing the UART.

## Verification log

(empty)
