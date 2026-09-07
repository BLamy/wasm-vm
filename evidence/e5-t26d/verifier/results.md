VERDICT: refuted

## Frozen provenance

- PR #342 base: `9a0186ad0f3bd818fc034ebc1a2a378ecbfc3e37`.
- Branch head inspected: `7e436d99d1b0cdf4b1f50295b055433908a51e16`.
- Runtime implementation: `ca002004650f0f4ec6acf302db871d2308318350`; no runtime-file
  differences exist between that commit and the branch head.
- Worker evidence SHA-256:
  `8f8bcf3f3f84b9c6adfe64b9368aec83760b2cfaf27b4118bc7907d7613d6c19`.
- Task-scoped implementation-diff SHA-256:
  `51c390f2bc5302ce32ba0f9e7f8510f7d9d3cf57aee564d325a0f2f5c7ccb5fb`.

Predictions were frozen in `attack-plan.md` before either verification command ran.

## Commands and observations

1. Scrubbed prescribed gate:

   ```text
   env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS \
     -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u RUST_LOG \
     make verify-E5-T26d
   ```

   Exit 0. It ran the Makefile target at lines 1069-1085 and reported 5 snapshot, 7 control,
   8 playback, 5 queue, 9 capture, 4 capture-config, and 4 machine tests passing, followed by a
   successful no-default-features `wasm32-unknown-unknown` build.

2. Bounded public-API verifier harness:

   ```text
   cargo fmt --manifest-path evidence/e5-t26d/verifier/Cargo.toml --check
   env -u RUSTFLAGS -u RUSTDOCFLAGS -u CARGO_ENCODED_RUSTFLAGS \
     -u CARGO_BUILD_TARGET -u RUST_LOG CARGO_TARGET_DIR=target/e5-t26d-verifier \
     cargo run --manifest-path evidence/e5-t26d/verifier/Cargo.toml --locked
   ```

   Exit 1 by design after completing all checks. Final summary:

   ```text
   REFUTATION playback bytes cannot describe one configured period:
     accepted=SndRestoreReport { host_audio_rings_discarded: true,
     discarded_playback_transfers: 1, discarded_capture_transfers: 0, xrun_events: 0 }
     target_unchanged=false expected_code=13
   REFUTATION capture bytes cannot describe one configured period:
     accepted=SndRestoreReport { host_audio_rings_discarded: true,
     discarded_playback_transfers: 0, discarded_capture_transfers: 1, xrun_events: 0 }
     target_unchanged=false expected_code=13
   STALL iterations=64 stall_ns=500000000 xrun_per_restore=1 fresh_frames=1024
     duplicate_frames=0 old_completion=absent
   RESULT refuted lifecycle_states=3 duplex_running=1 mutation_cases=42
     mutation_failures=2 stall_iterations=64
   ```

## Finding

- **Invalid ring lengths do not fail closed — FAILED.** Predicted that `pending_count = 1` and
  `pending_bytes = 1` would be rejected because both configured playback and capture periods are
  4096 bytes. The decoder accepted both payloads, reported one discarded transfer, and applied
  the source snapshot over a distinctive prepared target (`target_unchanged=false`). The attack
  bytes are constructed at verifier harness lines 275-282 and 306-313; atomic comparison is at
  lines 127-150. The implementation only checks zero/non-zero parity and a loose
  `count * MAX_PCM_BUFFER_BYTES` upper bound at `snapshot.rs:602-615`, then commits decoded state at
  `snapshot.rs:356-378`. Demand: validate pending bytes against the decoded stream's configured
  period (including checked multiplication for `count * period_bytes`) before any assignment, for
  both playback and capture, then record a rerun of this harness and the prescribed gate.

## Predictions carried forward

- **Prescribed gate — HELD.** Exact claimed suite counts and wasm build passed.
- **Lifecycle fidelity — HELD.** Prepared, stopped, and running output states preserved params;
  only running produced one repair XRUN. Duplex running preserved output/capture configuration,
  emptied both host queues, and produced two XRUNs.
- **Partial playback and 500 ms stall — HELD.** Sixty-four restore/service cycles completed with
  one bounded XRUN each; the stale period was never sent and the fresh 1024-frame ramp completed
  once with no duplicate frames.
- **Malformed IDs/rates/formats/events/versioning and event-budget atomicity — HELD.** Forty of 42
  mutations were rejected with the predicted stable error code and byte-identical target state.
  The only failures were the two impossible pending-byte totals above.
- **Device wrappers — HELD.** `VirtioSnd` encode/restore delegated to the shared state and preserved
  the running/XRUN contract.

## Changed-hunk coverage audit

- `Makefile:1069-1085`: executed by the prescribed gate.
- `snd/mod.rs:1189-1198` and `snd/mod.rs:2071-2080`: direct-state and device-wrapper encode/restore
  paths executed by the harness.
- `snapshot.rs:171-287`: wire encoding exercised for released, prepared, stopped, running,
  capture-enabled, queued-transfer metadata, and 256-event states by the worker suite plus harness.
  Invalid in-memory-state encoder guards are waived as public-API-unconstructible invariant checks.
- `snapshot.rs:289-379`: non-running, running, duplex, event-budget refusal, empty-ring repair, and
  repeated stalled restore paths executed.
- `snapshot.rs:382-650`: header, stream, rate, format, queue, event, boolean, reserved-byte,
  truncation, and trailing-byte decoder paths executed by the 42-case mutation matrix. Queue
  validation was executed and refuted for the under-constrained length relationship.
- `snapshot.rs:653-716`: scalar wire helpers and reader success/truncation paths executed.
  Arithmetic-overflow and allocation-failure arms are waived as defensive branches unreachable
  under the fixed 184-byte header, 256-event bound, and 4096-transfer metadata bound; error-code
  mapping for those two arms is diagnostic-only.
- `snapshot.rs:718-895`: all five added unit tests executed by the prescribed gate.
- `virtio_snd_playback.rs:341-379`: added partial-period/reference-ramp test executed by the gate;
  the independent 64-cycle 500 ms variant is at harness lines 587-633.
- Task/queue/evidence hunks are declarative and provenance-only.

## Suite disposition

Retain this verifier harness as the deterministic regression/sabotage check for remediation. No
implementation test is promoted while the semantic refutation remains open.

## Supplemental independent checks

- A pristine local clone at submitted head `7e436d99d1b0cdf4b1f50295b055433908a51e16`, with
  `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG`, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET`,
  `CARGO_ENCODED_RUSTFLAGS`, and `CARGO_NET_OFFLINE` removed, passed `make verify-E5-T26d` with
  the same counts and wasm32 result.
- `cargo run --offline --locked --manifest-path evidence/e5-t26d/verifier/Cargo.toml --bin
  post_restore_stall` exited 0. The independent probe rejected all 184 strict payload prefixes
  atomically, rejected direct event count 257 atomically, then observed exactly 23 elapsed XRUNs
  after a post-restore 500,000,000 ns empty-ring stall (`pending_events=24`, no drop). See
  `src/bin/post_restore_stall.rs:41-104`.
- Sabotage check: in the pristine temporary clone only, replacing
  `decoded.output.state == PcmState::Running` with `false` at `snapshot.rs:295` made the isolated
  partial-playback regression fail at `virtio_snd_playback.rs:355` (`left: 0`, `right: 1`). The
  committed test therefore detects loss of the required output repair XRUN.
