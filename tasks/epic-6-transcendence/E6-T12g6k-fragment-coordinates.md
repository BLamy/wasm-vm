---
id: E6-T12g6k
epic: 6
title: Lower captured fragment position and coordinate properties
priority: 525.02701058
status: verified
depends_on: [E6-T12g6j2]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit only original POSITION fragment input plus FS_COORD_ORIGIN LOWER_LEFT and FS_COORD_PIXEL_CENTER HALF_INTEGER. Lower to explicit physical fragment coordinate semantics with correct stage/index/interpolation metadata. Preserve interface/output bounds and reject unsupported origins/centers. No discard opcode.

The original accepted declaration is full-mask `IN[0], POSITION, LINEAR`
with both explicit properties, in either order before instructions. Missing,
duplicate, foreign-stage or unsupported coordinate properties and POSITION
indices/masks/interpolation reject. The builtin is highp `gl_FragCoord`;
it never joins the ordinary GENERIC varying interface. An owned v38 wrapper
retains every underlying v1..v37 obligation and binds lower-left surfaces,
half-pixel single-sample rasterization, window-depth Z and reciprocal-clip-W
into the checked selector key. Existing input numerical/output authority
remains unchanged; no exact, finite, F2I or address-range facts are added.

Physical predictions use supplied clip-space vertices and independent rational
screen barycentrics. X/Y half-centers and constant dyadic Z/W cases are exact;
interpolated Z/W use an explicit measured absolute budget <=2^-20. RGBA8
readback exposes all four bytes of one evaluated component, including outside
viewport sentinel pixels. No portable accuracy or full-body claim follows.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6k`: Native/wasm metadata and actual GPU per-pixel x/y/z/w predictions for several framebuffer/viewport positions and dimensions, copied/raw/numeric coordinate uses and neighboring GENERIC inputs. Reflection, surface origin and shader-key binding must agree; zero errors/disposal and coordinate-source faults required.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

(empty)

### 2026-10-04 — worker — activated

The user requested continued guest graphics offload implementation. POW is
independently verified at `574d633c17c7436545195c63e534d9fa7859ac74`; its ten
predictions HELD,118-member critic seal was authenticated, and PR454 remains
open. Native stack layer `codex/virgl-fragment-coordinates` starts from that
exact prerequisite. Read-only geometry and primary-source preparation found
the literal original POSITION/LOWER_LEFT/HALF_INTEGER header, existing surface
and rasterizer conventions, and ESSL3.00's intrinsic highp gl_FragCoord. Use
native/Wasm closed metadata checks, actual physical full-word predictions,
varied seeds/schedules, source faults, one final pristine clone and a fresh
critic. Production capability and performance claims remain gated.

### 2026-10-04 — worker — recorded submission

Frozen source head: `c947442bad912ebcd46d3ff30a0e4c71be87ca4a`.
Runtime base: independently verified POW `574d633c17c7436545195c63e534d9fa7859ac74`.
Commands: `make verify-E6-T12g6k`;
`python3 tools/virgl-fragment-coordinates/cold.py --output target/evidence/virgl-fragment-coordinates-cold-final`;
`python3 tools/virgl-fragment-coordinates/seal.py --hot target/evidence/virgl-fragment-coordinates --cold target/evidence/virgl-fragment-coordinates-cold-final --output evidence/virgl-fragment-coordinates/worker`.

The frozen recording demonstrates strict admission of the original explicit
POSITION/LOWER_LEFT/HALF_INTEGER header and complete native/Wasm singles/pairs
for 315 predetermined requests (285 accepted singles and 284 accepted pairs).
285 unmodified pinned Mesa token/GLSL witnesses confirm POSITION semantics,
properties and exclusion from GENERIC interpolation metadata.8,034 complete
predecessor responses and 17,170 promoted native/Wasm guards remain unchanged.
561 inert metadata attacks reject; four synthetic fragment ports retain all
simultaneous underlying numerical contracts and owned bank restrictions. The
ports are isolated obligation probes, not unchanged full compositor bodies.
Three physical headed Chrome/Apple M4 Max WebGL2 schedules checked 298,520 direct
owned/Mesa framebuffer pixels plus 196,608 actual synchronous/asynchronous indexed
consumer pixels. Every evaluated component exposes all 32 bits through RGBA8.
X/Y half-centers, constant dyadic Z/W, copies, masks, aliases, numeric operations,
raw bits, neighboring GENERIC inputs, offset viewports, depth-range mapping and
clipped variable-W geometry meet independent rational/source predictions. Maximum
observed absolute error was exactly 2^-21 on both backends, inside the measured
2^-20 variable-coordinate budget; no portable precision guarantee is claimed.
Indexed consumers restore poisoned native viewport/depth/raster state, own
poisoned caller packets, bind coordinate conventions in actual selector keys,
reject 24 scoped attacks per consumer and dispose every object/budget. Async
rejections perform only bounded completion-fence synchronization. Four actual
emitted-source X/Y/Z/W corruptions fail the original pixel predictions. Browser
console/page/request errors and sanitizer diagnostics are zero. The pristine
scrubbed clone passed the entire same acceptance command at the frozen head,
with clean status before/after; both original sanitizer binaries and profiles
are sealed. No public capability changed, so the demo/deployment gate does not
apply to this private, unnegotiated boundary. No live guest-offload, FPS or MIPS
claim follows.

Raw recordings: `target/evidence/virgl-fragment-coordinates/` and
`target/evidence/virgl-fragment-coordinates-cold-final/`. Clean clone:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-fragment-coordinates-cold-_69yxvmu/wasm-vm`.
Sealed evidence: `evidence/virgl-fragment-coordinates/worker/`.
127 archive members authenticated. Archive SHA256 `8bba25788029785c57fd48b2f1a47a522856b178f4b3d5025f14adce43c7d8e2`; record-index SHA256 `e6c6ab2af48ff5ca58e0794e163ee38075ead285f04c3df6ee822bb33d521bad`.
Hot receipt `0035f91e92b4c47d05e39367d24e06dfe243fd1941d1a336b2d0b8a7afdd6e9d`; cold report `821210827dd50ba460b65a279b79f257da68a558ac79f8c8a15454913b474130`; cold receipt `e865adb3109c71d8fae482c401a374fce294387e992c5d43ce17879f237e5776`.
Draft PR #455: <https://github.com/BLamy/wasm-vm/pull/455>. Independent criticism is pending; dependents stay gated.


