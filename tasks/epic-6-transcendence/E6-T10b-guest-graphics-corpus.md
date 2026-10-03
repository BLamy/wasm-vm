---
id: E6-T10b
epic: 6
title: Capture the current guest graphics driver and command requirements
priority: 525.02702
status: implemented
depends_on: [E6-T10a]
estimate: S
risk: medium
capstone: false
---

## Boundary

Pin the prepared Arch/Mesa/Hyprland stack and capture real reference VirGL streams
for a textured GLES scene, kmscube, glmark2-es2 and a compositor frame. Preserve
commands, versions, raw captures, hashes and opcode/shader histograms. Update the
old Alpine/ES2 assumptions using the actual guest. This slice collects a reusable
corpus; it does not advertise capabilities or claim browser desktop rendering.

## Deterministic acceptance

`make verify-E6-T10b` validates all four recorded captures, versions, complete
framing, shader extraction and reproducible histogram/digest generation.

## Adversarial verification

Independently recapture one workload and check materially missing opcode families.
Verify Mesa actually selected virgl; software fallback is a failed capture. Check
captures contain draw work, textures, fences and real shader bodies.

## Verification log

### 2026-10-03 — worker — activated

Parent `cad9e11702fb3f4b3791d6144ec9d63c01e080d8` (verified E6-T10a,
PR #403). Disposable Linux ARM64 QEMU plus pinned virglrenderer 1.3.0 can
boot the sanitized Arch image and run the actual Mesa 26.2.2 / Hyprland 0.56.2
stack through VirGL. The original ext4 is mounted read-only and a qcow2 overlay
receives all writes. The reference host uses llvmpipe; browser hardware proof
is separate. Existing exploratory debug logs are incomplete and are not this
task's framed corpus. Implementation will capture full submissions, resource
and transfer data, shader continuation framing and finite workload markers.

### 2026-10-03 — worker — implemented (UTC)

Source frozen at `2cfc3382d7ceaa572cc3bc9d835cea4166b387ca`; validator/test-only
follow-up `28d8251a` accepts the upstream kmscube quoted renderer line and tests
streamout/compute header framing. Four final captures landed in `9a1551b7`;
native recorder contract tests and worker evidence landed in
`062cd81430f52326e83a128b6cf7cb6c1e9d3f92`. Recorder and guest execution sources
are byte-identical to the frozen copies embedded in every final capture.

Commands:

- `sh tools/virgl-capture/reference.sh build` and `reference.sh start` with the
  sanitized rootfs and release kernel 6.6.63 mounted read-only; then
  `python3 tools/virgl-capture/workloads/build.py --container wasm-vm-virgl-reference`.
  Fresh Docker build and cross-build logs are in
  `evidence/virgl-corpus/worker/{reference-build,reference-start,workloads-build}.log`.
  The original reference container is `wasm-vm-virgl-reference-research`.
- For each of `textured-scene`, `kmscube`, `glmark2-es2`, `compositor`:
  `docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py --workload WORKLOAD --output /capture/final-corpus/WORKLOAD --max-blob-bytes 536870912`.
  Each manifest preserves the full actual QEMU argv/environment and guest script.
- `python3 tools/virgl-capture/validate.py evidence/virgl-corpus/captures --write --pack-blobs`.
- `make verify-E6-T10b`: 20 deterministic parser/event tests and all four complete
  captures pass. Recorded output: `evidence/virgl-corpus/worker/acceptance.log`.
- `python3 tools/virgl-capture/tests/recorder_harness.py --output evidence/virgl-corpus/worker/recorder-harness`:
  27 native cases plus a rejected readback-oracle sabotage; C builds use
  `-Wall -Wextra -Werror`. This is explicitly a fake public ABI renderer testing
  recorder forwarding/snapshot/guard behavior, not GPU or guest semantics.
  Exact commands, copied ABI/source inputs, binaries, JSONL and digests are under
  `worker/recorder-harness/`; report SHA-256
  `9569c0e6a09b723c254518e57b2f6da2292f3bea8c605650f5cc0affd2fbef75`.
- Exact frozen negative guest recordings in `worker/negative-captures/` reject
  event exhaustion, blob exhaustion and a red-to-green texture sabotage. The
  latter exits 1 with `PIXEL_MISMATCH phase=0`; none is relabeled successful.
- Pristine detached clone at `062cd81430f52326e83a128b6cf7cb6c1e9d3f92`, with
  `RUSTFLAGS`, `RUST_LOG`, `CARGO_*`, `PYTHONPATH`, `PYTHONHOME` scrubbed:
  `make verify-E6-T10b` passes and leaves a clean worktree. Commands/path/log
  digest are in `worker/cold-clone/report.json`; log SHA-256
  `8b0cebcc44ef1fdf08ec095186f5af0b3c5d31e670f4594cd71e0ca211324df0`.

| Workload | API events | DRAW_VBO commands | Unique TGSI bodies | Manifest SHA-256 |
| --- | ---: | ---: | ---: | --- |
| textured-scene | 283 | 3 | 2 | `cbe711eb1d57dbaf416d684b351ade01642eff298ecb7869b04063925466f8cf` |
| kmscube | 291 | 48 | 2 | `f336ce65bbf4827ab6b7f43d76b6be9badbc8c81a3576116095d09615dfbb77f` |
| glmark2-es2 | 5847 | 4870 | 15 | `28effba207e0c7d5679644e9a5c8d21b5ce30067a8155dfe46f92e417050c263` |
| compositor | 2707 | 2241 | 7 | `22519c071fb65af6c5556bda1c3f4304951f49b8d19141ac40658bcb2d31482c` |

The final recordings show real Mesa `1:26.2.2-1` selecting guest VirGL, not
llvmpipe guest fallback, with Hyprland `0.56.2-3` and pinned virglrenderer 1.3.0.
All four guest/QEMU runs exit zero and contain full markers, complete no-drop
footers, draw/texture/fence traffic and extracted shader bodies. The union is 33
command families and 19 unique TGSI bodies. The tiny scene independently checks
768 exact pixels; kmscube executes eight frames (six draws each, with its printed
count excluding warmup); glmark2 passes its unmodified texture oracle in an
800×600 Wayland window. Its stream also includes its Hyprland compositor, with
contexts retained for attribution. All command/backing bytes remain recoverable
from lossless gzip blobs with uncompressed SHA-256 checks. Host llvmpipe is the
reference renderer; this task does not prove browser acceleration or a complete
Omarchy session. Rust/emulator/wasm/web sources are unchanged, so their gauntlet,
browser demo and deployment gates do not apply. Recorded CRLF/trailing spaces
are preserved in hash-bound logs; new implementation source passes whitespace
checks. Fresh independent verification is still required before `verified`.
