---
id: E4-T28
epic: 4
title: "Capstone: interactive/fast Node.js (Bun stretch), 10x CoreMark, sub-5s boot, zero regressions"
priority: 428
status: pending
depends_on: [E4-T24, E4-T26, E4-T27]
estimate: L
capstone: true
---

## Goal
The Level 4 threshold demonstrated end-to-end from a cold start. The headline named target
is **interactive, fast Node.js**: the same runtime that crawled at Level 3 (E3-T28), now
responsive — a REPL that echoes and evaluates without perceptible lag, and a real
`node`-driven workload (e.g. a small HTTP server handling requests, or `npm`-style script
execution) that feels usable. Because V8 emits machine code at runtime, this is also the
proof that **FENCE.I i-cache coherence** (E4-T16) works: the guest's own JIT is writing code
into pages we have translated. Supporting gates: in-browser CoreMark ≥ 10x the recorded
Level 3 interpreter baseline, unmodified Alpine kernel boot to login under 5 seconds, and the
full compliance suite green under JIT. **Bun** is a documented *stretch*: attempt it, but its
JavaScriptCore backend has a much weaker/immature RISC-V JIT, so a Bun result is recorded as
bonus/gap data, never a gate. This is the moment the machine crosses from "toy shell" to
"you can develop software inside it."

## Context
This capstone is arithmetic against numbers already in the ledger: the denominators are
the E4-T04 `level3-interpreter` baseline entries; the compliance gate is E4-T26's matrix;
the latency claims ride on E4-T21/T23/T24. "Interactive speed" for gcc is fixed here as a
number so it is checkable: guest wall clock ≤ 20 s for `gcc -O2 -c miniz.c` (≈10 kLoC),
with the shell responsive throughout. Per the capstone protocol in `tasks/README.md`, the
demo runs from a fresh clone and a fresh browser profile — no warmed JIT caches, no
lingering IndexedDB/OPFS state, no dev server with special flags beyond the documented
COOP/COEP headers. Expected result if E4-T05..T27 hold: CoreMark 10–25x, boot 3–5 s; if
the margin is thin, this task includes the final tuning pass (batch composition, hotness
threshold, chain depth) — but no new subsystems.

## Deliverables
- A scripted, reproducible capstone run: `tools/capstone_e4.sh` (native prep) + documented
  browser steps, producing a signed-off results JSON: all four benchmark numbers, their
  baseline ratios, compliance matrix summary, and environment capture (browser version,
  hardware, headers).
- Ledger entries for the capstone run tagged `capstone: level4`.
- Any final tuning changes, each individually ledgered (no untracked magic).
- A short demo recording or reproducible demo script showing: cold page load → login
  prompt with on-screen timer, then CoreMark run, then the gcc compile with a visible
  stopwatch and interleaved interactive typing.

## Acceptance criteria
- [ ] Interactive Node.js in the browser: a `node` REPL echoes keystrokes with p95 < 100 ms
      and a scripted `node` HTTP workload serves N requests at a recorded throughput ≥ 10x
      its Level 3 interpreted baseline; the session runs clean under JIT (no i-cache/FENCE.I
      coherence faults from V8's own code generation). Bun attempted; result or gap recorded
      in the results JSON as non-gating.
- [ ] CoreMark (browser, default config, cold profile): ≥ 10x the ledgered
      `level3-interpreter` browser baseline.
- [ ] Kernel boot (OpenSBI first byte → `login:`, E4-T04 definition): < 5.0 s median of 3,
      cold browser profile, default persistent-disk configuration.
- [ ] `gcc -O2 -c miniz.c` in-guest: ≤ 20 s guest wall clock, with scripted keystroke echo
      < 100 ms throughout the compile.
- [ ] E4-T26 compliance matrix fully green at the capstone commit (same commit hash as
      the benchmark run — one build, all claims).
- [ ] E4-T25 lockstep: 500M-instruction boot run clean at the capstone commit.
- [ ] All results reproduced by the verifier from a fresh clone + fresh browser profile
      using only committed documentation.

## Adversarial verification
Refute the headline numbers from a cold start — this is the epic's thesis on trial.
Mandatory: fresh clone, fresh browser profile, follow the docs only. Attack angles:
(1) baseline integrity: recompute the 10x denominator by checking out the ledgered
baseline commit and re-measuring interpreter CoreMark — a drifted or cherry-picked
baseline refutes the ratio; (2) clock honesty: cross-check guest-reported CoreMark
elapsed time against host wall clock (E4-T24's mandatory check) — mtime skew inflating
the score refutes; (3) cold-start honesty: clear site data, time boot on *first*
documented-interactive load, run 3x and report median, not best; (4) interactivity: type
continuously during the gcc compile and measure echo latency independently (screen-
recording frame analysis, not the VM's self-report) — p95 > 100 ms refutes; (5) same-
commit rule: compliance artifacts and benchmark JSON must carry the identical commit hash
and build flags — a fast-build/correct-build split refutes everything; (6) Firefox: the
gates are Chrome-based, but a Firefox result below 5x or any Firefox correctness failure
must be disclosed in the results JSON — omission refutes the report's completeness.

## Verification log
(empty)
