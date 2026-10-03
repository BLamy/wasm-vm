---
id: E6-T12b
epic: 6
title: Replay bounded resource backing and VirGL uploads and readbacks
priority: 525.02693
status: in-progress
depends_on: [E6-T12a]
estimate: S
risk: high
capstone: false
---

## Boundary

Add the renderer resource/backing model and transfer executor for the captured
textured-scene profile: buffer resources, single-level RGBA8 2D textures, CPU
staging backing, TRANSFER3D and both COPY_TRANSFER3D directions. Validate context
attachment, resource identity/generation, logical extents, IOV lengths, checked
box/stride/layer-stride/offset arithmetic and allocation budgets. Public handles,
attached guest backing and storage retained by objects have separate lifetimes.
The first uploads precede CREATE_SUB_CTX1 and use the context's default state.

Use original resource metadata and snapshots 156/157/160 for vertex/index/texture
input. Preserve the distinction between 64/12-byte logical buffers and 4096-byte
backing pages, and the 1MiB staging allocation. READ_FROM_HOST reverses the named
copy source/destination fields. Later snapshots containing renderer readback are
comparison evidence only, never replay inputs. No device/capset activation.

## Deterministic acceptance

`make verify-E6-T12b` proves the original 64-byte vertex, 12-byte index and
16-byte texture transfers using actual WebGL2 buffer/texture readback, plus
independent transfer-box/stride/IOV cases for both directions. Record exact
source event/hash/ranges, resulting bytes, Node/browser checks, bounded resource
usage and zero browser errors. These isolated transfers do not claim whole-stream
replay. Run the affected high-risk resource-boundary gates and final clean clone:
Node pure-layout/lifecycle checks, original decoder regression, actual hardware
WebGL2 transfer and hostile-state proofs, bounded repeated mutation/recovery,
input sabotage and source/evidence hashes. Production Rust, shader compiler and
Wasm APIs are unchanged by this boundary; their proofs carry forward.

## Adversarial verification

Attack overflow, short IOVs, row/layer overlap, invalid levels/formats, missing
attachments, stale/reused IDs, duplicate attach and detach during a pending copy.
Reject before reading/writing outside the validated resource/backing range.
Prove reference retention after public unref and eventual storage release.
Poison captured output snapshots and require unchanged upload results; change
one genuine input texel/index and require the independent byte oracle to fail.

## Verification log

### 2026-10-03 — worker — activated (UTC)

Follows independently verified E6-T12a (`c8a34f4a`, PR #407). This isolated S
boundary creates resource/backing ownership and actual WebGL2 transfer storage;
state objects and draw replay remain separate. Pending-copy attacks use prepared,
single-use tickets, whose upload bytes are snapshotted and whose context/backing
identity is rechecked before execution. These tickets are not accepted asynchronous
virtio submissions; ordered fences remain E6-T11b. No other task is active.
