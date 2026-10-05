---
id: E6-T12g6k
epic: 6
title: Lower captured fragment position and coordinate properties
priority: 525.02701058
status: implemented
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
for315 predetermined requests (285 accepted singles and284 accepted pairs).
285 unmodified pinned Mesa token/GLSL witnesses confirm POSITION semantics,
properties and exclusion from GENERIC interpolation metadata.8034 complete
predecessor responses and17170 promoted native/Wasm guards remain unchanged.
561 inert metadata attacks reject; four synthetic fragment ports retain all
simultaneous underlying numerical contracts and owned bank restrictions. The
ports are isolated obligation probes, not unchanged full compositor bodies.
Three physical headed Chrome/Apple M4 Max WebGL2 schedules checked298520 direct
owned/Mesa framebuffer pixels plus196608 actual synchronous/asynchronous indexed
consumer pixels. Every evaluated component exposes all32 bits through RGBA8.
X/Y half-centers, constant dyadic Z/W, copies, masks, aliases, numeric operations,
raw bits, neighboring GENERIC inputs, offset viewports, depth-range mapping and
clipped variable-W geometry meet independent rational/source predictions. Maximum
observed absolute error was exactly2^-21 on both backends, inside the measured
2^-20 variable-coordinate budget; no portable precision guarantee is claimed.
Indexed consumers restore poisoned native viewport/depth/raster state, own
poisoned caller packets, bind coordinate conventions in actual selector keys,
reject24 scoped attacks per consumer and dispose every object/budget. Async
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
Draft PR455: <https://github.com/BLamy/wasm-vm/pull/455>. Independent criticism is pending; dependents stay gated.