### 2026-10-04 — fresh critic — VERDICT: verified

Frozen runtime `c947442bad912ebcd46d3ff30a0e4c71be87ca4a` against verified
POW `574d633c17c7436545195c63e534d9fa7859ac74`. The fresh critic wrote all
predictions before inspecting worker state and made no implementation edits.
`make verify-E6-T12g6k` passed at promoted guard/wiring head
`0eb794639b408c80aa6f35688bf85e15a433a845`, using
`VIRGL_COORDINATE_EVIDENCE_DIR=target/evidence/virgl-fragment-coordinates-critic-current`.
The complete run and actual critic artifacts are sealed under
`evidence/virgl-fragment-coordinates/verifier/`.
Archive SHA256 `a05686aa76631217e32eb2b598b48fc0305a0ab43e5b692d0934aad82323edc2`;
record-index SHA256 `50372d59bfdca970e0ff520572c18bf0f4f0916222ed0190f2c2bff01b6672d4`;
verdict SHA256 `a5f446813901b5e54b09e4330c604450d7cac3b1ce3461b893f77d71d6393c77`;
predictions SHA256 `31d879d5b2e5dec5c331378378e7aac1cedc67be74762b3371a80e44595aa181`;
manifest SHA256 `379c15316fe4e359e89e530f1c577fa185bbbbc05c43eb64952dcb6aa650520e`.
All following archive points have full digest bindings in the record index and
`critic/verdict.json#/predictions`.

