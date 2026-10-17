---
id: E9-T03
epic: 9
title: Persist multiple session logs with atomic publication
priority: 524.903
status: pending
depends_on: [E9-T02, E3-T12d]
estimate: S
risk: high
capstone: false
---

## Goal

Store many independent sessions locally in the browser and reopen them after a tab reload.

## Boundary

One chunked append-only IndexedDB session store with a commit cursor. Keep the existing resume-snapshot store intact; localStorage is limited to small preferences, not VM blobs.

## Acceptance criteria

- [ ] Stream bounded chunks and publish the manifest/commit cursor only after referenced chunks are durable; never retain an additional whole-session copy.
- [ ] Reload two different sessions and recover the exact committed prefix after termination between data and commit writes.
- [ ] Serialize competing writers with existing browser ownership mechanisms; detect missing/corrupt chunks and keep incomplete records out of the playable list.

## Deterministic acceptance

`make verify-E9-T03`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Terminate between each publication step and race two tabs writing the same session. A partially published session, mixed writers or loss of a previously committed prefix refutes.

## Verification log

(pending; no implementation or verification claim)
