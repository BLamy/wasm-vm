---
id: E6-T10b
epic: 6
title: Capture the current guest graphics driver and command requirements
priority: 525.02702
status: verified
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

### 2026-10-03 — fresh verifier — VERDICT: verified (UTC)

Verified worker claim `84563e8a441330b02ed7b9bfec468387a6a35a97` against
`cad9e117`, with verifier evidence and promoted tests in
`5b211b216d8a16464ca5aa1d213ecd2bd6a0f93d`. This verifier did not implement the
task. Predictions P1–P8 were recorded before inspecting the captures; a separate
read-only helper independently parsed the raw bytes without importing the
production validator. Interim binary-provenance and client-renderer findings
were fixed before final evidence and their repaired boundaries were attacked
again below.

- **P1 provenance and real guest driver — HELD.** Predicted all four finite
  workloads use the pinned actual guest and select VirGL. Package logs contain
  Mesa `1:26.2.2-1` and Hyprland `0.56.2-3`; renderer citations are
  `captures/textured-scene/workload.log:5`, `kmscube/workload.log:13`,
  `glmark2-es2/workload.log:6`, and `compositor/hyprland.log:204`. All exact
  guest BEGIN/END markers and zero process exits hold. Manifest digests match
  the worker table. The fresh reference build independently reproduces all six
  input hashes, including host renderer `2ba77dd6f0493c8caa4a9e92746bb94c4381d09f1244fd671e82b01c27c28a52`.
  Host llvmpipe is intentional; the guest reports VirGL and GLES 3.2.
- **P2 complete raw framing — HELD.** Predicted byte-zero-to-EOF command
  consumption, contiguous events, balanced API calls, and complete resource
  backing. The independent parser checked all 85 manifest-referenced
  artifact/event files and 500 per-capture unique blobs. Complete footers occur
  at `events.jsonl` lines 283 / 291 / 5847 / 2707, respectively. No prefix,
  command tail, API return, or required pre-submit backing snapshot is missing.
  Full event digests and first-event/command-offset citations are in
  `verifier/independent-raw-audit.json`; `independent_raw_audit.py` reproduces it.
- **P3 deterministic derived outputs — HELD.** Predicted all histogram,
  submission, shader, resource and capset data recompute exactly. All 14
  independently derived summary fields match. Final `make verify-E6-T10b` at
  `5b211b21`, with Rust/Cargo/Python override variables scrubbed, passes 21 tests
  and all four captures. `verifier/acceptance-report.json` records the command
  and log SHA-256 `0c07b7023237960369d8f0286dfaa974aa1e21638968831fe619855677475f56`.
  The worker's unchanged-source pristine-clone result is carried forward.
- **P4 real shader bodies and continuation framing — HELD.** Predicted exact
  declared shader lengths, stage headers, terminal NUL and instruction bodies.
  Every extracted shader matches its raw CREATE_OBJECT bytes. Actual captures
  contain only VERT/FRAG, uncontinued, zero-streamout shaders; compute and
  streamout framing are covered by deterministic parser tests. A genuine
  shader at textured-scene event 161, command byte 4420, blob
  `364452bac8463817df9b95ae07be7203ec8411bd6be08ab43029f7c69be028cc`
  was split into valid continuation packets and retained both original shader
  bodies. This is parser evidence, not a claim that these guests emitted a
  continued or compute shader.
- **P5 workload substance and attribution — HELD.** Predicted actual draw,
  texture, fence and shader work. The textured scene records three draws and
  768 exact pixel checks (`workload.log:6–9`). kmscube records six face draws in
  each of eight frame submissions (events 176, 187, 198, 209, 220, 231, 242,
  253). glmark2's own context 7 is created at event 3010 and performs a textured
  draw at event 4569, byte 6676 of blob
  `df08a0b38bcd8c9435c51236c521557d587c27a14edde4dcc3482453cc1fddfc`;
  the sampler view is bound at byte 5988, with its real vertex/fragment shaders.
  Its independent pixel oracle passes at `workload.log:11`. The other 4869
  draws are Hyprland context 5; complex extra shaders belong to Xwayland context
  6. `verifier/context-detail.jsonl` preserves attribution. All workloads have
  fence completions. The corpus union is 33 command families and 37 TGSI
  instruction names; no universal command or shader coverage is claimed.
- **P6 independent recapture — HELD.** Ran
  `VIRGL_REFERENCE_CONTAINER=wasm-vm-virgl-reference sh tools/virgl-capture/reference.sh capture textured-scene /capture/verifier-textured-scene`
  in the separately rebuilt container, then copied the directory and ran
  `python3 tools/virgl-capture/validate.py evidence/virgl-corpus/verifier/textured-scene --write --pack-blobs`.
  Manifest `64535efc5435d14960d5fc59426bf6480a22be1929882b0c6b78c88573cb493b`
  records success and 347 events. All 32 opcode families and their counts,
  object counts, both shader hashes and instruction histograms exactly match
  the worker. Additional transfer writes (47 versus 26) explain the API-event
  difference without a missing graphics family. Full comparison and input
  hashes are in `verifier/recapture-comparison.json`.
- **P7 bounded novel attacks — HELD.** After repairing outer event/blob hashes
  and footer totals, changed the real shader's continuation offset from 16 to
  12: rejected as `shader continuation offset gap/overlap`. A changed workload
  executable with a repaired artifact hash is rejected against its build
  digest. Changing glmark2's own renderer to llvmpipe while preserving the
  compositor's VirGL log is rejected. `verifier/attack-results.json` records
  exact mutation digests; `attack_captures.py` reproduces all four positive and
  negative cases. The real guest texture sabotage also fails at phase 0 with
  actual green versus expected red, as predicted.
- **P8 changed-hunk coverage — HELD within the declared boundary.** Recorder
  initialization, names, resources, backing, capsets, submissions, transfers and
  fences are exercised in the real corpus. Its remaining API forwarding,
  explicit/attached IOV, reset/cleanup, callback-version, 64-bit fence and bounded
  rejection branches are exercised by the 27-case native fake-ABI harness.
  Verified all eight input hashes and 118 artifact hashes. At harness happy
  events 19 and 23, readback bytes are literal `readAFT0` with [4,4] and [3,5]
  IOV partitions (blob `4e6989573df0f49ee52a63b5202cac9f0b760cbb223368e3cdd7b5633b4670d7`).
  `verifier/harness-audit.json` records this independent check. This harness
  proves recorder behavior only. Four guest cases plus negative captures cover
  the runner; native fresh builds cover Docker/reference/workload recipes;
  unit tests, real files and repaired-hash attacks cover parser branches.
  WAIVED: static declarations, pins, licenses, documentation and logging/error
  reporting for unforced OS allocation/disk failures. Arbitrary concurrent
  embedding, hostile host pointers and cleanup/reinitialization reuse remain
  outside the explicitly scoped serialized QEMU recorder. No Rust, emulator,
  wasm or browser implementation changed; their gates are inapplicable.
- **SUITE.** Retained the four golden real captures, fresh recapture and
  independent raw/binding audit scripts. Promoted the repaired-hash shader,
  executable and client-fallback attacks as
  `tools/virgl-capture/tests/test_corpus_verifier.py`, exercised by the permanent
  `make verify-E6-T10b` target. No unresolved refutation or proof gap remains
  for this corpus-collection task.

All evidence paths above are relative to `evidence/virgl-corpus/` unless an
explicit repository path is given. Source/capture digests are unchanged across
the final verifier test promotion and this log/status-only commit.