- P1 authenticity — HELD. All 127 worker members and 795 source bindings authenticate; both actual original sanitizer binaries/profiles remain preserved. Point: `critic/authentication.json#/members`, `critic/native-replays.json#/records`.
- P2 primary semantics — HELD. Literal original lines 1–4, 285 unmodified Mesa token/GLSL witnesses and TGSI/ESSL conventions agree. Point: `critic/source-semantics.json`, worker `generated/coordinate-primary.json#/0/primary`.
- P3 admission/authority — HELD. Original/reordered headers accept; invalid conventions, masks, bounds and coordinate-derived numerical fact laundering reject in 380 complete native/Wasm singles/pairs. Complete original bodies retain their admissions. Point: `acceptance/independent-coordinate-guards.json#/native`, `critic/carry-forward.json#/rejectedCompleteBodies`.
- P4 wrapper/banks — HELD. All simultaneous underlying obligations survive; 561 original and 32 novel inert metadata attacks invoke zero getters, with four combined ports and 480 novel owned-bank cases. Point: worker `hot/consumer.json#/combined`, `acceptance/independent-coordinate-guards.json#/banks`.
- P5 interface/key — HELD. POSITION stays outside GENERIC linkage, including GENERIC0/7; actual keys bind the complete convention and forged selectors reject atomically. Point: `critic/gpu-3737844652/report.json#/acceptance/consumers/0/pairRequests`.
- P6 geometry/budget — HELD. Independent literal clip geometry and determinant barycentrics check 657,696 complete words across four distinct seeds. Exact XY/dyadic cases and outside sentinels hold; maximum variable-derived error 2^-21 is below 2^-20. Point: `critic/fourth-capture.json#/transcript/294`, raw SHA256 `680a769f44a0d90b2be014160c61311e977b36426a5c70214ebce219435a995d`, (3,1), actual 1080981990 / predicted 1080981992.
- P7 versions/masks — HELD. Forward literal-source execution snapshots old operands; saved/reversed/killed versions, masks, raw/numeric operations and UIF agree with physical words and 300 novel version guards. Point: `critic/fourth-capture.json#/transcript`, `acceptance/independent-coordinate-guards.json#/predictions`.
- P8 hardware/reflection — HELD. Headed WebGL2 Metal/Apple M4 Max, zero browser/GL errors, successful compile/link, no FragCoord uniform, COLOR0 at 0 and 8,173 created objects all disposed. Point: `critic/gpu-3737844652/report.json#/browser`, `#/acceptance/events`, `#/acceptance/objects`.
- P9 actual async ownership — HELD. Both indexed consumers restore poisoned viewport/depth/raster state, own poisoned packets, match A/B/A pixels and reject 24 attacks each; async events are bounded completion fences and all budgets finish zero. Point: `critic/gpu-3737844652/report.json#/acceptance/consumers`.
- P10 sabotage — HELD. Original hot/cold emitted X/Y/Z/W faults contradict the independent oracle. Isolated actual runtime admission mutation, wrong promoted-test mask and jointly forged pixel/cache word all fail at the intended point. Point: `critic/hot-capture-fault-x.json#/transcript/0/failurePoints`, `critic/hot-capture-fault-w.json#/transcript`, `critic/sabotage.json#/records`.
- P11 coverage/carry — HELD. 118 changed runtime lines execute in original LLVM/V8/Node recordings; nine nonexecuting lines are individually waived below; zero executable gap. Ten unchanged predecessor HELD predictions carry by source boundary/digest. Point: `critic/coverage-audit.json#/lines`, `critic/carry-forward.json#/priorVerdict/predictions`.
- P12 cold isolation — HELD. Authenticated pristine scrubbed c947442b acceptance passes clean before/after. Test/wiring-only promotions preserve that proof; no redundant clone. Point: `critic/authentication.json#/cold`, `critic/final-acceptance.json`.
- P13 novel attack — HELD. Eight-register POSITION+GENERIC0/7, missing producers/ninth-register, masked versions, nonfinite/subnormal/signed-zero banks and inert metadata hold. Fresh preplanned seed 3737844652, step size 2, checks 162,568 words and 48 rejections. Point: `critic/fourth-command.json`, `critic/fourth-capture.json`, `acceptance/independent-coordinate-guards.json#/predictions`.

Waivers, each bound to the original measured profiles in `critic/coverage-audit.json`:
`bridge.c:988` COLOR0 comment; `:1013` direct-MOV comment; `:1334` GENERIC comment;
`:1531` signature generates no instruction, body 1532–1534 executes 1,138 times
per original profile; `:1535` blank separator; `raw_bits.h:36` comment;
`:37` compile-time feature bit with executed uses 1014/1387/1577;
`:38` compile-time separation assertion passes native/Wasm builds;
`:153` field declaration with executed reads/writes 981–985/1009 and matching
native/Wasm descriptors. No runtime behavior was waived.

SUITE: promote `tools/virgl-fragment-coordinates/independent-guards.mjs` and
`capture-check.py` into the acceptance target and receipt, committed at 0eb79463.
Source sabotage used an isolated copy only. Original hot/cold binaries/profiles,
actual supplementary replay profiles, new captures and sabotage inputs/results
are sealed. Physical accuracy remains measured for this configuration; the
combined/copy ports are isolated obligation probes. Original complete compositor
bodies, production caps/public imports, guest integration, FPS and MIPS stay gated.
