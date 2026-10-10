---
id: E6-T11d27
epic: 6
title: Preserve original R11G11B10 floating image storage and transfers
priority: 525.027039000369
status: implemented
depends_on: [E6-T11d26]
estimate: S
risk: high
capstone: false
---

## Boundary

One explicitly selected original R11G11B10_FLOAT 2D resource owner and native transfer backend. Original VirGL format124 stores three unsigned floating fields in one four-byte pixel, with six/six/five mantissa bits and implicit alpha1. Preserve original packed upload words through actual native R11F_G11F_B10F storage and UNSIGNED_INT_10F_11F_11F_REV uploads. Public readback repacks actual native floating read words in the one charged scratch reservation; no persistent CPU image, shader evaluation or software fallback.

Qualify complete original NPOT full/truncated mip chains, bounded odd public strides and nonzero boxes, native private range copies and original storage generations across delayed PBO reads, ID destruction/reuse, cancellation/disposal and native failures. Retain exact logical/native/PBO/scratch charges and the existing ceilings. Require actual floating framebuffer support before native allocations. Historical float/byte/default owners and decoders retain their original admission and dependency boundaries.

This storage boundary grants no original sampler/surface consumer, RGB9E5, vertex, complete API, capset, guest or production authority. The original packed image consumer is an ordered successor.

## Deterministic acceptance

`make verify-E6-T11d27`

Record all original packed source words, full native floating planes, literal upload/readback packets, native objects and consumed physical fences. Independently reconstruct every finite channel from its original unsigned bit fields. Exercise normal/subnormal/zero/max finite encodings and nonfinite input safety/custody without portable undefined payload claims. Include all complete native mips and retained local copies, synchronous and staged public readback, original SG backing and untouched padding. Reconstruct packed public read words from the actual native floating values; every representation comparison has a stated contract, including permitted denormal flush.

Use varied deterministic schedules, retained old native generations, GPU-only mip mutation without CPU shadow updates, unequal public ID reuse and exact/one-byte-short budget/range/ownership cases. Real upload lane and copy-level regressions must complete a native fence and fail the unchanged original-input inverse. Cover native allocation/upload/copy/read/PBO/fence failures with complete once-only cleanup and zero terminal budgets. Record full nested V8/served/generated/source closures, carry unchanged storage/compiler evidence, and run one final pristine scrubbed frozen-head acceptance. Seal for a fresh critic.

## Adversarial verification

Predict literal field widths, native format/type, original range bytes, finite channel values, public inverse words, generation and lifetime state before observing results. Independently authenticate complete original programs/data and native fences, audit each changed nested interval, attack every acceptance boundary and add one bounded novel packed field/range/ownership experiment. Sabotage-check a promoted oracle through actual native GPU execution. The critic does not edit runtime or grant consumer/production capability.

## Verification log

### 2026-10-10 — worker — ordered prerequisite planning

D26 is independently verified at `a5085b5491f24b3c700fb7cef7b1629c2efef914`. No packed storage task is active yet. Scratch syntax, original wire/layout predictions (30 records/94 predictions), and the independent 11,950-vector public scalar inverse pass; no native packed image run has been attempted. Original format124/125 layout/view/surface probes at this verified predecessor head all refuse; the scratch preparation grants no native or guest authority. Original half-float vertex fetch was already qualified in D12 and is not repeated.

Pinned Mesa26.2.2's GLES3 predicate requires EXT_packed_float. The original format enum and Mesa YAML identify format124 as R11G11B10_FLOAT, with three unsigned floating fields and implicit alpha1. Primary Khronos references: [EXT_packed_float](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_packed_float.txt), [EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/). The storage family must be physically qualified before any production format bit is published. Finite native render rounding is not certified by this storage task.


### 2026-10-10 — worker — implementation freeze and narrow native prechecks

The explicit packed owner/backend now preserves original format124 words in native R11F_G11F_B10F storage and repacks actual native RGBA/FLOAT reads in the charged reservation. Only `resources.mjs` and the new packed format/scalar module change runtime; all other admission/compiler/guest paths remain at verified D26. Original wire/layout/hostile-data/range/one-byte transfer checks pass39 records/107 predictions. The independent11950-vector scalar inverse passed in scratch; the recorded acceptance will bind it at the frozen head. Native smoke and the bounded14-run schedule prove original partial boxes/neighbors, private ranges/generations, native-only refresh, exact/one-byte-short native read budgets and allocation/upload/copy/read/PBO/fence failures. Independent reconstruction of that precheck passes3760 native components,3772 public components,456 packed inverse bytes,4772 original native upload bytes and3326 untouched padding bytes. These are ephemeral prechecks; the full exact-head recording, one pristine clone, seal and fresh critic are still required.


