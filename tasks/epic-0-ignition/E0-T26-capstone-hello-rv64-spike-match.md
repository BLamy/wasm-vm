---
id: E0-T26
epic: 0
title: Capstone — Hello from RV64 in a browser tab with a byte-for-byte Spike trace match
priority: 26
status: pending
depends_on: [E0-T17, E0-T19, E0-T20, E0-T21, E0-T23, E0-T24, E0-T25]
estimate: L
capstone: true
---

## Goal
The Level 0 threshold from `ROADMAP.md`, demonstrated end-to-end from a cold start: a
browser page loads the WASM module, executes the bare-metal `hello.elf`, prints
`Hello from RV64` through the stub console into xterm.js — and the instruction trace of
that exact execution matches Spike's normalized trace byte-for-byte, with native, node-
wasm, and browser-wasm builds all in agreement.

## Context
This is the phase-change gate: after it, every Epic 1 change is developed against an
observable, reference-anchored machine. The capstone integrates nothing new — it *proves*
the integration under the capstone rule in `tasks/README.md`: performed from a fresh
clone and fresh browser profile, no development-machine state. "Byte-for-byte" means
`cmp` exit 0 between the E0-T16 canonical trace produced by our machine and the E0-T20
normalized Spike log, at `commit` level (pc + insn + rd writebacks), for the complete
hello run from entry to HTIF exit.

## Deliverables
- `tools/capstone/e0.sh`: automated portion — cold-clone via `tools/verify/cold_clone.sh`,
  `make ci`, run hello natively (assert stdout `cmp` + exit 0), run hello under
  `wasm-pack test --node` capturing trace and digest, run the Spike diff at commit level,
  and `cmp` all three traces (native, node-wasm, Spike-normalized) pairwise; prints a
  PASS/FAIL summary table.
- `docs/capstone-e0.md`: the manual browser procedure — fresh-profile launch commands for
  Chrome and Firefox, `make web-build web-serve`, the observable checklist (terminal text,
  status line `exited code=0`, retired count, zero console errors), and an evidence
  section for screenshots plus the browser `take_trace()` output diffed against native.
- `make capstone-e0` invoking the script and then printing the manual checklist.

## Acceptance criteria
- [ ] `make capstone-e0` passes from a cold clone on a machine with only git, Rust
      (+ wasm32 target, wasm-pack), Docker, node, and a browser installed.
- [ ] `cmp` reports zero differing bytes between native trace, node-wasm trace, and
      normalized Spike trace for the full hello execution (all pairs; line counts equal
      and > 0, printed in the summary).
- [ ] In a fresh Chrome profile *and* a fresh Firefox profile: page loads with zero
      console errors, Run prints exactly `Hello from RV64`, status shows `exited code=0`,
      and the displayed retired count equals the native CLI's `retired=` value.
- [ ] Browser-side `take_trace()` output, saved from the page, is byte-identical to the
      native trace file.
- [ ] `make verify-all` (E0-T25) is green at the same commit — the capstone claim covers
      the epic, not just the demo path.

## Adversarial verification
Cold start is mandatory, not optional: perform everything on a machine (or pristine VM /
fresh user account) that has never built this repo; any reliance on leftover state —
cargo caches with patched deps, a stale `pkg/`, a warm browser profile — refutes.
Attack angles: (1) sensitivity proof — hex-edit one immediate byte in a *copy* of
`hello.elf` (e.g. change a printed character), rerun the pipeline, and confirm the trace
diff goes red at the corresponding instruction and the terminal shows the mutation; a
pipeline that stays green refutes the entire measuring apparatus; (2) `cmp`, never
`diff -w` — inspect the script for whitespace-forgiving comparison and refute if found;
(3) recount independently: count retired instructions in the Spike log yourself and check
it against the browser status line; (4) pull the network cable after `web-build` and
reload the page — a CDN dependency sneaking in refutes the pinned-assets claim;
(5) run everything twice — nondeterminism anywhere (trace bytes, digests, retired counts)
refutes; (6) attempt the demo on the other OS (Linux if verified on macOS) and record it.

## Verification log
(empty)
