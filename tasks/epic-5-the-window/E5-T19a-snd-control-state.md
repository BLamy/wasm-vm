---
id: E5-T19a
epic: 5
title: virtio-snd control protocol and PCM state machine
priority: 519.1
status: in-progress
depends_on: [E5-T05c]
estimate: S
risk: high
capstone: false
---

## Goal

Define the guest-visible virtio-snd control contract and make one playback stream's legal
transitions explicit before any host audio timing or browser sink exists.

## Deliverables

- `crates/core/src/dev/virtio/snd/mod.rs` control-plane skeleton for virtio device ID 25.
- Deterministic JACK_INFO, PCM_INFO, and CHMAP_INFO responses for one stereo S16 output stream.
- An explicit PCM transition table matching Virtio 1.3 §5.14.6.6.1, including repeated
  SET_PARAMS/PREPARE and RELEASE → PREPARE with retained negotiated parameters. Its independent
  oracle covers every request/state cell and distinguishes never-configured power-on state.
- Validation for format, rate, channels, buffer size, period size, and stream ID.

## Acceptance criteria

- [ ] The exhaustive native oracle covers all six control requests across all five stream states and
      matches the documented OK/BAD_MSG table exactly.
- [ ] Config responses advertise one output jack, FL/FR, S16, stereo, and only 44.1 kHz/48 kHz;
      unsupported selectors and malformed requests return deterministic errors.
- [ ] `SET_PARAMS` at 96 kHz returns `VIRTIO_SND_S_BAD_MSG` while a subsequent legal setup remains
      usable.

## Verification command

`make verify-E5-T19a`

## Adversarial verification

Permute control requests and selectors, repeat SET_PARAMS with boundary-sized buffers, and inject
unknown stream IDs or truncated payloads. The oracle must show no illegal transition, panic, or
state mutation after a rejected request. Reproduce real Linux STOP → RELEASE → PREPARE
recovery followed by new exact PCM. Check configured-release snapshot roundtrip, reset losing
configuration, invalid retained configuration refusal, and repeated SET_PARAMS/PREPARE without
leaking pending I/O. Run independent schedules, one bounded novel attack, one effective
sabotage, and one scrubbed exact-head local clean clone for the high-risk remediation.

## Verification log

### 2026-09-07 — fresh Daybreak Blue verifier — VERDICT: refuted

The independent report `evidence/e5-t19a/recovery-refutation/results.md` (SHA-256
`b8e08e9f06e8a8ea65fe51f2c5916c05c0bde64b373d4d924c86bd1968464ca1`) refutes this
control contract, not the held E5-T26h queue-order fix. At runtime source SHA-256
`b4665f3c335e1d0806981236338a5507bc8712112051dc530318220dca16fa23`, the real-queue
native recording proves exact 960-frame playback and an XRUN, then STOP/RELEASE OK
followed by PREPARE `0x8001` (BAD_MSG, Linux `-EINVAL`), with parameters discarded.
Repro: `cargo test -p wasm-vm-core --test desktop_machine_audio_resume
linux_6_6_63_xrun_stop_release_prepare_recovers_without_set_params -- --nocapture`.
The same specification permits three repeated SET_PARAMS/PREPARE cells that the
original self-confirming table rejected. Correct this one control-state boundary,
retain pending-I/O release ordering, and prove configured-release state also survives
the existing sound codec without admitting invalid or never-configured streams.
Raise the remediation to high risk because it changes guest control semantics and
persisted configuration. E5-T26f is blocked until a fresh critic accepts the remedy.

### 2026-09-03 — worker — IMPLEMENTED

- Commits: `411ac609038dfad39c8f3ad754ca445634314bfd` (implementation) and `ae3d641` (shared-constructor coverage).
- Commands: `cargo fmt --all -- --check`; `cargo test -p wasm-vm-core --test virtio_snd -- --nocapture`; `cargo test -p wasm-vm-core --lib --quiet`; `cargo clippy -p wasm-vm-core --all-targets -- -D warnings`; `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release`; `git diff --check`.
- Results: focused control-plane suite 6/6 passed; core library 238/238 passed; clippy and the release wasm build passed.
- Evidence: [`snd-control-native-2026-09-03.txt`](../../evidence/e5-t19a/snd-control-native-2026-09-03.txt), SHA-256 `ed52f518d2aa366ff76ff7912c555f00e495021903c180d8d29d58a2c3d4ca7f`.

The recorded native run exercises the exact JACK_INFO, PCM_INFO, and CHMAP_INFO wire payloads,
the five-state/six-request oracle, malformed and unsupported control requests, queue/reset
markers, parameter-boundary rejection including 96 kHz, and a legal prepare/start/stop/resume/
release sequence. The independent byte fixtures and state assertions show that rejected requests
do not mutate the stream, while the accepted setup remains usable.

### 2026-09-03 — verifier — VERDICT: verified

- Predictions: every oracle cell remains exact; malformed, truncated, unsupported, invalid-boundary,
  and unknown-stream requests return errors without mutation; the legal lifecycle remains usable.
- Observed: the optimized focused suite passed 6/6, and 25 consecutive debug invocations passed
  6/6 each with no panic or failure. The run covers every changed runtime branch, including the
  shared constructor, queue/reset markers, exact info payloads, validation, and lifecycle paths.
- Evidence: [`snd-control-verifier-2026-09-03.txt`](../../evidence/e5-t19a/snd-control-verifier-2026-09-03.txt), SHA-256 `4362b5a2c684802d38c39ef8605e0a555789d85017a3fdfee397fb5787aa3456`.
- Findings: none. The task is verified.
