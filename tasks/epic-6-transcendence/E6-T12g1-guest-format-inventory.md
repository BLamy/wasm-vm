---
id: E6-T12g1
epic: 6
title: Capture unmodified guest es2gears and inventory required resource/view packets
priority: 525.0270101
status: implemented
depends_on: [E6-T12f6]
estimate: S
risk: high
capstone: false
---

## Boundary

Pin the official Mesa demos source archive, cross-build its unmodified
es2gears Wayland client against the immutable guest sysroot, and capture it
through the existing real RISC-V/Mesa/VirGL reference pipeline. Close the actual
client window through compositor IPC and require its real zero exit; a watchdog
kill cannot count as completion. Preserve source/build/library/binary/recorder
and guest BEGIN/END provenance, every submission and backing snapshot. Keep the
four old captures and nineteen-hash shader claim immutable.

Derive the kmscube and es2gears client requirements directly from authenticated
resource creates and original surface/view/sampler/transfer/draw packets, with
context/event/byte/digest citations. Separate supporting-compositor traffic from
the gears client. Record formats by role, flags/origin, channel order, swizzle,
levels/layers/targets/filtering, inline-write use and any new unchanged shader
bodies. This slice adds no renderer mapping, caps or performance claim.

## Deterministic acceptance

`make verify-E6-T12g1` validates the complete committed real capture, pinned
unmodified workload inputs/build and client draw/exit provenance; reconstructs
its required-format/view inventory; rejects provenance/packet/output mutations;
retains the four old captures and affected recorder/framing regressions. Record
the actual guest run at frozen source and a final pristine-clone acceptance.
Report new shader admission or format gaps as requirements for later slices,
never as inferred browser support.

## Adversarial verification

Attack fake renderer/exit/FPS markers, early closure or timeout counted as
success, wrong workload binary/source pins, source-version substitution,
missing client draws, omitted snapshots, forged resource roles and damaged
packet blobs. Hold client-only inventory against literal protocol words and
ensure supporting compositor formats are not mislabeled client requirements.
The actual executed recorder remains unchanged unless separately scoped proof
is added. No rendered-pixel or browser-FPS claim is made by this capture.

## Verification log

### 2026-10-04 — worker — execution boundary

Verified shader parent is `3381977b27842437e6a675809374642059987854`.
This high-risk S slice captures and inventories one original workload. It adds
no format/shader/device implementation. Source/binary identity, real guest
completion and exact packet provenance are the acceptance boundary. Original
Mesa demos9.0.0 archive candidates are checked against the official SHA-256
before building; the rootfs/kernel and existing recorder stay immutable.
No mapping slice starts before this inventory is independently verified.

### 2026-10-04 — worker — sealed submission

Actual guest/controller/build source is frozen at
`a669aad01b93e03e3b528a931748d0800156e57c`; final evidence-checking source is
`928f4fb6e3ae4c134aca8fdd79a759045fbc877d`. The later supplement changes only
evidence, acceptance checks and future planning notes. The original builder,
controller, recorder, packet stream, resource inventory and source pins remain
byte-identical. Source tables in the worker archives bind both boundaries.

Executed commands (full compiler/QEMU argv and guest script are retained in
the build/capture manifests):

```sh
docker exec wasm-vm-virgl-reference-research python3 /workload-build/control/build_gears_in_container.py --rootfs /reference/omarchy.ext4 --archive /workload-build/inputs/mesa-demos-9.0.0.tar.xz --output /capture/gears-workload-a669aad0
docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py --workload es2gears --gears-directory /capture/gears-workload-a669aad0 --output /capture/gears-capture-a669aad0 --timeout 150 --max-blob-bytes 1073741824
python3 tools/virgl-capture/workloads/build_gears.py --container wasm-vm-virgl-reference-research --cache /tmp/wasm-vm-gears-source-fetch-a669aad0 --output /capture/gears-workload-download-a669aad0
python3 tools/virgl-capture/validate.py evidence/virgl-workload-inventory/captures/es2gears --write --pack-blobs
VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR=target/evidence/virgl-workload-inventory-worker make verify-E6-T12g1
# Expected failure: separately substituted immediate-zero RISC-V executable.
docker exec wasm-vm-virgl-reference-research python3 /capture/capture.py --workload es2gears --gears-directory /capture/gears-quick-zero-a669aad0 --output /capture/gears-negative-quick-zero-a669aad0 --timeout 150 --max-blob-bytes 1073741824
# Final pristine clone at 928f4fb6; inherited CARGO_*, RUSTFLAGS,
# RUSTDOCFLAGS, RUST_LOG, PYTHONPATH and PYTHONHOME removed.
VIRGL_WORKLOAD_INVENTORY_EVIDENCE_DIR=target/evidence/virgl-workload-inventory-cold make verify-E6-T12g1
```

Evidence lives in `evidence/virgl-workload-inventory/`. Capture manifest
SHA-256 is`202500d87a7e31a5c04f192852bb9a23dedce8681fb3ee4850e0738aee30e8a8`;
the complete no-drop recording has 52,809 events and 632,291,908 unique raw
blob bytes. Actual guest, QEMU, client and closewindow exits are zero. The
live executable hash is`59f4029a08b809f8d191cd7b3d719e2c5b09f0aadb97833f088b41fa60a918af`,
also reproduced by the independent-directory/fresh-download build. Client
context lifetime`6@4410` supplies 1,566 draws; supporting traffic supplies
29,025. Literal creates/draw roles require format233 B10G10R10X2_UNORM color,
format16 Z16_UNORM depth, and format64 buffer storage with vec3 vertex input.
Original kmscube requires format2 color, format67 sampling and format64 vertex
bytes. Channel spellings are recorded enum names; mapping remains unproven.

The immutable kmscube inventory SHA-256 is
`8a1fb71fdd3f4d4c3696104690e11af480e5f1b95634bd077a1fcef1636b7b8c`;
gears is`fb91301b9e14b098e0d8a590ddb7fa33ead15972195211741a5efcc3d58e9a3c`.
All four prior manifests and nineteen original bodies are unchanged. The new
full capture contains thirteen prior bodies plus two new client and four new
supporting-compositor bodies, bound separately in`index.json`. All six new
bodies remain unproven for shader admission and browser execution.

Original worker archive SHA-256 is
`fd2b5faf08ab77133937fa8d09183a24f16bfe2f88913ca4f08d2fbacc14e7dc`;
final cold archive under`worker/cold/` is
`155e1eb8a75cc790513d19abae489953952384df7900e4bd835c854a6dcc05d4`.
The clean clone passed with clean Git status before/after, 21 framing tests,
all five captures, byte-identical inventories, 42 rejected mutations, 27 native
recorder cases and its source-sabotage rejection. The separately sealed
negative archive`4d6d63999632fc23088343403aac4d54c3a0e7beb0dc4ab41a6af96ed595b257`
records actual client exit0 but guest exit1 and incomplete/workloadPass false,
despite 2,277 supporting draws. Its 2,806-event recorder session is itself
complete/no-drop; acceptance rejects the workload rather than its framing.

This proves only unchanged guest-client completion, packet/backing provenance
and reproducible requirements. No renderer, emulator, wasm or demo code changes;
broad Rust/wasm/browser gates do not exercise this tooling boundary. No rendered
pixels, new shader admission, format support, live offload or MIPS claim is made.
Fresh adversarial verification is still required.
