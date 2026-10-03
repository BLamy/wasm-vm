---
id: E6-T12d
epic: 6
title: Replay the original three VirGL draws and readbacks in WebGL2
priority: 525.02695
status: verified
depends_on: [E6-T12c]
estimate: S
risk: high
capstone: false
---

## Boundary

Execute the textured scene's original DRAW_VBO packets: unsigned-short indexed
triangles, two RG32_FLOAT attributes, one instance and the recorded tint/blend
changes. Bounds-check actual index/vertex fetches; UINT_MAX max_index is an
unknown range hint, not authorization to access a huge buffer. Replay all eight
original submissions and required public lifecycle/backing inputs, preserving
command bytes, geometry, shaders, state, order and cleanup. Explicitly identify
the dependency-selected scene and excluded independent boot scanout events.

## Deterministic acceptance

`make verify-E6-T12d` replays all 210 original packets and three actual GPU draws.
Execute COPY_TRANSFER3D readbacks into staging offsets64/4160/8256, then assert
the independent workload's 768 exact interior pixels over all three phases.
Do not preload later recorded output snapshots or reconstruct state/geometry in
the harness. Bind every executed input to original event/hash/offset provenance.
Record GPU identity, emitted GLSL/reflection, frame-N command/binding dumps,
screenshots, output hashes, cleanup counts and zero browser errors. Complete
affected high-risk gates and one scrubbed pristine-clone replay.

## Adversarial verification

Independently mutate a vertex/index, texture texel, constant, blend factor and
readback offset; the relevant pixel or bounds oracle must fail. Poison reference
output snapshots and require unchanged actual pixels. Attack geometry bounds,
Y orientation, context/subcontext reuse, resource unref before object teardown,
invalid-tail recovery and resource budgets. No Mesa initialization, live guest
transport, production VIRGL advertisement or FPS claim follows this replay.

## Verification log

### 2026-10-03 — worker — activated

