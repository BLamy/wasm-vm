---
id: E3-T21a
epic: 3
title: File-transfer mechanism decision, protocol, and threat model
priority: 321.1
status: implemented
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
- [x] `bash tools/verify/e3-t21a-protocol.sh` checks every required protocol and threat-model field.
- [x] Upload/download state machines have bounded memory and explicit interruption outcomes.

## Adversarial verification
Attempt to derive path traversal, ambiguous lengths, capability escalation, or a complete-looking
file after interrupted transfer from the written protocol. Any ambiguity that permits one refutes.

## Verification log

### 2026-07-27 — worker — implemented

Commit `fa5e1b8` freezes WVFT version 1 in `docs/design/file-transfer.md` and its deterministic
acceptance checker in `tools/verify/e3-t21a-protocol.sh`. The decision chooses a guest agent over a
reserved slirp endpoint instead of a filesystem-shaped or block-device capability. Both transfer
directions use a 16-byte length-delimited envelope, a four-frame receiver-controlled window,
incremental SHA-256, fixed inbox/outbox roots, normalized basenames, explicit partial/unknown
completion outcomes, and receiver-owned flush/commit-record/rename/directory-fsync durability.
The threat model grants only bounded user-selected bytes and denies destination dialing, host path
selection, public ingress, and command/eval opcodes.

Exact-head commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- `bash tools/verify/e3-t21a-protocol.sh` — `OK (10 constants, 10 frame types, 11 adversarial vectors)`
- from `/tmp`, `bash /Users/brettlamy/Dev/wasm-vm/tools/verify/e3-t21a-protocol.sh` — same result
- sabotage copy with the `No arbitrary host fetch` boundary removed — rejected by the checker
- `python3 tools/check_task_policy.py` — `OK (active=E3-T21a)`
- `git diff fa5e1b8^..fa5e1b8 --check`

Evidence paths: `docs/design/file-transfer.md`, `tools/verify/e3-t21a-protocol.sh`. This is
documentation/tooling-only medium-risk work, so no browser or target build gate applies. A fresh
verifier must still run the acceptance criteria and one independent bounded ambiguity attack.
