---
id: E3-T21d
epic: 3
title: File-transfer guest round-trip and durability proof
priority: 321.4
status: pending
depends_on: [E3-T10, E3-T21c]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the completed transfer path inside Alpine, across interruption and reboot, on a frozen head.

## Deliverables
- One browser acceptance target that performs upload, guest hashing, download, host hashing, sync,
  tab kill, reboot, and persistence inspection.
- Exact-head evidence for 100 MiB round trips, two concurrent uploads, hostile names, and a 50%
  interrupted upload retaining only an explicit `.part` file.

## Acceptance criteria
- [ ] `make verify-E3-T21d` passes in a fresh browser profile and a pristine clone.
- [ ] Every completed file matches SHA-256; interrupted data is never presented as complete.
- [ ] Teardown leaves no worker, socket, object URL, or temporary host resource behind.

## Adversarial verification
Repeat with independent contents and interruption points, fill quota mid-stream, and inspect both
guest and host state after reboot. Invent one framing or lifecycle attack not used by the worker.

## Verification log
(empty)
