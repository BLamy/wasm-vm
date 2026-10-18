---
id: E9-T06
epic: 9
title: Add the local saved-session library and checkpoint controls
priority: 524.906
status: in-progress
depends_on: [E9-T05]
estimate: S
risk: medium
capstone: false
---

## Goal

Let a user find, name and reopen real locally stored session checkpoints.

## Boundary

The session library UI over the actual store: list, rename, start recording, checkpoint, stop and open. Display duration, storage usage, build/image identity and compatibility state; label previews and exact restore points separately.

## Acceptance criteria

- [ ] Two saved sessions remain visible after reload; renaming and opening one selects its actual stored checkpoint and matching guest state.
- [ ] Show capturing, restoring, incomplete, incompatible and storage-error states, with keyboard-accessible controls and responsive layouts.
- [ ] Existing sessions with no event log offer checkpoint restoration only; recording does not fabricate history from before it was enabled.

## Deterministic acceptance

`make verify-E9-T06`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Try an incompatible saved build, rapid selection changes and keyboard-only operation. The displayed selected session must agree with the active machine, not an old preview.

## Verification log

(pending; no implementation or verification claim)
