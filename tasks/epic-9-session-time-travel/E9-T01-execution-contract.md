---
id: E9-T01
epic: 9
title: Freeze the full-system session replay contract
priority: 524.901
status: in-progress
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

- [ ] A source-to-owner matrix covers UART, keyboard/tablet/mouse, resize, clock/lifecycle rebases, timers, entropy, block/network completions, DMA, file transfers, audio input and GPU readbacks/completions.
- [ ] Freeze the event boundary, schema/version policy, one-hart scope and explicit refusal for unrecorded devices or execution modes; compare every matrix row with actual current adapters.
- [ ] Pin software and accelerated desktop fixtures, reference environment, expected state witnesses and numeric recording/storage/seek budgets before implementation or performance tuning. Separate preview latency from actual restored-state readiness.

## Deterministic acceptance

`make verify-E9-T01`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

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
