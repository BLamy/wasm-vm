---
id: E9-T10
epic: 9
title: Record user and host-control inputs at delivery
priority: 524.910
status: in-progress
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

### 2026-10-18 — worker — started

E9-T09 is independently verified at `3434d69d069dce7a0fdc52162b7a9c21a3db53a9`; its final published catalog and stack head is `b25fb9de9e04b8be20a95ed1747066c1617e49b9`. This high-risk slice records owned, normalized input through the actual device delivery boundary, retaining an explicitly incomplete input prefix until all replay adapters are installed. No implementation or verification claim yet.
