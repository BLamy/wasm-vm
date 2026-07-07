# Part 2 — The Map

*Part 2 of a six-part series on the agent-loop framework behind wasm-vm.
[Part 1](part-1-the-loop.md) laid out the shape of the loop. This part is about the first
of the three documents that drive it: `ROADMAP.md`, the destination.*

---

## An agent loop needs a destination, not a prompt

Every agent session in this project starts from zero context. That's not a limitation to
work around — it's the design. Fresh sessions can't rationalize past mistakes they don't
remember making, and a fresh verifier can't be anchored by the implementer's reasoning.

But amnesia has a price: anything that must survive across iterations has to live in the
repo, in writing. The first thing that has to survive is *intent*. Not "build a Linux
emulator" — that's a wish. The loop needs a document that answers, for any session at any
point in a months-long project:

1. What is the end state, concretely?
2. What is the next *milestone*, and how will we know we've hit it?
3. Which big decisions are already made, so I don't reopen them?
4. Why is the work ordered this way, so I don't "helpfully" reorder it?

`ROADMAP.md` is that document. It's ~350 lines and it does all four jobs.

## A Kardashev scale for in-browser Linux

The roadmap frames the project as nine stacked levels, and it's explicit about the framing:

```
Level 0  IGNITION        a Rust machine skeleton executing RISC-V in a browser tab
Level 1  THE MACHINE     RV64GC CPU + Sv39 MMU + traps + timers/interrupts
Level 2  FIRST LIGHT     devices + interrupts + SBI → boot xv6, then Linux to init
Level 3  CIVILIZATION    persistence + net + a real userland → busybox+QuickJS+Node
Level 4  ACCELERATION    JIT-to-WASM + FENCE.I i-cache coherence → fast Node.js/Bun
Level 5  THE WINDOW      framebuffer/GPU + input + compositor → GUI apps, a surface
Level 6  TRANSCENDENCE   SMP, WebGPU-3D, shareable snapshots, self-hosting
Level 7  BABEL           box64 + full network + persistence → x86_64 bins, a desktop
Level 8  CHROME IN CHROME stock chromium-riscv64 + record/replay → time-travel browser
```

The theatrical names are not decoration. They encode the roadmap's actual thesis, borrowed
from Kurzweil: *each level is a phase change that makes the next level cheaper.* The
interpreter makes the CPU debuggable; the compliant CPU makes Linux bootable; booted Linux
makes the system self-testing (the guest OS becomes the test harness); the JIT makes
compilers usable inside the guest. An agent that understands *why* the ladder is ordered
this way makes better local decisions than one following a flat task list — because when a
task is ambiguous, the trajectory disambiguates it.

## Capstones: milestones an agent can't weasel out of

Each epic ends in a **capstone task** — and capstones are the roadmap's enforcement
mechanism. A capstone names a *runnable, demonstrable* threshold, not a vibe:

> **Level 1 capstone:** Green across riscv-tests (rv64ui/um/ua/uf/ud/uc, mi/si) and a
> RISCOF run, in both native and WASM builds.

> **Level 2 capstone:** In the browser, boot xv6-riscv to its shell, then boot an
> unmodified Linux kernel from virtio-blk through init; carry Alpine riscv64 to a `login:`
> prompt, run `vi`, `top`, shell scripts, and a clean `poweroff`.

Two properties matter here:

- **Binary checkability.** "395/0 on RISCOF against the Sail reference model" is not
  something an agent can be optimistic about. It either is or isn't. Every capstone bottoms
  out in a command with an exit code, run from a cold clone.
- **Gating.** The queue's dependency system (Part 3) lets a task depend on a bare epic id —
  `depends_on: [E1]` means "Epic 1's capstone is verified." You structurally cannot start
  Epic 2's kernel-boot work while Epic 1's compliance gate is still red. The agent doesn't
  get to decide the CPU is "probably fine, let's try booting Linux" — the queue won't
  surface the task.

This is the antidote to the most seductive agent failure: skipping ahead. Booting Linux is
more exciting than the 256-combination PTE permission matrix. The capstone gate makes the
boring work load-bearing.

## Decisions made once

The roadmap has a section called **"The three irreversible architectural bets"**:

1. **Guest ISA: RISC-V (RV64GC), not x86** — clean, open, formally specified, official
   compliance suites, Alpine ships riscv64. One decision that cuts CPU effort ~10x.
   (x86_64 arrives *inside* the machine later, via box64 as a guest program.)
2. **Rust → wasm32, no_std-friendly core** — the emulator core is a pure Rust crate with
   zero web dependencies, testable natively at native speed; everything browser-specific
   lives behind traits.
3. **Device model: virtio everywhere** — one transport, one ring-buffer implementation,
   amortized across block/net/GPU/input/sound; Linux already ships every driver.

Why write these down with the word "irreversible" attached? Because agents re-litigate.
Ask a hundred fresh sessions to work on an emulator and a few of them will decide, mid-task,
that actually x86 would be more useful, or that a quick JavaScript prototype of the device
would be faster. Every one of those is locally defensible and globally catastrophic. Naming
the bets — and the *reasoning* behind them — converts "I have a better idea" into "the
decision record already considered this."

The same section documents prior art (JSLinux, v86, CheerpX, container2wasm) and where the
project sits relative to each. That's context an agent would otherwise burn tokens
rediscovering — or worse, half-rediscovering.

## The trajectory is legible to the queue

The roadmap isn't just prose; it's coupled to the machinery. Task IDs are `E{level}-T{nn}`
and priority is computed as `level × 100 + nn`, so the queue's total order *is* the
roadmap's order. The "How to read the numbers" section spells it out:

> Task IDs are `E{level}-T{nn}`; priority = `level × 100 + nn`. The queue is strictly
> ascending priority. Dependencies may pull tasks earlier in *eligibility* but never
> reorder the queue file itself.

One consequence I didn't fully appreciate until the loop was running: **a good roadmap
makes task *authoring* mechanical.** When it came time to decompose Epic 1 into its 29
tasks, the roadmap had already fixed the boundaries (what Level 1 includes, what it
explicitly defers, what the capstone demands). Decomposition became transcription. The
same will be true when Epic 3's tasks get refined against Epic 2's reality.

## Cross-cutting concerns get named too

One more roadmap pattern worth stealing: capabilities that mature across many levels get
their own named "layer" so tasks can reference them. Determinism and record/replay is
**Layer G** — seeded in Epic 0 (instruction trace hook, state snapshots), exercised in
Epic 1 (native-vs-WASM trace identity), stressed in Epic 4 (the JIT must replay
bit-for-bit), and capstoned in Epic 8 (rewinding a live Chromium session). Without a name
and a threaded narrative, a cross-cutting concern like this is exactly what a
task-at-a-time loop silently drops — no single task owns it, so no session defends it.

---

**The takeaway:** before the loop can run, write the document that makes every future
session's context window irrelevant. Concrete end state, binary-checkable milestones,
irreversible decisions with reasoning attached, and an ordering rationale. It's the
cheapest part of the framework and everything else leans on it.

*Next: [Part 3 — The Queue](part-3-the-queue.md), where 216 markdown files become a state
machine.*
