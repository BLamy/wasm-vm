---
id: E9-T10
epic: 9
title: Record user and host-control inputs at delivery
priority: 524.910
status: pending
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Capture actual user inputs and host actions as guest-visible ordered events.

## Boundary

UART, keyboard, absolute/relative pointer, resize and offered clipboard/file-transfer ingress through the common delivery queue. Store large payloads by content hash; explicitly gate unsupported input channels.

## Acceptance criteria

- [ ] Record exact delivered bytes/events, including releases, modifiers, pointer mode changes and a file upload, with event clock keys rather than DOM timestamps alone.
- [ ] Repeated input and same-position sequences retain their original order and payload identity across store/reload.
- [ ] Pause/resume/stop boundaries and failed or cancelled transfers produce a documented, replayable prefix; no hidden live input may enter replay.

## Deterministic acceptance

`make verify-E9-T10`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Use rapid typing, focus loss with a held key, duplicate-position pointer events and a cancelled partial upload. Compare guest-observed events and file bytes, not just host event counts.

## Verification log

(pending; no implementation or verification claim)
