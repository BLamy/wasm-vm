---
id: E6-T12g6a
epic: 6
title: Prove four newly captured gears and compositor shader bodies on hardware
priority: 525.02701055
status: verified
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

### 2026-10-04 — fresh critic — VERDICT: verified

VERDICT: verified. Reviewed the full task and base-to-source diff before evidence;
recorded falsifiable predictions before inspecting numerical state. Source boundary
`2e7f43167fe29d8ad0da92591888e27e2dbae589`, submission
`c1a7f03490275d0d8ef9077d598c1e9d735cfb3c`, verified base
`ee0277231f1903633881d803ba6153b58d31fd1c`.

- P1 exact source/seal — HELD. Authenticated all 57 worker members, lengths,
  hashes and 2,890 hot/cold source bindings against the frozen git tree. Native
  and wasm generated bytes match the sealed binaries; post-source submission
  changes are proof packaging and task/queue metadata only. Worker archive
  `9941036d869021078ce41f67e219b568c24a5b00294598dba4b6873c67b3af6e`
  and index `66f7335f9d11d6cd9cca13b12bbf78e7ae4c43c8f0f3149baea41e514dcad5bb`
  authenticate. Critic `authentication.json` digest
  `a494df0f515a1936b8213e3582ec1a50c3728d6805568533f6dc7e58a5b180d9`.
- P2 literal provenance/real pairing — HELD. An independent packet interpreter
  reassembled the six complete new bodies and retained `403b0529`, then tracked
  actual shader bindings to draws at 5115/byte6484 and 5328/byte48168. The actual
  unsupported pairs remain 5328/byte46312 and 5328/byte64400. Source and packet
  digests, stages, complete bodies and event-stream identity are independently
  checked; the isolation vertex is explicitly labeled. Critic
  `independent-provenance.json` digest
  `71ae1dcc3d128210ebc3adf5548ffb4ce15b4a1b88e144717662ba4958c74383`.
- P3 admission/reflection — HELD. Native/wasm rerun equals the sealed results
  except report head; literal metadata, actual raw uvec4 banks and readbacks,
  attributes, masks, feedback varyings and VirglBlock offset 640/value 1 agree.
  The two larger bodies remain complete original rejections, with no truncation
  or substituted complete-program claim. Critic `compiler-and-carry.json` digest
  `8891e56fa130b0eec1354234a5ec5ff8e2f94a591473b2e6fc7cf397d01cfad2`.
- P4–P6 independent words/pixels — HELD. Separately derived float32 equations
  recompute all 5,184 hot/cold written words and 55,296 raw pixels; lighting RGB
  differs by at most 2 ULP. All positions, copied alpha, defined compositor lanes,
  signed zeros and subnormal precise outputs match exact words. Every raw SHA,
  written lane and all 256 pixels per draw are checked. Representative points:
  authenticated worker hot gpu1648868771 `report.json`:8853 (gears vector 0),
  :27583 (compositor vector 0), :67535 (texture coefficient .25/quadrant 0), report
  SHA256 `de22cad792b81071377e6bfcc15051bed418259618ce0b513df5df96fe482b65`.
  Critic `worker-numerical-checks.json` digest
  `7ed2b2592bdb2593ba49f3fa3c0f9ab9fd83ea7f212ba9839b5bbd5bb66704a0`
  contains every input, independent expectation and exact report/line/pointer.
- Exact-alpha guard — HELD after strengthening. The grouped budget at
  `renderer/virgl-shader/tests/gears-originals.mjs:132/135` also grants copied
  alpha 12 ULP, weaker than the stated exact-copy check. This discrepancy is not
  waived: independently every recorded alpha word is exact. Promoted
  `renderer/virgl-shader/tests/gears-exact-alpha.mjs` (digest
  `9b118502814dd7634fda76c1fc6df0d9eba679dbd73a469f413d8fd637a1f3da`)
  authenticates raw feedback bytes and compares physical word 7 directly with
  raw CONST[9].w. All nine hot/cold/fresh-seed reports pass 432 exact-alpha words.
  A one-ULP sabotage yields 1065353217 instead of 1065353216: the original grouped
  allowance accepts it and the promoted guard rejects it. Critic sabotage digest
  `596f92535be02e34767e5fe122663dde220b9583f42588247de10d5dbe77fe9d`;
  direct promoted-check result digest
  `50dc9214d60a58db55def69a2771523e78f963138dd1e23f13d434c26ae0c0bc`.
  Use this strict guard for future acceptance recordings retaining exact alpha.
- P7 faults/sabotage — HELD. The worker’s lighting, auxiliary and forced-alpha
  faults reach the physical oracle with successful hardware compile/link and
  complete cleanup. Invented emitted alpha=1-alpha fault fails at
  `novel-alpha-fault/report.json`:1134 /acceptance/vectors/0/failure, observed
  1063675494 versus preregistered 1036831949, budget 0; report digest
  `2dea0c6a9edd70af63211e0fe5cfa573c28f5c81fbbc3974cd185e2596d0984d`.
  Original/served sources are both bound. Original compiler metadata assertion
  also rejects a missing-alpha-mask fixture (15 versus 7) without editing source;
  sabotage digest `6e3756c5e5e06a9a08d24c3465467920122164f49911ae2e4c9c5164255782b4`.
