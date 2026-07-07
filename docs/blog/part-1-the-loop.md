# Part 1 — The Loop

*This is part 1 of a six-part series on the framework behind wasm-vm — a from-scratch
RISC-V virtual machine in Rust, compiled to WebAssembly, on its way to booting unmodified
Linux in a browser tab. This series is not about how an AI wrote an emulator. It's about
the loop that let it.*

---

## The failure mode everyone hits

If you hand a coding agent a prompt like "build a RISC-V emulator that boots Linux in the
browser," you get something that *looks* like an emulator. It has files named `cpu.rs` and
`mmu.rs`. It prints "Hello". Its tests pass — because the agent wrote both the code and the
tests, graded its own homework, and moved on.

Run that agent in a loop and the problem compounds. Each iteration builds on the last
iteration's unverified claims. By iteration ten you have a codebase that is confidently,
elaborately wrong, and no single session has enough context to notice. The agent isn't
lying, exactly. It's doing what every optimistic engineer does: mistaking "my check passed"
for "the thing is correct."

An emulator is the worst possible project for this failure mode, and that's exactly why I
picked it. Linux does not boot on a CPU that is 98% correct. There is no partial credit.
Either every one of the thousands of architectural details is right, or you get a hang at
some point during boot with no error message. A vibe-coded emulator is worth nothing.

So the question that actually mattered was never "can an AI write an emulator?" It was:

> **What structure lets an agent iterate hundreds of times on a correctness-critical system
> without the errors compounding?**

## The answer, in one sentence

The repo's `AGENTS.md` opens with what it calls **the one rule**, and everything else in
this series is downstream of it:

> An implementer being satisfied is a **claim**. A deterministic recording of the run that
> satisfied them is **evidence**. No task reaches `verified` on claims: a separate,
> adversarial verifier session must interrogate the evidence, hold it against the diff, and
> fail to refute it.

That's the whole trick. The loop is not "agent writes code until done." The loop is a
pipeline with an adversary in it:

```
worker edits code
      │
      ▼
fmt + clippy                 seconds  · deterministic
      │
      ▼
tests (native + wasm32)      minutes  · deterministic
      │
      ▼
self-validation              minutes  · worker drives its own runs until satisfied
      │
      ▼
recorded final run           minutes  · rr trace (Linux) + guest trace/digests
      │
      ▼
adversarial verification     minutes  · fresh session falsifies the recording,
      │                                 audits the diff, promotes tests
      ▼
verified → build_queue.py → commit → next task

a failure at ANY stage returns the worker to the top,
with the failure report as new context
```

(That diagram is lifted verbatim from `AGENTS.md`, where it's called **the gauntlet**.)

## The three documents

The framework is small. It's three documents and one Python script, and every agent session
is pointed at them before it does anything else:

- **`ROADMAP.md` — where we're going.** Nine "epics" arranged like a Kardashev scale, from
  "a Rust skeleton executes RISC-V in a tab" up to "stock Chromium runs *inside* the
  emulator and is time-travelable." Each level ends in a **capstone**: a named, runnable,
  demonstrable threshold. Part 2 covers why this shape matters more than it looks.

- **`tasks/` — what's next.** 216 markdown files, one per task, each with machine-readable
  frontmatter (id, priority, status, dependencies) and — crucially — a section written *to
  the future adversary* describing how to attack the finished work. A stdlib-only script,
  `tools/build_queue.py`, compiles all frontmatter into `tasks/QUEUE.md`: a single totally
  ordered priority queue with a computed "Next up" list. Part 3.

- **`AGENTS.md` — how work gets proven.** The worker protocol, the verifier charter, what
  counts as evidence, and the rule that the two roles never touch the same task. Parts 4
  and 5.

Notice what's *not* in the framework: no orchestration server, no agent-to-agent message
bus, no LangChain, no bespoke harness. The state machine lives in git. A task's status is a
YAML field in a markdown file. The queue is a generated markdown file. The evidence is a
directory of traces. Any agent — or any human — can pick up the repo cold, read three
files, and know exactly what to do next and what "done" means. That property (call it
*legibility*) turned out to be the load-bearing design decision, because agent sessions are
amnesiacs: every iteration starts from zero, and anything not written down doesn't exist.

## One iteration, concretely

Here's what one turn of the crank actually looks like:

1. A fresh agent session opens `tasks/QUEUE.md` and takes the top entry of "Next up" —
   say, `E1-T16: Sv39 page-table walker`. It reads the whole task file, including the
   "Adversarial verification" section, so it knows in advance how it will be attacked.
2. It flips the task's frontmatter to `status: in-progress`, regenerates the queue,
   commits.
3. It implements, running the cheap deterministic gates (format, lints, native tests,
   wasm32 build) in ascending cost order. Any failure returns to the top.
4. When it's satisfied, it re-runs its validation **under recording** — producing a guest
   instruction trace and/or an [rr](https://rr-project.org/) recording of the emulator
   process — and writes a *claim* into the task file: commit hash, exact commands, evidence
   paths, one paragraph of what the recording demonstrates. Status: `implemented`.
5. A **different, fresh session** — the verifier — takes the task file, the diff, and the
   evidence, and tries to refute the claim. It runs the task's listed attacks plus at least
   one it invents. It checks that every changed line of the diff actually *executed* in the
   recording. It mutation-tests the new tests by breaking the code and confirming they go
   red.
6. The verifier appends a verdict to the task file's Verification log:
   `verified` (queue advances) or `refuted` (with a written repro, and the worker starts
   over — not patches in place, *starts over*, because a fix applied mid-pipeline never
   re-earned the earlier gates).

Each task landed as its own pull request. The commit log reads like a lab notebook:

```
E0-T08: loads and stores — the hart touches memory (refuted, reworked, verified)
E0-T09: control flow — the hart runs real programs (verified first-pass)
E0-T10: ELF64 loader — the machine loads real binaries (refuted, reworked, verified)
```

Those parentheticals are the loop working. Out of 76 verdicts the adversarial verifier has
handed down so far, **19 were refutations** — one in four. Every one of those would have
been a silent lie compounding into the next iteration under the naive loop.

## Where the series goes from here

- **Part 2** — the roadmap: why the destination document is written like a Kardashev scale,
  and why irreversible decisions are made once, in writing, so no session re-litigates them.
- **Part 3** — the queue: the task file format, the lifecycle state machine, and the
  40-line script that turns 216 files into one ordered list.
- **Part 4** — the adversary: the verifier charter in detail, with real refutations.
- **Part 5** — the evidence: two layers of time travel, and why "here is a recording,
  interrogate it" beats "trust me, I checked."
- **Part 6** — the ratchet: how every verified task makes the pipeline stricter, how the
  verifier itself is verified, and the numbers.

*Next: [Part 2 — The Map](part-2-the-map.md)*
