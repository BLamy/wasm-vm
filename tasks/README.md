# wasm-vm Task System

All work on wasm-vm is decomposed into task files in this directory, organized into epic
folders (`epic-0-ignition/` … `epic-8-chrome-in-chrome/`, plus fractional inserted epics
such as `epic-3.5-oci-workloads/` and `epic-3.75-pico-lab/`). They ladder toward named,
runnable milestones: xv6, busybox+QuickJS+Node, Pico SDK firmware on an emulated Pico 2,
fast Node, GUI apps, and x86_64-via-box64 + a desktop. See `../ROADMAP.md` for the
capability stack (Layers A–G), the targets→epic map, and what each level gets you.

## The priority queue

`QUEUE.md` is the single ordered list of every task, regenerated from task frontmatter by:

```sh
python3 tools/build_queue.py
```

Rules:

- **Priority** is a global numeric ordering key. Whole-number epics conventionally use
  `epic × 100 + task number` (`E2-T07` → `207`). Fractional inserted epics reserve a
  decimal band at their intended position (`E3.5` uses `312.x`; `E3.75` uses `375.xxx`).
  The queue is sorted ascending. Lower number = sooner.
- Work is done **one task at a time**, taking the highest-priority task whose
  `depends_on` are all `verified`. The queue's "Next up" section computes this for you.
- A dependency may be a task id (`E1-T04`) or a bare epic id (`E1`, meaning "that epic's
  capstone task is verified").

## Task lifecycle

```
pending → in-progress → implemented → verified
                   ↘ evidence-needed      (claim not contradicted; proof incomplete)
                             ↑            |
                             └── refuted ─┘   (verifier broke it; semantic rework)
```

`verified` is the only terminal state, and only an adversarial verifier can grant it.
`verification-debt` parks historical landed work that lacks current exact-head proof; it is
neither active nor verified. At most one task may be `in-progress`, `implemented`,
`evidence-needed`, or `refuted` at a time.
`blocked` means its acceptance is currently impossible; the task must name `blocked_on` and keep
an exact repro, while unrelated eligible work may use the active lane.

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
risk: high           # low | medium | high; required before activation
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
- Executable tasks are `S`: one focused boundary, one deterministic acceptance command, normally
  half a day to a day. `M`/`L`/`XL` files are planning containers and must be split into
  `E{n}-T{nn}a/b` files before activation. Atomic exceptions require `decomposition: approved`
  and a written `## Execution slices` section.
- Run `python3 tools/check_task_policy.py` before `python3 tools/build_queue.py`; CI enforces the
  same active-lane and task-size rules.
