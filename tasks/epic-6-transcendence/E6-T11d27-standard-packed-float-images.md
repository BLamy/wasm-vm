---
id: E6-T11d27
epic: 6
title: Preserve original R11G11B10 floating image storage and transfers
priority: 525.027039000369
status: pending
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
