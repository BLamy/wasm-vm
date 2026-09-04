---
id: E5-T23e
epic: 5
title: End-to-end guest agent channel proof and documentation
priority: 523.5
status: in-progress
depends_on: [E5-T23d]
estimate: S
risk: high
capstone: false
---

## Goal

Freeze the complete virtio-console agent channel with a measured T17 boot, restart recovery,
protocol attack coverage, and the documented extension contract for clipboard and future features.

## Boundary

This slice owns only the end-to-end harness, fuzz/hostile fixtures, latency and size ledgers,
`docs/agent-protocol.md`, roadmap evidence, and checked-in browser/native evidence. It may not
redesign the protocol, transport, agent, or Channel implementation owned by E5-T23a–d.

## Deliverables

- A bounded boot proof recording named-port creation, agent HELLO/capabilities, PING latency, and
  serial-console isolation.
- Restart, unknown-frame, 1 MiB-boundary, 10k-flow-control, version-skew, and repeated kill/restart
  coverage with machine-readable results and exact source/dist hashes.
- Framing fuzz corpus/target and a clear policy for byte dribble, coalescing, garbage, and reset.
- `docs/agent-protocol.md` describing framing, HELLO negotiation, capability registration, and how
  to add a message type; verified roadmap capability.

## Acceptance criteria

- [ ] A T17 boot creates `/dev/virtio-ports/org.wasmvm.agent`, the agent HELLO arrives within 2 s,
      and measured host PING p50 is below 20 ms.
- [ ] `wasmvm-agent` restart reconnects and re-negotiates automatically; in-flight sends fail
      explicitly, unknown types NAK without killing either endpoint, and the serial console stays
      usable while the agent channel is saturated.
- [ ] Static size/dependency, oversized-frame, fuzz, and browser/request/console evidence are
      recorded at one exact head with no unexplained unexecuted changed hunk.

## Verification command

`node tools/verify/e5-t23e-agent-channel-proof.mjs`

## Adversarial verification

Byte-dribble valid frames, coalesce ten, inject garbage, split across close/open, flood 10,000
PINGs, kill the agent 100 times, and bump the host version. Run two simultaneous tabs and compare
listener counts, pending memory, HELLO negotiation, serial output, and all reconnect/fuzz digests.

## Verification log

(empty)
