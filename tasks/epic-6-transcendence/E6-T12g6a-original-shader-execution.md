---
id: E6-T12g6a
epic: 6
title: Prove four newly captured gears and compositor shader bodies on hardware
priority: 525.02701055
status: implemented
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
compiles the admitted original programs in hardware WebGL2, records actual reflection and
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

Original draw binding inspection additionally identifies two supported programs:
client `80a42bf3` / `86d0ee79` and supporting `403b0529` / `c2474531`.
The latter reuses a byte-identical verified F6 vertex body. New vertex `7bf4d0d0`
is originally paired with rejected `92cb866a`; measure every written output of
that vertex in an explicitly labeled compatible isolation program. Keep its
original complete program rejected, together with `403b0529` / `c5806d5f`.

### 2026-10-04 — worker — submitted original shader physical proof

Frozen harness/source head `2e7f43167fe29d8ad0da92591888e27e2dbae589`,
base independently verified G5 `ee0277231f1903633881d803ba6153b58d31fd1c`.
No production compiler, renderer, guest, caps, negotiation or demo source changed.
The checked native and wasm converters are rebuilt; four new admitted bodies
and the unchanged F6 partner have identical native/wasm emitted source and
complete metadata. All six new bodies reassemble byte-identically from G1
CREATE_OBJECT packets, authenticated against its literal index, event stream
and command blobs. First source packet citations: gears VERT event5115/byte4136,
FRAG event5115/byte5348; supporting VERT event5328/byte5608, larger FRAG
byte6224, texture FRAG byte47556 and second larger FRAG byte48868.

The original gears pair executes on physical WebGL2. The texture fragment runs
with its actual captured F6 vertex partner `403b0529`; draw citations are
5115/byte6484 and 5328/byte48168. The supporting vertex's actual original pair
is `7bf4d0d0`/`92cb866a` at 5328/byte46312, and remains rejected. Its every
written vertex lane is measured in a clearly labeled compatible isolation
program instead. The other original larger program `403b0529`/`c5806d5f` at
5328/byte64400 also remains rejected. No truncation or substituted body is
counted as complete original program support.

Commands (passed):
- `VIRGL_GEARS_SHADER_EVIDENCE_DIR=target/evidence/virgl-gears-shaders-worker-final make verify-E6-T12g6a`
- `python3 tools/virgl-gears-shaders/cold.py --output target/evidence/virgl-gears-shaders-worker-cold`

Seeds1648868771/254715103/3281536249 measure 2,592 written transform-feedback
words and 27,648 raw RGBA8 pixels against separate handwritten transform,
normalized lighting, ambient/material, precise zero arithmetic and texture
forced-alpha equations. The 12-ULP allowance applies only to lighting RGB;
other written words are exact, including signed zeros and subnormal arithmetic
outputs. Pixel rounding allowance is one byte. Literal texture quadrants and
input alpha0/64/128/255 are independent inputs. Original raw uvec4 uniform
reflection/readback, attribute snapshots, output masks and VirglBlock offsets
are recorded. Every created GL object is actually deleted; zero GL, page,
console or request errors. Chrome154/ANGLE Metal on Apple M4 Max.

All three owned-emitted-GLSL output faults reach the physical oracle: lighting
x=0 yields word0 instead of1041865114 at gears-0/lane4; auxiliary x=1 yields
1065353216 instead of0 at compositor-0/lane8; forced alpha0 yields raw
[4,21,55,0] instead of[4,21,55,64] at compositor-pixels-1-0/pixel0. Original
compiler results and mutated emitted sources are both digest-bound. The
unchanged F6 suite retains19 literal bodies,57 of88 native linked programs,
1,536 vertex words and155,648 pixels. G1–G5 HELD leaf archives and all runtime
files at the G5 base are bound unchanged in the receipt; unrelated regression
walls are not restarted for a proof-harness-only change.

The pristine clone at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-gears-shader-cold-3277kuor/wasm-vm`
starts/ends clean at the frozen source hash. Its full acceptance passes with
compiler/runtime environment overrides scrubbed. Hot/cold source and input
tables are identical. Authoritative committed worker evidence:
`evidence/virgl-gears-shaders/worker/{manifest.json,records.json,recording.tar.gz}`
contains57 members, including hot/cold reports, screenshots, actual word/pixel
bytes, V8 counters, logs, generated binaries and diff. Archive SHA256
`9941036d869021078ce41f67e219b568c24a5b00294598dba4b6873c67b3af6e`;
index `66f7335f9d11d6cd9cca13b12bbf78e7ae4c43c8f0f3149baea41e514dcad5bb`;
hot receipt `08939a224d4124b0487a0daba3166a7cf61d3c70a6d2528ae1f1811fcdc9ef6d`;
cold report `008ffbb1df301e2b9bd80805150fcef7d0f50615b8662e1ffae830c442b737ee`;
cold receipt `16d332ab285c26519de4bfe6b2d379eec2dfaf383909493f6b6cd81a1aed95c4`.

Claim: four additional unchanged original shader bodies have bounded physical
GPU execution evidence for the stated equations. This does not prove complete
programs containing the two larger fragments, original draw-state replay,
full guest offload, production negotiation, FPS or MIPS. Fresh independent
verification is still required.
