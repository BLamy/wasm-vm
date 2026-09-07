VERDICT: verified

## Frozen provenance

- Branch submission: `fc78300294fb4e92e5d1965500f200a0fa091e4e` on
  `codex/e5-t26d-sound-snapshot-xrun`.
- Remediation implementation: `2a501be6626035a6a38b75e36aa95dea0442e451`; its only changed file is
  `crates/core/src/dev/virtio/snd/snapshot.rs`, and that file's commit/current blob is
  `66f4d9e2ffc124481adfa28e3900e53cf407b54a`.
- Remediation binary diff SHA-256 (prior implementation `ca002004` to remediation `2a501be6`):
  `e89426545ce61539ebe32be7bf47b7d5f160a768d5da181e14471c9a55576d69`.
- Submitted `evidence/e5-t26d/native-final.json` SHA-256:
  `3263508ab45253fee95e6087811b1063c8bf2653aaa083e55963422db72a3684`; the artifact names
  `2a501be6`, the scrubbed command, six snapshot tests, the exact-period invariant, empty rings,
  running XRUN repair, and atomic refusal at lines 3-46.

Predictions were frozen in `reverification-plan.md` before any acceptance or attack run.

## Findings

- **P6 period-metadata remediation — HELD.** Predicted all 42 malformed mutations would fail
  atomically. The locked harness exited 0 with `mutation_cases=42 mutation_failures=0`; its
  byte-identical target oracle is at `src/main.rs:127-150`, and the formerly failing output and
  capture payloads are at `src/main.rs:275-313`. The implementation validates decoded parameters
  first and queue totals second, before returning a decoded state (`snapshot.rs:450-482`), using
  exact `count * period_bytes` comparison at `snapshot.rs:624-652`.
- **Bounded novel period arithmetic — HELD.** Predicted that `pending_count=2` with only one
  configured period of pending bytes would fail for output and capture without mutation. The new
  verifier-only probe exited 0 with `directions=2 atomic_refusals=2`; mutations and the
  byte-identical oracle are at `src/bin/period_arithmetic.rs:60-98`.
- **Restore/XRUN recovery — HELD.** Carried forward lifecycle results remained unchanged. The
  locked harness reported empty output/capture rings and two repair XRUNs for two running streams
  (`src/main.rs:408-432`). After a 500 ms clock advance, 64 restore/service cycles each returned
  one replacement repair XRUN with an empty playback ring; the stale descriptor never completed,
  one fresh 1024-frame ramp completed once, and a second service produced no duplicate audio
  (`src/main.rs:587-633`).
- **Independent stall/truncation probe — HELD.** `post_restore_stall` rejected all 184 strict
  prefixes and direct event count 257 atomically, then bounded a 500,000,000 ns empty-ring service
  to 23 elapsed XRUNs, 24 pending events, zero pending playback, and zero drops
  (`src/bin/post_restore_stall.rs:41-104`).
- **Prescribed gate — HELD.** The scrubbed `make verify-E5-T26d` exited 0: format, both
  `gpu-trace` clippy legs, 6 snapshot, 7 control, 8 playback, 5 queue, 9 capture, 4 capture-config,
  4 machine tests, and the no-default-features wasm32 build all passed with zero ignored snapshot
  tests.
- **Prior predictions — CARRIED FORWARD HELD.** Lifecycle fidelity, ephemeral ring discard,
  partial playback, the other 40 malformed cases, versioning, event-budget atomicity, device
  wrappers, and unchanged-hunk coverage retain the prior verifier result because their code and
  dependency boundary did not change.

## Remediation diff and coverage audit

- Encode now applies parameter-aware output/capture queue validation at `snapshot.rs:199-217`.
- Decode validates both streams, then both exact period totals, before `DecodedSnd` can reach
  restore assignment at `snapshot.rs:450-482`.
- The shared queue validator retains count/bound/parity checks and adds exact period arithmetic at
  `snapshot.rs:624-652`. The u64 checked-multiplication failure arm is defensive and unreachable
  for bounded u32 operands; a product exceeding the u32 wire value is still rejected by the exact
  comparison.
- The worker-promoted unit regression hits both formerly accepted one-byte payloads and verifies
  atomicity at `snapshot.rs:864-913`. The prescribed gate executed it. The locked harness and the
  novel verifier probe independently hit the same behavioral hunk with distinct payloads.
- The changed playback fixture now supplies one exact configured period before testing host-ring
  discard; the harness independently proves the queued/stale/fresh behavior. No remediation hunk
  remains unexecuted except previously waived unreachable encoder/allocation defenses.

## Commands

```text
cargo fmt --manifest-path evidence/e5-t26d/verifier/Cargo.toml --check
env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_BUILD_TARGET -u RUST_LOG CARGO_TARGET_DIR=target/e5-t26d-reverify cargo run --offline --locked --manifest-path evidence/e5-t26d/verifier/Cargo.toml --bin e5-t26d-verifier
env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_BUILD_TARGET -u RUST_LOG CARGO_TARGET_DIR=target/e5-t26d-reverify cargo run --offline --locked --manifest-path evidence/e5-t26d/verifier/Cargo.toml --bin post_restore_stall
env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_BUILD_TARGET -u RUST_LOG CARGO_TARGET_DIR=target/e5-t26d-reverify cargo run --offline --locked --manifest-path evidence/e5-t26d/verifier/Cargo.toml --bin period_arithmetic
env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u RUST_LOG make verify-E5-T26d
git diff --binary ca002004650f0f4ec6acf302db871d2308318350 2a501be6626035a6a38b75e36aa95dea0442e451 -- crates/core/src/dev/virtio/snd/snapshot.rs | shasum -a 256
shasum -a 256 evidence/e5-t26d/native-final.json
```

## Suite disposition and waivers

Retain the locked verifier harness and the bounded `period_arithmetic` probe as deterministic
remediation evidence. The worker's promoted exact-period unit test is suitable for the permanent
suite. Independent machines, WebKit, and host rr remain waived by user direction and repository
policy.
