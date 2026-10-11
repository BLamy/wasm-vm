---
id: E6-T11d41
epic: 6
title: Qualify original UN16 depth images and sampling
status: pending
estimate: S
risk: high
priority: 525.027039000381
depends_on: [E6-T11d40]
capstone: false
---

## Boundary

One opt-in original Z16_UNORM=16 image path: checked single-layer 2D native
DEPTH_COMPONENT16 storage, original depth/sampler roles 1/8/9, full/truncated
NPOT mips, canonical little-endian UN16 transfers, retained nearest-compatible
FLOAT sampler views and original mip depth surfaces. Extend the selected owner,
decoder and state together for this single format. Keep every historical factory's
admission unchanged. Reuse the unchanged actual C/Wasm compiler and native
floating-depth GPU copy/packing helper; no CPU mirror or rendering fallback.

## Deterministic acceptance

`make verify-E6-T11d41`

Record the original storage/view/surface refusals at the independently verified
D40 head before activation. Authenticate the full D40 worker and critic seals
and unchanged compiler/helper and whole pinned Mesa/virglrenderer sources.

Exercise all 65,536 original UN16 input words through native sampling and exact
canonical public UN16 readback. For native FLOAT lookup, derive the expected
value independently as float32(original_word/65535), permitting at most one ULP
only in sampled depth lanes; all constants, query results, other output words,
UN16 bytes and padding remain exact. Execute original non-shadow FLOAT samplers
in both stages at slots 0/15, original TXF/TXL/TEX/TXD/TXB/TXQ where supported,
client swizzles/constants, private/full NPOT ranges and nonzero output levels.

Execute mip depth surfaces with all eight comparison functions, test enable and
write masks, complete depth clears and matching FLOAT/SINT/UINT color planes.
Independently model stored and incoming UN16 quantization and prove native depth
attachments, levels and dimensions; preserve a retained combined floating
format's S8 across switches. Exercise synchronous and asynchronous strided,
segmented transfers and native-only source refresh, with exact owned texture,
scratch, staging and conversion charges before allocation or readback.

Reject wrong roles, unsupported sample/layer/flags, oversized or invalid chains,
return types, format aliases, ranges, dimensions and feedback before a private
copy or guest draw. Reject linear depth filters before sampling. Retain the held
D40 18/126 and legacy level-zero Z16 behavior. Run three varied retained-range,
generation, cancellation and disposal schedules, including opposite-format ID
reuse and once-only fence/object retirement with zero terminal charges. Separate
owned fences, consumed completions and disposal-only fences in all claims.

Refute actual wrong native sampler/depth attachment and completed native color
or depth corruption after a distinct second consumed fence with unchanged full
original-input inverses. Cover every changed governing nested V8 partition,
allowing only exact source-pinned unchanged predecessor operands or whitespace.
Run scoped syntax/diff/policy and affected predecessor gates, then one final
frozen hot recording and one pristine scrubbed cold clone. Seal and reopen every
full source/input/native/public/browser/coverage/screenshot record.

This isolated factory is not demo-reachable and grants no production authority.
Shadow comparison, stencil testing, desktop linear depth semantics, full API,
capsets, guest/compositor rendering and measured throughput remain in the parent.

## Adversarial verification

A fresh critic reads the task and diff and records falsifiable predictions
before opening evidence. Authenticate full custody, carry unchanged predecessor
HELD results, and independently invert original descriptors, packets, TGSI and
segmented input bodies. Inspect the full UN16 domain, quantization/comparison,
one-ULP bound, native bindings, depth attachments and preserved S8, original mip
and generation identities, actual consumed fences and terminal accounting.

Run three new schedules and one bounded novel image/transfer attack. Sabotage
actual completed native storage after a new consumed fence and demand unchanged
inverses reject it. Promote one useful deterministic attack and seal all fresh
recordings. Verify only when every changed governing partition is covered or
explicitly justified and no contradiction or proof gap survives. Do not repeat
the unchanged final cold clone absent a portability finding.

## Verification log

### 2026-10-11 — worker — original UN16 readiness refusal

D40 is independently verified at
`d64b2f5e782fee2090f7a0f435bdb0ea7a0a1081`. Exact reproduction:

```sh
node evidence/virgl-production-readiness/standard-unorm-depth-image-gap.mjs
```

Its complete adjacent JSON records ten original sampler/depth mip storage/layout
refusals and three base/private sampler or mip-surface packet refusals. Two
legacy base depth transfer layouts and one legacy base surface packet still
succeed. Every original input and source closure is pinned; no native allocation,
guest rendering or production negotiation occurs. This orders one format path
above independently verified D40.

Whole pinned `vrend_formats.c` maps original Z16_UNORM=16 to
DEPTH_COMPONENT16/DEPTH_COMPONENT/UNSIGNED_SHORT with NO_SWIZZLE. The complete
Mesa `u_format.yaml` describes UN16 depth with X red swizzle. Whole D40 view
sources and GLES3.0.6 depth-mode expansion/filter restrictions remain held.
The selected implementation reuses the unchanged native GPU copy/packing helper
and actual compiler. The public depth stream remains exact UN16, while native
FLOAT depth lanes have the explicitly bounded one-ULP acceptance above.
