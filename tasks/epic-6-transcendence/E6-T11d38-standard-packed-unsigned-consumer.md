---
id: E6-T11d38
epic: 6
title: Consume original packed unsigned samplers and COLOR0–3 surfaces
status: pending
estimate: S
risk: high
priority: 525.027039000378
depends_on: [E6-T11d37]
capstone: false
---

## Boundary

One false-by-default selected original packed UINT command consumer in decoder
and state only. Admit original B10G10R10A2_UINT=225 and R10G10B10A2_UINT=253
sampler views and COLOR0–3 surfaces through D37 native storage. Reuse the held
integer compiler, resource generations, image-range/job ownership and native
integer readback. Preserve original aliases, unsigned sampler/output masks,
nearest-compatible filters, raw UINT clears and per-slot blend bypass. All
historical command profiles, default device and production caps remain closed.

## Deterministic acceptance

`make verify-E6-T11d38`

Authenticate D37 storage and D36 consumer seals/source closures incrementally.
The negative command below records six complete original view/surface refusals
at the independently verified predecessor. Execute both aliases through original
TXF/TXL/nearest operations in both shader stages, base and restricted mip ranges,
constant/swizzled views and complete raw UINT output planes with zero tolerance.
Integer vertex varyings must retain the held CONSTANT contract.

Execute each COLOR0–3 slot at base and nonzero levels, distinct fields and field
extrema, sparse and broadcast integer outputs, scissor/color masks, raw integer
clears, and mixed FLOAT/SINT/UINT attachments with float-neighbor blend folding.
Derive packed field widths/swizzles from primary Mesa/header descriptors. Pin
Mesa's pure integer packing conversion and prove out-of-width uint shader/clear
conversion on actual RGB10_A2UI targets; never reuse normalized float or masking
assumptions. Invert original TGSI/packet words into complete native uint lanes,
original packed public words, full SG padding and untouched mip planes.

Prove typed/FLOAT/SINT/alias/filter and old-profile refusals before any native
guest draw or private image copy. Run three varied retained-range, resource ID,
context, cache, finishing-fence and disposal schedules. Physically substitute
an incorrect sampler texture and nonzero color attachment; corrupt completed
native packed output after a distinct second fence. The unchanged full independent
inverse must catch every control. Record actual native binding types/levels,
compiler selectors, cold/warm cache identity, once-only retirement and zero
terminal charges. Held storage budgets remain D37's four-byte packed storage and
sixteen-byte native integer reads.

Run scoped syntax/diff/task policy checks, affected historical consumer paths,
and rebuild the unchanged actual C/Wasm bridge with held digests. Account for
every changed governing V8 partition, preserving reasoned exact predecessor
waivers only for unchanged operands. Record one exact-head hot acceptance and
one pristine scrubbed cold clone, and reopen the complete worker source/input/
native/coverage/browser/screenshot archive. This selected isolated consumer is
not reachable through the demo; parent E6-T11d retains production guest bring-up,
built-page/live deployment and independently measured throughput acceptance.

## Adversarial verification

A fresh critic reads the task/diff and predicts before opening recordings.
Authenticate all source/member pins, original numeric aliases, pure integer
field conversion, exact cold proof and unchanged compiler/storage boundaries.
Carry HELD facts forward only with unchanged source and dependency digests.
Independently derive native/public values from complete original packets/TGSI,
including uint extremal fields, mixed target masks, raw integer clears, sampler
stage/types/ranges, padding and private mip isolation. Interrogate every changed
governing partition and complete fence/generation/native retirement custody.

Run three new varied schedules, scoped refusal/failure attacks and one bounded
novel mixed-alias/partial-output/generation attack. Sabotage actual completed
native packed storage after a distinct new physical fence and require the
unchanged full inverse to refute it. Promote one useful deterministic attack,
seal its full recordings and mark verified only if no contradiction or proof
gap survives. Do not repeat an unchanged final cold clone absent a portability
finding. Production guest/capset/throughput claims are outside this boundary.

## Verification log

### 2026-10-11 — worker — original packed UINT consumer refusal

D37 is independently verified at
`f9f479c20d37d89d0d6da18675777a4a8fd7a7b9`. Reproduce:

```sh
node evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.mjs
```

The complete pinned record
`evidence/virgl-production-readiness/standard-packed-unsigned-consumer-gap.json`
shows six unsupported-feature refusals through the D36 selected command
consumer: both aliases at base and swizzled restricted mip sampler views, plus
nonzero mip color surfaces. This is synthetic original-wire refusal evidence,
not a guest/native draw. D37 storage and the unchanged integer pair compiler
permit this one selected consumer prerequisite; no complete API or positive
production capability follows from it.
