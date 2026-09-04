---
id: E5-T23a
epic: 5
title: Shared guest-agent protocol and bounded framing
priority: 523.1
status: in-progress
depends_on: [E5-T05c]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze the versioned, length-prefixed wire contract shared by the host Channel and the static
guest agent before either transport endpoint is implemented.

## Boundary

This slice owns only the protocol types, capability bits, HELLO negotiation, incremental frame
encoder/parser, unknown-type NAK policy, and deterministic host/guest-compatible tests. It does
not own virtio-console queues, process polling, browser lifecycle, or image installation.

## Deliverables

- A small no-std-compatible protocol crate usable by the host and `riscv64gc-unknown-linux-musl`
  guest agent.
- Little-endian `{u32 len, u16 type, u16 flags, payload}` framing with a 1 MiB maximum and
  allocation-free rejection of oversized lengths.
- HELLO version/capability intersection, PING/PONG, and unknown-type NAK definitions.
- Tests for byte-dribble, coalesced frames, truncation, malformed headers, and round-trip parity.

## Acceptance criteria

- [ ] Valid HELLO/PING/NAK frames encode and decode byte-exactly on native host tests and a
      no-std guest build.
- [ ] The incremental parser accepts one-byte-at-a-time and ten-frame coalesced input, rejects
      `len = 0xFFFFFFFF` before allocation, and never desynchronizes after a truncated frame.
- [ ] HELLO negotiation returns the protocol/capability intersection; unknown message types are
      represented as NAK-able events without terminating the parser.

## Verification command

`cargo test -p wasm-vm-agent-protocol`

## Adversarial verification

Feed random bytes between valid frames, split headers at every byte boundary, and repeat oversized
length prefixes under a fixed seed. Assert bounded parser storage, no panic, and either documented
resynchronization or an explicit connection-reset result.

## Verification log

(empty)
