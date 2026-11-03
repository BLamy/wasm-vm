---
id: E5-T30d
epic: 5
title: Attach the real RISC-V Replay driver and validate genuine recordings
priority: 0.3814
status: in-progress
depends_on: [E5-T30c]
estimate: S
risk: high
capstone: false
---

## Boundary and acceptance

Build the complete genuine driver with real build metadata, load it into the real
RISC-V Chromium recording process, and validate actual recording output with
Replay's own implementation. This qualifies the driver/reference path; T29b must
still prove the same recording behavior on wasm-vm's CPU.

Acceptance: `python3 local/chromium-riscv64/driver/verify-recording.py`.

Unset RECORD_REPLAY_DONT_RECORD, use a nonempty RISC-V driver, require actual
RecordReplayAttach/recorded execution, known JS/time/random/input events, complete
usable recording data, and the real recording reader/replay path. No success
marker or file-existence-only substitute. Use the upstream recording-mode launch
policy deliberately; ordinary-browsing sandbox pre-checks are a separate claim.
Run the scoped full driver/target suite, repeated deterministic fixtures, threat
cases and final exact-head pristine private clone; bind binary/source/recording
and consumed replay output digests. A QEMU reference is labelled as such.

Fresh high-risk critic challenges dropped/reordered data, unavailable hooks,
invalid/incomplete recordings, wrong architecture/build IDs, real replay results
and a bounded novel corruption case. Sabotage the recording acceptance once.
Keep all private implementation, recording data, binaries and full proofs local;
no Replay pushes/PRs or public asset upload.

## Verification log

### 2026-11-03 — worker — activation

E5-T30c is independently verified at `7d81112d1471e2b78bedaf65feb9bf87413a1072`.
The private driver platform, call bridges and ELF hooks have native wasm-vm
component proof. Begin actual Chromium renderer attachment and recording with
the genuine nonempty RISC-V driver, first in the labelled QEMU reference, followed
by the authoritative wasm-vm integration. No Replay PRs/pushes or private uploads.