### 2026-10-10 — worker — serving closure repair before final submission

The recorded packed product run at `f388827a41e0387d50cbf525141b90ca6a0d2c09` passed all54 native runs, the107 wire predictions,11950 scalar vectors and both actual post-fence sabotage inverses. The following historical async regression failed because its test server did not serve the newly imported packed module; no product/native contradiction occurred. Repair26 historical test-server source declarations to include that required module, with exact inverses proving their algorithms byte unchanged against verified D26. The repaired final source is refrozen before a complete submission; no pristine clone has yet been run.

The repaired historical async browser precheck passes on actual hardware (3051ms), with zero console/page/request errors. All26 source-declaration inverses reconstruct their exact original servers. Only proof harnesses, metadata and this log change in the repair; runtime remains byte frozen at `f388827a41e0387d50cbf525141b90ca6a0d2c09`.


### 2026-10-10 — worker — recorded original packed storage claim

Runtime remains frozen at `f388827a41e0387d50cbf525141b90ca6a0d2c09`; the final serving/harness freeze and every submitted source record is at `f8daccb922097c7fa1cd71f601395824a32277e1`. Commands: `VIRGL_PACKED_FLOAT_IMAGE_EVIDENCE_DIR=target/evidence/virgl-standard-packed-float-images-final-v2 EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc make verify-E6-T11d27`; `python3 tools/virgl-command/standard-packed-float-image-cold.py --output target/evidence/virgl-standard-packed-float-images-cold-final`; `python3 tools/virgl-command/standard-packed-float-image-seal.py target/evidence/virgl-standard-packed-float-images-final-v2 target/evidence/virgl-standard-packed-float-images-cold-final evidence/virgl-standard-packed-float-images/worker`. All exit0. The one pristine clone is `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-packed-float-image-cold-vslacjhd/wasm-vm`; before/after status is empty and its default acceptance succeeds with inherited Rust/Cargo/compiler/browser/npm configuration scrubbed.

Each complete hot/cold submission records39 original wire/layout/hostile-input records and107 held predictions,11950 independent scalar inverse vectors,12 full/truncated NPOT finite/nonfinite matrices and three14-run retained/budget/partial/native-failure schedules, plus actual upload-lane and wrong-copy-level controls. All healthy runs use headed M4 Max Metal, zero browser errors, actual original packed uploads and complete native/public planes. Independent original-bit reconstruction passes41148 native components,77086 public components,57744 native-to-public packed inverse bytes,33108 original upload bytes,19726 untouched padding bytes and3284 footprint checks. Both physical controls consume a real fence before failing the unchanged original-input inverse. Nonzero boxes retain full untouched neighbors/mips; native-only refresh does not change public backing; old generations remain tied to their native allocations across unequal reuse; exact/one-byte-short scratch/PBO budgets and native failures leave once-only object cleanup and zero terminal budgets. Nonfinite payload custody/safety grants no portable NaN pixel assertion. Disposal proves cleanup without a GPU completion claim.

All26 changed historical test-server source declarations reconstruct their exact predecessor algorithms. The affected float storage smoke and original asynchronous jobs pass with actual native execution. Full original/served/generated/source closures and all nested V8 regions remain recorded;14 complete changed-runtime script records/54 added-line samples are navigation aids, with governing nested minima left to the fresh critic. Runtime is isolated to resources and the new original packed map/scalar module; unselected decoder, renderer, compiler and production sources remain at verified D26. Unchanged D25/D26 original worker/critic seals are authenticated and carried.

Committed worker seal: `evidence/virgl-standard-packed-float-images/worker/{manifest.json,records.json,recording.tar.gz}`, 3168 full indexed members /3580618 compressed bytes. Archive SHA256 `a20c525b93d18e0b1db07cb17a462e253c6b4616b108417fa2173fc784bb7329`; index `543bf6fea1a1b91b35ea37b3d52ff8cc665066654a9829df0fa83b37e16c02fa`; hot receipt `6adae3ad8a8f36abeb618c1b4fabc62b2a2e7ae59beca21d6d4275508aa346d3`; cold report `3de39e154710953a5b4d2336cf5326fb2a547cbf264a8b2754d8a62472f84e31`; cold receipt `bb61747b2d47a0f6f6e2601b3421b5cd995408ab22306bd486f0c2d0eabc7084`. The recording demonstrates the selected original R11G11B10 storage/transfer/range boundary. Original packed sampler/surface consumption, RGB9E5, complete API/capsets, guest execution and production graphics remain unqualified. A fresh critic must determine the verdict.
