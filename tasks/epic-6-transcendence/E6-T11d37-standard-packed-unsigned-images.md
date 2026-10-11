---
id: E6-T11d37
epic: 6
title: Qualify original packed unsigned color image storage
status: implemented
estimate: S
risk: high
priority: 525.027039000379
depends_on: [E6-T11d36]
capstone: false
---

## Boundary

Selected original `B10G10R10A2_UINT=225` and `R10G10B10A2_UINT=253`
resource storage and transfer only. Preserve the original UINT fields in native
`RGB10_A2UI` storage and private mip copies. Guest/native pixels are four bytes;
native `RGBA_INTEGER/UNSIGNED_INT` read scratch and PBO pixels are sixteen.
Maintain complete SG padding, original identity, byte budgets, retained resource
generations, async completion and retirement. Existing owners/layouts/consumers,
default device, typed capabilities and actual production guest stay closed.

## Deterministic acceptance

`make verify-E6-T11d37`

Pin both original protocol IDs and Mesa UP10/UP10/UP10/UP2 channels/swizzles.
Authenticate D35 storage and D36 consumer seals/source closures incrementally.
The recorded D36 negative command below must contain twelve complete original
metadata/transfer refusals with zero allocations. One new false-by-default owner
and native backend admit the family; all existing owners and layouts refuse it.

Use headed Chrome on Apple Metal to execute both aliases through three image
roles and four NPOT/axis/truncated mip shapes, plus a dense 65 by 65 plane covering
every ten-bit R/G/B value and all two-bit alpha values. Record original inline,
direct and async transfers, partial boxes, private restricted mip copies, GPU-only
UINT clears, full native uint lanes and full public words/SG padding. An independent
Python inverse derives expected fields from the original descriptors and packets
with zero tolerance. Copies must stay on the GPU and preserve untouched levels.

Prove four-byte storage/upload charges and sixteen-byte direct/queued read
reservations at exact and one-short bounds, before native allocation/issue.
Exercise three varied retain/reuse/context/disposal schedules, native allocation,
transfer and completion failures, and all selected profile refusals. Physically
corrupt an upload lane, private copied level and completed native packed word;
the unchanged complete inverse must catch each, including a distinct physical
completion fence after the completed-word mutation.

Run scoped JavaScript/Python syntax, diff and task policy checks, rebuild the
unchanged actual C/Wasm bridge and verify its pins. Record native selected paths
and directly affected historical storage paths, every changed governing V8
partition (only exact predecessor operands may receive reasoned waivers), exact
head hot acceptance and one pristine scrubbed cold clone. Reopen all raw input,
native output, source, coverage, browser and screenshot members in the worker
seal. This isolated boundary is not exposed through the demo; production wiring
and its built-page/live deployment remain E6-T11d acceptance.

## Adversarial verification

A fresh critic writes predictions before opening evidence. Authenticate the
primary IDs, complete source/member digests and held dependency boundary; carry
HELD results forward only where those pins are unchanged. Independently inspect
all four raw integer lanes, full packed public words and padding, exact 4/16-byte
budgets, original native storage/internal formats, private mip ranges, fence
custody and once-only native retirement. Verify all changed governing partitions.

Run three independent schedule seeds, the stated native failure/refusal attacks
and one bounded novel alias/partial box/generation attack. Sabotage actual native
packed storage after completed work and demand failure of the unchanged full
integer inverse after a new physical fence. Promote a useful deterministic attack,
seal its full records and set `verified` only if no contradiction or proof gap
survives. Do not rerun an unchanged final cold clone unless portability fails.

## Verification log

### 2026-10-11 — worker — original packed UINT readiness refusal

At independently verified D36 head
`ec96d7544bb86c9defda0b7abc60e447a0a634b9`, run:

```sh
node evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.mjs
```

The complete pinned record
`evidence/virgl-production-readiness/standard-packed-unsigned-image-gap.json`
shows twelve refusals: both original aliases, base and three mip levels, and
sampler/render/combined roles. Both owner and layout return `unsupported-resource`
before allocation. This is synthetic refusal evidence, not a guest or native run.
Mesa's original UP10/UP10/UP10/UP2 fields and WebGL2's native RGB10_A2UI support
permit a narrow storage prerequisite. D38 consumer admission follows only after
this independent verification; production negotiation and throughput are unclaimed.

