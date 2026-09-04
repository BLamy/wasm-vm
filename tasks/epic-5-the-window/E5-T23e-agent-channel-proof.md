---
id: E5-T23e
epic: 5
title: End-to-end guest agent channel proof and documentation
priority: 523.5
status: implemented
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

- [x] A T17 boot creates `/dev/virtio-ports/org.wasmvm.agent`, the agent HELLO arrives within 2 s,
      and measured host PING p50 is below 20 ms.
- [x] `wasmvm-agent` restart reconnects and re-negotiates automatically; in-flight sends fail
      explicitly, unknown types NAK without killing either endpoint, and the serial console stays
      usable while the agent channel is saturated.
- [x] Static size/dependency, oversized-frame, fuzz, and browser/request/console evidence are
      recorded at one exact head with no unexplained unexecuted changed hunk.

## Verification command

`node tools/verify/e5-t23e-agent-channel-proof.mjs`

## Adversarial verification

Byte-dribble valid frames, coalesce ten, inject garbage, split across close/open, flood 10,000
PINGs, kill the agent 100 times, and bump the host version. Run two simultaneous tabs and compare
listener counts, pending memory, HELLO negotiation, serial output, and all reconnect/fuzz digests.

## Verification log

### 2026-09-04 — worker — implemented

- Implementation heads: `333a1c5` (proof-only native host driver, documentation, corpus, browser
  verifier, roadmap capability, and deployable dist) and `eefdca2` (safe native evidence-stream
  completion in the verifier).
- Final worker command, with the prescribed environment scrub, was:
  `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS
  -u CARGO_ENCODED_RUSTFLAGS node tools/verify/e5-t23e-agent-channel-proof.mjs`.
- Exact-head machine-readable evidence is
  [`agent-channel-proof-2026-09-04.json`](../../evidence/e5-t23e/agent-channel-proof-2026-09-04.json),
  SHA-256 `eec2718768ad9feb5a41b731f1ed59fa0fc8a793878ef4c3a0e156b7309211a`; native guest
  evidence is `evidence/e5-t23e/native-agent-proof.json` plus
  `evidence/e5-t23e/native-agent-guest-evidence.txt`, and the recorded Chromium capture is
  `evidence/e5-t23e/agent-channel-browser-2026-09-04.png`.

Claim: the pinned T17 Alpine guest exposes the fixed agent port, negotiates HELLO/capabilities,
answers basic and 10,000-flood PING traffic, NAKs unknown and exact-boundary frames, discards a
partial in-flight frame across an agent restart, re-negotiates after reconnect, and leaves the
serial console usable while agent input is queued. The same exact-head run records the static
378536-byte RISC-V static agent and its two-node dependency tree, deterministic framing attacks,
two simultaneous Chromium MessagePort channels with request/console capture, and source/dist
SHA-256 hashes. The changed runtime hunks are exercised by the native proof, Node framing/channel
attacks, or both browser pages; the Makefile recipe is declarative and each of its commands was
run individually in this submission.

Commands:

- `cargo fmt --all -- --check`
- `cargo clippy -p wasm-vm-agent-protocol -p wasm-vm-guest-agent -p wasm-vm-cli --bin wasm-vm -- -D warnings`
- `cargo test -p wasm-vm-agent-protocol`
- `cargo test -p wasm-vm-guest-agent`
- `cargo test -p wasm-vm-core virtio_console`
- `node --test web/tests/agent-channel.test.mjs`
- `cargo build --release -p wasm-vm-cli`
- `make web-dist`
- `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS node tools/verify/e5-t23e-agent-channel-proof.mjs`
