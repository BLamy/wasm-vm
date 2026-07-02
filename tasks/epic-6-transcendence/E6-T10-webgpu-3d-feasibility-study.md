---
id: E6-T10
epic: 6
title: WebGPU 3D feasibility study — virgl vs venus decision document
priority: 610
status: pending
depends_on: [E5]
estimate: M
capstone: false
---

## Goal
An evidence-based, written go/no-go decision on the guest-3D backend: virgl (Gallium-level
GL command stream) versus venus (serialized Vulkan) translated to WebGPU — grounded in
captured real command streams and a WebGPU capability audit, so E6-T11/12/13 build the
path that can actually ship instead of the one that sounds best.

## Context
This is research-heavy and must be honest. virtio-gpu context types select the protocol:
virgl capsets 1/2 (Mesa's `virgl` Gallium driver, TGSI shaders, GL2.1/ES2-ish state
machine — host normally implements it with virglrenderer on real GL), venus (Mesa `vn`
Vulkan driver, serialized VK 1.1+ commands), plus cross-domain/gfxstream as prior art
(crosvm's rutabaga_gfx is the reference abstraction). The hard truth to evaluate: venus
needs Vulkan semantics WebGPU cannot express — arbitrary descriptor indexing, memory
aliasing/sparse binding, pipeline barriers, timeline semaphores, geometry/tessellation,
SPIR-V caps beyond WGSL — so full venus is likely infeasible; virgl at an ES2-level capset
maps far better but still hits WebGPU gaps: no transform feedback, max 4 bind groups,
no line width >1, no point sprites, limited texture formats, WGSL-only (TGSI→WGSL
translation needed). Guest side matters equally: Alpine riscv64 ships `mesa-dri-gallium`
(includes virgl) and `mesa-vulkan-*` — verify exact package coverage.

## Deliverables
- `docs/gpu-3d-decision.md` containing: (a) capability matrix — virgl opcode families and
  venus VK feature classes vs WebGPU/WGSL, each row supported/emulable/impossible with a
  sentence of justification; (b) command-stream evidence — capture real streams from QEMU
  +virglrenderer (`VREND_DEBUG=all`) for kmscube, es2gears, glmark2-es2, and an X/Wayland
  desktop session, with opcode histograms showing what an MVP must cover; (c) guest
  driver audit — exact Alpine riscv64 Mesa packages and which capset versions they
  require; (d) the decision, an explicit out-of-scope list, and a risk register.
- Prototype spikes checked into `spikes/`: TGSI→WGSL hand-translation of the three most
  common shader patterns from the captures, running under raw WebGPU in a test page.
- A recommended MVP command subset (numbered virgl opcodes) for E6-T12.

## Acceptance criteria
- [ ] The capability matrix covers 100% of opcode families present in the captured
      streams (no "TBD" rows for observed opcodes).
- [ ] Histograms from ≥4 captured workloads are included with capture commands that a
      third party can rerun.
- [ ] The three spike shaders render correctly in a WebGPU test page on Chrome and
      Firefox Nightly (screenshots + code committed).
- [ ] The decision names what is *not* supported (e.g. transform feedback, GL4 desktop
      apps) and E6-T13's target app list is chosen to be achievable under it.

## Adversarial verification
Refute by evidence, not taste. Re-capture one workload independently and diff the opcode
histogram against the doc's — a materially different distribution (>10% opcode families
missing) refutes the evidence claim. Pick the three hardest matrix rows marked
"emulable" and demand the emulation sketch: if TGSI control flow, integer ops, or
FBO/format rows hand-wave over a WGSL limitation (e.g. no gl_FragDepth equivalent
mismatch, missing texture format), that row is refuted and the matrix reopened. Check
the guest-side claim by actually installing the named Mesa packages in the Epic 3 guest
and confirming the virgl DRI driver loads (`LIBGL_ALWAYS_SOFTWARE=0 eglinfo` in a KMS
session shows virgl once E6-T11 lands — at this stage, verify the .so exists and links).
If the decision picks venus, refute by demonstrating any captured vn stream uses a VK
feature the matrix marked impossible.

## Verification log
(empty)
