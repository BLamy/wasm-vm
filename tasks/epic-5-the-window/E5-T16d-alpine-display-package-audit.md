---
id: E5-T16d
epic: 5
title: Audit Alpine riscv64 display-stack packages and installability
priority: 516.4
status: pending
depends_on: [E5-T16c]
estimate: S
risk: medium
capstone: false
---

## Goal

Prove the real Alpine riscv64 repository and install surface for the measured finalist stacks and
their terminal, clipboard, seat, and XKB support before the decision is written.

## Boundary

This slice owns package discovery/install evidence and the candidate package manifests. It does
not choose the winner, rebuild the final desktop image, or hand-edit a running image as a fix.

## Deliverables

- Clean E3-derived riscv64 scratch-image runs of `apk search` and `apk add` for labwc/pixman and
  weston/pixman stacks, with terminal, clipboard, seat/udev, and XKB packages tested as applicable.
- Captured repository URLs, package versions, signatures, dependencies, failures, and the exact
  package manifests/config inputs handed to E5-T16e.
- A check that the package audit uses the real riscv64 Alpine main/community repositories and no
  `--allow-untrusted` or host-architecture substitute.

## Acceptance criteria

- Every package proposed for the eventual server + WM + terminal + clipboard stack has a successful
  riscv64 `apk search` and clean signed `apk add` result, or the evidence names the missing package
  and removes that stack from consideration.
- The two measured finalists' package availability is represented separately from their runtime
  measurements; package presence is never inferred from a host package database.
- A fresh E3-derived image reproduces the captured package/version manifest and leaves a replayable
  log suitable for the final decision document.
- The audit exits nonzero on signature failure, wrong architecture, missing repository metadata, or
  an untrusted install flag.

## Verification command

`make verify-E5-T16d`

## Adversarial verification

Clear the package cache and rerun against the configured riscv64 mirrors. Attempt each proposed
`apk add` on a clean image, including the clipboard and terminal packages; a package that only
exists on x86 or only succeeds with `--allow-untrusted` refutes the candidate's availability claim.
Compare package versions and repository labels against the captured architecture metadata.

## Verification log

(empty)
