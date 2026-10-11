---
id: E6-T11d40
epic: 6
title: Consume original floating depth views and surfaces
status: implemented
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

### 2026-10-11 — worker — frozen original floating depth consumer submission

Runtime and harness freeze: `1f8cb8c7ccdf8d58e78944a51156453a22fc5b5a`.
The runtime diff from independently verified D39
`50b98a3ab6652e9d23f3eaac5eb1095023f9898d` changes only decoder/state; all
resource, transfer, constant-domain and actual C/Wasm compiler boundaries retain
their held identities. Final commands, run once at this frozen head:

```sh
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc \
  VIRGL_FLOATING_DEPTH_CONSUMER_EVIDENCE_DIR=target/evidence/virgl-standard-floating-depth-consumer-final-hot \
  make verify-E6-T11d40
python3 tools/virgl-floating-depth-consumer/cold.py \
  --output target/evidence/virgl-standard-floating-depth-consumer-final-cold
python3 tools/virgl-floating-depth-consumer/seal.py \
  target/evidence/virgl-standard-floating-depth-consumer-final-hot \
  target/evidence/virgl-standard-floating-depth-consumer-final-cold \
  evidence/virgl-floating-depth-consumer/worker
```

Both acceptance receipts passed, with the cold clone pristine before and after
the run and its relevant inherited environment scrubbed. Each independently
inverted 74 positive original runs, 206 native output frames, 23,664 float/integer
output words, 28,188 retained native depth/stencil pixels and 10,560,000 public
bytes, with 2,485 consumed physical syncs and 144 actual compiler responses.
The full nearest-compatible 22-pair sampler matrix covers both stages, slots0/15,
original operations, swizzles/constants, full/private NPOT ranges and output
mips. Forty surface cases cover all eight comparisons, test/write state, FLOAT,
SINT and UINT neighbors, plus attachment switching through original Z16 and the
opposite floating format without losing original S8. Three boundary schedules
cover linear and role/return/range/feedback refusal, GPU-only old-range refresh,
opposite-format ID reuse and completing/cancelling/disposing queued generations.
Retired queued output planes were read after physical completion and before
native deletion. Every terminal account is zero; native objects retire once.

Each hot/cold recording also refuted actual wrong native sampler and depth
attachment controls, and completed native color/depth corruption after distinct
second consumed physical fences, through the unchanged JS/Python inverses.
Historical MRT, FLOAT/SINT/UINT, packed-normalized, packed-unsigned and Z16
consumer checks passed on the real Metal GPU with zero browser errors and no
software-rendering flags. Syntax, Python compilation, shell syntax, diff/policy,
actual C/Wasm rebuild and all affected gates passed. Both coverage audits have
305 positive governing nested V8 partitions, 24 exact source-pinned unchanged
predecessor operands, and zero unexplained partitions. The predecessor audit
reopened all 28,339 D39 worker/critic members; no held boundary was requalified.

Complete committed evidence is `evidence/virgl-floating-depth-consumer/worker/`:
33,662 members, 1,521,428,916 raw bytes, 90,599,444 archive bytes. Every member was
reopened and authenticated, including original wire/TGSI/input/native/public
bodies, browser command lines, full source bodies/closures, nested counters,
screenshots, original primary sources, hot/cold logs and generated compiler
bytes. SHA256 identities:

- archive: `44697cfa945b3ea306d44eb9fefef1e8505a56ac7aec37f538471c374f5ecba6`
- index: `4e1bf3fc407ec86d2897ccc1279a82d401d9061d1873d55125575a036fefd22a`
- manifest: `0bd79d028035888c9f7c6d3876c0c03de3b44b5fb108d035b4f7b802377bbeb5`
- hot receipt: `aee53aa3ed5147d0454432d39a16eaae152e327dbd54c9ab358e0d8d7c8682ee`
- cold report: `d3d0e38a1d34807acb41764120bec075cc3c10a43b7b6b47412d2a6590961c97`
- cold receipt: `f2d539b85783e0630a5fb49b95642c5f08ecea704b3be7492a3f5ce903220c9d`

This evidence demonstrates the selected original non-shadow floating-depth
command boundary with nearest-compatible filtering and preserved depth/stencil
storage and lifetimes. It deliberately grants no linear-depth, shadow-compare,
stencil-test, Z16-sampler, full-API, production-capset, guest-execution, offload or
throughput authority. Fresh adversarial verification is still required.
