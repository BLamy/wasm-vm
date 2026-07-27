---
id: E3-T21c
epic: 3
title: Streaming browser upload/download UI
priority: 321.3
status: pending
depends_on: [E3-T21b2]
estimate: S
risk: medium
capstone: false
---

## Goal
Expose the frozen transfer protocol through accessible drag/drop upload and browser download flows.

## Deliverables
- Drag/drop target, progress, cancellation, partial/error state, and simultaneous-upload UI.
- Streaming guest-to-browser download handling without whole-file buffering.
- Browser tests for hostile names, directories, empty files, and 1,000-file refusal/handling.

## Acceptance criteria
- [ ] A browser test transfers a generated 100 MiB stream in each direction with heap growth under
  32 MiB and matching SHA-256.
- [ ] Console errors are zero and cancellation leaves an explicit partial state.

## Adversarial verification
Cancel during every phase, drop directories and hostile Unicode names, start simultaneous flows,
and force quota/protocol errors. The UI must never report completion before durable acknowledgement.

## Verification log
(empty)
