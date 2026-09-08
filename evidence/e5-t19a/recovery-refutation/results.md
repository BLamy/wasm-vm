VERDICT: refuted — E5-T19a control contract; task status intentionally unchanged pending coordinator lane transition.

## Findings

- **P1 Linux ordering — HELD.** In bundled Linux 6.6.63, ALSA STOP calls the virtio trigger and sets `stop_operating` (`sound/core/pcm_native.c:1502-1508`); prepare calls `snd_pcm_sync_stop` before the driver prepare (`:1952-1957`). The virtio driver sends STOP (`sound/virtio/virtio_pcm_ops.c:358-371`), RELEASE from `sync_stop` (`:387-427`), then PREPARE without SET_PARAMS for a non-suspended stream (`:270-308`). BAD_MSG falls through to `-EINVAL` (`sound/virtio/virtio_ctl_msg.c:191-203`).
- **P2 wire reproduction — HELD / refutation reproduced.** The exact focused test proved 960 frames/3,840 bytes of bit-exact PCM, completed two TX entries, delivered one real XRUN event, and observed zero pending playback. STOP and RELEASE were OK. The next real controlq PREPARE completed with `0x8001` rather than `0x8000`; state was `Released`, parameters were `None`, and the assertion failed at `desktop_machine_audio_resume.rs:877`. Evidence: `hooke-native-reproduction.log`, SHA-256 `516bf50cd8e9bf9500d8ede7a8909f7bcba73faa969361b7a19d65189d862dcf`.
- **P3 T19a contract — FAILED.** [VirtIO 1.3 section 5.14.6.6.1](https://docs.oasis-open.org/virtio/virtio/v1.3/virtio-v1.3.html) explicitly permits PREPARE after RELEASE. The runtime instead marks Released/PREPARE BAD_MSG at `crates/core/src/dev/virtio/snd/mod.rs:1004-1012`, and successful RELEASE erases parameters at `:1133-1143`. This directly contradicts T19a's acceptance requirement that its exhaustive oracle match the documented lifecycle table. It is unrelated to H's already-verified queue ordering.
- **P4 oracle independence — FAILED.** The same specification permits repeated SET_PARAMS after SET_PARAMS, and SET_PARAMS or PREPARE after PREPARE. Runtime cells at `mod.rs:1013-1028` reject all three. The original “exhaustive” test duplicates those runtime expectations at `crates/core/tests/virtio_snd.rs:68-108`, then compares the implementation with its own exported constant at `:110-120`; consequently it still passes while four specification-valid cells are wrong. Evidence: `original-oracle-self-confirmation.log`, SHA-256 `5565601582e9af683f818cf8ebad44a0048a59af6761e69b8da9d85ef8e819d3`.
- **P5 smallest remedy boundary.** Reopen only T19a's PCM control-state contract and independent oracle. Preserve negotiated configuration independently from RELEASE resource teardown—or distinguish initial unconfigured state from post-RELEASE configured state—so Linux's RELEASE → PREPARE recovery succeeds. Accept and atomically validate the other documented repeated SET_PARAMS/PREPARE cells. Preserve RELEASE's pending-I/O completion rule, malformed-request non-mutation, queue numbering/restoration, XRUN transport, playback pacing, and all unrelated H behavior.
- **P6 regression disposition — HELD.** Hooke's appended test is a sufficient permanent wire-level regression: it uses the real control, event, and TX virtqueues; proves actual sink bytes before XRUN; proves the event and pending state; and captures the disputed response directly. Its hunk was preserved unchanged. No additional test was promoted in this review.

## Reproduction

```text
cargo test -p wasm-vm-core --test desktop_machine_audio_resume linux_6_6_63_xrun_stop_release_prepare_recovers_without_set_params -- --nocapture
# FAILED as predicted: left 32769 (BAD_MSG), right 32768 (OK)

cargo test -p wasm-vm-core --test virtio_snd exhaustive_six_request_five_state_oracle_is_stable -- --nocapture
# PASSED, demonstrating the existing duplicated oracle does not detect the specification mismatch
```

Predictions: `predictions.md`, SHA-256 `efe1c3c07366121111409a9e72c10e5e2fcebf13d797744f63610afe1291e353`.

Bundled Linux source identity: archive SHA-256 `d1054ab4803413efe2850f50f1a84349c091631ec50a1cf9e891d1b1f9061835`; extracted `pcm_native.c` `60e6667eada6e3dc8f5c634572397426109d495174418cef5f9d0d0ca6df3972`, `virtio_pcm_ops.c` `4c56dde3c59339f4173e3496d215f41e04be077ba4147f92570b87475f1be014`, and `virtio_ctl_msg.c` `4fb72bcb73abebf71c892218c8dcc3c68e7f58895b82c843c8feb60db63775f9`.
