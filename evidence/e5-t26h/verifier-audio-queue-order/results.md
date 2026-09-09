# E5-T26h late sound-queue refutation

VERDICT: refuted

Review target: H runtime `2325c05f756f9a9746099051db9ab46866b874e8`. The current
`crates/core/src/lib.rs` and `crates/core/src/dev/virtio/snd/mod.rs` are byte-identical to that
frozen target (SHA-256 respectively
`baf963e202847e997fe02afdea53ad5914afc413ee48231f13e95dba97ade3ee` and
`b4665f3c335e1d0806981236338a5507bc8712112051dc530318220dca16fa23`).

## Prediction and observation

- **Sound queue identity — FAILED.** Predicted the sound resume prefix would associate each
  preserved service cursor with the same virtio queue index, so an unconfigured optional RX queue
  would not invalidate playback and a configured RX queue could not receive the TX cursor.
  Virtio-snd defines `TX_QUEUE = 2` and `RX_QUEUE = 3`
  (`crates/core/src/dev/virtio/snd/mod.rs:28-31`), but `save_resume` appends service metadata as
  `[controlq, eventq, rxq, txq]` (`crates/core/src/lib.rs:2746-2754`). The shared parser and queue
  builder interpret tuple ordinal as transport queue index 0..3
  (`crates/core/src/lib.rs:183-228`), then the sound restore assigns those rebuilt queues back as
  control/event/RX/TX (`crates/core/src/lib.rs:3017-3041`). Thus TX metadata is validated and
  rebuilt against queue 3, while RX metadata is tied to queue 2.
- **Unconfigured RX manifestation — FAILED.** In both whole-machine-only and desktop-envelope
  variants, the source configured real control/event/TX queues but no RX queue. `load_resume`
  rejected every matrix case as `BadComponentState { tag: 16 }` at fixture line 526. Citation:
  `native-audio-resume.log:14-19,37-41,145-175`.
- **Configured RX manifestation — FAILED.** Configuring the otherwise-unused RX queue lets restore
  proceed but misbuilds the live playback queue. At the fresh deadline the expected seed-1701 PCM
  starts `[165, 6, 91, 249, ...]`; the fresh sink instead receives old seed-73 bytes
  `[73, 0, 183, 255, ...]`, reports `queued=2`, leaves used index at `1`, and leaves the fresh
  status word at `0xffffffff`. Citation: `native-audio-resume.log:24-31` and repeated frame-size,
  clock, release-state, and desktop-envelope variants through lines 200-245.
- **Fixture sufficiency — HELD.** The four tests use the production MMIO queue programming,
  lifecycle requests, whole-machine save/load, real fresh `WavSink`, distinct fresh clock/sink,
  nonzero saved control/TX/event cursors, and fresh TX descriptors. They cover with/without the
  desktop envelope and with/without configured RX, across 480/2048 frames, zero/high source clock,
  and stopped/released states. Source fixture SHA-256:
  `915368af7e7f611655e7441f27a21a71a9eefc5a8c83012ec3a4b5bfe9d41009`.

Command:

```text
cargo test -p wasm-vm-core --test desktop_machine_audio_resume -- --nocapture
```

Result: exit 101; 0 passed, 4 failed, 0 ignored. Recorded output SHA-256:
`c80f4272d49e8660566bce2fe025e4401c395100d0e7cccd49b2887f6bf2f36e`.

## Scope and demand

Withdraw only the previous sound queue/cursor HELD result. Prior console session fencing,
old-HELLO exclusion, serial/control continuity, CPU/RAM continuation, input reconciliation,
GPU state, corruption/topology refusal, atomicity, sparse parsing, headless compatibility, and
clean-environment results remain HELD because their code and dependency boundaries are unchanged.

Required remediation: preserve sound service metadata in actual queue-index order
control/event/TX/RX (or perform an explicit equivalent mapping on both encode and decode), while
preserving the fresh host sink/clock. The four-test fixture must then show no restore refusal when
RX is absent, no replay of old PCM, exact fresh PCM in the fresh sink, and fresh TX used/status
completion at ordinal 2. E5-T26f remains blocked until this H boundary is reverified.