Follows independently verified object/state execution (`a768b341`, PR #409).
One explicit draw renderer extends the shared engine while retaining the existing
state-only factory. This slice validates actual index/vertex storage bounds and
replays the dependency-selected original scene: chronological public resource
initialization, eight unchanged submissions, three draws, staging readbacks and
ordered teardown. Unrelated boot scanout/fence transport remains excluded.
Scoped high-risk gates are the affected state/resource/decoder regressions,
hardware WebGL2 full replay with independent pixel and bounds oracles, input
sabotage, source-bound coverage and one final scrubbed clean clone. Production
web/Rust/device capabilities are unchanged; no Mesa or FPS claim follows.


### 2026-10-03 — worker — implemented

Frozen runtime/harness commit: `ab60a54e6b3c8bd1020065b7e78b847e3d91c65f`.

Commands:

- `EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_DRAW_EVIDENCE_DIR=evidence/virgl-draw/worker make verify-E6-T12d`
- `python3 tools/virgl-command/draw-cold.py --output evidence/virgl-draw/cold-clone`

The hardware recording executes the selected original context2/resources3–7
public initialization in chronological order, verifies zero attachment snapshots,
applies only the 92 selected original CPU input bytes, and executes all eight
unchanged submissions: 210 packets and three actual WebGL2 indexed draws. The
original VS/FS text passes through the real pinned Wasm bridge. Actual program,
attribute, index, framebuffer, constant and blend bindings are captured with
per-command provenance and reflected GLSL. COPY readbacks land in staging offsets
64/4160/8256; all 768 literal interior pixels match the independent workload's
three color/tint/alpha phases. Boot scanout context1/resources1–2 and fence
transport are explicitly excluded. Nested context-create97 is not duplicated.

The run passes 11,982 assertions and 37 rejection/recovery cases, including
actual index/UV fetch bounds, complete bindings, feedback, fixed-restart and
stride semantics, malformed-tail prevalidation, lowered/default draw budgets,
and A/B1/A/B2/A actual drawing with hostile host GL state. A positive offset6,
count3 draw proves the second indexed triangle with independent blue/yellow
probes and min1/max3 fetches. All 12,288 reference-output bytes are poisoned in a
second full replay with identical actual image hashes. Six independent input
corruptions (vertex/index/texel/constant/blend/readback offset) each fail the
intended pixel or bounds oracle. Original resource5 public removal before
submit249 preserves the retained surface until the recorded final unbind;
ordered cleanup finishes with zero allocations and owner budgets. Browser console,
page and request errors are empty on Chrome154 / ANGLE Metal / Apple M4 Max.
The worker screenshot was visually inspected. Existing state-only hardware,
its two corruption controls and native decoder/resource regressions pass.

Evidence and SHA-256:

- `evidence/virgl-draw/worker/receipt.json`:
  `09bd16273acbb6cb1efa8ab27c271b2b069f297afa3b00cc48eb60bd7771318e`.
- `worker/hardware/report.json` with full frame/command/binding dumps and
  source-bound `browser-coverage.json`; `browser.png` digest
  `3017afbbfc27d7b495da79df5a441f5013e2ae86cc4475f50252888369e51760`.
- Changed runtime `renderer/virgl-command/state.mjs`:
  `c435f8737b461bcbf2fc336fc257516e9f61729431a4046088772dbc2ac73edd`.
- Original full-image outputs in phase order:
  `f244dc2a7a61960cbad1f603961e4f324ec4f444367ca589744b3e60531f22e9`,
  `1d754556e8e0abc93bf12d0c6a44ffdbb6fe925dc7c96dbb8c30474d372d16ae`,
  `62f04d5e21e789af6ef74af17498e36c8bbb45788f296124fd64c80832751061`.
- `evidence/virgl-draw/cold-clone/report.json` records the same exact frozen head,
  fresh dependencies, scrubbed environment, empty status before/after, and a
  retained clone; cold receipt `f0a1e3ce227a4cb1702fa1e58c1d6123240f27104db31df7824e88f92128b5e1`, log
  `64fe62fc92245121eca4632ab72818cf683dd42daacfb61db7c2a8098ba8480a`.

This proves isolated captured command replay on actual GPU storage. Guest
virtio transport, production capability advertisement, Mesa activation and FPS
remain gated by later tasks. Fresh verification must challenge the changed draw
boundary and carry unchanged state/resource/compiler proofs forward.

### 2026-10-03 — fresh verifier — VERDICT: verified

Independent verifier; no implementation edits. Frozen source
`ab60a54e6b3c8bd1020065b7e78b847e3d91c65f`, diff from `a768b341`.
Predictions P1–P12 all HELD. Complete evidence points, per-hunk coverage and
promoted test commands: `evidence/virgl-draw/verifier/review.md`.

- Independent original replay executes all 210 packets and three actual draws,
  reproduces all three image hashes and applies chronological public teardown.
- 28,760 assertions cover 18 mutations across all six input families and three
  seeds, 36 real GPU-index/UV-bound rejection-and-recovery rounds, CPU/GPU index
  divergence, guarded relocated readback, subcontext restoration, retained index
  generation reuse, invalid-tail no-draw and quota prefixes. Final budgets zero.
- Both runtime sabotages and all worker/cold wire corruption controls are caught.
  Original reference-output poisoning leaves actual hashes unchanged; screenshots
  were visually inspected and baseline browser errors are empty.
- Audit passes 852 digest/source/oracle/cold checks. Every changed executable
  runtime range is covered; no D runtime waiver. Unchanged C proof carries forward
  with the final same-source C regression. Retained cold clone remains clean at
  the exact frozen head. No guest transport, capability or FPS claim follows.

Commands: `node evidence/virgl-draw/verifier/run-attacks.mjs`;
`python3 evidence/virgl-draw/verifier/audit-evidence.py`.
Independent attacks SHA256 `fe81359740246c8e221da67ff10bbd01160fab4633a5a77746c6996c53aef9e8`;
audit `9289ad8df75f979f406c869ce20cf44149960e01fb54bad682308e3af05fee20`.
