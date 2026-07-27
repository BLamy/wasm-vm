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

### 2026-07-27 — verifier — VERDICT: refuted

- **P1 framing and bounded state — HELD.** Predicted the exact-head checker would confirm the
  versioned envelope, fixed limits, ten frame assignments, two state machines, and required
  adversarial-vector inventory. Observed
  `E3-T21a protocol: OK (10 constants, 10 frame types, 11 adversarial vectors)` both from the
  repository and from `/tmp`; `bash -n` also passed. Citation:
  `docs/design/file-transfer.md:31-106`, `tools/verify/e3-t21a-protocol.sh:18-148`.
- **P2 out-of-root hard-link capability — FAILED.** Predicted the specified outbox open procedure
  would deterministically reject a basename hard-linked to an inode outside the fixed root.
  Observed a bounded fixture where `/tmp/.../outside-secret` and
  `/tmp/.../outbox/offered` had the same inode, type `Regular File`, and link count 2.
  `O_NOFOLLOW` plus a regular-file check does not distinguish that alias, while the document
  promises that an out-of-root hard link is rejected without specifying an enforceable link-count
  or filesystem-isolation rule. Citation: `docs/design/file-transfer.md:25-29,122-125,151-154`.
  Specify an implementable invariant (for example, reject any source with `st_nlink != 1`, with an
  explicit race-safe check), and add this vector to the checker.
- **P3 interruption at the commit boundary — FAILED.** Predicted every CANCEL/failure point would
  have one explicit outcome and that no final-looking upload name could appear before durable
  acknowledgement. Observed the upload sequence renames to the final basename before directory
  `fsync`, even though the next sentence says a final file is never visible before durable
  acknowledgement; the failure row defers handling to startup after the name is already visible.
  The table also defines CANCEL only before durable promotion, while EOF—but not CANCEL—after
  promotion maps to `COMPLETION_UNKNOWN`. Citation:
  `docs/design/file-transfer.md:135-141,168-179,242,247-249`. Define the visible-name/commit-record
  invariant and CANCEL outcome at and after the durable commit point so an interrupted transfer
  cannot be mistaken for a completed one.
- **P4 acceptance-checker sensitivity — FAILED.** Predicted the required checker would reject
  deletion or contradiction of the security and interruption fields it claims to check. Observed
  three sabotage copies: replacing `COMPLETION_UNKNOWN` was rejected, but removing the entire
  post-promotion EOF row passed; removing the out-of-root hard-link boundary passed; and adding an
  exception that permits accepting a URL passed. Citation:
  `tools/verify/e3-t21a-protocol.sh:75-141`. Add structural assertions for each required
  interruption cell and hard-link rule, plus negative/contradiction-sensitive checks for denied
  capabilities.
- **COVERAGE:** document prose is human-reviewed rather than executable; the constants, frame
  table, named states, and listed tokens were exercised by the checker. Error-path coverage proved
  only the stable-error token check is sensitive. The security-boundary and interruption semantics
  above are unproven and currently contradicted, so the checker diff is insufficient.
- **SUITE:** n/a until the semantic refutations clear; no promoted test was added.

Commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- `bash tools/verify/e3-t21a-protocol.sh`
- from `/tmp`, `bash /Users/brettlamy/Dev/wasm-vm/tools/verify/e3-t21a-protocol.sh`
- hard-link fixture using `touch`, `ln`, and `stat -f`
- checker sabotage copies removing the hard-link boundary and post-promotion EOF row, adding a URL
  exception, and replacing `COMPLETION_UNKNOWN`
- `python3 tools/check_task_policy.py`
- `git diff fa5e1b8^..fa5e1b8 --check`
