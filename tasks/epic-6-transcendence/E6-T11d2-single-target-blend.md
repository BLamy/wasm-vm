---
id: E6-T11d2
epic: 6
title: Execute single-target blend equations and factors for guest qualification
priority: 525.027037
status: verified
depends_on: [E6-T11d1]
estimate: S
risk: high
capstone: false
---

## Boundary

Replace the two-form alpha-blend restriction with the pinned Gallium single-RT
ADD, SUBTRACT, REVERSE_SUBTRACT, MIN and MAX equations and all non-dual-source
GLES2 factors, independently for RGB and alpha. Preserve explicit rejection of
unknown factors/equations, dual-source, logic operations and multiple targets.
Validate source-only SRC_ALPHA_SATURATE; its alpha factor is one.

WebGL forbids mixing constant color and constant alpha in the RGB source and
destination factors. For exactly those combinations whose RGB equation uses
factors, fold the clamped source constant into a bounded fragment variant and
use native source ONE. Leave alpha unmodified. Bind the variant, owned blend
color and cache identity to the actual draw. MIN/MAX ignore their factors and
must not acquire this variant. Keep normal cases on native GPU blending.

No API/capset, live guest, performance or production negotiation claim follows
from this isolated prerequisite. E6-T11d remains blocked until full qualification.

## Deterministic acceptance

`make verify-E6-T11d2` authenticates the pinned C enum oracle, checks wire
decoding and negative boundaries in Node and the actual headed browser, builds
the fixed-memory Wasm shader bridge, and draws every supported RGB and alpha
factor pair and equation through original-form VirGL packets. An independent
rational oracle checks all raw framebuffer pixels with a stated one-unit UNORM8
quantization budget, including saturation, source/blend-color clamps, different
RGB/alpha equations, color masks and X-alpha storage. Record actual reflection,
blend parameters, shader variants, complete packets/banks and pixel bytes.

Record context A/B/A and subcontext restoration, varied asynchronous schedules,
program/state cache eviction, variant allocation/size/host-uniform failures and
recovery. Deliberately sabotage equation, factor and constant-fold upload; each
must fail its precise pixel oracle. Run affected retained renderer, raster,
resource, indexed and asynchronous gates, final exact-head clean clone, and
seal sources, raw pixels, browser captures and changed-line coverage for a
fresh verifier. Preserve older constant/compiler and private profile limits.

## Adversarial verification

Independently choose colors and mixed constant pairs, partial color masks and
RGB/alpha equations; test source saturation with destination alpha on both
sides of the minimum. Attack a last blend-color update, object destruction/ID
reuse, context restoration and evicted variants. Reject speculative native
WebGL support for forbidden mixed constants. Check clamping before source-factor
folding, alpha preservation, factor-free MIN/MAX and actual owned uniform values.
Exercise variant size, host-component and allocation bounds and prove cleanup.
Invent one bounded physical attack and sabotage the new oracle once. Every
changed runtime hunk needs a recorded execution or explicit narrow waiver.

## Verification log

Activation follows the independent E6-T11d1 verdict. The next concrete readiness
probe is an original-form CREATE_OBJECT BLEND carrying ADD with source ONE and
destination ZERO in both RGB and alpha: it currently rejects with
`unsupported-feature: Only standard additive alpha blending is supported.` The
production capset remains disabled while this minimum operation is repaired.

### 2026-10-09 — worker — recorded submission for fresh falsification

Frozen source `0ed130ff0b9a3efa1273ac485d87dad656efcef4`, diff from independently
verified parent `3c6295a93d6b088c62a5c6f1cc434f226e090340`. Commands:
`make verify-E6-T11d2`;
`python3 tools/virgl-command/blend-cold.py --output target/evidence/virgl-blend-cold`;
`python3 tools/virgl-command/blend-seal.py target/evidence/virgl-blend target/evidence/virgl-blend-cold evidence/virgl-blend/worker`.

Both full submissions pass. The exact-head pristine clone has empty status
before/after and scrubbed environment. Each run authenticates 390 source files,
the generated fixed-memory Wasm and 116 recorded artifacts. The 536 Node/wire
predicates admit 120 and reject 136 factor-field cases. The real headed hardware
browser draws 2,302 frames (589,312 pixels) and holds 23,637 predicates with zero
console/page/request errors. Its raw stream is independently recomputed using
Python Fractions, with at most one stored UNORM8/UNORM10 component unit accepted.
Every RGB and alpha pair/equation is drawn; mixed source constants, clamps,
alpha saturation on both minimum branches, masks, X-alpha, disabled zero fields,
terminal discard, destroyed/reused state objects, A/B/A and real subcontexts,
bounded eviction, later-task native fences and typed allocation/size/component
failures recover. Native settings, reflected variants, owned uploads, complete
packet/TGSI/ESSL frame dumps and V8 changed-source coverage accompany the pixels.

