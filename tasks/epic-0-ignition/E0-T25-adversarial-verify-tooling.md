---
id: E0-T25
epic: 0
title: Adversarial-verification tooling — verifier runbook and make verify-E0-Tnn entry points
priority: 25
status: implemented
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
suite: `make verify-all` is what Epic 1 runs before touching the hart. The repo-level
protocol already exists — roles, predict-then-verify, evidence layers, and rr usage live
in `AGENTS.md` and `tools/rr/` — so the runbook operationalizes that per-task (which
verify target, which traces to record/replay, which attack angles) rather than restating
it; on Linux runners the verify recipes should record their final run via
`tools/rr/record-test.sh` so refutation attempts have a trace to interrogate.

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
### 2026-07-03 — worker claim — branch task/e0-t25-verify-tooling (stacked on e0-t24)
Deliverables: the verification protocol is now executable.
- Makefile: one verify-E0-Tnn target for EACH of the 26 epic-0 task files, composed from shared
  _v-* recipes (fmt/clippy/test/features/wasm/exhaustive/zerocost/riscv/diff/web/bench/toolchain/
  fuzz), each exiting NONZERO on failure. verify-all depends on all 26 (make builds each _v-*
  prerequisite once per invocation, so it runs the union). verify-list prints the target↔task map.
  Skip-needing recipes (_v-wasm/_v-diff/_v-web/_v-toolchain/_v-fuzz) print "SKIPPED: <reason>" and
  exit nonzero unless VERIFY_ALLOW_SKIP=1 — silence forbidden.
- tools/verify/cold_clone.sh [--keep] <target>: clones the COMMITTED HEAD into mktemp, scrubs
  RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG + every CARGO_*, PREPENDS trusted toolchain dirs (~/.cargo/bin +
  system bins) so a poisoned PATH shim is outranked while real tools further down (container
  runtime) still resolve, runs bash --noprofile --norc, reports, cleans up.
- tools/verify/self_check.sh (verify-E0-T25's _v-meta) + tools/verify/list.sh: coverage check
  (every task file has a target) + no-green-washing grep (|| true / continue-on-error / TAB-dash
  recipe prefix) over the verify Makefile section + scripts (comments stripped, detector+docs
  excluded). Wired into CI (.github/workflows/ci.yml test job).
- tools/verify/runbook.md: cold-clone-first protocol, attack-angle checklist, the Verification-log
  entry template (matches the "### DATE — adversarial verifier — VERDICT: verified|refuted" format
  at the bottom of every task file), rr recording note, and status-flip rules.
SELF-VERIFIED (each acceptance + adversarial angle):
- verify-list names a target for all 26 tasks (exit 0); ADDING a dummy E0-T99-x.md → verify-list
  exit 2 (angle 4 target-drift caught).
- cold_clone.sh verify-E0-T03 and verify-E0-T18 PASS from a pristine clone. verify-E0-T20 needs the
  Docker daemon (currently DOWN in this env) → correctly SKIPs (see skip-abuse below); with the
  daemon up it runs the Spike diff selftest.
- SABOTAGE SENSITIVITY, one per shared recipe: fmt error → _v-fmt red; failing test / corrupted
  golden (docs/golden/loops.trace.txt line 6) → cargo test --workspace red (the CLI golden-prefix
  test); broken wasm (syntax error) → _v-wasm red (wasm-pack exit 1). Each reverted.
- NO green-washing (acceptance 4): self_check greps the verify path — injecting "|| true" into a
  _v-* recipe makes self_check exit 1; clean tree exit 0.
- Angle 2 ENV BLEED: RUSTFLAGS="--cfg never" + PATH="/tmp/poison(fake cargo):$PATH" before
  cold_clone → the poisoned cargo NEVER runs (outranked by trusted ~/.cargo/bin), verify passes on
  the real toolchain.
- Angle 3 SKIP-ABUSE: with Docker down, make verify-E0-T20 → "SKIPPED: Docker unavailable" + make
  Error 1 (nonzero, no silent pass); VERIFY_ALLOW_SKIP=1 → SKIPPED printed + OK (0).
- Angle 5 DIRTY TREE: breaking crates/core/src/lib.rs WITHOUT committing, then cold_clone → still
  PASSES (verifies committed HEAD, not the working tree).
- Runbook template matches the task-file verification-log convention (acceptance 5).
Gates: fmt; clippy -D warnings 0; workspace tests 0 FAILED; self_check.sh OK; CI runs it.
rr: N/A (macOS; runbook documents the Linux tools/rr/record-test.sh step). Verifier angles open:
meta-sabotage 3 random tasks (1), env bleed (2), skip-abuse with Docker hidden (3), target drift (4),
dirty-tree HEAD-not-worktree (5).
