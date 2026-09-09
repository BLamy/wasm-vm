# E5-T26h worker submission: sound queue identity and explicit layout compatibility

Implementation head: `e8850241b686fd497c4ff1589fd31b6ffd0c7cc4`.
This is a worker claim for fresh verification, not a verifier verdict or browser claim.

## Frozen-source identity

The selected gates ran after source edits were frozen, before the coordinator's commit.
After the coordinator committed the source, the three file hashes were checked again and
matched the pre-gate hashes exactly. No gate was repeated solely for commit metadata.

| File | SHA-256 |
| --- | --- |
| `crates/core/src/lib.rs` | `eb54ec562944d8e12133e9b6d52401bc8bed7cd316828d13ea74da365587f39d` |
| `crates/core/tests/desktop_machine_audio_resume.rs` | `1a2fb0343f1b09429dbab00cab67181cb146c3acf2bc7991adb3a670ae7794dc` |
| `Makefile` | `6ac1c8207232d72a0ebc7491e971210ecb6b69fd9b600487661f086205b1091e` |

The original promoted verifier fixture is unchanged:
`crates/core/tests/desktop_machine_resume_verifier.rs`, SHA-256
`3bce55401cc6827c6ab3909d3bc68bfa7e65351ac15dfedd54521b059f43d474`.

## Runtime correction

- `crates/core/src/lib.rs:2763` now emits sound cursor entries in actual transport order:
  control=0, event=1, TX=2, RX=3. The Rust Machine tuple still places RX before TX; its field order
  no longer defines the serialized order.
- `crates/core/src/lib.rs:3052` assigns rebuilt queue 2 to TX and queue 3 to RX. The host clock,
  sink and capture source tuple members remain untouched.
- Consequently an unconfigured RX queue no longer invalidates a valid saved playback cursor,
  and a configured RX queue no longer causes TX service to rebuild a mismatched view at cursor
  zero and replay old PCM.

## Compatibility decision

The old sound cursor encoding was unversioned and ambiguous when both queue configs were ready.
It is not silently migrated or reinterpreted. A sound-section-local layout word is now required:
little-endian `u32 = 2`, immediately after the 277-byte transport and four five-byte cursor
entries (section payload offset 297), before the unchanged standalone sound codec.

`crates/core/src/lib.rs:187,212,2766` define, validate and emit that layout word. The existing
detached preflight rejects missing/unversioned, truncated, or unknown layout words with
`SnapshotError::BadComponentState { tag: 16 }`, before any live machine/desktop commit.

Container format version remains 1. Headless snapshots and other unchanged section layouts
remain compatible. Standalone sound snapshots and desktop envelopes keep their existing
formats. Old whole-machine snapshots containing the unversioned sound section are intentionally
rejected, even if their queues happened to be inactive. Integration must create a new snapshot
with the fixed build; no claim of compatibility with those broken saved sound sections is made.

## Native PCM and rejection evidence

The four Daybreak-reviewed PCM fixture bodies were retained without weakening their assertions:

- `strict_fresh_machine_pcm_sink_after_whole_machine_resume`
- `fresh_pcm_sink_after_whole_machine_and_desktop_envelope_restore`
- `configured_unused_rx_preserves_tx_cursor_and_fresh_pcm`
- `configured_unused_rx_preserves_pcm_through_desktop_envelope_too`

All 32 combinations pass: 480/2048-frame S16 stereo periods at 48 kHz; source clock zero or
3,600,000,000,000 ns; stopped/released source streams; configured/unconfigured unused RX;
whole-machine-only or subsequent desktop-envelope restore. Each source first completes actual
PCM and an actual XRUN event through the MMIO rings. Targets begin with distinct CPU/RAM
sentinels, no configured rings/resources/stream parameters/consumed descriptors, and distinct
fresh WavSink and ManualAudioClock instances.

