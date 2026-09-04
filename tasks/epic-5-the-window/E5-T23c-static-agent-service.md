---
id: E5-T23c
epic: 5
title: Static riscv64 guest agent and OpenRC service
priority: 523.3
status: pending
depends_on: [E5-T23b]
estimate: S
risk: high
capstone: false
---

## Goal

Build the poll-driven Rust guest agent for `riscv64gc-unknown-linux-musl`, install it in the T17
image, and keep it alive as an OpenRC service with no dynamic runtime dependencies.

## Boundary

This slice owns the guest agent binary, its bounded poll loop and protocol handlers, the cross-build
and stripped-size gate, rootfs installation, and service lifecycle. It does not own host Channel
APIs, clipboard messages, or the final reconnect/fuzz/browser proof.

## Deliverables

- `guest/agent/` binary using the shared protocol, handling HELLO/PING/NAK over the named port.
- Reproducible static musl build recipe and a stripped binary check at ≤1 MiB with `ldd` reporting
  no dynamic executable.
- T17 image-builder installation and `wasmvm-agent` OpenRC service with bounded restart behavior.
- Guest-side unit/integration fixture for agent restart and in-flight frame termination.

## Acceptance criteria

- [ ] The cross-built stripped agent is ≤1 MiB and `file`/`ldd` prove it is a static riscv64
      executable with no shared-library dependency.
- [ ] The service opens `/dev/virtio-ports/org.wasmvm.agent`, answers HELLO/PING, and exits or
      retries cleanly when the port disappears; it never spins without a poll bound.
- [ ] Rebuilding the T17 image installs the exact agent digest and service links without changing
      the existing serial getty path.

## Verification command

`bash tools/verify/e5-t23c-static-agent.sh`

## Adversarial verification

Kill the agent repeatedly, remove/recreate the port, feed byte-dribbled and oversized frames, and
hold the peer write queue full. Assert no zombie pile-up, no unbounded allocations, bounded restart
latency, and unchanged serial-console output.

## Verification log

(empty)
