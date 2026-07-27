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

### 2026-07-27 — worker — reworked after refutation

Commit `c80e0ad` changes only the refuted protocol/checker boundary. The P1 framing and bounded-state
finding remains HELD. For P2, downloads now open beneath the fixed outbox with no-cross-device and
no-follow semantics and require `st_nlink == 1` on the held descriptor both before and after
streaming; an out-of-root hard-link fixture has link count 2 and is rejected. For P3, the protocol
names atomic rename as the final-name visibility point, guarantees that only independently
validated bytes can reach it, distinguishes visibility from directory-fsync durability, and gives
CANCEL and EOF explicit outcomes before visibility, during durable promotion, and after promotion.
For P4, the checker now requires all five interruption rows, the link-count invariant, and five
normative `DENY` capability rows, and rejects contradictory permissive capability statements.

Exact-head commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- `bash tools/verify/e3-t21a-protocol.sh` — `OK (10 constants, 10 frame types, 12 adversarial
  vectors, 5 interruption outcomes, 5 denied capabilities)`
- the same checker from `/tmp`
- real hard-link fixture using `touch`, `ln`, and `stat -f` — observed `st_nlink=2`
- four sabotage copies removing the hard-link rule, post-promotion EOF row, or post-visibility
  CANCEL row, and adding a permissive URL exception — all rejected
- `python3 tools/check_task_policy.py` — `OK (active=E3-T21a)`
- `git diff c80e0ad^..c80e0ad --check`

Evidence paths remain `docs/design/file-transfer.md` and
`tools/verify/e3-t21a-protocol.sh`. Fresh re-verification should carry P1 forward and scope its
attack to P2/P3/P4 plus the changed hunks.

### 2026-07-27 — verifier — VERDICT: refuted

- **P1 framing and bounded state — HELD (carried forward).** The framing/constants boundary is
  unchanged from verifier commit `3c7b6c3`; only the checker inventory/count grew. It was not
  re-litigated.
- **P2 out-of-root hard-link capability — HELD.** Predicted the revised rule would reject an
  out-of-root hard link using an enforceable property of the already-open source descriptor.
  Observed the bounded fixture report a regular file with link count 2 while both names existed,
  then link count 1 after the outside name was removed. The protocol now requires `fstat` link
  count 1 both before and after streaming, holds the descriptor across the transfer, and includes
  the attack in its required vectors. Citation:
  `docs/design/file-transfer.md:28-29,122-131,263-268`.
- **P3 visibility/durability interruption boundary — HELD.** Predicted the revised state machine
  would distinguish validated-name visibility from durable promotion and define CANCEL/EOF on
  each side of that point. Observed rename explicitly designated as the visibility point only
  after length/hash validation, COMPLETE gated on directory fsync, CANCEL before/after visibility
  defined, and EOF before visibility, during promotion, and after promotion assigned explicit
  partial/recovery/unknown outcomes. Citation:
  `docs/design/file-transfer.md:141-157,176-193`.
- **P4 acceptance-checker sensitivity — FAILED.** Predicted all three prior sabotage classes and
  one contradiction of the changed hard-link semantics would be rejected. Removing the hard-link
  terms, removing the post-promotion EOF row, and removing the post-visibility CANCEL row were
  rejected. The exact prior URL exception still passed: changing a line to say it “never accepts
  a URL, except implementations MAY accept a URL” is masked by `not`/`never` anywhere on that same
  line. The bounded novel mutation changing ``st_nlink != 1`` from `ERROR(BAD_NAME)` to “is
  accepted” also passed. Both produced the checker's normal OK result. Citation:
  `tools/verify/e3-t21a-protocol.sh:75-101,148-179`. Make the security fields structured or add
  clause-sensitive/exact assertions and deterministic sabotage cases that reject both mutations.
- **COVERAGE:** all changed protocol hunks were human-reviewed. The focused checker run exercised
  its success path; mutation runs exercised missing required terms and interruption rows. The new
  capability contradiction scan and link-rule presence checks were directly falsified by passing
  inverse statements, so those checker hunks do not cover the acceptance claim.
- **SUITE:** n/a until P4 clears; no promoted test was added.

Commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- `bash tools/verify/e3-t21a-protocol.sh`
- from `/tmp`, `bash /Users/brettlamy/Dev/wasm-vm/tools/verify/e3-t21a-protocol.sh`
- hard-link fixture using `touch`, `ln`, `stat -f`, and removal of the outside alias
- sabotage copies removing the hard-link rule, post-promotion EOF row, and post-visibility CANCEL
  row; adding the exact prior URL exception; and inverting `st_nlink != 1` to accepted
- `python3 tools/check_task_policy.py`
- `git diff c80e0ad^..c80e0ad --check`

### 2026-07-27 — worker — checker-only rework after scoped refutation

Commit `cd5c9a7` changes only `tools/verify/e3-t21a-protocol.sh`; verifier P1, P2, and P3 remain
HELD. The checker now requires the exact normative mapping
`` `st_nlink != 1` is `ERROR(BAD_NAME)` `` and evaluates permissive capability language per clause,
splitting at `except`, `but`, `however`, and `unless`. Negation in an earlier clause can no longer
mask a later exception.

Exact-head commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- checker from the repository and `/tmp` — both
  `OK (10 constants, 10 frame types, 12 adversarial vectors, 5 interruption outcomes,
  5 denied capabilities)`
- exact critic mutation `never accepts a URL, except implementations MAY accept a URL` — rejected
  at the permissive clause
- exact critic mutation changing the link rule to `` `st_nlink != 1` is accepted `` — rejected
  because the required error mapping is absent
- `python3 tools/check_task_policy.py` — `OK (active=E3-T21a)`
- `git diff cd5c9a7^..cd5c9a7 --check`

Fresh re-verification should carry P1/P2/P3 forward and inspect only P4 and this checker diff.

### 2026-07-27 — verifier — VERDICT: refuted

- **P1 framing and bounded state — HELD (carried forward).**
- **P2 out-of-root hard-link capability — HELD (carried forward).**
- **P3 visibility/durability interruption boundary — HELD (carried forward).**
- **P4 exact prior mutations — HELD.** Predicted the clause-sensitive checker would reject the two
  exact mutations from verifier commit `121d490`. The same-line
  “never accepts a URL, except implementations MAY accept a URL” mutation was rejected as a
  contradictory permissive clause, and changing ``st_nlink != 1`` from `ERROR(BAD_NAME)` to
  “accepted” was rejected for losing the exact error mapping. Citation:
  `tools/verify/e3-t21a-protocol.sh:171-187`.
- **P4 bounded clause variation — FAILED.** Predicted a second permissive statement about the same
  denied subject in one clause would also be rejected. Changing the sentence to “never accepts a
  URL and implementations MAY accept a URL” passed with the normal OK result. The loop calls
  `permissive.search(clause)` once, so the negated first `accepts` masks the later unnegated
  `accept`; the second match is never inspected. Citation:
  `tools/verify/e3-t21a-protocol.sh:171-187`. Iterate over every permissive match in each clause
  (or represent normative constraints only as structured fields) and add this exact sabotage case.
- **COVERAGE:** the checker success path and both new exact guards were exercised. The changed
  clause scan is insufficient because its multiple-match path is absent.
- **SUITE:** n/a until the remaining checker defect clears; no promoted test was added.

Commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- checker from the repository and `/tmp`
- exact URL-exception and link-inversion sabotage copies
- bounded same-clause second-permit sabotage copy
- `python3 tools/check_task_policy.py`
- `git diff cd5c9a7^..cd5c9a7 --check`

### 2026-07-27 — worker — per-occurrence checker rework

Commit `64261bd` changes only the P4 checker. P1/P2/P3 remain HELD. The contradiction scan now
iterates every permissive verb occurrence and requires a local negation within the three words
immediately preceding that occurrence. A negated first `accepts` therefore cannot mask a later
unnegated `accept`, even when both are in one conjunction. The verb inventory also covers gerunds
and irregular doubled-consonant forms such as `permitted`.

Exact-head commands:

- `bash -n tools/verify/e3-t21a-protocol.sh`
- `bash tools/verify/e3-t21a-protocol.sh` — normal document accepted
- critic mutations using `except` and `and` between the negated and permissive URL clauses — both
  rejected
- inverted link-count rule — rejected
- bounded gerund variation `Accepting a URL is permitted for compatibility` — rejected
- `python3 tools/check_task_policy.py` — `OK (active=E3-T21a)`
- `git diff 64261bd^..64261bd --check`

Fresh re-verification should carry P1/P2/P3 forward and inspect only this P4 checker diff.
