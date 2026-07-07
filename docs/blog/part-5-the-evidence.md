# Part 5 — The Evidence

*Part 5 of a six-part series on the agent-loop framework behind wasm-vm.
[Part 4](part-4-the-adversary.md) introduced the adversarial verifier. This part covers
what the verifier actually interrogates — because an adversary is only as good as the
evidence you force the worker to hand over.*

---

## Claims are cheap; recordings are not

The core doctrine, from `AGENTS.md`:

> Not "trust me, I checked" — here is the session where it worked, in full;
> interrogate it.

When a worker finishes a task, it doesn't submit test output. Test output is a *summary
written by the optimist*. It submits a deterministic **recording** of the final happy run —
and the verifier gets to poke at any instruction, any memory address, any syscall in that
run, looking for the moment it contradicts the claim.

The pattern is borrowed from Replay-style web verification — where a critic interrogates a
browser recording instead of trusting a test log — ported to native systems code. The
worker/critic split from Part 4 only has teeth because the artifact between them is a
recording, not prose.

## Two layers of time travel

The framework records at two levels, answering two different questions:

| Layer | Records | Answers |
|---|---|---|
| **Guest** — the machine being emulated | every retired guest instruction, architectural state digests | *did the machine do the right thing?* |
| **Host** — the Rust process doing the emulating | the entire emulator process: threads, syscalls, memory — replayable in gdb with reverse execution, via [rr](https://rr-project.org/) | *why did the Rust do what it did?* |

**The guest layer is the emulator being its own flight recorder.** One of the first things
built in Epic 0 — before floating point, before the MMU, before anything fun — was
instruction-level trace infrastructure (E0-T16) and deterministic state-snapshot digests
(E0-T17). That ordering was deliberate: every capability built afterward was born
observable. A guest trace is canonical and diffable, which is what makes *differential*
verification possible (more below). It runs everywhere, including in the browser.

**The host layer is rr**, and it gives the verifier its killer move. From the charter:

> a hardware watchpoint on corrupted state plus `reverse-continue` lands on the exact line
> that wrote it.

The repo ships `tools/rr/record-test.sh` (build the test binary first, so the trace records
the test rather than the compiler; pack the trace so it's a self-contained directory you
can hand to another session) and `tools/rr/verifier.gdb` with helpers like
`whowrote <lvalue>`. Findings cite rr event numbers — `rr replay -g 48123` — so any
session, worker or verifier or human, can jump to the exact moment of a finding. For
concurrency-touching tasks, the protocol escalates: N recordings under `rr record --chaos`
(randomized scheduling), where any divergence or hang is a finding with its trace attached.

Two details make this workable in an agent loop. First, the worker self-validates freely —
ad-hoc runs, printf, scratch binaries, no recording, no limit — and only the *final* happy
run gets recorded. Evidence discipline applies at the boundary between sessions, not inside
one. Second, the recorded run has to be *load-bearing*: the verifier will hold it against
the diff (Part 4's sufficiency attack), so any changed behavior that didn't execute during
the recording is automatically suspect. The recording isn't a ceremony; it's the coverage
oracle.

## Never grade against yourself: differential oracles

The deepest anti-self-deception measure isn't the recording — it's *what the recording is
compared to*. Wherever possible, correctness is defined as agreement with an independent
implementation:

- **Spike** (the canonical RISC-V simulator): `tools/diff/` normalizes both traces and
  diffs them byte-for-byte, instruction by instruction.
- **QEMU**: a second, independently-written reference for cross-checking.
- **The Sail model** (the formal, executable RISC-V specification): the RISCOF
  architectural compliance suite runs 395 tests against it — the Level 1 gate demanded
  **395/0 with zero exclusions**.
- **The emulator against itself, across builds**: native and wasm32 must produce
  *identical* traces for identical programs (E1-T22) — caught by a trace-hash fingerprint.

An agent cannot fool an oracle it didn't write. When the worker's code and Spike disagree
at instruction 91,442, there is no prose in the world that makes that a pass. And the E1-T16
verification from Part 4 shows the interesting failure mode this handles: when Spike's
default behavior *legitimately* differs (Spike hardware-updates A/D bits; this emulator
uses the trap-based Svade policy), the divergence has to be understood and documented per
row, not waved off — the task file records which oracle covers which rows and why.

The differential harness is also why E0-T20's refutation (Part 4) was the most important
save of the project: the oracle plumbing itself had a false-pass bug. Evidence
infrastructure gets verified with the same hostility as everything else, because everything
else stands on it.

## Determinism is enforced, not hoped for

None of this works if runs aren't reproducible. A trace you can't regenerate is a
screenshot, not evidence. So determinism is a *gated invariant*, checked in CI on every
push:

- `tools/ci/determinism-hazards.sh` — greps the guest-visible core for `HashMap`/`HashSet`
  (iteration order!), host clocks, and randomness. Structurally banned from the core crate.
- `tools/ci/no-host-float.sh` — no host floating point in the guest FP datapath; softfloat
  only. Host FPUs vary; the guest's arithmetic must not.
- `tools/determinism_check.sh` — same program, N runs, identical trace hashes; and the same
  program native vs WASM, identical traces.

This is also the roadmap's cross-cutting **Layer G** (Part 2) earning its keep early: the
same determinism that makes evidence trustworthy in the loop *is* the substrate for the
endgame feature — full record/replay of a live Chromium session inside the VM. The
verification framework and the product converge on the same requirement.

## Evidence at the boundary: seeing is a gate too

One more evidence rule, added after the demo page drifted behind the machine's real
capabilities: any change a user could reach through the browser demo must be *proven in the
browser* — rebuild the page, load it under Playwright, assert zero console errors, assert
the in-browser riscv-tests suite reports its full pass count, screenshot for the record.
The demo page doubles as a live conformance dashboard (`web/roadmap.js` re-derives each
capability's status from the suite that just ran in your tab, rather than asserting it
statically). The principle generalizes: for every layer boundary in your system — native,
wasm, browser — evidence must be collected on the *far* side of the boundary, because "it
passes natively" says nothing about what the bindgen layer mangled.

---

**The takeaway:** design the evidence before the features. Give the system a flight
recorder on day one, record the final run of every task, verify against oracles you didn't
write, and enforce the determinism that makes recordings replayable. The adversary from
Part 4 is only as strong as what it can interrogate — so make everything interrogable.

*Next: [Part 6 — The Ratchet](part-6-the-ratchet.md) — how verified tasks compound, who
verifies the verifier, and the scoreboard so far.*
