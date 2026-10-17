---
id: E9-T01
epic: 9
title: Freeze the full-system session replay contract
priority: 524.901
status: implemented
depends_on: [E0-T16, E3-T12d]
estimate: S
risk: low
capstone: false
---

## Goal

Define local session time travel for the existing full-system RV64 Linux VM, starting with one hart. Inventory every host-to-guest source and assign each to a recording task or an explicit unsupported-mode gate.

## Boundary

Documentation and pinned workload/measurement definitions only. Distinguish a saved checkpoint, visual preview, exact replay position and a new live branch. Reuse existing snapshot and GPU work rather than assuming instruction traces are a complete session recording.

## Acceptance criteria

- [x] A source-to-owner matrix covers UART, keyboard/tablet/mouse, resize, clock/lifecycle rebases, timers, entropy, block/network completions, DMA, file transfers, audio input and GPU readbacks/completions.
- [x] Freeze the event boundary, schema/version policy, one-hart scope and explicit refusal for unrecorded devices or execution modes; compare every matrix row with actual current adapters.
- [x] Pin software and accelerated desktop fixtures, reference environment, expected state witnesses and numeric recording/storage/seek budgets before implementation or performance tuning. Separate preview latency from actual restored-state readiness.

## Deterministic acceptance

`make verify-E9-T01` checks the frozen contract, source anchors/digests, owner tasks,
asset/workload pins and numeric budgets. The [contract](../../docs/design/session-replay.md)
and [machine-readable definitions](../../docs/design/session-replay-contract.json) are the
handoff to T02 and the capture slices. This direct check makes no guest runtime,
performance or acceleration qualification claim.

## Adversarial verification

Find one real guest-visible input absent from the matrix, or a claimed supported mode without an assigned capture path. An inventory of browser DOM events alone is insufficient.

## Verification log

### 2026-10-17 — worker — started

The user explicitly selected Epic 9 after the backlog review. Its priority band is now
524.901–524.924, ahead of the optional userspace runtime; other task statuses are unchanged.
E0-T16 and E3-T12d are verified. This low-risk S slice changes documentation and the
deterministic contract checker only; it makes no runtime replay claim.

The original checkout has unrelated uncommitted work. This isolated checkout starts at
`ec178d579aed126c30eae1ee608e62557b276c08` and imports only the existing Epic 9 plan.


### 2026-10-17 — worker — contract submission

Implementation/evidence head: `2a7ab8a8fcf738498330d6e12fba3beb379c8e9a`; current trunk boundary:
`05fa92c82288a4de217eac7345ba2766737a8c16`. The initial isolated source was older
than current trunk; it was rebased before submission and the source inventory was
re-audited. Only the final receipt below is submitted. The original dirty checkout
was not changed.

Commands at the frozen implementation:

- `make --no-print-directory verify-E9-T01 > evidence/e9-t01/worker/acceptance.json`
- `python3 -B -m py_compile tools/verify/e9-session-contract.py`
- `python3 tools/check_task_policy.py > evidence/e9-t01/worker/task-policy.log`
- `git diff --check`

Evidence: `evidence/e9-t01/worker/acceptance.json` (SHA-256
`280dc04f70fe5c85d4c912f31eae329f526d747ecca9b132d2519f73a3238f39`),
`assets.json`, `commands.txt`, `task-policy.log` and `SHA256SUMS` in the same directory.
The asset receipt independently streams the SHA-256/length of all six advertised
payloads found in local checkouts; it records each exact asset path and identity.

Claim: the direct result checks 23 named guest-affecting sources against 32 current
source files, assigns each to capture or an explicit gate, freezes lossless event
coordinates/version/bounds and pins software plus production accelerated assets,
stimulus/state witnesses, reference environment and numeric future budgets. Existing
GPU worker/renderer/clock checkpoint successors replace the cancelled E6-T11 dependency.
The GPU reconstruction journal is explicitly not a whole-session replay engine.
The probe C file is a pinned future guest workload definition, not compiled/executed
runtime evidence. GPU/clock/microphone session recording remains unqualified.

Risk: low, documentation/fixture definitions and direct checker only. No emulator,
wasm surface, browser flow or production output changes; Rust/workspace/browser/deploy
gates and guest instruction recording do not apply to this definition-only claim.
The final task/queue/evidence commit changes metadata only; the acceptance receipt
binds all contract/checker/Makefile content and audited source digests. Fresh review
must judge the direct result and attempt the task's missing-input inventory check.
