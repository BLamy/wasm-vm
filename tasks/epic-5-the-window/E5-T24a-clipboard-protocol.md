---
id: E5-T24a
epic: 5
title: Freeze bounded clipboard protocol types and UTF-8 policy
priority: 524.1
status: implemented
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

- [x] Both peers encode/decode the same CLIP_SET/CLIP_GET values and negotiate `CAP_CLIPBOARD`
      without changing PING/NAK behavior.
- [x] UTF-8 text/plain payloads of 3 bytes and exactly 256 KiB round-trip byte-for-byte; 257 KiB
      and invalid UTF-8 are rejected before allocation or delivery with a stable error code.
- [x] Existing protocol/channel tests remain green and the new deterministic tests cover dribble,
      coalescing, malformed payload, and unknown-message compatibility.

## Verification command

`cargo test -p wasm-vm-agent-protocol && node --test web/tests/agent-channel.test.mjs`

## Adversarial verification

Feed one byte at a time, coalesce ten messages, cut every fixed-payload boundary, send invalid
UTF-8 and a 257 KiB payload, and connect a version-1 peer that does not advertise clipboard. The
decoder must not allocate or deliver rejected bytes, and PING must remain usable.

## Verification log

### 2026-09-04 — worker — CLAIM: implemented

- Commit: `309d2e680f38c13cae42388c89a7de9e5d6a0ef4`.
- Commands: `cargo fmt --all -- --check`; `cargo clippy -p wasm-vm-agent-protocol -p wasm-vm-guest-agent -p wasm-vm-cli --bin wasm-vm -- -D warnings`; `node --check web/agent-channel.js`; `node --check web/dist/agent-channel.js`; `cmp web/agent-channel.js web/dist/agent-channel.js`; and scrubbed `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T24a`.
- Evidence: [`evidence/e5-t24a/clipboard-protocol-2026-09-04.txt`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t24a/clipboard-protocol-2026-09-04.txt), SHA-256 `8080bda0eac5098d6cdb47745dc78c90a5b69aed3c4cab1b33867ece5ffaa91f`.
- The final exact-head run passed 11 Rust protocol tests and 14 JavaScript channel tests. It demonstrates shared CLIP_SET/CLIP_GET framing and CAP_CLIPBOARD negotiation, byte-exact CRLF/emoji and 3-byte values, the exact 256 KiB boundary, rejection of 257 KiB/invalid UTF-8/unpaired surrogates, dribble and ten-message coalescing, malformed CLIP_GET handling, and PING continuity with a legacy PING-only peer.
- Coverage: new Rust and source-JavaScript protocol paths are executed by the deterministic suites; `web/dist/agent-channel.js` is the byte-identical deployable mirror (`cmp`); the Make target is executed; documentation and the generated service-worker cache stamp are declarative/generated outputs.
