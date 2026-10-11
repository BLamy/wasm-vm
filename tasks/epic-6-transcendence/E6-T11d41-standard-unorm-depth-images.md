---
id: E6-T11d41
epic: 6
title: Qualify original UN16 depth images and sampling
status: implemented
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
UN16 bytes and padding remain exact. For floating-point clears, validate the
GLES3.0.6 two-closest-integers conversion rule, a uniform native choice, and
exact public serialization of that same native fixed word; never independently
allow native and public streams to disagree. Execute original non-shadow FLOAT samplers
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
Distinguish driver-synchronized CPU readPixels returns in the synchronous
backend from asynchronous PBO collection after consumed WebGLSync completion.
A fence preceding a conversion draw must not be claimed as completing that draw.

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


### 2026-10-11 — worker — native UN16 clear conversion corrected from whole primary

The ephemeral `target/evidence/d41-transfer-smoke/report.json` records a native
0.375 clear sampled as 0.37499046325683594, original word24575, while the initial
fixture assumed nearest word24576. The unchanged actual GPU therefore refuted
that over-specific fixture assumption. Whole GLES3.0.6 section2.1.6.2 allows the
two closest integers for float-to-UNORM conversion and prefers nearest;
section4.2.3 applies fixed window-depth conversion to clears. The updated
acceptance independently predicts the allowed pair24575/24576 before the clear,
requires every native pixel to use the same allowed fixed word, and then demands
all public bytes exactly serialize that independently validated native choice.
Uploaded UN16 words, constants, padding and comparisons retain their existing
exact criteria. This changes no product, compiler or GPU-helper code.


### 2026-10-11 — worker — synchronous readback custody is explicit

The initial transfer event audit correctly refused to credit an earlier
WebGLSync as completing a later GPU packing draw. The synchronous backend uses
actual CPU-destination `readPixels`, which returns the framebuffer data through
the driver's synchronous readback API. Its full returned native words are
recorded and inverted, and the selected backend invocation scope is recorded
explicitly. Asynchronous PBO `getBufferSubData` and independent diagnostics still
require an actual consumed fence created after their writer. The new audit
counts these separately and does not relabel synchronous reads as WebGLSync
completions. Product and held GPU helper code are unchanged.

### 2026-10-11 — worker — older recorder import closure repaired

The first frozen product matrix and pristine clone at `9b3e9412d19e26488c675ad53c7b08d6e490a417` passed. Separately, the original legacy recorder's fixed import list omitted the new descriptor: `target/evidence/d41-preflight/retained-z16-consumer/report.json` contains its missing-module failure. The unified adapter proved the unchanged native behavior but did not repair that original command. Twenty-five fixed recorder inventories now append only this dependency. Every full body is compared to D40 with exactly that literal removed, and the original hardware `verify-virgl-depth-formats.mjs` command is part of final acceptance. No runtime, shader compiler or GPU-helper behavior changed. The earlier hot/cold pair remains a pre-repair recording; the final worker submission uses the corrected frozen harness and one final pristine clone on that head.

### 2026-10-11 — worker — implemented; frozen native UN16 claim

Frozen source head: `eda91e2569c38de3f56b92fd38b5326b2c6ae3fd`.
The four runtime files are byteidentical to the first product freeze9b3e9412;
the final head repairs only recorder packaging and records that repair.

Commands (run locally on M4 Max, headed Chrome155 with real Metal, zero console,
page or request errors):

```sh
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc VIRGL_UNORM_DEPTH_EVIDENCE_DIR=target/evidence/virgl-standard-unorm-depth-frozen-hot make verify-E6-T11d41
python3 tools/virgl-unorm-depth/cold.py --output target/evidence/virgl-standard-unorm-depth-frozen-cold
python3 evidence/virgl-unorm-depth-images/worker/seal-io-driver.py target/evidence/virgl-standard-unorm-depth-frozen-hot target/evidence/virgl-standard-unorm-depth-frozen-cold evidence/virgl-unorm-depth-images/worker
```