The physical source faults fail exactly at `rgb-0-1-1` (equation swap),
`rgb-0-1-4` (destination factor), and `rgb-0-7-8` (fold upload); raw pixels
independently contradict their predictions, with no unrelated browser error.
Affected I/H/G5 renderer/resource/indexed/async/raster gates and the promoted
three-seed cache attacks pass at this head. The unchanged compiler/private
profile semantics carry the independently verified D1 boundary. Early harness
runs found the system Bash empty-array/nounset case and the promoted cache
report's `sourceHead` field; these recording fixes precede the frozen full runs.

Evidence of record: `evidence/virgl-blend/worker/recording.tar.gz` (242 records,
9,896,153 bytes), archive SHA256
`ee7ef868a4e8d98e8121c37116a8d3d06497b6cc88ef3c9c4581254f3a522b1f`,
record-index SHA256
`1c6b9f26fae9591017986598f241272b084505d251e34460c5c315f322108d7c`.
Hot receipt `22d754268302c8ff528706d385ba11e76cd23dafb0a56b415a784af10eced6f7`;
cold receipt `7af314b1ded202c86688796d365b4629bd958eed6e7c8121e6e6b6438f6ccbc7`.
Unpacked working artifacts remain in `target/evidence/virgl-blend` and
`target/evidence/virgl-blend-cold`. This is an isolated normalized blend claim:
production capability negotiation stays disabled, with no guest boot or
performance claim. This worker does not set `verified`.

### 2026-10-09 — fresh verifier — VERDICT: verified

VERDICT: verified

Reviewed frozen source `0ed130ff0b9a3efa1273ac485d87dad656efcef4` from
verified parent `3c6295a93d6b088c62a5c6f1cc434f226e090340`; submission
`2b720fcac4da27b57397aa70ed3ba84a4d2c0b1e`. Predictions preceded state
inspection; runtime remained unchanged. Detailed predictions: `evidence/virgl-blend/verifier/predictions.json:1` SHA256 `2148bf33099f1c1738a10de6d52d622a2f916e6ab1ed95a551866724947482d2`.

- P1 authentication — HELD. Independently reopened all 242 worker members and checked
  sizes, archive/index digests, 780 hot/cold tracked-source bindings, 232 receipt files,
  actual served/coverage sources, exact fault substitutions, and generated hot/cold/current
  JS/Wasm equality. `evidence/virgl-blend/verifier/authentication.json:1` SHA256 `6605053aa65287e6ed19576c81b03ed62ea10dd9391fbaf4fdc9b42c8c576653`.
- P2 wire/native enums — HELD. Pinned C compiled/executed freshly with native and
  ASan/UBSan clang; both match the sealed enum output. Equations 0..4 and 15 source
  factors agree. Destination SATURATE, unknown/dual-source, active zero, logic/independent
  and extra targets reject with provenance. `evidence/virgl-blend/verifier/enum-audit.json:1` SHA256 `f1165432e44138a9cdbe408897f58388c39ff6e5d81e3fe0404997a390d6801c`; `evidence/virgl-blend/verifier/unpacked/hot/hardware/report.json:3483` SHA256 `84d292c2697d4eb5d0fa0dd45980a2823d906f94173022cfa4bb480144cfc9e8`.
- P3 physical equations — HELD. Independent exact IEEE32/Fraction packet decoding
  checked full dumps and all 589,312 pixels in each 2,302-frame original hot/cold run,
  including all 2,100 RGB/alpha pair/equation cases, masks, clamps and X-alpha storage.
  Maximum permitted deviation is one stored component unit. `evidence/virgl-blend/verifier/recording-audit.json:1` SHA256 `0ef34a9b30ee395e24ca999d97d7f3082ec360fa8df95e9f4d3aa3bb27629d01`.
