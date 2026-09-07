---
id: E5-T26b
epic: 5
title: Virtio-GPU resource, scanout, cursor, and shadow snapshot
priority: 526.2
status: implemented
depends_on: [E5-T26a]
estimate: S
risk: high
capstone: false
---

## Goal

Snapshot the desktop GPU state needed to redraw the same front buffer after restore, including
resource metadata, host shadows, scanout/cursor bindings, and pending damage.

## Boundary

Own virtio-gpu serialization/deserialization and deterministic shadow compression. Do not own
keyboard, audio, agent reconnect, or the final browser reload flow.

## Acceptance criteria

- A scripted resource map with non-default dimensions/formats, scanout, cursor hotspot/position,
  and pending damage serializes and restores with byte-identical state and front-buffer CRC.
- Shadow compression reports raw size, encoded size, ratio, and bounded decompression checks for
  both fbcon-like and desktop-like fixtures; malformed compressed data is rejected.
- Restore refuses a missing resource or incompatible format before touching the live scanout and
  then renders one full repair frame when the state is valid.

## Verification command

make verify-E5-T26b

## Adversarial verification

Try an out-of-range resource id, overlapping scanout binding, truncated shadow, and a cursor
hotspot outside its image. Each must fail closed without corrupting another resource.

## Verification log

### 2026-09-06 — worker — IMPLEMENTED
- Implementation commit: `2b985379727f10586938f11831be35dc149408a8`.
- Exact-head evidence: `evidence/e5-t26b/native-final.json` (SHA-256 `9dc545757ae5e0740913ab7d5228ed97b841df49aed604ad1b02515374878e78`).
- Command: `make verify-E5-T26b` (exit 0). The run passed format, both GPU-trace clippy gates, 5 GPU snapshot tests, 15 resource tests, 5 damage tests, 6 tile tests, 3 block-quiesce tests, 6 CPU-resume tests, and the no-default-features wasm32 build.
- The recorded tests exercise a non-default-format 8×4 resource with scanout, cursor hotspot/position, pending damage, dirty tiles, and front-buffer CRC equality; deterministic repeat/literal shadow compression reports raw/encoded sizes and ratio. Truncated payloads, forged shadow runs, missing scanout resources, incompatible formats, and an out-of-range cursor hotspot all fail before the target resource map changes. Valid restore emits exactly one full scanout repair frame.
