---
id: E5-T26n
epic: 5
title: Retain browser inline-cache authority across SPP-only trap transitions
priority: 526.599
status: in-progress
depends_on: [E5-T26m]
estimate: S
risk: high
capstone: false
---

## Goal

Extend the verified browser cache projection by exactly one bit: saved supervisor
previous privilege (SPP). Prove that real guest trap/return transitions preserve
live privilege while avoiding needless invalidation when current authority is
unchanged. This is not a latency diagnosis or a promise to satisfy F's deadline.

## Boundary

Only add bit8 to the cached mstatus projection already excluding1/3/5/7. Preserve
live architectural SPP and every other status bit, current mode, satp, PMP revision,
TLB flush count and trigger-idle input. Synchronize before every compiled entry.
Do not change CSR/SRET/trap implementation, translation support, polling, budgets,
clocks, scheduling, snapshot format, image/helper or F's harness/deadline.

M's historical exact-four-bit assertion remains evidence of its tested revision;
this task explicitly supersedes that expected partition with five bits, rather
than pretending the old matrix proves SPP. Extend that matrix, do not duplicate it.

## Acceptance criteria

- The existing private actual-WASM64-bit matrix preserves read/write/exec
  sentinels only for1/3/5/7/8, clears for every other bit and for a mixed
  ignored+retained mutation, and preserves the complete live architectural value.
  Extend real generated static/dynamic reuse cases to bit8; SUM remains negative.
- Encoded guest SRET from S with SPP=1 and MPRV=0 returns to S, clears SPP and
  restores SIE correctly. Prewarmed inline authority and both published link
  classes remain usable; actual compiled target side effects occur. Compare
  PC/current mode/registers/RAM/mstatus/trap CSRs/retire-cycle state with the
  interpreter oracle. Assert JIT-only execution/link/hit state separately.
- Encoded guest SRET with SPP=0 returns to U and lands on a U-fetchable compiled
  block, so context synchronization actually executes. Its attempted S-only
  data access or published successor is refused with no forbidden side effect
  and exact interpreter architectural parity. Prove current-mode invalidation
  clears/refuses inline words and both publication classes. A denied landing
  fetch alone is insufficient because it never reaches the changed boundary.
- A pending delegated S interrupt across guest SRET preempts the precompiled
  return target at the next dispatch boundary. Record exact sepc/scause, modeS,
  SPP1/SIE0/SPIE1 and absent target effect; clear the source through the fixture's
  legitimate authority, execute the nested guest SRET and observe the expected
  return plus target effect. Compare both stops to the interpreter.
- Scoped format/clippy/native interrupt/privilege/PMP and actual-WASM regressions
  pass at the frozen head, with one final pristine-clone record. Build the local
  demo, expose this task in its manifest, and record126/0 with zero non-favicon
  errors and a screenshot. No outage-only release. Fresh critic independently
  interrogates exact evidence and a bounded pending-source variant.

## Verification command

make verify-E5-T26n

The semantic core remains
`wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture`.
The scoped make target may reuse the unchanged M runtime gate, extending its
tests rather than repeating old F, observer, image or unrelated task suites.

## Adversarial verification

Before inspecting evidence, predict exact live SPP/current-mode and generated
target behavior across SRET. Test MPRV=0 in the positive case; retained MPRV changes
must still invalidate. Use a U-fetchable negative landing so the JIT boundary is
not bypassed by an earlier fetch denial. Keep JIT counters out of interpreter
snapshots. One fresh bounded attack varies the pending delegated interrupt source
in the nested-SRET sequence. Once add SUM to the ignored mask: both the exact
partition and existing generated SUM negative control must fail. Restore source
before freeze. Carry unchanged M/authority results; do not repeat old full tasks,
old image builds or a second pristine clone. No rr, WebKit, other machine, guest
intervention, performance waiver, or speculative speedup claim.

## Verification log

### 2026-09-08 — coordinator — activate source-reviewed SPP prerequisite

F's new exact-runtime screen at657fb5a2 fails at3701.995ms; its separate existing
latency sampler first observes PCM at3156.655ms after a zero sample at3108.295ms.
The records do not identify a cause. Luna's source-only candidate and independent
Daybreak preflight permit exactly bit8 while preserving current authority and
guest SRET semantics; see
`evidence/e5-t26f/spp-context-candidate/{worker-plan,critic-preflight}.md`.
The proposal patch is not executed evidence. F is parked on this named
prerequisite so only one task is active. No semantic or performance claim
precedes the new actual-WASM/guest proof.
