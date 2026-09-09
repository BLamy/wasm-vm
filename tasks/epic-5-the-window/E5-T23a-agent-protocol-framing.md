---
id: E5-T23a
epic: 5
title: Shared guest-agent protocol and bounded framing
priority: 523.1
status: verified
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

- [x] Valid HELLO/PING/NAK frames encode and decode byte-exactly on native host tests and a
      no-std guest build.
- [x] The incremental parser accepts one-byte-at-a-time and ten-frame coalesced input, rejects
      `len = 0xFFFFFFFF` before allocation, and never desynchronizes after a truncated frame.
- [x] HELLO negotiation returns the protocol/capability intersection; unknown message types are
      represented as NAK-able events without terminating the parser.

## Verification command

`cargo test -p wasm-vm-agent-protocol`

## Adversarial verification

Feed random bytes between valid frames, split headers at every byte boundary, and repeat oversized
length prefixes under a fixed seed. Assert bounded parser storage, no panic, and either documented
resynchronization or an explicit connection-reset result.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- Wire contract — HELD. The exact-head tests encode and decode little-endian frame headers plus
  fixed HELLO/PING/NAK payloads, and the same dependency-free crate passes a
  `wasm32-unknown-unknown` `no_std` check.
- Incremental safety — HELD. One-byte dribble and ten-frame coalescing produce identical frames;
  a truncated stream is reported at `finish()` and reset; `len=0xffffffff` returns
  `PayloadTooLarge` while decoder payload capacity remains zero; a zero-length frame is emitted
  when its eight-byte header is the entire write; and an exact 1 MiB payload is accepted.
- Negotiation and forward compatibility — HELD. HELLO returns the minimum supported peer version
  and capability intersection, rejects version zero with an explicit error, and leaves unknown
  message types available for an unknown-type NAK without terminating the stream.
- Exact-head coverage — HELD. Commit `8204ab8` passed the 9-test native acceptance suite, its
  doc-tests, the wasm32 target check, clippy with `-D warnings`, formatting, and a normal dependency
  tree containing no runtime dependencies. The decoder's documented malformed-stream policy is
  explicit connection reset rather than unsafe byte guessing.

Commands: `cargo test -p wasm-vm-agent-protocol`; `cargo check -p wasm-vm-agent-protocol --target wasm32-unknown-unknown --quiet`; `cargo clippy -p wasm-vm-agent-protocol --all-targets -- -D warnings`; `cargo fmt --all -- --check`; `cargo tree -p wasm-vm-agent-protocol -e normal`

Evidence: `evidence/e5-t23a/protocol-framing-2026-09-04.txt` (SHA-256 `6499ef0ae933dfc604d205362b716254ac9926081297d879ae6ca04edbe29ed1`)