- P9 novel hardware — HELD. Critic seeds 431193889/2793656469/3828116243 add
  2,592 words and 27,648 pixels (RGB maximum 1 ULP). Preregistered custom inputs
  add 432 words and 11,520 pixels with exact word agreement: rotated/reversed
  normal/light, nonsymmetric matrices and normal translation, material/alpha
  endpoints, irrelevant position.w, precise signed-zero/subnormal/min-normal/
  max-finite arithmetic, UV clamp/edges and nonquarter coefficients. Predictions
  digest `9c07e313da1b3d4a96ef369d039e58a34a477bf89309f2be7690047bc30ee61e`;
  attacks digest `0a28ee4fdd78c75fcb9a3212575043358f6e9381cf040619f8b32f7ef766aeda`.
  Actual WebGL2/ANGLE Metal on Apple M4 Max, zero GL/page/console/request errors;
  all 40 objects per fresh seed, 23 per custom success and 7 per novel fault
  actually deleted. All owned browsers and servers have closed.
- P8 sufficiency/carry/cold — HELD. All 72 function regions in the two new browser
  modules execute across twelve authenticated worker coverage recordings. Only
  defensive invalid-fixture/hardware throws, an undefined-lane skip, out-of-scope
  zero/nonfinite normalization rejection and unused general negative-float ULP
  ordering are waived, with explicit reasons; all other diff hunks are executed
  or declarative/logging/config. No dead or needs-evidence hunk remains. Preserve
  F6's unchanged 19 bodies/57 of 88 programs/1536 words/155648 pixels and G1–G5
  HELD leaf identities. The frozen-head pristine clone is clean before/after and
  has scrubbed overrides with identical hot/cold source/input tables. Cold report
  digest `008ffbb1df301e2b9bd80805150fcef7d0f50615b8662e1ffae830c442b737ee`;
  receipt `16d332ab285c26519de4bfe6b2d379eec2dfaf383909493f6b6cd81a1aed95c4`.
  No unrelated walls or second cold clone restarted.

SUITE: promoted the strict raw-alpha guard, independently checked its clean
results and sabotage failure. Other novel vectors remain authenticated critic
proof of this boundary; no duplicate broad fixture is promoted. This verifies
four additional bodies and the two actual supported programs plus explicitly
scoped vertex isolation. Complete larger programs, original draw-state replay,
production negotiation, full guest offload and FPS remain unclaimed.

Critic artifacts are under `target/evidence/virgl-gears-shaders-verifier/`:
`predictions.md`, authentication/provenance/numerical/coverage/attack reports,
raw hardware recordings/screenshots, faults, sabotage and `verdict.md`.
A nonduplicate critic archive is bound by `manifest.json`/`records.json`:
archive SHA256 `60f2783e02e62bd6cac757b948192a4d709f4d5ded35127c9d05ff51b35e5a24`, index SHA256 `9aa1c2cda4c4bda92f710869c182ce59d15f7f6d06afd9bd2f93682b7d293319`.
All members authenticate; worker artifacts are referenced by the existing seal
rather than copied into the critic archive.

Commands: independent `authenticate.py`, `check-provenance.py`,
`check-numerics.py`, `check-attacks.py`, `coverage-audit.py`; native/wasm
`compiler.mjs` rerun; three `browser.mjs` seed runs; custom `browser-novel.mjs`
success and `--fault alpha`; `sabotage-exact-alpha.mjs` and
`sabotage-compiler-test.mjs`; `node --check` promoted guard; `git diff --check`.
Direct strict-alpha invocation (passed 432 words):
`node renderer/virgl-shader/tests/gears-exact-alpha.mjs target/evidence/virgl-gears-shaders-verifier/authenticated-worker/hot/gpu-*/report.json target/evidence/virgl-gears-shaders-verifier/authenticated-worker/cold/acceptance/gpu-*/report.json target/evidence/virgl-gears-shaders-verifier/fresh-seed-*/report.json`.
The readonly guard uses only Node built-ins and is suitable for the recurring
acceptance command on `$evidence_dir/gpu-*/report.json` after the three recorded
seed runs. Root owns queue, Git and PR/seal preservation.

### 2026-10-04 — worker — preserve verified boundary

The independent critic sets `verified`. Its nonduplicate 54-record / 49-member
seal is now committed at `evidence/virgl-gears-shaders/verifier/`. Root
authenticated every member and bound the promoted guard to its unchanged
`9b118502814dd7634fda76c1fc6df0d9eba679dbd73a469f413d8fd637a1f3da` digest.
The recurring acceptance invokes the critic's exact raw-alpha guard immediately
after the three successful seed recordings. That direct invocation against all
nine authenticated hot/cold/fresh reports passes 432 exact words; Node and shell
syntax checks pass. This is harness plumbing for the promoted test; reviewed
compiler/runtime sources and recorded inputs remain unchanged. HELD numerical,
provenance, coverage and pristine-clone results carry forward. Production
negotiation and complete larger programs remain gated.
