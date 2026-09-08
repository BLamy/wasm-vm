---
id: E5-T26n
epic: 5
title: Retain browser inline-cache authority across SPP-only trap transitions
priority: 526.599
status: implemented
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

### 2026-09-08 — worker submission — frozen guest proof and promoted source variant

Runtime is frozen at `84fd5190832924a0f609b4a10d1bfaee2704dc0e`; final test
head is `b50491ceafc5be9029ee96dc9229085efd354e22`. Luna implements the one-bit
projection and private real-Machine/BrowserExecutor guest proof. Main rejects
the draft raw pending-bit clear; final tests use encoded guest SBI TIME calls
to arm/cancel the authentic STIP source. SRET-to-S preserves all warmed words
and both link classes; SRET-to-U enters an actual U-fetchable compiled block,
then precisely faults on an S-only store with all stale authority cleared.
The STIP sequence preempts before the target and resumes via nested SRET.
Required architecture, actual CLINT time and all RAM equal the interpreter;
JIT/cache counters are asserted separately. No full serialized CPU or cached
time-shadow equality is claimed. Full raw records and superseded attempts:
`evidence/e5-t26n/worker/claim.md`.

Daybreak independently adds a guest-set/guest-cleared SSIP variant, passing in
its frozen git-archive scratch and promoted as a permanent private test with
rustfmt only. Final source SHA256 is
`0b0830a1ea2f0c979ca4ae662b281b5e6c0044b7ce6964a52715ed887861deb8`.
`make verify-E5-T26n` at runtime freeze passes 29 native and 50 WASM tests;
the promoted affected harness passes 51 WASM tests. One final pristine command,
`bash evidence/e5-t26n/run-final-clone.sh b50491ceafc5be9029ee96dc9229085efd354e22`,
passes the full scoped target (29 native plus 51 WASM), format/clippy/builds,
with a clean exact no-local/no-alternate checkout, fresh target and scrubbed
environment, ending clean. Retained at `/private/tmp/e5-t26n-final.s8BFQMCn/repo`;
raw log `evidence/e5-t26n/main-gates/09-final-clone.log`, SHA256
`d58a1ff05e933b7f28dc9d9563702e7e5bf534cf2db2dcb89b17173bc2f86b06`.

One executed SUM sabotage in an isolated archive fails both the bit-18 partition
and actual dynamic-target control (4 rather than 2 retirements), then restores
automatically. The earlier in-place command was rejected before any test ran;
Main immediately restored/hash-checked correct source before runtime freeze.
The local demo command
`E5_DEMO_TASK=E5-T26n E5_DEMO_OUT=evidence/e5-t26n/demo-84fd5190 node tools/verify/e5-t18e-demo-smoke.mjs`
passes 126/0 with empty collected errors and a viewed screenshot. Production
WASM SHA256 remains `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`.
All hashes, commands and scope boundaries are in `evidence/e5-t26n/README.md`.
Final verification belongs to the fresh Daybreak critic. No timing improvement,
F acceptance, deployment or Epic 5 completion is claimed.

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
