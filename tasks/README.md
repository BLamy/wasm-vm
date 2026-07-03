# wasm-vm Task System

All work on wasm-vm is decomposed into task files in this directory, organized into epic
folders (`epic-0-ignition/` … `epic-8-chrome-in-chrome/`) that stack like a Kardashev
scale and ladder toward named, runnable milestones (xv6, busybox+QuickJS+Node, fast Node,
GUI apps, x86_64-via-box64 + a desktop, and a time-travelable stock Chromium) — see
`../ROADMAP.md` for the capability stack (Layers A–G), the targets→epic map, and what each
level gets you.

## The priority queue

`QUEUE.md` is the single ordered list of every task, regenerated from task frontmatter by:

```sh
python3 tools/build_queue.py
```

Rules:

- **Priority** is a global integer: `epic × 100 + task number` (`E2-T07` → `207`).
  The queue is sorted ascending. Lower number = sooner.
- Work is done **one task at a time**, taking the highest-priority task whose
  `depends_on` are all `verified`. The queue's "Next up" section computes this for you.
- A dependency may be a task id (`E1-T04`) or a bare epic id (`E1`, meaning "that epic's
  capstone task is verified").

## Task lifecycle

```
pending → in-progress → implemented → verified
                             ↑            |
                             └── refuted ─┘   (verifier broke it; back to work)
```

`verified` is the only terminal state, and only an adversarial verifier can grant it.

## Adversarial verification protocol

Every task file has an **Adversarial Verification** section written *for a hostile
verifier* — an agent (or human) whose explicit mission is to **refute** the completion
claim, not to confirm it.

1. The implementer finishes the task, sets `status: implemented`, and records *how they
   claim it works* (commands, tests, demo steps).
2. A **separate session/agent** — never the implementer — takes the task file and attempts
   to break the claim: run the listed checks, then go beyond them (edge cases, adversarial
   inputs, the native-vs-WASM build, differential traces against QEMU/Spike, kill-and-reload
   persistence checks, etc.). The task file's verification section lists mandatory attack
   angles; the verifier is encouraged to invent more.
3. If **any** refutation succeeds: status → `refuted`, with a written repro appended to the
   task file under `## Verification Log`. Back to the implementer.
4. If the verifier fails to break it: status → `verified`, log entry recording exactly what
   was attempted. Only then does the queue advance.

A capstone task additionally requires its demo to be performed end-to-end from a cold start
(fresh clone / fresh browser profile) — no state left over from development.

## Task file format

Filename: `E{level}-T{nn}-{kebab-slug}.md` inside the epic folder. Frontmatter is flat YAML;
`depends_on` is an inline list.

```markdown
---
id: E1-T03
epic: 1
title: Decode and execute the RV64M multiply/divide extension
priority: 103
status: pending
depends_on: [E1-T02]
estimate: M          # S | M | L
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

## Conventions

- Implementation language is **Rust**; core crates must build for native *and*
  `wasm32-unknown-unknown`. Acceptance criteria that involve behavior should hold in both.
- Tasks should be one focused session of work (estimate S/M/L ≈ hours/half-day/day-plus).
- If a task turns out to be too big, split it into `E{n}-T{nn}a/b` files rather than letting
  it sprawl — then rerun `build_queue.py`.
