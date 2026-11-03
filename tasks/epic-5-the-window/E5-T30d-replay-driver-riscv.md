---
id: E5-T30d
epic: 5
title: Attach the real RISC-V Replay driver and validate genuine recordings
priority: 0.3814
status: implemented
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

### 2026-11-03 — worker — genuine recording and native reader submission

Claim: the complete genuine RISC-V driver records the real Chromium renderer in
the labelled QEMU reference, and Replay's production recording reader consumes
those bytes on wasm-vm's CPU. Full backend instruction re-execution and a usable
Chromium GUI in wasm-vm remain separate T29b/T29c claims.

Driver source: `a2562ea831c1ace189e479d49988b43003ce7dc4`; runtime changes
introduced at `bb99a13308b0d0f974498321daa53f4cb24d1be7`. Final harness:
`a92baa30e5a11da8ad1806cfdad3c18562935f75`. All private source and proofs live
below `local/chromium-riscv64/driver/`, with Replay pushes disabled. The final
separate clean checkout is `recording-cold-transport`; no local object sharing.

Final command (from the wasm-vm root):

```
python3 local/chromium-riscv64/driver/recording-cold-transport/test/cpp/verify-riscv64-recording.py --vm-root /Users/blamy/Documents/Codex/wasm-vm --reuse-components local/chromium-riscv64/driver/recording-final-transport/components --output local/chromium-riscv64/driver/recording-final-framing
```

The complete driver built with fatal warnings. Platform/LP64D/ELF fixtures ran
with seeds 17/98173/42991 on QEMU and native wasm-vm. The new syscall test modifies
real executable code and invokes intercepted cache-flush syscall 259, proving new
instructions execute and no recorded-call bytes are added. Invalid-flag results
are compared with the original kernel syscall; an unrelated unknown syscall
still fails in the real interceptor. Native component run: 1,430,470,712 retired,
`Exited(0)`, state
`d802c5e23b357e82b4e31eb52050e79ab26f7b3dc44bf82f39e0fdbc194dbd47`.
After serial-harness corrections, the qualifier carried forward that exact clean
proof only after checking unchanged runtime/header/fixture trees, VM input hashes
and every prior evidence digest. The driver retains its real build metadata,
`linker-linux-16521-a2562ea831c1`; no runtime fix was applied mid-pipeline.

With recording enabled and the real runtime assets installed, the reference
browser ran a real timer and trusted mouse click and finished normally. Its
2,737,518-byte recording has SHA-256
`da708a459715513d6c010aec83f2f2609f4dd3223910ca4e8c1532df9b31228c`.
Replay's unchanged production chunk-reader body consumed all 1,807 chunks, 641
streams, 23 checkpoints, 7,856 calls and 84,237 contiguous assertions. It matched
all three observed random values and timestamps plus the complete dynamic DOM
result, including the trusted click. The real driver emitted `writeFinished`.
Wrong magic/build ID, truncation, oversize/corrupt chunks, dropped data and a
contradictory observation were rejected. The authenticated transfer digest also
rejects a syntactically valid reorder; the format has no global checksum, and
structural parsing alone is not claimed to prove all semantic corruption absent.

The same genuine reader and recording then ran on native wasm-vm: 4,507,674,685
retired, `Exited(0)`, state
`800554d88d19c97c51f9c6e17e676eef57ded7690c2df1bfc5f54bb646f9a25b`.
Its complete decoded JSON matched the reference byte for byte, SHA-256
`3078bdf0e79d55f65696a30fe38820f17c1dfbc71440f58a1259150cc7eb1add`.
Both native evidence files explicitly state `jit-retired-counter-only`; no full
instruction-trace claim is made. Diagnostic crash-architecture metadata is waived
for happy-run coverage; a retained negative attach probe exercised riscv64 reports
before the freeze. The unused GUI configuration is outside this claim.

Paths below are relative to `local/chromium-riscv64/driver/recording-final-framing/`:

- `report.json`: `586c45941242b9ccdbdef92a3e37fbce6641600c821badcd497cf0d0d4d98094`.
- `components/report.json`: `396529ecab76dc05f32046430e6ba92aa2710f9d8e0fe87eb8162a6d61695877`.
- Driver binary: `37edf0c99fdb69f541013b0c962577bd23cfe86a4be55136998f0e8c5bcfcbd5`.
- `native-reader-evidence.json`: `f4ccdf41dd5f8c1810b12782c2ac318386c9fca5581a0bd0ed0ffef9b10c48d0`.
- `native-reader.log`: `dbb3b976a65fa46d29b08e5be6397073df7d527572fc3e2ed7c78d7e584549f5`.

Full private source, binaries, recordings, decoded streams, negative probes and
serial transcripts remain local. Public changes contain task/evidence metadata
only. No emulator semantic change, browser-source change, private upload, Replay
push/PR, GitHub Actions, or merge is part of this submission.
