---
id: E6-T11d31
epic: 6
title: Preserve original signed and unsigned integer color image storage
status: in-progress
estimate: S
risk: high
priority: 525.027039000373
depends_on: [E6-T11d30]
capstone: false
---

## Goal

Add an explicitly selected original integer color store, transfer layout and native
WebGL2 backend for original formats177..200 (R/RG/RGB/RGBA, 8/16/32-bit UINT/SINT).
The current selected shared-exponent profile rejects these layouts before allocation.
Preserve every historical constructor, owner protocol, resource/cache/transfer ceiling,
shader compiler, decoder, draw executor, generated compiler and production capset.
The subsequent compiler and consumer boundaries must be independently qualified.

## Acceptance criteria

- `make verify-E6-T11d31` is the one deterministic acceptance command. Preserve exact
  source/generated identities, original metadata/bytes and every native/public plane,
  caller state, object retirement, physical completion and full nested V8 source/ranges.
- Original integer formats are admitted only by the new explicitly selected layout,
  owner and matching native backend; every old owner/layout still refuses. Metadata,
  limits, backing, inline fields, configuration, roles, levels and attachment mutations
  remain checked without invoking accessors or accepting new targets/flags/samples.
- All24 layouts preserve exact original signed/unsigned raw words at each 8/16/32-bit
  width through native uploads and sync/async reads. R/RG use matching native formats;
  RGB expands to matching native RGBA with integer alpha1; RGBA remains matching.
  Native readback is RGBA_INTEGER with INT or UNSIGNED_INT, then original lane/width
  narrowing in the already charged scratch. No float/normalized conversion is allowed.
- Base, NPOT truncated/full mip chains, original render/sampler/combined roles, inline
  and attached strided subrect transfers, and every untouched source/output/SG byte
  are independently reconstructed from original values. Signed minima and UINT high
  words above2^31 appear in inputs declared before GPU execution, without fitting or
  changing inputs after observing a native result.
- Whole original and private native mip planes follow physical completion. Private
  nonzero ranges use native integer NEAREST framebuffer blits without a CPU pixel
  download supplying GPU copies. GPU-only typed integer clears alter one original
  mip and refresh retained ranges; adjacent mips and whole source backing retain
  their original values. RGB implicit alpha is initialized with typed integer clear.
- Three varied ownership schedules exercise context switching, source-ID reuse,
  retained old storage/ranges, queued read complete/cancel/resource destruction and
  disposal. Actual held storage/fence identities survive reuse; native objects retire
  once and all terminal byte/ticket/view/lease/reference budgets return to zero.
- Original guest/native expansion, scratch/read staging and private-copy bytes are
  charged before allocation. At/over bounds refuse exactly; malformed fields and
  actual native errors/context loss cannot publish success or new private authority.
- Two real native controls corrupt upload lane identity or copied source level,
  complete the physical run, and fail the unchanged original-word/full-plane inverse.
  Mismatched integer read format is an explicit native-error control, never a substitute
  for wrong-pixel detection after successful native completion.
- Carry unchanged predecessor HELD boundaries and all ten D26–D30 worker/critic seals
  by exact digest. Run affected prior store/transfer owner gates. Freeze runtime/harness,
  record the full hot command, repeat that same command once in a pristine scrubbed
  exact-head clone, seal and reopen/hash every indexed member before submission.

## Adversarial verification

Fresh critic reads this task and full scoped diff first, predicts concrete values before
looking, independently reopens/hashes the complete archive and source closure, and derives
native/public planes from original signed fields and source bytes with an independent
integer oracle. Audit every smallest governing nested V8 partition for changed runtime
regions; line samples are navigation. Exercise all stated roles, malformed/config/error,
limits and three varied retained-ownership schedules; invent one bounded native integer
or lifetime attack; sabotage a promoted check with actual native wrong pixels after the
original physical completion. Carry unchanged HELD results/seals and final pristine clone.
Classify unexecuted changed behavior as needs-evidence or dead, then promote the independent
proof, seal critic recording, log verdict, check policy, regenerate queue and commit.
The worker cannot verify its own submission.

## Execution slices

One boundary: selected original integer allocation and transfer/range representation in
resources.mjs plus a declarative original-format map. Native upload expansion/read narrowing
and integer copy/initialization stay within that representation boundary. No packet/shader/
draw/production or multidimensional-texture behavior is added here.

## Evidence boundary

This is isolated native storage authority only. It grants no integer sampler/output shader
admission, production feature/capset, complete GLES API, guest Mesa/desktop rendering,
worker scanout, demo deployment or performance result. Those are ordered successor gates.

## Verification log

### 2026-10-10 — worker — verified predecessor and exact-head refusal

D30 is independently verified at `131f7ec39a56b747e4107f9b2e5077e8215434f0`.
`node evidence/virgl-production-readiness/standard-integer-image-gap.mjs` records
all24 original integer formats with base/full NPOT chains and render/sampler/combined
roles:144 owner/layout refusals, zero allocations. Its adjacent JSON pins complete
original metadata, old runtime source bytes and original enum header at that head.
This synthetic refusal grants no native, guest, production or capset authority.
The human instruction continues production graphics work ahead of unrelated queue work.

Native representation is derived from the pinned Khronos GLES3 reference pages
(commit `4bdf67a73d040f79bd7b087f5c1e588809e1f329`, glTexImage2D/glReadPixels/
glBlitFramebuffer/glClearBuffer) and Mesa26.2.2 original format descriptors.
Integer RGB is expanded to matching native RGBA; native integer alpha is1.
Integer public reads use guaranteed RGBA_INTEGER plus INT/UNSIGNED_INT.
The original4MiB/resource,32MiB aggregate and8MiB scratch ceilings stay unchanged.
