---
id: E5-T16b
epic: 5
title: Measure labwc with the pixman renderer inside the emulator
priority: 516.2
status: pending
depends_on: [E5-T16a]
estimate: S
risk: medium
capstone: false
---

## Goal

Bring up labwc as the first T16 finalist on a throwaway Alpine riscv64 image and record an honest
end-to-end result from cold start through the shared desktop workload.

## Boundary

This slice owns only the labwc candidate bring-up and its capture. It does not compare candidates,
audit the final package set, or select the desktop stack.

## Deliverables

- A scripted scratch-image bring-up using `WLR_RENDERER=pixman` and the existing DRM/virtio-gpu
  path, with no fallback to a failed GL attempt.
- The T16a workload result for cold start, idle, opening foot (or the documented terminal
  fallback), 100 typed characters, a 300 px drag, and close.
- Captured guest-instruction, upload-byte, RSS, idle-wakeup, wall-time, and cursorq observations,
  plus the exact image/package/config inputs needed to replay the run.

## Acceptance criteria

- The compositor, window manager, terminal, and workload all run end-to-end inside the emulator;
  the result contains numbers for every required metric and no extrapolated finalist row.
- The renderer selection is recorded as pixman, the idle interval is explicit, and any idle cost
  above 2% of guest instructions is either absent or justified as required by the T16 charter.
- The typing result records bytes uploaded during the 100-character phase and the capture shows
  cursorq traffic when labwc claims/usefully exercises the hardware cursor plane.
- The result is linked to the exact scratch-image manifest and passes the T16a schema checks.

## Verification command

`make verify-E5-T16b`

## Adversarial verification

Inspect the compositor command line and renderer diagnostics before trusting the numbers. Force
the scripted workload through a clean cold boot, repeat the drag and typing phases, and verify
that a missing cursorq event is reported as a capability gap rather than silently inferred from
labwc's configuration. A GL failure followed by a pixman measurement without the pixman setting
being visible is a refutation.

## Verification log

(empty)
