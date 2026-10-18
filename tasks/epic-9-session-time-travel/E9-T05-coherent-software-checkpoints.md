---
id: E9-T05
epic: 9
title: Capture and restore coherent software session checkpoints
priority: 524.905
status: implemented
depends_on: [E9-T03, E9-T04]
estimate: S
risk: high
capstone: false
---

## Goal

Save a usable single-hart software-rendered machine at a session position and restore it after reload.

## Boundary

Coordinate CPU/RAM/device state, clock policy, input queues, log cursor and historical disk root at one bounded quiescence point. Accelerated guests remain explicitly gated until T17/T18.

## Acceptance criteria

- [ ] Record and restore exact CPU/device/disk witnesses from the same boundary, including pending I/O and held keyboard state.
- [ ] A failed capture or rejected restore leaves the previous committed checkpoint and current machine usable; never publish half a tuple.
- [ ] Use real native and built-browser fixtures; restore guest-visible memory and files rather than accepting a screenshot as state proof.

## Deterministic acceptance

`make verify-E9-T05`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Capture during disk I/O and input transitions, force quiesce timeout and corrupt one component. Demand all-or-nothing admission and an independently checked post-restore guest witness.

## Verification log

### 2026-10-17 — worker — implemented

Runtime/source freeze: `354f0a6036221bd2b858558dc04f125f22a3323b` (runtime implementation
`4169888c`, subsequent commits correct only the evidence exporter and RPC delimiter assertion).
Command: `E9_CHECKPOINT_EVIDENCE_DIR=target/evidence/e9-t05-worker-final make verify-E9-T05`.
All **20 recorded gates passed**, including 399 core tests, resume/held-input/audio/GPU/blk
regressions, native frame/storage tests, native/wasm Clippy, browser build, shared Node/Wasm
metadata tests, protocol v4 and retained factory v2 checks.

Evidence: `target/evidence/e9-t05-worker-final/report.json`, SHA-256
`d06225f249d7c1ce6b5d3b3826d92e7cdd713649a9fe3c7ea2367ea3f5e5ef92`.
It authenticates **540 files** and exact source digests. The permanent compact packet is
`evidence/e9-t05/worker/`; its provenance maps every copy and compressed tuple to originals.
The full browser trace/profile, raw native/tuple files and reconstructed ext4 images remain
in the original evidence directory.

The recorded real Alpine guest changes a shell variable and `/root/e9-session/state`, saves
while a key is held and a UART command is queued, advances the live guest, then reloads by
committed checkpoint ID. The before/restored **23,834,211-byte tuple is identical**, SHA-256
`2fe4d221e3df99938a25afb60f047051e8f01d2d2ee27a5f8a5d7a24236cad3a`.
The independent Python oracle decodes all **16 CPU/RAM/device sections**, reconstructs sparse
RAM and ext4, and finds the saved `e9:before\n` file; the advanced state contains `e9:after\n`.
Restored execution prints `memory-before/queued-before`, proving guest memory and delivery
of the recorded pending UART command. Corrupt components and a same-generation sibling disk
are rejected without changing the native destination. Failed publication leaves revision 1
byte-identical and the live guest continues with its advanced memory values.

Actual original disk reads/writes drain without advancing CPU time. Sixteen failed quiescence
passes terminate with `session_checkpoint_busy_or_budget`; after genuine chunk bytes become
available, the same guest captures successfully and retires 49,997 instructions. Direct-control
mutations are fenced during capture, and stop joins the capture lifecycle. The built demo
passes **127/0**, with **zero console errors**, the new roadmap pip and screenshots. The
unchanged retained accelerated factory also boots: qualified, fresh epoch 4 physically drawn,
**3,999,540 retired instructions**. Accelerated session history remains gated for T17/T18.

This initial checkpoint profile is offline software/ICount, at most 256 MiB RAM, without extra
disks, microphones, host audio bridges or active PCM streams. Its event cursor is honestly zero
in checkpoints-only mode; event replay/UI/retention/runtime bundles remain their successor tasks.
Fresh adversarial verification, its promoted tests, the one final pristine clone and live
Cloudflare publication are pending; this entry makes no verifier or public-deployment claim.
