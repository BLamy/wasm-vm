---
id: E6-T10a
epic: 6
title: Reuse VirGL TGSI shader translation in a bounded browser module
priority: 525.02701
status: implemented
depends_on: [E5-T06b, E5.5-T03bg]
estimate: S
risk: high
capstone: false
---

## Boundary

Extract the pinned MIT-licensed virglrenderer shader frontend into an isolated
WebAssembly module that converts bounded TGSI vertex/fragment text to GLSL ES300
and returns the binding/interface metadata needed by a browser command renderer.
Reuse upstream parsing and conversion. This is one translation boundary; no 3D
capability is advertised to Linux, no compositor is switched, and no guest GPU
acceleration or Hyprland compatibility is claimed by this slice.

The user explicitly authorized implementing guest graphics offload. Native shared
OpenGL contexts and native-only entrypoints prevent treating the full upstream
renderer as a drop-in browser module. Reuse its shader compiler, then implement
explicit guest-context state and command execution in later S slices.

## Deterministic acceptance

`make verify-E6-T10a`

- Pin upstream and toolchain, preserve licenses and reproducible generated data.
- Translate a small literal corpus covering VS/FS linkage, uniforms, texture
  sampling, arithmetic and alpha output; compile/link it in actual hardware
  WebGL2 and verify exact stable interior pixels for textured/blended draws.
- Return structured, bounded errors for malformed, oversized and unsupported
  stages; do not silently drop shader semantics. Exercise repeated failures and
  successes without corrupting the next conversion. Validate the wrapper under
  native sanitizers and a bounded hostile-input corpus.
- Record commands, compiler/module/source digests and browser renderer identity.
  A fresh clone builds and reproduces the direct acceptance. Do not describe
  browser-side test shaders as guest-rendered frames.
- Emulator runtime and its default 2D device remain byte-identical. This isolated
  renderer tool is not connected to the production demo yet; guest/browser
  integration, demo exposure and deployment belong to the later transport slice.

## Adversarial verification

A fresh critic checks the pin and license, predicts literal pixels independently
of the converter, mutates shader output to ensure the browser assertion fails,
attacks malformed text/unsupported stage/size limits, repeats failures followed
by valid translation, and checks source/output digests. Audit the JS/Wasm boundary
for lifetime, allocation and truncation mistakes. Every supported shader feature
must compile and execute in the recorded hardware-browser acceptance; extra
features are unsupported until separately exercised. Full emulator gates may be
carried forward where their source and dependency boundary are unchanged.

## Verification log

### 2026-10-03 — worker — activated

Parent `1d0e9c407cfbbf31dde02b116e301122540c5789`. The implementation continues
as a new stack layer. Initial inspection pins virglrenderer 1.3.0 at
`ca50e008863837e094747a69974dde3ae148aeaa`. A prior host probe established
hardware WebGL2/Metal and WebGPU access on this Mac; that probe is not evidence
of guest offload. Separate verification follows implementation.

### 2026-10-03 — worker — implemented

Frozen runtime `6993efb1540cf7f5a01f6c82b8dac32cee734b39`, parent layer
`1d0e9c407cfbbf31dde02b116e301122540c5789`. Recorded command:
`EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_SHADER_EVIDENCE_DIR=evidence/virgl-shader/worker make verify-E6-T10a`.
Native ASan/UBSan passed 8,769 calls, including 4,096 seeded mutations and all
six literal shaders. Hardware WebGL2 passed nine draws / 4,336 exact pixels,
13 structured rejections and 416 recoveries with zero browser errors. The
recording checks actual shader compilation/linkage, uniform and sampler types,
VirglBlock layout, vertex transforms, texture sampling and blending.

Evidence: `evidence/virgl-shader/worker/acceptance.log`, `worker/receipt.json`,
`worker/browser/report.json`, `worker/browser/browser.png`, relative to
`evidence/virgl-shader/`; cold-clone counterparts are under `cold-clone/`.
`provenance.json` records the scrubbed-environment clone, matching 93 source
digests and Wasm/JS outputs, 67 byte-identical upstream source comparisons and
unchanged emulator/demo paths. Wasm SHA-256:
`4263ea2ec1fddc8b19bf9922879eb7397ab23de9e1cce205a88a1da94e4528cb`.
Pinned PyYAML 6.0.2 regeneration reproduced all three generated files; command
and result are in the evidence README and `regeneration.log`.

The narrow straight-line profile is explicit; unselected upstream shader
features are not advertised or claimed tested. Existing upstream whitespace
and three native deprecation warnings are preserved with the pin. Runtime Rust,
its dependencies and production web bytes are unchanged, so unrelated emulator
gates carry forward. This is isolated renderer tooling, not a guest graphics
offload or compositor-performance claim. Awaiting the separate critic.
