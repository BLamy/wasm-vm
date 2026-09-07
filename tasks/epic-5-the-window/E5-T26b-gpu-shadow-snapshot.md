---
id: E5-T26b
epic: 5
title: Virtio-GPU resource, scanout, cursor, and shadow snapshot
priority: 526.2
status: in-progress
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

(empty)
