---
id: E6-T11d40
epic: 6
title: Consume original floating depth views and surfaces
status: in-progress
estimate: S
risk: high
priority: 525.027039000380
depends_on: [E6-T11d39]
capstone: false
---

## Boundary

One false-by-default original floating depth command consumer in decoder and
state only. Admit original Z32_FLOAT=18 and Z32_FLOAT_S8X24_UINT=126 view/surface
packets through the independently qualified D39 owner, retaining original mip
ranges, resource generations and field values. Use the unchanged actual C/Wasm
FLOAT sampler contracts and original client swizzle over native (D,0,0,1).
Depth surface selection must use its original mip and dimensions, attach each
correct native format, execute original depth comparison/write/clear state and
preserve the combined format's stencil. Historical profiles remain closed.

## Deterministic acceptance

`make verify-E6-T11d40`

Record the six literal original view/surface refusals at the final independently
verified D39 head before starting. Authenticate both D39 seals and the unchanged
storage/compiler source closure incrementally, including original whole Mesa
26.2.2 and pinned virglrenderer1.3.0 depth-view/swizzle sources. Rebuild actual
C/Wasm with held generated digests; no compiler, owner or transfer edits.

Execute FLOAT samplers in both stages at slots0/15, native nearest and original
TXF/TXL/TEX/TXD/TXB/TXQ where that stage supports them. Cover arbitrary original
swizzles/constants, full and private truncated NPOT ranges, nonzero source and
output levels and GPU-only source refresh. Independently invert original shader,
packet, descriptor and segmented input bytes into full native float output words,
retained depth/stencil fields, public output rows and all untouched padding/mips.
Use exact binary fraction inputs. Reject original linear minification,
magnification and mip filters before any private copy or guest draw. GLES3.0.6
section3.8.13 makes non-comparison depth textures incomplete under those filters;
native linear support cannot be granted by this decoder/state boundary. A later
qualified shader/storage path must implement desktop depth linear semantics.

Execute original floating depth surfaces at base/nonzero levels with all eight
comparison functions, enabled/disabled tests and write masks, full depth clears
and matching FLOAT/SINT/UINT color neighbors. Prove stencil preserved across each
operation and correct attachment texture, level and dimensions. Reject wrong
sampler returns, roles, format aliases, layers, levels, dimensions and overlapping
depth feedback before any guest native draw or private image copy. Preserve the
held Z16 depth surface path and old command profile refusals.

Run three varied original range/object/generation/fence/lifetime schedules,
including old generation plus opposite-format ID reuse, cancellation and both
owner/renderer disposal orders. Record actual native bindings, compiler requests,
warm cache reuse, physical consumed fences, once-only retirement and zero terminal
charges. Refute actual wrong sampler/attachment and completed native depth/float
output corruption after a distinct second physical fence with unchanged full
inverses. Account for every changed governing nested V8 partition, allowing only
exact source-pinned unchanged predecessor operands or non-executable whitespace.

Run scoped syntax, diff and policy checks plus affected predecessor consumers.
Record one final frozen hot run and one pristine scrubbed cold clone, then reopen
the full source/input/native/public/browser/coverage/screenshot worker archive.
This selected isolated factory is not demo-reachable. Parent E6-T11d retains
production API/capset, real guest/compositor, browser demo/deployment and measured
throughput acceptance. Shadow compare, stencil testing and Z16 sampler storage
remain separate gaps; this task grants no production draw authority.

## Adversarial verification

A fresh critic reads the task and diff and records falsifiable predictions before
opening evidence. Authenticate complete source/member/receipt/cold pins and
carry only unchanged predecessor HELD results. Independently derive native/public
words and stencil preservation from original packets/TGSI/input bodies, examine
correct native depth attachments and levels, every changed governing partition,
physical fence custody and exact resource generation/terminal retirement.

Run three new schedules and one bounded novel depth-view/surface/generation
attack. Sabotage actual completed native storage after a new consumed physical
fence and require unchanged inverses to reject it. Promote one useful deterministic
attack, seal complete recordings and set verified only when no contradiction or
proof gap survives. Do not repeat the unchanged final cold clone absent a
portability finding. Full API and production offload are outside this boundary.

## Verification log

### 2026-10-11 — worker — original floating depth consumer refusal

D39 is independently verified at
`50b98a3ab6652e9d23f3eaac5eb1095023f9898d`. Exact reproduction:

```sh
node evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.mjs
```

The complete source-pinned original record
`evidence/virgl-production-readiness/standard-floating-depth-consumer-gap.json`
contains six `unsupported-feature` refusals from the unchanged D38 command
profile: both formats at base and swizzled restricted mip views, plus nonzero
mip depth surfaces. No native or guest operation executes in this probe.
This orders one selected command consumer above the verified D39 storage.

Whole original Mesa26.2.2 and pinned virglrenderer1.3.0 sources establish the
native depth component, original client swizzle and preservation of S8. GLES3.0.6
section3.8.15.1 assigns depth to Rt, with RED expansion (Rt,0,0,1) in table3.24;
its non-shadow lookup ignores stencil. These primary facts grant no production
API or capset authority.

### 2026-10-11 — worker — depth filtering scope corrected from primary evidence

The ephemeral hardware matrix
`target/evidence/d40-full-samples/report.json` caught original Z32_FLOAT vertex
TXF with a linear sampler returning zero depth, instead of the input depth word
`1051721728`. Whole pinned GLES3.0.6 PDF page174 / printed161, section3.8.13,
requires native nearest-compatible filtering when depth compare mode is NONE.
This is a native API restriction even for TXF. The initial plan's native linear
acceptance was therefore incorrect. This selected decoder/state task now proves
explicit pre-copy/pre-draw linear refusal; qualified desktop linear depth
semantics remain parent production work. No compiler or owner behavior changes.