- P4 fold/native settings — HELD. Actual cache identities/reflection/uploads use owned
  clamped source coefficients, native RGB ONE, and untouched alpha. MIN/MAX and terminal
  discard avoid the variant. `evidence/virgl-blend/verifier/hot-hardware-audit.jsonl:91` SHA256 `9f5bbeecafc4296982e11893a49ae98f69ad86b9ee62b1f66f98bf4de3e9b359` (original `evidence/virgl-blend/verifier/unpacked/hot/hardware/report.json:266711`, raw offset 92160, raw SHA256 `e9a410a2ae2930425475fc620d2b0099223d97be7fd3ead93e414b8da19cedd0`); `evidence/virgl-blend/verifier/hot-hardware-audit.jsonl:721` SHA256 `9f5bbeecafc4296982e11893a49ae98f69ad86b9ee62b1f66f98bf4de3e9b359` (original `evidence/virgl-blend/verifier/unpacked/hot/hardware/report.json:641195`, raw offset 737280, raw SHA256 `e9a410a2ae2930425475fc620d2b0099223d97be7fd3ead93e414b8da19cedd0`); `evidence/virgl-blend/verifier/gpu-1779033703/report.json:227930` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`.
- P5 lifetime/restoration/eviction — HELD. Fresh state-only A/B/A and subcontext draws
  restore colors, banks and factors after host poisoning; latest-color and destroy/reused-ID
  binding produce distinct predicted pixels. `evidence/virgl-blend/verifier/fresh-1779033703-audit.jsonl:2451` SHA256 `ac13389989bdcb00fea8102e7d80522b8456b3d2a971e615a1bf8ab02eb6fc54` (original `evidence/virgl-blend/verifier/gpu-1779033703/report.json:1690404`, raw offset 2508800, raw SHA256 `ecc5afdd634606029a0e5426ef4362357ff4890b3bd44bcfc75e7432a15768d9`); `evidence/virgl-blend/verifier/fresh-1779033703-audit.jsonl:2456` SHA256 `ac13389989bdcb00fea8102e7d80522b8456b3d2a971e615a1bf8ab02eb6fc54` (original `evidence/virgl-blend/verifier/gpu-1779033703/report.json:1693439`, raw offset 2513920, raw SHA256 `ecc5afdd634606029a0e5426ef4362357ff4890b3bd44bcfc75e7432a15768d9`);
  `evidence/virgl-blend/verifier/fresh-1779033703-audit.jsonl:2458` SHA256 `ac13389989bdcb00fea8102e7d80522b8456b3d2a971e615a1bf8ab02eb6fc54` (original `evidence/virgl-blend/verifier/gpu-1779033703/report.json:1694653`, raw offset 2515968, raw SHA256 `ecc5afdd634606029a0e5426ef4362357ff4890b3bd44bcfc75e7432a15768d9`); `evidence/virgl-blend/verifier/fresh-1779033703-audit.jsonl:2461` SHA256 `ac13389989bdcb00fea8102e7d80522b8456b3d2a971e615a1bf8ab02eb6fc54` (original `evidence/virgl-blend/verifier/gpu-1779033703/report.json:1696472`, raw offset 2519040, raw SHA256 `ecc5afdd634606029a0e5426ef4362357ff4890b3bd44bcfc75e7432a15768d9`); bounded program/state eviction: `evidence/virgl-blend/verifier/gpu-1779033703/report.json:224112` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`.
