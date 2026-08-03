---
id: E3-T22c
epic: 3
title: Guest image clipboard conveniences — vim OSC52 yank, tmux set-clipboard
priority: 322.3
status: pending
depends_on: [E3-T22a]
estimate: S
risk: low
capstone: false
---

## Goal
The served guest image makes clipboard workflows work out of the box: a vim yank emits OSC 52 (so it
lands on the host clipboard), and tmux `set -s set-clipboard on` routes copies through OSC 52.

## Context
Split from **E3-T22**. Depends on the OSC 52 copy path (E3-T22a) actually landing text on the host
clipboard. Image/rootfs work (coordinates with the E3-T11 image pipeline).

## Deliverables
- vim config in the image with an OSC52 yank provider (or a `yank`-to-OSC52 helper).
- tmux config with `set -s set-clipboard on`.

## Acceptance criteria
- [ ] In guest vim (image defaults), yanking a line emits an OSC 52 sequence that reaches the host
  clipboard via the E3-T22a handler.
- [ ] tmux copy-mode yank routes through OSC 52.

## Verification log
(empty)
