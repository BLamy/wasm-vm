---
id: E5-T28b
epic: 5
title: Record the integrated type hear drag clipboard and resize desktop session
priority: 528.2
status: pending
depends_on: [E5-T28a]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the simultaneously running desktop capabilities in one exact-head session.
Reuse one clean local clone and empty Chromium profile; independent machines,
WebKit, and host rr are not required by the current user evidence policy.

## Boundary

Own the integrated browser harness and its hash-bound recordings/report. Runtime
failures go back to the owning feature task; do not patch semantics mid-recording.

## Acceptance criteria

- Build from committed sources in the documented clean environment, record browser
  version/configuration and release digests, and cold-boot without serial intervention.
- Open a real terminal from the guest menu alongside a second GUI application. Type
  `echo "Level 5: $(uname -m)" && aplay /usr/share/sounds/test.wav` through the actual
  keyboard path. Assert riscv64 output and captured non-silent audio with zero underruns.
- Measure real window displacement and >=15 FPS p50 full-width drag in the declared
  baseline configuration. Report raw guest/transfer/present attribution from T25.
- In the same session, exercise host-to-guest and guest-to-host clipboard, a real
  guest resolution change, and focus loss/return during a chord without stuck keys.
- Capture a continuous <=3-minute active demonstration, storing the larger artifact
  as a release asset with its digest rather than committing it to Git.
- Preserve zero console/HTTP errors and an explicit handoff checkpoint for T28c.

## Verification command

make verify-E5-T28b

## Adversarial verification

During the integrated session combine audio, real window dragging, and pointer
motion; demand zero audio underruns and the same FPS budget. Resize mid-drag, lose
focus mid-chord, and toggle serial/desktop during audio. Repeat the bounded seam
checks at 2x CPU throttle: no deadlock, stuck input, or permanently wedged audio.
Carry unchanged held leaf evidence rather than rebuilding unrelated regression walls.

## Verification log

(empty)
