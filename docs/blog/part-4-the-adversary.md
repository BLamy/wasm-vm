# Part 4 — The Adversary

*Part 4 of a six-part series on the agent-loop framework behind wasm-vm.
[Part 3](part-3-the-queue.md) covered the task queue. This part covers the mechanism that
keeps the loop honest: no task is done until a hostile fresh session fails to break it.*

---

## Why self-review doesn't work

The naive fix for "the agent grades its own homework" is to ask the agent to review its own
work. It doesn't work, for the same reason it doesn't work with people: the author of a
change is the person least equipped to see what's wrong with it. Worse for agents — the
implementer session's context is saturated with its own reasoning. It *remembers deciding*
the edge case was handled. Reviewing your own work inside the same context window isn't
review; it's re-reading.

The framework's answer is a hard structural split, from `AGENTS.md`:

- **Worker** — implements exactly one task. Self-validates as much as it likes, then
  submits three things: the diff, a claim, and recorded evidence of the final happy run.
- **Verifier (critic)** — a **fresh session**, never the one that implemented. It does not
  fix code and does not trust the worker's summary.

Same model, same repo, zero shared context. The same agent may play both roles on
*different* tasks — never both on the same one. The verifier's mission statement is one
word: **refute**.

## The two ways a worker can fail

The verifier attacks from two directions, and the second one is the framework's sharpest
idea:

1. **Falsification** — find one point in the evidence where the program contradicts the
   claim or the acceptance criteria.
2. **Sufficiency** — find changed code the evidence never *exercised*. Unexecuted diff is
   either unproven (demand a run that exercises it) or dead (demand deletion).

Falsification catches bugs. Sufficiency catches the subtler agent pathology: plausible code
that nothing actually runs. The verifier holds the recording against the diff, hunk by
hunk — breakpoints on changed lines during replay, hit counts as ground truth — and every
unexecuted hunk must be classified: **needs-evidence**, **dead**, or **waived** (types,
config, logging — with one line of reasoning each). "The diff isn't proven until every
changed line is executed, waived, or gone."

## The charter, condensed

The verifier's runbook (`AGENTS.md` plus `tools/verify/runbook.md`) reads like it was
written by someone who has been lied to a lot. The highlights:

**Predict, then verify.** For each acceptance criterion, the verifier writes a falsifiable
prediction about concrete program state *before* inspecting that state:

> A prediction made after looking is a caption, not a check.

**Every finding cites a point.** Not "the atomics look wrong" but "x7 holds the pre-CAS
value at rr event 48123" — a citation anyone can jump to with `rr replay -g 48123`.
Opinions don't refute; coordinates do.

**Cold-clone rule.** Acceptance commands must pass from a pristine clone in a scratch
directory with scrubbed environment (`RUSTFLAGS`, `CARGO_*`, `RUST_LOG` unset —
`tools/verify/cold_clone.sh` automates it). "Works on the implementer's machine" is a
refutation, not an excuse.

**Mock & env hunt.** The verifier explicitly hunts for self-licking tests — golden values
computed by the code under test, magic constants, seeded RNG defaults, `cfg(test)` behavior
leaking semantics.

**Sabotage the tests.** Once per task, the verifier breaks the implementation in a scratch
branch and confirms the worker's tests actually go red. A test suite that stays green over
broken code is a refutation *of the tests*. In E1-T16's verification, the verifier ran
twelve targeted mutations of the page-table walker — drop the canonical-address check,
invert SUM, let fetches honor MPRV, turn the PTW's PMP failure into a page fault — and
confirmed the suite caught all twelve.

**Run the task's listed attacks — with your own seeds — then invent one more.** The
pre-written attack plan (Part 3) is the floor, not the ceiling.

**And a no-fire list.** The verifier may not raise style nits, performance complaints
without a stated budget, pre-existing warnings, requirements the task doesn't state, or
anything it can't anchor to an rr event, a trace line, or a diff line. This matters more
than it sounds: an adversary rewarded for finding *anything* will bury you in noise and
train you to ignore it. The charter aims the hostility narrowly at claims.

## A real refutation

From E0-T20, the Spike differential harness — the tool that diffs this emulator's
instruction trace byte-for-byte against the canonical RISC-V simulator. The worker
submitted it as working. The verifier's log entry:

> **FALSE-PASS via crash-truncated prefix (DECISIVE):** run_diff.sh on rv64ui-p-add printed
> "MATCH: 32 instructions" exit 0, but our CLI actually TRAPS at instruction 33
> (csrr a0,mhartid → IllegalInstruction, exit 101). The crash-truncated 32-line trace
> matched Spike's first 32, and report.py accepted it as an authoritative prefix. Two
> causes: run_diff.sh `|| true` masks exit 101, and report.py never verified our trace
> ended via a legit HTIF halt vs a trap.
>
> DEMAND: stop masking the CLI exit; refuse a prefix-match unless our trace ends at a
> verified HTIF halt (not a trap).

Sit with what almost happened there. The *verification tool itself* had a bug that made
crashes look like passes. Every subsequent task in the project would have leaned on that
tool. A one-in-four refutation rate sounds expensive until you price a false green in your
differential oracle at task 20 of 216.

The lifecycle then did its thing: status → `refuted`, the demand became the worker's new
context, the worker reworked and re-recorded, and a second verifier session verified the
fix — including re-running the original attack. Refutation reports name the *single
concrete change required*, which keeps the rework loop tight instead of adversarial in the
bad sense.

## Verdicts are structured, and failure means starting over

Every verifier session ends with a structured log entry appended to the task file —
`VERDICT: verified | refuted | needs-evidence`, one bullet per finding with prediction,
observed value, citation, and demand. Then it flips the status, rebuilds the queue, and
commits. The verifier's only writes are the log, promoted tests, and the status field — it
never fixes implementation code, because an adversary who fixes things stops being an
adversary.

And on refutation, the worker starts the gauntlet from the top — fmt, clippy, tests, fresh
recording — rather than patching in place:

> A fix applied mid-pipeline never re-earned the earlier gates.

## The numbers so far

Across Epics 0 and 1 — 54 verified tasks — the verifier handed down 76 verdicts: 57
`verified`, 19 `refuted`. The refutations cluster exactly where you'd expect agent
optimism to live: evidence tooling (E0-T20's false-pass), coverage gaps ("the code is
correct but no committed test would catch a regression" is an explicitly valid refutation,
and it's the standing pattern behind five early ones), and semantics at spec corners.

What the split bought, concretely: every one of those 19 was caught *inside* the loop, as a
written repro that became the next session's context — instead of surfacing three epics
later as "Linux hangs at boot and nobody knows why."

---

**The takeaway:** the loop's error-correction is not better prompting — it's structure.
Fresh context, an explicit mission to refute, two attack axes (contradiction and coverage),
mutation-tested tests, cold clones, citations or it didn't happen, and a no-fire list so
the hostility stays aimed. Make `verified` a status only the adversary can grant, and the
optimist in the worker stops being a liability.

*Next: [Part 5 — The Evidence](part-5-the-evidence.md) — what, exactly, the verifier
interrogates: recordings, not claims.*
