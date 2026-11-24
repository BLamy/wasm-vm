---
id: E4-T40
epic: 4
title: Usable Replay desktop — interaction latency and guest CPU throughput (planning parent)
priority: 0.3876
status: cancelled
depends_on: [E5-T34e]
estimate: L
risk: high
capstone: false
---

## Why this exists

User request (2026-11-24): clicks in the in-browser desktop "take forever to be
registered"; Replay Chrome and Replay Node work but are "painfully slow". Deep
changes to how CPU instructions are processed are explicitly in scope.

Measured on the warm Replay desktop (Apple M4 Max, headless Chrome, local build
`c6cc6692…` of 2026-11-23):

- The browser runs the guest at 35–45 MIPS on this workload (JIT on) and 45–55 MIPS
  with `?jit=0`. The JIT retires only 27% of instructions, re-enters the host every
  ~23 instructions and recompiled 17,251 of 20,618 installed blocks.
- One click on Chrome's "Run again" needs 50–100 M guest instructions before the
  result is painted: 1.3–2.6 s. A key echo in foot takes 1.6–2.6 s. `node -e` takes
  580–950 M instructions: 15–25 s.
- Native fast interpreter on the same snapshot: 75 MIPS. A host profile attributes
  about 37% of the main thread to block-boundary bookkeeping and about 5% to
  re-decoding evicted blocks (blocks average 5.4 instructions).

This parent is a planning container. It is cancelled in favour of the ordered S
tasks below; each has one boundary and one deterministic acceptance command.

## Replacements

1. E4-T40a — interaction-latency benchmark and recorded baseline.
2. E4-T40b — event-horizon turbo run loop for the fast interpreter, bit-identical to
   the batched interpreter.

Further slices (decoded-block cache capacity, per-guest JIT policy, display damage,
pointer coalescing, hardware cursor plane, guest clock pacing) are filed as their
boundaries are measured.
