---
id: E6-T12h
epic: 6
title: Execute required VirGL raster depth and vertex state without coordinate drift
priority: 525.02702
status: implemented
depends_on: [E6-T12g6]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement the additional captured kmscube/es2gears draw-state requirements over
the eight-object engine: scissor, depth/stencil behavior, supported culling and
winding, vertex formats/layouts and constant-buffer bindings. Keep unsupported
instancing/primitive/point/line variants explicit rather than silently ignoring
their fields. Preserve GL clip space, framebuffer Y origin, front-face winding
and pixel centers; WebGL2 already uses GL clip depth, so do not import the
obsolete WebGPU [-1,1]-to-[0,1] remap. Document shader-key dependencies.

## Deterministic acceptance

`make verify-E6-T12h` executes independently checked recorded state/draw cases
and literal occlusion/scissor/winding tests. Draw fullscreen triangles at
z=0.999 and z=-0.999 against a mid-depth occluder and require correct pixels.
Exercise required vertex/constant layouts, actual shader reflection and state
restoration across A/B/A contexts; retain tiny-scene and format regressions.
Record all admitted state fields, browser/GPU identity and zero GL errors.
Run affected high-risk gates and a final pristine-clone proof.

## Adversarial verification

Toggle depth, blend, scissor and orientation between adjacent draws; poison
host state and reuse handles across contexts. Attack fetch alignment/stride,
missing attributes, incompatible target state and shader-key mismatches.
Sabotage depth direction or winding and require failure. Additional independent
feature families discovered during workload bring-up need separate S tasks.

## Verification log

### 2026-10-09 — worker — activation

Continue the production graphics dependency chain explicitly requested by the
user. E6-T12g6 is independently verified at `10adfaaf3badf5f70ad9375f4e0bff6a615418f6`.
This high-risk boundary adds actual required draw/state behavior to the isolated
renderer; it does not yet advertise guest acceleration or claim live FPS/MIPS.
Original client packets require triangle strips, RGB32F fetches, negative-Y
viewports, lower-left winding and Z16 depth attachments. Active stencil,
instancing, points/lines and other unsupported fields remain explicit errors.


### 2026-10-09 — worker — implemented

Frozen source/harness: `49c408e10b2a5126157f099765b2da6890dd2c16`.
Task base: independently verified G6 at `10adfaaf3badf5f70ad9375f4e0bff6a615418f6`.

Commands (all exit0 at the frozen head):

- `make verify-E6-T12h`
- `python3 tools/virgl-command/raster-cold.py --output target/evidence/virgl-raster-depth-cold`
- `python3 tools/virgl-command/raster-seal.py target/evidence/virgl-raster-depth target/evidence/virgl-raster-depth-cold evidence/virgl-raster-depth/worker`

The recording executes the complete original first client submissions (six
kmscube strips and three es2gears strips), with the immutable CPU snapshots
139/152/5112/5113/5114, all original constant banks, actual reflected attributes,
RGB32F/RG32F fetches, negative-Y viewports, lower-left front-face/culling, and the
real sixteen-bit gears depth attachment. `hardware/report.json` records exact
original command/draw citations and actual GL state; readback digests record
those client draws without claiming a matched final artwork image. The 157
native guard predictions and 759 hardware predictions hold. Separate literal
physical scenes cover z=±0.999 against a drawn mid-depth occluder, all eight depth
compare functions at exactly representable depth zero, write-mask preservation,
full color/depth clears, depth-only FBOs, empty/partial scissor, asymmetric Y and
winding, adjacent depth/blend/scissor/orientation toggles, missing/foreign/mismatched
attachments and attributes, actual vertex bounds, poisoned A/B/A contexts and
public depth name/ID reuse. Every owned nonindexed job issues three GPU draws
and retires through an actual later-task completion fence under delays0/1/3;
no synchronous or asynchronous GPU index read occurs. Every normal and fault
browser run records its physical ANGLE Metal GPU identity and zero browser
errors. Depth-direction, winding, negative-Y, scissor and RGB-fetch-size source
mutations fail the five named independent physical pixel predictions.

The same frozen gate retains current decoder/resource/state/indexed-draw/async/
color/depth/view/inline regressions, their physical inline offset/stride faults,
and the promoted format-role test. The depth leaf's historical assertion that
framebuffer binding was still closed is updated to exercise H's admitted binding.
No Rust or compiler numeric semantics changed, so unrelated workspace walls and
unchanged compiler proof leaves are not repeated. The renderer is still isolated
from production web imports; guest negotiation, live guest execution, matched
full-client artwork and FPS/MIPS remain subsequent tasks.

The pristine final clone is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-raster-cold-ybwo2yv7/wasm-vm`.
It has the exact head, scrubbed compiler/Node/Python/Rust overrides, and no tracked
or untracked changes before/after the same acceptance. Hot evidence:
`target/evidence/virgl-raster-depth`; cold evidence:
`target/evidence/virgl-raster-depth-cold`. Screenshots and precise V8 runtime
coverage are hash-bound inside the reports. The committed worker seal contains
126 regular records / 4,688,113 archive bytes:
`evidence/virgl-raster-depth/worker/{manifest.json,records.json,recording.tar.gz}`.

- Archive SHA256: `c49cbffdd4e273b0a38ed4ed49bea91553ef78fab5c347f77f4acd81d179ca78`
- Index SHA256: `7126f218b7e944b92a66f41e9ea1b76cd07b31f309c0a74c532e02736a7181f7`
- Hot receipt SHA256: `5333dd56678bbddbd817509906851221afe12fde4fe88f73ebf3c3a2c895f825`
- Cold receipt SHA256: `dc1d2be8e66d5fed012cf7ea6ffd7c5630c4de48f326c2b0ba1d8fc196d0a5ff`
- Cold report SHA256: `5c981a07cf1b1119bfd7f83c0e028fb3fc5eccb704cc861b59f0957cb55fe2db`

Submission remains a worker claim until a fresh adversarial verifier audits the
diff, source coverage, original wire join, literal pixels, fault sensitivity and
record custody. No production deployment or merge is claimed or performed.
