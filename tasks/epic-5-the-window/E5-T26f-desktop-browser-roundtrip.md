---
id: E5-T26f
epic: 5
title: Browser desktop snapshot round-trip and interaction smoke
priority: 526.6
status: in-progress
depends_on: [E5-T26e]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the composed desktop snapshot in the browser: reload and restore the same visible desktop,
then resume real input and audio without a guest reboot.

## Boundary

Own the browser save/reload/restore harness, pixel CRC comparison, and post-restore interaction
smoke. Do not add new device serialization semantics or stress/fuzz infrastructure.

## Acceptance criteria

- A desktop with two windows, visible custom cursor, terminal text, and completed `aplay` saves,
  reloads, restores, and has a first-present front-buffer CRC equal to the pre-snapshot CRC.
- Within 2 seconds after restore, typed text, cursor movement, window focus, and one user-gesture
  audio playback all succeed; the evidence records exact image, browser, and snapshot hashes.
- A snapshot taken during a window drag restores with no stuck button, and the browser path proves
  no guest reboot or re-probe was required.

## Verification command

make verify-E5-T26f

## Adversarial verification

Save at each drag phase, reload twice, and restore once with a delayed user gesture. Reject any
stuck button, stale cursor, CRC mismatch, or audio hang.

## Verification log

(empty)
