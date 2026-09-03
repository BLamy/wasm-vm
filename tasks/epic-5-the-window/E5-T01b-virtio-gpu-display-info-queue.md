---
id: E5-T01b
epic: 5
title: virtio-gpu control queue and GET_DISPLAY_INFO
priority: 501.2
status: verified
depends_on: [E5-T01a]
estimate: S
risk: high
capstone: false
---

## Goal

Drain virtio-gpu control-queue descriptor chains and answer `VIRTIO_GPU_CMD_GET_DISPLAY_INFO`
with one enabled 1280x800 scanout, including exact fence echo semantics and request headers split
across descriptors.

## Context

This is the first guest-visible GPU command. It reuses the existing split virtqueue and virtio-mmio
transport while proving that device-readable request bytes and device-writable response buffers are
handled with the same descriptor ownership rules as the existing block and network devices.

## Deliverables

- Controlq queue-0 dispatch for `GET_DISPLAY_INFO` and cursorq queue-1 exposure.
- Response construction for the 408-byte header plus 16 display modes.
- Queue-driven native tests for contiguous and two-descriptor request headers, with and without
  `VIRTIO_GPU_FLAG_FENCE`.

## Acceptance criteria

- `cargo test -p wasm-vm-core --lib virtio_gpu_display_info` passes with a hand-built descriptor
  chain and asserts response length, scanout rectangle, and status.
- A fenced request returns the same nonzero fence ID and flag; an unfenced request returns fence ID
  zero. A header split across two 12-byte descriptors parses identically to a contiguous header.
- The command consumes the used-ring entry and does not hang when the response is delivered through
  a separate writable tail descriptor.

## Adversarial verification

Submit a response buffer shorter than 408 bytes and inspect guest memory for writes outside the
provided range. Use a zero-length readable segment and a chain with no writable tail; both must be
consumed or rejected without a host panic or stale used-ring entry.

## Verification log

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **GET_DISPLAY_INFO controlq — HELD.** The exact acceptance run passed 3/3 tests. A contiguous
  request and a request whose 24-byte header is split across two readable 12-byte descriptors
  both produce the 408-byte response with scanout 0 enabled at 1280x800 and all other modes zero.
- **Fence semantics — HELD.** The fenced request returns `RESP_OK_DISPLAY_INFO` with the same
  nonzero fence ID and `FLAG_FENCE`; the unfenced request returns a zero fence ID and no fence flag.
  The response preserves context/ring identity and emits zero padding.
- **Queue ownership and bounds — HELD.** QueueNotify defers work until `service`, the used-ring
  element is published for each consumed chain, and the short-tail test proves a 32-byte writable
  response is truncated without touching the sentinel after the descriptor.
- **Regression/parity — HELD.** The full core library passed 182 tests. The wasm32 Node runner
  passed both GPU protocol/MMIO tests, and the production core wasm32 build passed.
- **Scope — HELD.** Unsupported-command error mapping and the remaining malformed-chain policy
  are intentionally deferred to E5-T01c; this slice does not claim them complete.

Implementation commit: `0df7111`.

Evidence: `evidence/e5-t01b/display-info-2026-09-03.json` (SHA-256
`37d87355b92300f58e445c9bb8183ad883490435751f26679f7282e1276b591c`).

Commands: `cargo fmt --all`; `cargo clippy -p wasm-vm-core --lib -- -D warnings`; `cargo test
-p wasm-vm-core --lib virtio_gpu_display_info` (3 passed); `cargo test -p wasm-vm-core --lib`
(182 passed); `cargo build -p wasm-vm-core --no-default-features --target
wasm32-unknown-unknown`; and `wasm-pack test --node crates/wasm --test gpu_protocol` (2 passed).
Independent-machine, WebKit, and host-layer rr runs were not used per the user's direction and
current repository evidence policy.
