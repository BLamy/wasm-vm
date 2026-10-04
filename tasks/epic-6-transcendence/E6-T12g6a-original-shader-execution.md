---
id: E6-T12g6a
epic: 6
title: Prove four newly captured gears and compositor shader bodies on hardware
priority: 525.02701055
status: in-progress
depends_on: [E6-T12g5]
estimate: S
risk: high
capstone: false
---

## Boundary

Bind and execute four original bodies outside the unchanged F6 corpus: gears
client vertex `80a42bf3` and fragment `86d0ee79`, supporting compositor vertex
`7bf4d0d0` and fragment `c2474531`. All four already pass the checked compiler; add original
source, metadata, reflection and physical execution evidence without extending
compiler grammar or bounds. Original bodies `92cb866a` and `c5806d5f` remain rejected
and gate the six-body G6 integration until separate compiler work is verified.

This boundary proves the gears transform/lighting/material equations and smaller
compositor coordinate/forced-alpha texture equations on bounded finite vectors.
It does not replay full client drawing state, enable negotiation or claim FPS.

## Deterministic acceptance

`make verify-E6-T12g6a` authenticates literal G1 source/index/capture provenance,
compiles the original pairs in hardware WebGL2, records actual reflection and
uniform snapshots, and uses independent hand-written equations for transform
feedback words and raw GPU fragment pixels. Exercise all written vertex lanes,
lighting clamp/ambient/material/alpha, separate rounded precise zero arithmetic,
texture alpha forcing and coefficient multiplication, with varied seeds, normal
and matrix inputs. Track GL objects through disposal and require zero errors.
Preserve the two explicit unsupported original rejections and unchanged G1–G5
leaf results; record numerical source faults that must fail the independent
physical oracle, exact source and one pristine clone. Submit to a fresh critic.

## Adversarial verification

Predict source/metadata/reflection and independent words/pixels before inspection.
Attack distinct normal/light directions, material and alpha channels, precision
and written masks, texture UV/quadrants and forced alpha; use fresh seeds. Mutate
one output equation while keeping the oracle fixed and require a physical fault.
Unsupported larger originals cannot be substituted, truncated or advertised.

## Verification log

### 2026-10-04 — worker — activated scoped graphics continuation

Continues the human-authorized guest graphics work after G5 was independently
verified at `ee0277231f1903633881d803ba6153b58d31fd1c`. The unrelated queue-top
publishing task remains outside this request. This task changes proof harnesses,
not production compiler semantics, renderer negotiation, demo imports or caps.
G6 remains gated on separately proving the two larger unsupported original bodies.
The four already-admitted originals receive their own physical GPU proof here;
F6's unchanged nineteen-body evidence is carried forward, never relabeled.
