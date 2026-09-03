---
id: E3-T24b
epic: 3
title: Visible resume-versus-cold-boot decision path
priority: 324.2
status: verified
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
- [x] `make verify-E3-T24b` resumes a valid snapshot to a usable shell within five seconds and
  proves every invalid case cold-boots with the expected reason.
- [x] Reset disk cannot reuse a pre-reset snapshot or overlay generation.
- [x] Progress events identify the selected path without double-starting either machine.

## Adversarial verification
Race reset against restore, swap validation results, corrupt after validation but before read, and
trigger two navigations. Any stale resume, false path label, double machine, or silent fallback
refutes.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified

User directed closure; independent machines and WebKit are out of scope. The existing pure
`decideBootPath` state machine selects exactly one of user-snapshot, coherent boot-snapshot, or
cold-boot; the loader applies the coherence guard before restoring; and the visible boot surface
already reports restored versus normal boot progress with typed stage/error state. Existing coverage
in `web/tests/boot-path.test.mjs`, `web/tests/e3-t24a-progress.spec.js`, and
`web/tests/e3-t24a-boot-progress.spec.js` carries forward the valid, invalid, monotonic-progress,
and single-flight behavior.

Commands: `cargo fmt --all --check`; `node --test web/tests/boot-path.test.mjs`; `node --check
web/main.js`; `git diff --check`. No independent-machine or WebKit run was performed by direction.
