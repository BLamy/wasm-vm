---
id: E6-T11
epic: 6
title: virtio-gpu 3D context plumbing — capsets, contexts, SUBMIT_3D, fences
priority: 611
status: pending
depends_on: [E6-T10]
estimate: L
capstone: false
---

## Goal
The Epic 5 virtio-gpu device grows the full 3D control plane: VIRGL feature negotiation,
capset queries, context lifecycle, 3D resources, transfer ops, command submission and
fences — validated by a null renderer that decodes every command into typed Rust enums,
so the guest Mesa driver initializes end-to-end before any pixel is drawn.

## Context
Per virtio-gpu spec: advertise VIRTIO_GPU_F_VIRGL; handle GET_CAPSET_INFO / GET_CAPSET
(serve capset blobs matching the E6-T10 decision — capset contents *are* the caps the
guest Mesa virgl driver will believe, so limits must reflect our WebGPU reality: max
texture size from adapter limits, no transform feedback streams, GLSL/ES level);
CTX_CREATE / CTX_DESTROY / CTX_ATTACH_RESOURCE / CTX_DETACH_RESOURCE;
RESOURCE_CREATE_3D (target/format/bind/width/height/depth/array_size/last_level),
RESOURCE_ATTACH_BACKING (guest-page sg lists), TRANSFER_TO_HOST_3D / FROM_HOST_3D with
box + stride/layer_stride semantics; SUBMIT_3D carrying the virgl command stream; fence
protocol (VIRTIO_GPU_FLAG_FENCE, fence_id, ordered completion on the ctrl queue).
Guest needs CONFIG_DRM_VIRTIO_GPU=y (Epic 5 kernel has it) and mesa-dri-gallium.

## Deliverables
- Control-queue handlers for all commands above, with strict validation (resource ids,
  ctx ids, backing bounds) returning ERR_* responses per spec — never panicking on
  malformed guest input.
- `Renderer` trait separating transport from rendering; `NullRenderer` impl that decodes
  SUBMIT_3D streams into typed virgl command enums (per the E6-T10 MVP subset; unknown
  opcodes logged with id + length, skipped per stream framing), completes fences in
  submission order, and records a replayable command log.
- Capset blobs generated from a Rust struct (not hand-hexed) with the E6-T10 limits.
- Fence bookkeeping: out-of-order completion forbidden on ctrl queue; cursor queue
  unaffected; instrumentation counters (submits, fences, bytes) in the debug UI.
- Guest bring-up doc: packages, modeset expectations, how to read `dmesg | grep virtio`.

## Acceptance criteria
- [ ] Guest dmesg shows `virtio-gpu: ... virgl 3d acceleration enabled`; `/dev/dri/card0`
      + renderD128 exist; Mesa loads the virgl driver without falling back to llvmpipe
      (verified via `EGL_LOG_LEVEL=debug eglinfo` under a KMS seat).
- [ ] `eglinfo`/`es2_info` complete without hanging: caps handshake round-trips and the
      renderer string from our capset appears.
- [ ] Running kmscube produces a decoded command log containing context create, resource
      creates, transfers, and DRAW_VBO ops with correct framing — no unknown-length
      desyncs across ≥1000 submits (the stream stays parseable to the end).
- [ ] Malformed submissions (fuzzed SUBMIT_3D bodies, sg lists pointing past RAM,
      TRANSFER boxes exceeding resource extents) return spec error responses; the device
      and machine survive a 10^6-case fuzz run without panic or memory error.
- [ ] All Epic 5 2D scanout behavior is regression-free (desktop still boots).

## Adversarial verification
Fuzz first: cargo-fuzz targets for SUBMIT_3D decode and TRANSFER_3D box math (integer
overflow in width*stride*depth is the classic hole) — any panic, OOB read of guest RAM,
or hang refutes. Attack fences: submit 100 fenced commands then immediately CTX_DESTROY;
missing or out-of-order fence responses refute. Attack resource lifetime: DETACH_BACKING
while a TRANSFER is queued, double CTX_ATTACH of one resource, use-after-destroy of a
resource id — spec errors required, UB refutes. Compare against a reference: run the same
guest under QEMU with virglrenderer and diff the *sequence* of control commands during
Mesa init (order may vary; missing handshake steps on our side mean our capset lies).
Confirm the no-fallback claim by deleting llvmpipe from the guest and re-running eglinfo.

## Verification log
(empty)
