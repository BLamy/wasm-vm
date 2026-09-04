---
id: E5-T24a
epic: 5
title: Freeze bounded clipboard protocol types and UTF-8 policy
priority: 524.1
status: in-progress
depends_on: [E5-T23e]
estimate: S
risk: high
capstone: false
---

## Goal

Define the v1 clipboard messages carried by the verified guest agent channel without changing the
existing frame format or transport lifecycle.

## Boundary

This slice owns only shared Rust/JavaScript message constants, fixed payload parsing/encoding,
capability advertisement, the 256 KiB UTF-8 policy, and deterministic tests. Guest child processes,
browser permissions, paste ordering, and end-to-end UI proof belong to E5-T24b–d.

## Deliverables

- `CLIP_SET` and `CLIP_GET` message types plus `CAP_CLIPBOARD` in the shared Rust and JS contracts.
- Strict UTF-8 text/plain payload validation with an exact 256 KiB limit and explicit rejection of
  257 KiB or invalid UTF-8 input; 3-byte, emoji, and CRLF payloads remain byte-exact.
- Round-trip and malformed/size-boundary tests for byte-dribble, coalesced, and unknown-peer paths.

## Acceptance criteria

- [ ] Both peers encode/decode the same CLIP_SET/CLIP_GET values and negotiate `CAP_CLIPBOARD`
      without changing PING/NAK behavior.
- [ ] UTF-8 text/plain payloads of 3 bytes and exactly 256 KiB round-trip byte-for-byte; 257 KiB
      and invalid UTF-8 are rejected before allocation or delivery with a stable error code.
- [ ] Existing protocol/channel tests remain green and the new deterministic tests cover dribble,
      coalescing, malformed payload, and unknown-message compatibility.

## Verification command

`cargo test -p wasm-vm-agent-protocol && node --test web/tests/agent-channel.test.mjs`

## Adversarial verification

Feed one byte at a time, coalesce ten messages, cut every fixed-payload boundary, send invalid
UTF-8 and a 257 KiB payload, and connect a version-1 peer that does not advertise clipboard. The
decoder must not allocate or deliver rejected bytes, and PING must remain usable.

## Verification log

(empty)
