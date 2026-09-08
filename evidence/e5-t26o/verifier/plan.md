# E5-T26o — fresh verifier predictions before evidence

Activation: `43732938827e460af87e56da39d1aecec3ea63bc` on
`codex/e5-t26o-plic-sparse-candidates`. Read the complete activated task before preparing this
plan. No O implementation diff, worker output, gate, trace, demo, or clone evidence has been
inspected. The earlier source preflight permits this proposal to be tested; it does not verify it.

Luna owns implementation and shared native/actual-WASM fixtures. Main owns gates, demo, the one
final clone, and git/task metadata. This critic owns independent review and the single novel
variant after source freeze; it does not implement runtime changes.

## Frozen predictions

- **P0 — selector-only scope.** The only production change will be inside `PlicState::best_source`:
  a local `u32` mask `pending() & enable[context] & !1u32`, guarded nonzero iteration using
  `trailing_zeros` and clearing the lowest set bit, ascending IDs, and unchanged strict unsigned
  threshold/priority comparisons. EIP will still delegate unchanged. Pending derivation,
  claim/complete, counters, state/layout/restore acceptance, MMIO decoding, polling, clocks,
  interrupt/budget behavior, APIs, images and F's harness will remain unchanged. A separate EIP
  algorithm, additional production hunk, or stored-state normalization refutes this scope.

- **P1 — independent range-oracle equivalence.** For both contexts, the new selector's claim ID
  will equal the old test-only ascending range scan, and EIP will equal whether that reference
  winner is nonzero. Explicit cases cover empty/disabled candidates, singleton31, sparse/dense
  masks, tied1+31 (claim1 then31), higher-priority31, masked-low/eligible-high, priority0,
  priority equal to threshold, and full `u32` values including `0x80000000` and MAX. Threshold
  MAX permits no winner. A recorded bounded fixed-seed stream supplements the explicit cases.
  The reference must not call the new selector/helper. Repeated EIP and reference queries leave
  all behavioral snapshot bytes and all claim counters identical; successful claims mutate only
  the winning bank bit and that source's counter. Any mismatch or query side effect refutes P1.

- **P2 — accepted hostile snapshots remain accepted.** Actual `ComponentSnapshot::restore` will
  accept the existing 156-byte domain, including arbitrary source0/enable/level/claimed bytes
  and full-width priorities/thresholds. With source0 pending+enabled at priority MAX alone,
  EIP is false and claim is0. Adding eligible source31 below MAX yields EIP true and claim31;
  source0 cannot hide it. Observational queries preserve serialized bytes and raw priority0,
  enable and pending readback. Restore still resets diagnostic claim counts. Rejecting or
  sanitizing these inputs, selecting source0, or suppressing source31 refutes P2.

- **P3 — real-bus gateway and accounting sequence.** With a source enabled in both contexts,
  independent thresholds determine each context's EIP. A claim closes its gateway to both
  contexts; an empty repeat returns0 without a claim-count increment. Wrong-context, stale,
  zero and out-of-range completion cannot release another bank's claim. Owner completion
  re-pends a held-high source; completion after deassertion does not. Ordinary MMIO read/write,
  claim and complete each add exactly one existing bus-window hit. Only nonzero claims increment
  a PLIC source count; EIP adds neither bus hits nor claim counts. Behavioral state, claim IDs,
  full claim-count array and hit deltas must match each declared step. No separate completion
  counter is assumed or requested.

- **P4 — invalid context behavior.** Native direct EIP calls with context2 and an out-of-range
  index must still panic, including with no pending candidate. An empty fast path cannot bypass
  the array-index contract. Unimplemented MMIO contexts retain zero-read/no-op-write behavior
  and normal bus-hit accounting. No wasm panic-capture harness is required by this task.

- **P5 — shared execution and guest state.** The same public snapshot/MMIO selector cases will
  actually execute natively and on wasm32; a successful target build alone is insufficient.
  The short guest fixture must execute encoded PLIC routing/claim operations through Machine.
  For its declared route, I predict the selected nonzero source is returned once, its pending
  gateway closes, and its count increments once. The routed trap uses cause11/MTVEC for M or
  cause9/STVEC for delegated S, with the fixture's interrupted PC and precise guest side effects.
  At freeze, derive the concrete source ID, PCs, register/memory effects and retire/trap state
  from the guest words before opening the trace; compare the recorded state and canonical
  trace/digest to those predictions. Preserve the existing PLIC, snapshot-unit, interrupt and
  named chained-delivery regressions. That chain regression provides its existing bounded
  delivery assertion, not new exact interpreter/JIT counter parity.

## One reserved novel attack after source freeze

**P6 — both-claimed restore, hostile source0, reversed completion order.** Use the existing
public snapshot/MMIO fixture and one independent recorded seed (reserved `0x26_0f_0031`, distinct
from the worker's seed; retain its bounded case count). The directed state has sources0 and31
held high and enabled in both contexts, priority0=MAX, priority31=MAX-1, thresholds `[0, MAX-2]`,
and source31 claimed in both banks. Restore resets the claim counts to zero.

Before inspecting output, predict this exact sequence:

1. Both EIPs are false and both reference winners are0 despite hostile source0.
2. Complete31 in context1 first: both EIPs remain false because context0 still owns a claim.
3. Complete31 in context0: both EIPs become true and each independent reference winner is31.
   Neither completion has incremented a claim count.
4. Claim31 in context1: return31, increment count31 once, and suppress both EIPs. A wrong-context
   complete31 in context0 changes nothing; owner completion in context1 reopens eligibility.

At each stop compare behavioral bytes, EIP, MMIO results, counters and hit deltas against the
reference state. Any source0 effect or premature reopen refutes the proposal. This is one bounded
variant using existing fixtures, run only after handoff; it is not a new runtime or harness API.

## Sabotage, coverage and final proof

- **P7 — one coordinated mask-removal mutant.** Main will run exactly one isolated sabotage
  removing the selection-time `!1u32` exclusion, with automatic restoration. The explicit
  restored source0-MAX plus eligible-source31 row must fail: source0 steals the reference
  winner's place and the mutant returns0 instead of31. The bit0-only row may still return0
  because EIP delegates to `best_source != 0`; that row alone is not a sufficient discriminator.
  Require the actual semantic failure, then restored-source hash confirmation before final proof.

- **P8 — complete bounded submission.** Every changed runtime/test hunk must execute or have a
  specific non-executable waiver. The single task target must record the shared native and
  actual-WASM cases, short guest trace/state, existing affected regressions, scoped format/clippy
  and builds. Main's built demo must record126/0, zero non-favicon console/HTTP errors and a
  screenshot with the task represented in generated metadata. The one final pristine clone must
  use the final frozen source/test head, fresh target and scrubbed overrides, and finish clean.
  Source/test/log/trace digests must match the cited records. Only then may the independent
  final verdict be issued.

Carry unchanged M/N, polling, image, observer and harness results. No extra old-task replay,
long F boot, second clone, browser campaign or additional sabotage is requested. The authenticated
CPU report is motivation only; this plan does not inspect it or predict speedup/F acceptance.
Await the frozen worker source/evidence handoff before any attack or evidence audit.
