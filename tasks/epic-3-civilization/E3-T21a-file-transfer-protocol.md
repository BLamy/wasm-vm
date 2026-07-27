---
id: E3-T21a
epic: 3
title: File-transfer mechanism decision, protocol, and threat model
priority: 321.1
status: in-progress
depends_on: [E3-T08, E3-T14]
estimate: S
risk: medium
capstone: false
---

## Goal
Freeze one bounded host/guest file-transfer mechanism and protocol before implementation begins.

## Deliverables
- `docs/design/file-transfer.md` compares virtio-9p/virtio-fs, a sideload block device, and a
  guest agent over slirp, and records the decision.
- A versioned framing protocol specifies lengths, cancellation, errors, atomic `.part` rename,
  fsync/flush ownership, filename normalization, and maximum sizes.
- A threat model states exactly which host capabilities guest code receives and why the endpoint
  cannot become arbitrary host fetch, filesystem access, or eval.

## Acceptance criteria
- [ ] `bash tools/verify/e3-t21a-protocol.sh` checks every required protocol and threat-model field.
- [ ] Upload/download state machines have bounded memory and explicit interruption outcomes.

## Adversarial verification
Attempt to derive path traversal, ambiguous lengths, capability escalation, or a complete-looking
file after interrupted transfer from the written protocol. Any ambiguity that permits one refutes.

## Verification log
(empty)
