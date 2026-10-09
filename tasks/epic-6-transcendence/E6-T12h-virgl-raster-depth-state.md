---
id: E6-T12h
epic: 6
title: Execute required VirGL raster depth and vertex state without coordinate drift
priority: 525.02702
status: verified
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

### 2026-10-09 — fresh adversarial verifier

VERDICT: verified

Predictions P0–P8 were recorded in `predictions.json` before opening worker
evidence. Reviewed production/harness diff: `10adfaaf..49c408e1`; submission
`e07ca745888b0119ea86133acc179a9b982a0411`. The critic changed no implementation
or worker harness. Detailed points and SHA256 digests are in the sealed
`verdict.json`; paths below are members of the critic seal or, for `hot/…`, the
authenticated worker archive.

- **P0 custody — HELD.** All 126 unique regular worker members, exact frozen
  source bindings, served/fixture/coverage/screenshot hashes and generated
  Wasm/JS authenticate. Hot/cold binaries agree. The final cold clone names
  `49c408e1`, passes the same gate with scrubbed overrides and is pristine
  before/after; it was carried without repeating the clone. Post-freeze
  submission changes are only lifecycle/log/queue and sealed records.
  Citation: `authentication.json`; worker archive
  `c49cbffdd4e273b0a38ed4ed49bea91553ef78fab5c347f77f4acd81d179ca78`.
- **P1 original wire/state — HELD.** An independent little-endian packet walk,
  without worker decoder/fixture helpers, reconstructs six cube and three
  gears physical array-strip draws. RGB/RG sizes, strides, offsets, resource
  roles, complete active VS constant words, original negative-Y viewport,
  system Y=-1, GL clip depth, CW/back culling and actual Z16 match. Original
  CPU inputs bind snapshots 139/152/5112/5113/5114. Citation: `wire-audit.json`;
  each draw carries its original capture/event/packet offset and hash.
- **P2 depth — HELD.** The drawn mid-depth blue occluder remains blue behind
  z=0.999; z=-0.999 produces green. All eight comparison enums have the stated
  zero-depth outcomes, and disabled writes preserve the occluder. Independent
  literal pixel matrices reproduce the recorded full-frame digests across
  hot, cold and the critic replay. Citation: `pixel-audit.json`,
  `hot/hardware/report.json` and `acceptance-replay/report.json`.
- **P3 coordinates/scissor/adjacent state — HELD.** Scissor [3,5,7,6] produces
  exactly the lower-left rectangle with a full black clear outside. Empty
  scissor and no-op update, asymmetric positive/negative-Y samples, winding,
  and adjacent depth/blend/scissor/Y toggles hold. The independent audit checks
  81 whole-frame matrices and 24 asymmetric samples. Primary pinned upstream
  Git source `ca50e008…`, SHA256 `be7e5c63…`, confirms viewport, scissor,
  lower-left winding, full-clear masks and the inert bottom-edge field.
  Citations: `pixel-audit.json`, `source-conventions.json`.
- **P4 ownership/rejection/keys — HELD.** Bad alignment, final fetch, signed
  range, missing attributes, foreign/role-swapped/mismatched attachments and
  missing active Z16 reject before a draw with zero GL errors. Poisoned A/B/A
  frames preserve A's exact hash. Public depth name/ID reuse retains the old
  native16 attachment and all native budgets release at disposal. Shader keys
  preserve selector/interface/view dependencies; new dynamic state restores
  without shader emission changes. Citations: `hot/hardware/report.json`,
  current retained state/draw/view reports, `review-audit.json`.
- **P5 schedules/carried proof — HELD.** Owned arrays issue three actual draws
  from copied bytes and retire after real later-task completion fences, with
  no synchronous/asynchronous GPU index reads. Worker delays0/1/3 and critic
  PRNG seeds 1956311333/2789420567/728079433 hold. The unchanged G6 critic seal
  authenticates all 54 members; 113 source bindings, including compiler and
  resource boundaries, are unchanged. Current G5 gates cover affected state
  and decoder paths. Citations: `independent/report.json`, `carry-forward.json`.
- **P6 source-fault sensitivity — HELD.** Depth direction, winding, negative Y,
  scissor and RGB fetch-size mutations alter the exact served runtime and fail
  their named physical pixel predictions. All normal/fault/replay/critic
  captures bind the actual Apple M4 Max ANGLE Metal identity and zero browser
  errors. Citations: `authentication.json`, `review-audit.json`.
- **P7 coverage — HELD.** Authenticated precise V8 ranges execute all 22 added
  decoder lines and 72 executable state lines. Four comments are waived;
  documentation/declarative metadata and non-happy validation plumbing are
  classified explicitly. Changed historical assertions execute in the retained
  current gates. No ignored tests, disabled assertions, Rust/compiler change
  or production web import appears in the diff. Citations:
  `coverage-audit.json`, `review-audit.json`.
- **P8 bounded novel attack — HELD.** RGB32F stride12/start3/count3 accepts72
  bytes (firstByte36/requiredEnd72), rejects68 before drawing and preserves
  state/image. A real indexed RGB strip also succeeds. The promoted physical
  regression passes 346 predictions. Faulting only the final complete-fetch
  predicate to subtract8 attempts an extra draw: the independent RGB68 no-draw
  prediction fails with count1→2. Citations: `independent/report.json`,
  `sabotage-rgb-tail/report.json`.

**SUITE:** Promote `renderer/virgl-command/tests/raster-depth-boundaries.mjs`:
literal exact/truncated RGB bounds, indexed strips and independent owned
schedule/fence assertions, with a direct deterministic physical command and
isolated source sabotage. Preserve existing affected gates and immutable
recordings. No product refutation or proof gap survived. Authority remains
isolated original draw state; matched full-client artwork, real guest
negotiation/execution and FPS/MIPS are not certified by this task.

Critic commands (all exit0 except the required named sabotage, exit1):

- `python3 evidence/virgl-raster-depth/verifier/authenticate.py`
- `python3 evidence/virgl-raster-depth/verifier/wire_audit.py`
- `python3 evidence/virgl-raster-depth/verifier/coverage_audit.py`
- `node renderer/virgl-command/tests/raster-depth-boundaries.mjs --output evidence/virgl-raster-depth/verifier/independent`
- `node renderer/virgl-command/tests/raster-depth-boundaries.mjs --output evidence/virgl-raster-depth/verifier/sabotage-rgb-tail --sabotage rgb-tail`
- `node tools/verify-virgl-raster-depth.mjs --output evidence/virgl-raster-depth/verifier/acceptance-replay`
- `python3 evidence/virgl-raster-depth/verifier/pixel_audit.py`
- `python3 evidence/virgl-raster-depth/verifier/review_audit.py`
- `python3 evidence/virgl-raster-depth/verifier/write_verdict.py`
- `python3 evidence/virgl-raster-depth/verifier/seal.py`

Review seal: `evidence/virgl-raster-depth/verifier/{manifest.json,records.json,recording.tar.gz}`.
All 28 members re-authenticate. Archive SHA256
`6d25b4f232fe98f58e1b2bf2722679f0a84cbdc206fb4113334845f690a21ae9`;
index SHA256 `303245eb3708a29233293edcc218d8f68558bc8694b748d3001b444edc3ed06f`.
Predictions and verdict also remain directly readable beside the seal.
