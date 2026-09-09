---
id: E5-T06b
epic: 5
title: WebGL2 presentation backend
priority: 506.2
status: verified
depends_on: [E5-T06a]
estimate: S
risk: medium
capstone: false
---

## Goal
Implement the WebGL2 `PresentBackend` behind E5-T06a's contract, uploading the core pixel
format without a per-pixel JavaScript swizzle and rendering it through a deterministic textured
quad.

## Boundary
This slice owns only `web/src/sink/webgl.ts`, its shader/texture lifetime, and backend-local
readback tests. It does not benchmark or choose between backends, handle context loss, or wire
the selected sink into the VM.

## Deliverables

- WebGL2 texture allocation, resize, `texSubImage2D` damage upload, and fullscreen-quad draw.
- Correct coordinate orientation, alpha behavior, and BGRA/RGBA channel mapping for the core
  `FrameSink` pixels.
- Readback tests for the same five golden patterns used by E5-T06a, including odd damage rects.

## Acceptance criteria

- [ ] Five golden patterns render pixel-identically to the Canvas2D oracle after readback.
- [ ] A partial rect updates only the rect, including x=1, width=3 on a non-power-of-two canvas.
- [ ] Alpha-zero pixels remain correct and do not expose prior framebuffer contents.
- [ ] Repeated texture resize/delete cycles leave no stale GL object or unbounded staging buffer.

## Verification command

`cd web && node --test tests/e5-t06b-webgl.test.mjs`

## Adversarial verification

Use odd canvas widths, x/y damage at each edge, a rect crossing an upload row, transparent
pixels over a nonzero background, and 1,000 alternating texture sizes. Run with WebGL debug
validation enabled and fail on any GL error or readback mismatch.

## Verification log

### 2026-09-04 — worker — implemented

- **WebGL2 backend — HELD.** Added shader/program and fullscreen-quad setup, texture allocation
  and resize, full-resource byte staging, `UNPACK_ROW_LENGTH`/`UNPACK_SKIP_*` damage uploads,
  fragment-shader `.bgra` conversion, top-row orientation, and explicit GL disposal.
- **Deterministic coverage — HELD.** Added the same five golden patterns as T06a, partial x=1 /
  width=3 readback, transparent/opaque alpha coverage, SharedArrayBuffer isolation, unpack-state
  cleanup, unavailable/non-word input rejection, and 1,000 alternating resize/present cycles.

Implementation commits: `15d9244`, `0883afd`.

Evidence: `evidence/e5-t06b/webgl-proof-2026-09-04.json` (SHA-256
`aa9cd3d3ecf533db1445f455c7c062ab6627f5d58f32a5ae97e67de21e89529b`) and
`evidence/e5-t06b/webgl-proof-2026-09-04.txt` (SHA-256
`80dfaed37ba3d6ba686f30605d6267a7ed78264f303dfa2d52bb9616d7941293`).

Command: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR
-u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T06b` — 2 syntax checks,
10 tests passed, 0 failed. A local Chromium/SwiftShader smoke rendered full and partial frames,
matched RGBA readback, reported `glError: 0`, and produced no console/page errors.

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The exact-head deterministic recording matches all five golden RGBA
  patterns, preserves alpha-zero pixels, updates only partial damage, and keeps x=1/width=3
  non-power-of-two uploads aligned with no vertical inversion.
- **Coverage — HELD.** The changed source view validation, shader swizzle/orientation, texture
  setup, row/skip upload, staging copy, resize, draw, disposal, and fail-closed input paths are
  exercised by the focused suite and the real Chromium smoke; .ts and `web/dist` projections are
  byte-identical.
- **Adversarial matrix — HELD.** The suite covers 1x1, a 128x64 stress fixture, alternating
  transparent/opaque values, SAB-backed input, 1,000 alternating texture sizes, and unpack-state
  cleanup; Chromium independently confirms partial readback and `gl.getError() == 0`.
- **Evidence integrity — HELD.** Evidence digest `aa9cd3d3ecf533db1445f455c7c062ab6627f5d58f32a5ae97e67de21e89529b`
  matches the checked-in proof artifact for exact head `0883afd53df9909c3adf374cf96c804026dee7d7`.

E5-T06b is verified; E5-T06c is the next eligible stack layer. Independent-machine, WebKit, and
host-layer rr runs remain excluded per the user's direction and repository evidence policy.
