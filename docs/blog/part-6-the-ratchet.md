# Part 6 — The Ratchet

*The final part of a six-part series on the agent-loop framework behind wasm-vm.
[Part 5](part-5-the-evidence.md) covered evidence. This part covers the property that makes
the whole thing a flywheel rather than a treadmill — and the numbers.*

---

## A loop that only filters would still plateau

Everything in Parts 1–5 is filtering: gates, adversaries, oracles. Filtering alone keeps
bad work out, but each iteration would still start from the same baseline of protection.
The framework's last idea is that **every verified task must make the pipeline itself
stricter**. From `AGENTS.md`:

> Every verified task deposits promoted tests, golden traces, and fuzz seeds into the cheap
> gates at the front, so the pipeline gets stricter every time it runs. That's the
> compounding the whole system is built for.

Concretely, the verifier's final duty on every task — after correctness and coverage hold —
is called SUITE: judge what survives as a *permanent artifact*:

- **Deterministic test** — a committed test asserting what *the verifier* verified, not
  what the worker printed. (The verifier writes tests; it never writes fixes.)
- **Golden trace** — the verified guest trace or digest, checked in as a differential
  fixture that future runs must match byte-for-byte.
- **Fuzz corpus entry** — inputs that reached interesting states, committed as seeds.
- **Verify target** — recurring acceptance commands promoted into the Makefile as
  `make verify-E0-Tnn`, so any future session can re-check any past task with one command
  (`make verify-all` re-runs an epic's entire history; `make verify-list` maps every target
  to its task).
- Or **discard**, with one line of why.

This is the ratchet. The 6,144-cell page-table corpus the verifier built to attack E1-T16
didn't evaporate when the verdict came down — its assertions became committed tests. The
mutation that exposed E0-T20's false-pass became a permanent probe in the harness's
self-test. Task 55 runs against every trap task 1 through 54 left behind, at the *cheap*
end of the pipeline, before a verifier ever gets involved. The system's immune memory grows
monotonically, which is exactly the property the naive "agent in a while-loop" lacks —
there, each iteration *erodes* confidence in the ones before it; here, each iteration
armors them.

## Who verifies the verifier?

A verification system an agent maintains is a verification system an agent can quietly
defang — not maliciously, just in the ordinary course of "making CI pass." So the meta
layer is checked by machine too. `tools/verify/self_check.sh`, wired into
`make verify-E0-T25` and CI, fails if:

- any task file lacks a corresponding `verify-` target (you cannot add work that's exempt
  from re-verification), or
- any verify path contains a green-washing escape: `|| true`, `continue-on-error`, or a
  make ignore-errors prefix. Red must mean red.

Two companion rules close the remaining holes. **Skips are loud**: a check that can't run
because a tool is missing prints `SKIPPED: <reason>` and *exits nonzero* — silence is
forbidden; accepting a gap requires an explicit opt-in flag. And **CI mirrors the local
gate by construction** — the workflow's header comment states the contract: "Mirrored
exactly by `make ci` — if the Makefile and this file disagree, that's a bug. No
continue-on-error, no `|| true`, no conditional job guards."

If you take one implementation detail from this series, take `self_check.sh`. It's under
seventy lines of bash, and it's the difference between "we have verification" and "we still have
verification six weeks after the agents started editing the build."

## The scoreboard

Where the loop stands as of this writing:

- **216 tasks** decomposed across 9 epics; **54 verified** — all 26 of Epic 0 and 28 of
  Epic 1, each landed as its own PR with its own verdict.
- **76 adversarial verdicts: 57 verified, 19 refuted.** A 25% refutation rate, every one a
  written repro caught in-loop instead of a latent bug compounding.
- **Level 1 achieved and gated:** the full RV64GC machine — including Sv39/Sv48/Sv57
  paging, PMP, atomics, softfloat F/D, compressed instructions, interrupts, and debug
  triggers — passes the complete riscv-tests suites **and RISCOF architectural compliance
  at 395/0 against the formal Sail model, with zero exclusions**, native and WASM, from a
  cold clone (`make level1-gate`).
- The browser demo runs the riscv-tests suite live in your tab and re-derives the roadmap
  panel's status from the results — the public claim and the CI claim are the same
  artifact.

For calibration: v86, JSLinux, and TinyEMU are multi-year labors by exceptional systems
programmers. An agent loop reproducing the "architecturally compliant CPU" layer of that
stack — with a formal-model compliance gate, not a demo — is the strongest evidence I can
offer that the framework, not the model's raw ability, is where the leverage is. The same
model without the loop produces the confident, elaborate wrongness from Part 1.

## The recipe, if you want to steal it

Everything reduces to seven decisions:

1. **Write the destination first** (`ROADMAP.md`): concrete end state, binary-checkable
   capstones that gate the next phase, irreversible decisions recorded with reasoning so no
   session re-litigates them.
2. **Make the unit of work a session-sized document** with binary acceptance criteria and a
   **pre-written attack plan**, its status in frontmatter, its history append-only.
3. **Order work with a dumb script over those documents.** The agent never chooses what to
   do — only whether it's done. One task in flight.
4. **Split worker from verifier — hard.** Fresh session, zero shared context, a charter to
   refute, and `verified` grantable only by the adversary. Refutation restarts the
   pipeline from the top; it doesn't patch mid-pipeline.
5. **Demand recordings, not claims.** Flight-recorder infrastructure before features;
   differential oracles you didn't write; determinism enforced by CI; findings cite
   coordinates (an rr event, a trace line) or they don't count. Coverage is part of proof:
   unexecuted diff is unproven or dead.
6. **Ratchet.** Every verification deposits permanent artifacts — tests, golden traces,
   fuzz seeds, verify targets — into the cheap gates.
7. **Verify the verifier**, mechanically, forever.

None of this is specific to emulators, or to Rust, or to any particular model. It's
specific to a world where the implementer is tireless, capable, fast — and systematically
overconfident about its own work. Which is to say: it's a framework for the labor we
actually have now, built out of the oldest tools we know — falsifiable claims, adversarial
review, and evidence that outlives the person (or session) who produced it.

The machine wakes up one instruction at a time. The loop is what keeps it honest.

---

*Series index: [The Loop](README.md) · Repo artifacts: [`ROADMAP.md`](../../ROADMAP.md),
[`AGENTS.md`](../../AGENTS.md), [`tasks/`](../../tasks/),
[`tools/build_queue.py`](../../tools/build_queue.py),
[`tools/verify/runbook.md`](../../tools/verify/runbook.md)*
