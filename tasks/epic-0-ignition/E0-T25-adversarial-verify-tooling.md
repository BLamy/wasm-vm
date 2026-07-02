---
id: E0-T25
epic: 0
title: Adversarial-verification tooling — verifier runbook and make verify-E0-Tnn entry points
priority: 25
status: pending
depends_on: [E0-T02, E0-T18, E0-T20]
estimate: M
capstone: false
---

## Goal
The verification protocol from `tasks/README.md` becomes executable: every Epic 0 task
gets a `make verify-E0-Tnn` target that runs its acceptance checks mechanically, a
`tools/verify/cold_clone.sh` script that performs any target from a pristine clone in a
scratch directory, and a verifier runbook that tells a hostile verifier exactly how to
attempt refutation and how to record the outcome.

## Context
The roadmap's execution doctrine says a task is done "when a hostile verifier fails to
break it." That only scales if refutation attempts are cheap to launch and impossible to
fake: the verify targets encode each task's acceptance criteria as commands with real
exit codes; the cold-clone wrapper eliminates "works on the implementer's machine" as a
category; the runbook standardizes Verification log entries (what was attempted, exact
commands, observed output, verdict). These targets also become the per-epic regression
suite: `make verify-all` is what Epic 1 runs before touching the hart.

## Deliverables
- `Makefile`: one `verify-E0-Tnn` target per Epic 0 task (composed from shared recipes:
  fmt/clippy/test/wasm-build/riscv-tests/diff-all/web-build/bench-smoke), each exiting
  nonzero on any failed check; `verify-all` running every target; `verify-list` printing
  the target↔task map.
- `tools/verify/cold_clone.sh [--keep] <make-target>`: clones HEAD into
  `$(mktemp -d)`, scrubs environment (unsets `RUSTFLAGS`, `CARGO_*`, `RUST_LOG`), runs
  the target, reports, and cleans up.
- `tools/verify/runbook.md`: the verifier protocol — cold-clone first, run the task's
  listed attack angles, invent at least one novel attack, append a structured log entry
  (template: date, verifier, commands, evidence, verdict `verified|refuted`); rules for
  flipping task status per `tasks/README.md`.
- Checks needing missing host tools (Docker, nightly for fuzz) fail with an explicit
  `SKIPPED: <reason>` and nonzero exit unless `VERIFY_ALLOW_SKIP=1` — silence is forbidden.

## Acceptance criteria
- [ ] `make verify-list` names a target for every task file in `tasks/epic-0-ignition/`
      (script-checked against the directory listing; a new task file without a target
      fails CI).
- [ ] `tools/verify/cold_clone.sh verify-E0-T03` (and T18, T20) pass from a scratch
      clone on the current main.
- [ ] Sabotage sensitivity, demonstrated once per shared recipe: a formatting error, a
      failing unit test, a corrupted golden trace, and a broken wasm build each turn
      their corresponding verify target red.
- [ ] No `|| true`, `-` recipe prefixes, or `continue-on-error` in any verify path
      (grep-enforced).
- [ ] The runbook's log-entry template matches the verification-log conventions used at
      the bottom of every task file.

## Adversarial verification
Verify the verifier. (1) Meta-sabotage: pick three tasks at random, break one acceptance
criterion of each in a scratch branch (e.g. change the UART LSR value, off-by-one the
B-type immediate, drop a golden-trace line), and run the corresponding targets — any
green result refutes this task, regardless of whose "fault" it is. (2) Environment
bleed: export `RUSTFLAGS="--cfg never"` and a poisoned `PATH` before `cold_clone.sh` —
if the inner run sees them, the scrub is refuted. (3) Skip-abuse: uninstall/hide Docker
and run `verify-all` — silent passes refute; the SKIPPED contract must trigger.
(4) Target drift: add a dummy task file `E0-T99-x.md` and confirm the listing check
fails. (5) Run `cold_clone.sh` on a dirty working tree — it must verify HEAD, not
uncommitted state; confirm by breaking a file without committing.

## Verification log
(empty)
