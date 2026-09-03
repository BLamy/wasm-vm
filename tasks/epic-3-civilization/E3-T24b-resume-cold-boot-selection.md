---
id: E3-T24b
epic: 3
title: Visible resume-versus-cold-boot decision path
priority: 324.2
status: in-progress
depends_on: [E3-T24a, E3-T12e, E3-T10]
estimate: S
risk: high
capstone: false
---

## Goal
Make the validated snapshot path the visible default while every invalid or reset state takes an
honest, typed cold-boot path.

## Deliverables
- A single boot decision state machine consuming E3-T12 restore results.
- Visible resume/cold labels and stable reason codes in diagnostics.
- Browser tests for valid snapshot, corrupt/stale snapshot, missing snapshot, and reset disk.

## Acceptance criteria
- [ ] `make verify-E3-T24b` resumes a valid snapshot to a usable shell within five seconds and
  proves every invalid case cold-boots with the expected reason.
- [ ] Reset disk cannot reuse a pre-reset snapshot or overlay generation.
- [ ] Progress events identify the selected path without double-starting either machine.

## Adversarial verification
Race reset against restore, swap validation results, corrupt after validation but before read, and
trigger two navigations. Any stale resume, false path label, double machine, or silent fallback
refutes.

## Verification log
(empty)