- P6 bounds/cleanup — HELD. Actual native allocation, GLSL-output and host-component
  failures reject before drawing, ordinary/mixed recovery succeeds, and disposal deletes
  all native objects and reaches zero budgets. Fresh linked location/index/type/size faults
  also reject. `evidence/virgl-blend/verifier/gpu-1779033703/report.json:224508` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`; `evidence/virgl-blend/verifier/gpu-1779033703/report.json:227420` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`; `evidence/virgl-blend/verifier/gpu-1779033703/report.json:226980` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`;
  `evidence/virgl-blend/verifier/gpu-1779033703/report.json:230180` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`; `evidence/virgl-blend/verifier/gpu-1779033703/report.json:228098` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`; `evidence/virgl-blend/verifier/fresh-audit.json:1` SHA256 `e349bdcef1e169164861ebf091edf7ebaab390c9314aae92e746df58c4a81b5b`.
- P7 schedules — HELD. Independent seeded physical runs exercise owned bytes after
  caller mutation and delayed real fences 0/1/3, with bounded completion and correct uploads.
  `evidence/virgl-blend/verifier/gpu-1779033703/report.json:226638` SHA256 `9295269be46d9b375f24b52fb3482758bddde1e0cb274922b6bd3f999036593e`; complete jobs/pixels in `evidence/virgl-blend/verifier/fresh-audit.json:1` SHA256 `e349bdcef1e169164861ebf091edf7ebaab390c9314aae92e746df58c4a81b5b`.
- P8 sabotage/oracle — HELD. All six original hot/cold faults fail their named equation,
  factor or fold pixel. Fresh actual fold sabotage deviates 25 units; promoted test detects
  91 units on its first frame: predicted `[108,149,164,41]`, observed `[123,149,255,41]`.
  Forging stored expectations to the corrupted actual value still fails the independent
  packet oracle. `evidence/virgl-blend/verifier/final-audit.json:1` SHA256 `6dd499ea01622edf37dd89967bdb8fbebc7b9a41f3b35fda4d31e14771d009b2`.
- P9 independent attacks/novel seam — HELD. Seeds 1779033703/3144134277/1013904242
  each pass 2,470 frames and 25,859 predicates with zero browser errors, using binary-exact
  sixty-fourth colors, all eight mixed classes, masks 1/2/4/8/11/14, distinct alpha equations,
  and both saturation minima. Novel physical nonidentity sampler-view/blend wrapper A/B/A
  composition preserves both semantics: `evidence/virgl-blend/verifier/fresh-1779033703-audit.jsonl:2468` SHA256 `ac13389989bdcb00fea8102e7d80522b8456b3d2a971e615a1bf8ab02eb6fc54` (original `evidence/virgl-blend/verifier/gpu-1779033703/report.json:1700713`, raw offset 2526208, raw SHA256 `ecc5afdd634606029a0e5426ef4362357ff4890b3bd44bcfc75e7432a15768d9`); `evidence/virgl-blend/verifier/fresh-audit.json:1` SHA256 `e349bdcef1e169164861ebf091edf7ebaab390c9314aae92e746df58c4a81b5b`.
  The promoted actual WebGL probe rejects all eight forbidden native pairs with
  INVALID_OPERATION and unchanged factors: `evidence/virgl-blend/verifier/final-audit.json:1` SHA256 `6dd499ea01622edf37dd89967bdb8fbebc7b9a41f3b35fda4d31e14771d009b2`.
- P10 coverage/carry — HELD. Every added runtime line (10 decoder, 56 state) has an
  authenticated positive V8 witness; zero hunk gaps. `evidence/virgl-blend/verifier/coverage-audit.json:1` SHA256 `ada9146038c6b73091647d4b87de34db6a2976eeeb67cf52f9bada2f6b755e15`.
  Narrow unreachable false arms of checked output/main and trusted draw-identity guards
  are classified individually, without waiving packet behavior: `evidence/virgl-blend/verifier/guard-waivers.json:1` SHA256 `d7890d42b93f24898b0765b490731e5fdd1e7652979ed9be52cf338ae8eab3e5`.
  The unchanged D1 checked compiler/private limits and older dependency HELD results carry
  forward after authenticating its 54-record seal and dependency equality; 44 affected
  retained hot/cold gates hold. `evidence/virgl-blend/verifier/carry-forward.json:1` SHA256 `0ae675ed2d23b147e52cd0507eba1874f8527674a8bec648bea535531db0f83c`.
- P11 isolation — HELD. The single final frozen-head pristine clone was clean before/after,
  scrubbed overrides and served its own matching generated fixed-memory Wasm. Actual retained
  clone artifacts were rehashed; another clone/full compiler run is unnecessary.
  `evidence/virgl-blend/verifier/authentication.json:1` SHA256 `6605053aa65287e6ed19576c81b03ed62ea10dd9391fbaf4fdc9b42c8c576653`.

Critic fixture correction (not a product refutation): the initial novel attack reused
public ID 92 for a sampler and view; the renderer correctly rejected it. The corrected
100/101/102 views pass with unchanged runtime. Initial evidence is preserved:
`evidence/virgl-blend/verifier/prediction-correction.json:1` SHA256 `b95e188dc52852d684135dde6bb7a08d8b73efbeac98acf4270812998b723ae2`.

SUITE: promote `renderer/virgl-command/tests/blend-boundaries.mjs` SHA256
`9ccadf5102df2c93d9b58a2f88c7a7a16b2b02e4f663bc3ac87c79fb3f70d7c7`.
`node renderer/virgl-command/tests/blend-boundaries.mjs --output evidence/virgl-blend/verifier/promoted`
passes 22 frames / 633 predicates. Critic replay/audit commands and native enum commands
are sealed with the reports, raw pixels, actual harnesses, captures and coverage.

Critic seal: `evidence/virgl-blend/verifier/recording.tar.gz`, 81 records,
5,600,794 bytes; SHA256 `7a3dd7bdd542f66e6d852b059be0145d4e93d5b8be0283ad4f41e2c71238ae64`;
record-index SHA256 `80f7601bc8573a3458de5606756012655d47f1d77d65406ed7c25a5c6802e0c3`. Reopened and rehashed every member.
No FAILED or NEEDS EVIDENCE acceptance result remains. Authority is confined to normalized
single-target blend; no production capset, guest boot, GPU portability or performance claim.
