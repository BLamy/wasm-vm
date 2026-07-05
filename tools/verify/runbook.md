# Verifier runbook (E0-T25)

The roadmap's doctrine: a task is done **only when a hostile verifier fails to break it.**
This runbook makes that mechanical. It operationalizes the repo-level protocol in
`AGENTS.md` and `tools/rr/` per-task — it does not restate it.

## The loop

1. **Cold-clone first.** Never verify the implementer's working tree.
   ```sh
   tools/verify/cold_clone.sh verify-E0-T18      # pristine HEAD, scrubbed env
   ```
   This clones the committed HEAD into a scratch dir with `RUSTFLAGS`/`CARGO_*`/`RUST_LOG`
   scrubbed and a clean `PATH`, then runs the target. A green here is a real green.

2. **Run the task's verify target.** `make verify-E0-Tnn` encodes that task's acceptance
   criteria as commands with real exit codes. `make verify-list` maps every target to its
   task; `make verify-all` is the per-epic regression suite Epic 1 runs before touching the
   hart.

3. **Run the task's listed attack angles.** Each task file has an "Adversarial
   verification" section — execute every item. On Linux, record the final run so the trace
   is interrogable:
   ```sh
   tools/rr/record-test.sh <the test binary>     # then tools/rr/verifier.gdb helpers
   ```

4. **Invent at least one novel attack** the task author did not list. Mutation-test the
   armor: break one acceptance criterion in a scratch branch and confirm the corresponding
   `verify-E0-Tnn` turns **red**. A mutant that stays green is a refutation of the check,
   not just the code.

5. **Append a structured Verification-log entry** to the bottom of the task file (template
   below) and flip status per `tasks/README.md`:
   - all attacks failed to break it → `verified`;
   - any attack succeeded → `refuted` (rework, then re-verify from step 1).

## Skips are loud

A check needing a missing tool (Docker, nightly + cargo-fuzz, npm) prints
`SKIPPED: <reason>` and **exits nonzero** — silence is forbidden. Override only when you
have consciously accepted the gap:
```sh
VERIFY_ALLOW_SKIP=1 make verify-all           # skips become non-fatal, still printed
```

## Verification-log entry template

Matches the entries at the bottom of every task file:

```
### YYYY-MM-DD — adversarial verifier (fresh session) — VERDICT: verified|refuted
- <angle>: <what was attempted> — <exact command> → <observed output>. HELD|BROKEN.
- <novel angle>: <attempt> → <observed>. HELD|BROKEN.
- <if refuted> DEMAND: <the single concrete change required>.
```

Rules:
- **Predict, then verify.** State the expected output before running; a surprise is a
  finding.
- **Exact commands + observed output**, not summaries — the log must be reproducible.
- **Coverage refutations count.** "The code is correct but no committed test would catch a
  regression" is a valid `refuted` (the standing pattern behind E0-T15/16/17/18/21).
- One verdict per entry; re-verification after rework gets its own entry.

## Meta-integrity

`make verify-E0-T25` runs `tools/verify/self_check.sh`, which fails if any task file lacks
a verify target or if any verify path contains a green-washing escape (`|| true`,
`continue-on-error`, or a `-` ignore-errors recipe prefix). The verifier's own honesty is
itself verified.