After restore, Linux-order TX-before-START needs no second TX kick. Exactly the new seed-1701
samples reach the fresh WAV at the deadline, not the old seed-73 samples. TX/event used indices
advance from 1 to 2, the new TX status is OK (0x8000), latency is zero, and repeated service does
not duplicate completions or sink output. The old sink's byte count stays unchanged. Fresh
clock zero remains zero across restore, including with the high source clock.

Two additional tests pass:

- `old_or_unknown_sound_resume_layout_is_rejected_before_live_mutation` reconstructs the actual
  old unversioned RX/TX encoding with both queues configured, tests four unknown versions and
  four truncated markers, and checks all nine refusals leave the entire target snapshot,
  sound handle, fresh sink and fresh clock unchanged.
- `sound_layout_version_does_not_invalidate_container_v1_headless_resume` proves explicit
  container-v1 headless load and guest continuation still work.

Native WAV outputs are under `target/desktop-machine-audio-resume/`. One representative
desktop-envelope, configured-RX, 480-frame, high-source-clock, released-stream pair:

- `envelope-true-rx-true-frames-480-clock-3600000000000-released-true-source.wav`:
  SHA-256 `f369083051a2f5b9ed2faf1f8c15286e91d63e9b11b7f0cded9c76fce141d704`.
- `envelope-true-rx-true-frames-480-clock-3600000000000-released-true-fresh.wav`:
  SHA-256 `f05ff377271106595e1d35271cd9918fa63e5c29b08f70ca8594dcfca86969d7`.

## Recorded selected gates

`make verify-E5-T26h` — exit 0, 125 test executions, zero failures/ignored tests. The Makefile
target now includes `desktop_machine_audio_resume`. Its exact component commands are:

```sh
cargo fmt --check -p wasm-vm-core
cargo clippy -p wasm-vm-core --lib --tests --features gpu-trace -- -D warnings
cargo test -p wasm-vm-core --features gpu-trace --test desktop_machine_resume --test desktop_machine_resume_verifier --test desktop_machine_audio_resume --test cpu_resume --test snapshot_coherence --test virtio_blk_quiesce --test virtio_console --test desktop_snapshot_save -- --nocapture
cargo test -p wasm-vm-core --lib --features gpu-trace resume
cargo test -p wasm-vm-core --lib --features gpu-trace snapshot
cargo test -p wasm-vm-core --lib --features gpu-trace desktop_restore
cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown
cargo check -p wasm-vm-wasm --lib --target wasm32-unknown-unknown
```

Record: `evidence/e5-t26h/worker-audio-queue-order/gates.log`, SHA-256
`7b7aba1be129f036c2ffbfc4e5428dc3ed566497d0d8820fea73e045bdec2820`.
The existing desktop guest continuation digest remains `9865e79b681ad970`, retired=1.

Additional affected sound regressions — exit 0, 21 tests (9 capture, 4 machine, 8 playback):

```sh
cargo test -p wasm-vm-core --features gpu-trace --test virtio_snd_machine --test virtio_snd_playback --test virtio_snd_capture
```

Record: `evidence/e5-t26h/worker-audio-queue-order/related-sound-tests.log`, SHA-256
`449388e12b8fa769f739cf77d26d35744fb0910c76173deee448a06e35d09979`.
The scoped `git diff --check` also passed before the coordinator committed.

## Carry-forward and limits

Prior console session fencing/old-HELLO exclusion, control/serial continuity, GPU state,
input releases, CPU/RAM continuation, atomic refusal, topology/coherence checks, sparse parsing,
and headless results remain unchanged; their selected regression groups pass. The prior
clean-environment result is carried forward per the incremental policy; fresh verification is
the coordinator/Daybreak responsibility, not this worker's verdict.

No browser, web/pkg/dist build, deployment, PR, app task, lifecycle/status edit, or commit was
performed by this worker. No unrelated source files were changed. Native sound queue identity
and fresh-sink delivery are now proven by these tests; the browser's complete zero-SAB symptom
and F performance/interaction requirements still require the coordinator's browser proof.
