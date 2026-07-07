# Part 3 — The Queue

*Part 3 of a six-part series on the agent-loop framework behind wasm-vm.
[Part 2](part-2-the-map.md) covered the roadmap. This part covers the unit of iteration:
the task file, and the 120-line script that turns 216 of them into a priority queue.*

---

## The unit of iteration is a markdown file

Every piece of work in this project — from "scaffold the cargo workspace" to "boot stock
Chromium and scrub time backward through a browsing session" — is one markdown file in
`tasks/`, in an epic folder, with flat-YAML frontmatter:

```markdown
---
id: E1-T16
epic: 1
title: Sv39 page-table walker — PTE bits, superpages, page faults, A/D policy
priority: 116
status: verified
depends_on: [E1-T09, E1-T10]
estimate: L          # S | M | L
capstone: false
---

## Goal
One paragraph: the outcome, not the activity.

## Context
Why this task exists, what it unblocks, pointers (specs, files, prior art).

## Deliverables
- Concrete artifacts: crates/files/functions/tests/pages.

## Acceptance criteria
- [ ] Objective, binary-checkable statements.

## Adversarial verification
Instructions to the hostile verifier: what to run, what to try to break,
which reference to diff against, what would constitute refutation.

## Verification log
(appended over time by implementers and verifiers)
```

Six design decisions are hiding in this format, and each one earns its keep in the loop.

**1. The task is sized to one session.** The convention: a task is "one focused session of
work (estimate S/M/L ≈ hours/half-day/day-plus)," and if it sprawls, you split it into
`T{nn}a/b` files rather than letting it grow. This matches the physics of agent sessions —
context windows are finite, and quality degrades long before the window fills. The task
file is the checkpoint format: everything a fresh session needs to resume the project is
in the file, not in anyone's memory.

**2. Acceptance criteria are binary.** Not "the MMU works well" but "Store to W=1,D=0 →
cause 15 (Svade), succeeds after D set" — with the exact test name that proves it appended
in parentheses once it exists. An agent can't negotiate with a checkbox that names a
command and an expected output.

**3. The attack plan is written *before* the implementation.** Every task file ships with
an "Adversarial verification" section — instructions to the future hostile verifier. From
E1-T16, the page-table walker:

> Build a hostile page-table corpus: every PTE bit pattern (256 combinations of the low 8
> bits) at every level, mapped over a probe page, executing {fetch, load, store} from
> {S, U} × {SUM, MXR} settings — record {ok/fault, cause, stval} for all ~12k cells and
> diff against Spike running the identical binary. [...] Any cell divergence refutes.

This does two things at once. It arms the verifier. And — because the worker protocol's
step 1 is "read the whole task file; the Adversarial verification section tells you how
you'll be attacked; **build for it**" — it shapes the implementation. The worker knows the
6,144-cell corpus is coming, so it writes the walker against the spec table instead of
against a handful of happy-path examples. Telling the student exactly how brutal the exam
will be, in advance, turns out to be great pedagogy for agents too.

**4. Status lives in frontmatter, so git is the state machine.** The lifecycle:

```
pending → in-progress → implemented → verified   (terminal)
                              ↘ refuted → in-progress
```

`verified` is the only terminal state, and only the adversarial verifier may set it. A
worker at its most confident can reach `implemented` — the state whose queue icon is,
fittingly, `[?]`.

**5. The verification log is append-only memory.** Claims, verdicts, refutation repros,
and rework notes accumulate at the bottom of the file, dated and attributed
(implementer / verifier / rework). When a task gets refuted, the next worker session's
context *is* the refutation report. When a verifier wonders "was this weird A/D policy a
considered decision?", the answer is in the log with the word DECISION in caps. The task
file ends up reading like a scientific record: hypothesis, experiment, adversarial review,
result.

**6. Dependencies are explicit and machine-checked.** `depends_on` takes task ids
(`E1-T04`) or bare epic ids (`E1` = "that epic's capstone is verified"), which is how
capstone gating from Part 2 is actually enforced.

## The queue builder: deliberately boring

`tools/build_queue.py` is ~120 lines of stdlib-only Python. It parses every task file's
frontmatter, sorts by `priority` (= `epic × 100 + task number`), computes which tasks are
*eligible* (status `pending` or `refuted`, all dependencies verified), and writes
`tasks/QUEUE.md`:

```
**54 / 216 tasks verified.**

Legend: [ ] pending · [~] in-progress · [?] implemented (awaiting adversarial
verification) · [!] refuted · [x] verified

## Next up (deps satisfied, in priority order)

1. **E1-T28** — Sv57 five-level paging — satp MODE=10 (Priv §4.5)
1. **E2-T01** — Define the "wasm-vm virt" machine platform — memory map, hart layout, ...
```

The rules around it do the real work:

- **One task in flight at a time.** No parallel workers stepping on each other, no merge
  conflicts between sessions, no ambiguity about what the diff for a task is.
- **Top of "Next up," always.** The agent doesn't choose work; the queue does. Choice is
  where drift gets in.
- **Regenerate after any status change, and commit the queue with the change.** The queue
  file is generated, but it's also *committed* — so `git log` on `QUEUE.md` is a project
  progress timeline, and any session can see the state of the world without running
  anything.

It would have been easy to make this a database, a web dashboard, a task orchestrator with
an API. It's markdown and a script on purpose. The queue has to be readable by the same
tool that reads everything else in an agent's world — a file open — and writable by the
same tool that writes everything else — a text edit plus a commit. Every moving part you
add to an agent framework is a part the agent can misuse, misread, or break; a generated
markdown file is about as inert as infrastructure gets.

## What the queue looked like in practice

The commit log is the loop made visible — one task, one PR, one verdict at a time:

```
E1-T15: PMP — pmpcfg/pmpaddr TOR/NA4/NAPOT, locking, R/W/X, MPRV (#42)
E1-T16: Sv39 page-table walker — PTE bits, superpages, page faults, Svade A/D (#43)
E1-T17: software TLB (ASID-tagged) + SFENCE.VMA (all four scopes) (#44)
E1-T18: satp mode switching (Bare/Sv39/Sv48) + config-gated Sv48 (#45)
```

And when reality diverged from the plan, the divergence went *into the queue* rather than
around it. Epic 1 originally ended at T26; the compliance push surfaced real gaps —
64-region PMP, debug triggers, exception-priority refinements — and they entered as new
task files (E1-T27, T29) with their own priorities and their own adversarial sections,
rather than as untracked "quick fixes" bolted onto whatever branch was handy. The plan
bends; the protocol doesn't.

---

**The takeaway:** make the unit of work a self-contained, session-sized document with
binary acceptance criteria and a pre-written attack plan; make the scheduler a dumb,
deterministic script over those documents; and let git carry all state. The agent should
never face the question "what should I do?" — only "did I do it?" — because the second
question, unlike the first, has a wrong answer.

*Next: [Part 4 — The Adversary](part-4-the-adversary.md), the part of the framework that
answers "did I do it?" with maximum hostility.*