### 2026-10-11 — worker — scoped implementation and prechecks

The selected resource owner/backend admit only the two primary packed UINT
aliases beyond D36. A false-by-default appended flag retains all historical
factory boundaries. Packed upload uses the existing raw field permutation in
its four-byte scratch. Integer readback captures every native uint lane before
compacting into the already charged sixteen-byte reservation. No compiler,
consumer, guest, capset, web or default device source changes.

Ephemeral prechecks: selected wire and headed hardware smoke; all 26 matrix
cases and one 22-case native schedule; independent original-word/native-lane
and complete public SG inverse; three physical upload/copy/completed-word
controls caught; eight affected historical storage/resource paths passed. All
327 changed governing runtime partitions were positive, with zero gaps or
waivers. Declarative module additions in 27 old static servers were held byte
for byte against D36 apart from the pinned additions. These runs guide the
worker only. Final exact-head hot/cold and sealed submission follow this freeze.

### 2026-10-11 — worker — sealed exact-head submission

Recorded runtime/harness head: `c7c66c54482566f76b2f49af5a5e5721bd69d3f7`.
Selected gate commands, in order:

```sh
env EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc \
  VIRGL_PACKED_UNSIGNED_EVIDENCE_DIR=target/evidence/virgl-packed-unsigned-final-hot \
  make verify-E6-T11d37
python3 tools/virgl-command/standard-packed-unsigned-cold.py \
  --output target/evidence/virgl-packed-unsigned-final-cold
python3 tools/virgl-command/standard-packed-unsigned-seal.py \
  target/evidence/virgl-packed-unsigned-final-hot \
  target/evidence/virgl-packed-unsigned-final-cold \
  evidence/virgl-standard-packed-unsigned-images/worker
```

Both final acceptances passed at that exact head. The cold checkout was pristine
before and after, with compiler, Node, Python, Cargo and VirGL overrides scrubbed.
Each acceptance records 26 original native matrix cases and 110 input mip planes,
three independent 22-case native schedules, all eight affected historical storage
paths, zero browser console/page/request errors, and 327 positive changed governing
V8 partitions with zero missing partitions or waivers. The independent primary
field inverse checks 197080 native integer components, 131988 complete public
bytes and 10988 untouched SG padding bytes; dense cases cover every value in
each ten-bit RGB and two-bit A lane. Upload/copy/completed-word physical
controls are independently refuted after native completion; completed corruption
uses a distinct second physical fence. Four-byte packed storage/upload and
sixteen-byte native read/PBO accounting pass exact and one-short boundaries.
All native objects retire once and all owner charges end at zero.

The recording demonstrates selected original packed UINT storage, transfer,
partial boxes, GPU-only clears, private mip ranges and retained generation/job
ownership. Every historical owner/layout and the prior original command
consumer stays closed. D35/D36 dependency archives were fully reopened:
141936 authenticated members; unchanged compiler, consumers, constant domain
and image helpers are pinned. The actual rebuilt C/Wasm and module retain their
held digests. No compiler, production/default guest, capset, web, API-negotiation
or throughput claim follows from this storage boundary.

Hot receipt: `3d5e4faeb167bbc1e8e4f2944b33eaabd4b7798b935203f78464108e2e477989`.
Cold receipt: `72ad2db9e6365208c282247da7fdba0a1730849c9ee09696f597de70067a393a`; cold report:
`0a3525fab3556e8c3312d40468d1223de218ec655cbad18e323d4f518cbe6bef`.
Full reopened worker seal: `11416` members, `105019927` raw bytes,
`10766473` archive bytes at
`evidence/virgl-standard-packed-unsigned-images/worker`. Archive:
`3013c3d161c192b598370147e70940a28a14bfd741ce3a4180ed027da79167fc`; index:
`f191f60d45f82bab43fdec9227123b8f79c53fb9df90f60546b468741167af6e`; manifest:
`f6fb9368e136cc8e4ed9fa5bd0d8ddfce453a9dcf3bba577bbadbbfdfee0f6c6`.

Status is implemented pending a fresh adversarial verifier; worker self-validation
does not set verified. No merge authorization has been supplied.