Both final hot and pristine scrubbed cold acceptance passed at the frozen head.
The clean clone was detached at that exact head, with empty status before and
after and scrubbed compiler/Node/Python/recording environment. Each positive
matrix records62 runs,133 frames,801576 exact/qualified output words,
280776 sampled/tested depth pixels plus2732 transfer pixels, and10866784 public
bytes. Original descriptors, full TGSI/wire and all segmented input, native,
public and padding bytes are independently inverted. All65536 UN16 values
execute through an original guest sampler and exact canonical readback;680472
qualified FLOAT depth-lane comparisons had maximum observed error zero ULP.
Constants, queries and UN16/padding stay exact. Allowed clear quantization uses
one uniform primary-permitted native fixed value with exactly matching public
serialization. All eight depth comparisons, masks, original mip attachments,
nonzero levels and18->126->16 switches preserve original S8.

Eighteen transfer cases include native allocated-then-failed resource/private-view
rollback and one-byte-short resource, private-view, scratch and staging refusal
before any object allocation or CPU collection. Three varied schedules exercise
old generation/range retention, opposite-format ID reuse, cancellation and both
disposal orders. Four actual wrong-binding/attachment/completed-storage controls
are refuted by unchanged full original-input inverses; completed controls have a
distinct second consumed native fence. Every positive native object retires once
(6993 objects), with zero terminal budgets.

Full positive fenceObjects count1716 owned,1710 consumed and6 disposal-only
fences. The transfer inverse's summary omits consumedSyncs; its310 actual
completions are explicitly included from its full native fenceObjects, rather
than treating a missing field as zero. The1648 CPU reads separate1586 fenced
collections from62 synchronous driver readPixels returns. An earlier fence is
never credited for a later packing draw. Actual compiler requests are56 pair and
112 stage responses;101 matching draw associations are a separate quantity.

Both final nested V8 audits cover602 governing partitions, with25 exact
source-pinned unchanged predecessor operand/delimiter waivers and zero unproven
partitions. The original legacy Z16 recorder passes; all25 other repaired fixed
inventories are full-body authenticated as exactly one dependency literal added.
Historical D40 18/126, packed UINT/UNORM, integer/FLOAT/MRT paths remain green.
The unchanged actual compiler/helper and whole primary sources are authenticated,
and both full D40 archives reopen40703 held members.

The committed worker seal losslessly stores every logical source/input/native/
public/browser/coverage/screenshot member, including duplicate full records as
hardlinks to identical physical bytes. The initial gzip reverse-seek reopen was
terminated for cost. The committed I/O driver only expands the same stored
archive into memory and resolves each hardlink to its earlier actual physical
body; every logical body still passes the unchanged frozen sealer's complete
length/SHA check. It changes no record, verification predicate or product code.

Seal: `evidence/virgl-unorm-depth-images/worker`; 37121 members fully reopened, archive33512700 bytes.
Archive SHA256: `c04d93daf4f37cca8b9f9423fbe4776fe88d63c6a006709345691f9bcbc31afe`.
Index SHA256: `1d86135fbe288343f0d67d15cf7b355956e53400ea343324d3dae789a0e8d609`.
Manifest SHA256: `3b35c81a5d67ecbc8d781ad94acef91c2dadf656f950c7be8855637de72820ec`.
I/O driver SHA256: `2c44a63914f8f73ff416a2883a9fe2bd3fbe87f02875cce88deb07d93041e4c1`.
Hot receipt SHA256: `80292c7965691175b079b6c591de17a3038b28e0dea1693186d75b34a3402bdb`.
Cold report SHA256: `7b708cfe8bd3c3cd99affe1f62529a2c9a00511ed6f3cd921a76dd753c0b3738`.
Cold receipt SHA256: `602f358ec0569544a9ea5315c9d62b0e0cc19e1734e600b59ef0118c6602cc2e`.

This claim qualifies one isolated original UN16 path. Shadow/stencil/desktop
linear semantics, complete API and capsets, actual guest/compositor/worker/
scanout/demo production offload and300MIPS remain unproven. A fresh critic must
interrogate the full diff and recordings before this task can become verified.
