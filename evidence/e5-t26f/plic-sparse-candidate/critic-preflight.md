PREFLIGHT: GO — bounded source-safety permission to plan an S/high task; activation remains conditional on Main's current CPU attribution.

This is a new source-only PLIC preflight, not implementation evidence, a task verdict, or
E5-T26n re-verification. No tests, gates, browser, clone, CPU-profile inspection, task/status,
runtime, or HEAD changes were made. The only written artifact is this file.

## Reviewed source and decision

Inspected checkout HEAD: `96ecb801fdf8b67af75cd150db82d115bcf046cd`.
The inspected PLIC, PLIC integration tests, and Machine source have no working diff.

- `crates/core/src/dev/plic.rs`, SHA-256
  `351774cf07fc019c7107745c2bcd0896aae73ace3583a2aa0843a8e56607fbe3`.
- `crates/core/tests/plic.rs`, SHA-256
  `e32b45c9ad5006caf8bf0e50a827931158eabae48012a079a3c75601d77ea6c4`.
- `crates/core/src/lib.rs`, SHA-256
  `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c`.

`PlicState::eip` calls `best_source` (`plic.rs:158-186`). The latter traverses IDs 1 through
31 even when its candidate bitmap is empty. `Machine::sync_plic` calls EIP for both contexts
(`core/src/lib.rs:3411-3419`); the existing ordinary boundary and host-chain sites call that
same function (`:4790`, `:4344`). These facts support a small, isolated reduction of selection
work. They do not establish generated-code cost or a measurable workload improvement.

The proposed sparse enumeration is equivalent to the current selector if it computes the local
`u32` candidate bitmap as `pending() & enable[context] & !1u32`, visits its set bits in ascending
order with `trailing_zeros`, removes each visited low bit under a nonzero loop guard, and retains
the current unsigned, strict priority comparisons. It visits the same potentially eligible IDs
as the old range loop, in the same order. Skipping absent IDs cannot change the result; ascending
order plus strictly greater replacement retains the lowest ID on equal priorities. With no
candidates it visits no priority entries. With all valid sources set it visits at most 31.

An optional separate `eip` existence query is also permitted within this same boundary. It must
use the same valid-source bitmap and return true exactly when an examined priority is strictly
greater than that context's threshold. Because thresholds are `u32`, that condition also excludes
priority zero. EIP does not need to compute the highest winner. If included, both paths must be
checked against an independent old range-scan oracle; comparing only the new EIP and new claim
implementations to each other is insufficient. Keeping EIP delegated to the sparse selector is
the smaller implementation. Freeze which option is included before proof.

Risk is **high** because the result controls guest interrupt visibility and MMIO claims; size
**S** is justified by one pure selection boundary, no added state, and one bounded acceptance
target. The user-reported older ~5.98% `sync_plic` self sample is motivation only. Fresh current
CPU attribution belongs to Main/Luna; this critic has not inspected it. If that attribution does
not support the candidate, this GO does not oblige Main to activate a task.

## Accepted boundary and concrete failure conditions

1. **Selection only.** Production edits are limited to `best_source` and, if selected, the pure
   EIP existence query plus a tiny shared pure candidate helper. No caches, state fields,
   allocation, memoization, dirty flags, snapshot changes, query side effects, or new public
   runtime/testing APIs. Keep pending derivation, claim/complete, MMIO decoding, counters,
   Machine polling sites/order, CSR writes, budgets, clocks, interrupt batching, scheduling,
   and guest interrupt/trap timing unchanged.

2. **Source 0 is excluded at selection, even after restore.** `pending()` deliberately computes
   `level & !(claimed[0] | claimed[1])` without sanitizing bit 0 (`plic.rs:142-144`). Ordinary
   `set_level` and enable writes exclude source 0, but `restore` accepts every correctly sized
   payload without field validation (`:99-122`). A restored level/enable bit 0 and nonzero
   `priority[0]` are therefore supported input states. Mask bit 0 locally in each selection path;
   do not mask `pending()`, rewrite the snapshot, zero `priority[0]`, or normalize readback.
   A high-priority restored source 0 must neither assert EIP by itself nor suppress a real winner.
   E1-T13's old claim that enabling source 0 was an equivalent mutant predates this snapshot
   boundary and cannot justify dropping this mask now.

3. **Full unsigned priority domain.** Both MMIO and restore accept full `u32` priority/threshold
   values (`plic.rs:107-119`, `:299-324`). Do not narrow priorities to a hardware-style small
   range, cast comparisons to signed integers, or implement strictness via overflowing
   `threshold + 1`. Priority 0 is never eligible; priority equal to threshold is masked;
   `u32::MAX` wins over a lower threshold, while threshold `u32::MAX` permits no source.
   Source 31 must remain reachable and ties involving 31 choose the lower ID first.

4. **Both contexts and shared gateway.** Candidate eligibility must use `pending()` with the union
   of both claimed banks. A source claimed by context 0 is unavailable to context 1 and vice versa.
   Per-context enable and threshold remain independent. Held-high completion re-pends only after
   the relevant claimed bits cease blocking it. A snapshot may even contain the same claim in
   both banks; preserve that accepted state and its existing completion behavior.

5. **Invalid context behavior.** Public `eip(2)` and other out-of-range context indices currently
   panic on indexing, including when no source is pending. Preserve that behavior: do not return
   false before accessing the context arrays or replace indexing with a forgiving lookup. A
   guarded nonzero loop prevents `trailing_zeros(0)` from becoming source index 32. This panic
   contract is distinct from MMIO: an unimplemented MMIO context reads zero/writes no-op under
   the existing decoder (`plic.rs:283-294`, `:319-330`), and must continue to do so.

6. **Read/claim/complete observability and counters.** EIP and non-claim register reads are
   observational. Reading the claim register closes exactly the selected context's gateway and
   increments only that nonzero source's `claim_count` once; an empty claim changes neither
   behavioral state nor claim counts (`plic.rs:188-208`). COMPLETE alters the existing claimed
   bank only; it does not increment a claim count. The bus has a separate per-window access
   counter (`mmio.rs:220-224`, `:286`, `:312`): each routed aligned MMIO read/claim/write/complete
   adds one hit, while direct EIP queries add none. There is no distinct PLIC completion counter
   to compare or introduce. Restore still resets diagnostic claim counts and preserves all
   behavioral bytes (`plic.rs:71-122`).

Any violation above is a source refutation of this bounded proposal, rather than an occasion to
expand it into gateway, snapshot, or polling repair.

## Minimal falsifiable acceptance if Main activates

Keep the proof to one table-driven differential test group, one short MMIO/gateway sequence,
the existing affected regressions, one critic variant, and one sabotage. Combine rows within
these tests rather than creating separate large harnesses or tasks.

- **Independent selector oracle and edge rows.** A test-only reference retains the old
  `for id in 1..32` algorithm and its strict comparisons, without calling the new candidate
  helper or optimized EIP. For both contexts, compare winner and EIP using empty pending,
  pending-but-disabled, singleton source 31, sparse and dense masks, equal-priority IDs 1/31
  (claim 1 then 31), a higher-priority 31, priority zero, equality to threshold, values around
  `0x8000_0000`, `u32::MAX`, and threshold MAX. Repeated EIP queries must leave complete
  behavioral state and the full claim-count array unchanged. If EIP is separate, include a
  masked low candidate followed by an eligible higher candidate so it cannot stop at the first
  set bit incorrectly. A bounded, recorded fixed-seed stream of full-width states supplements
  these explicit rows; it is not a replacement for them or a claim of exhaustive sampling.

- **Restore through the actual decoder.** Feed correctly sized 156-byte payloads through
  `ComponentSnapshot::restore`, including raw bit 0, full-width priorities/thresholds, arbitrary
  enables/levels, and both claimed banks. Compare the optimized selector to the independent
  reference and assert byte-identical `to_snapshot()` before/after observational queries.
  Required discriminators: bit-0-only with priority MAX gives EIP false/claim 0; bit 0 at MAX
  together with eligible source 31 below MAX still gives EIP true/claim 31. Preserve raw pending,
  enable, and priority-0 readback; source 0 is excluded from selection only. Existing snapshot
  round-trip and wrong-length tests remain sufficient for their unchanged codec behavior.

- **One MMIO sequence with both contexts and exact counts.** Route reads/writes through the real
  bus, pre-enabling a source in both contexts. Verify independent thresholds, one claim closing
  that source to both contexts, an empty repeated claim, wrong-context/stale/0/out-of-range
  completion doing nothing, and owner completion with the level high reopening eligibility.
  Deassert-before-complete must leave it clear. Compare pending, claim IDs, per-source claim
  counts and bus-hit deltas at each step, including ordinary pending/priority/enable/threshold
  reads. Repeated EIP queries must add no claims or bus hits. One invalid MMIO-context read/write
  remains zero/no-op; separate direct invalid-context checks, including empty and nonempty
  states, must still panic. Private tests or existing public snapshot/MMIO interfaces suffice.

- **Existing affected regressions.** Retain the 10 `core/tests/plic.rs` cases for M/SEIP routing,
  thresholds, ordinary ties, gateway ownership, precise trap destinations and MEI-over-MTI.
  Existing snapshot unit tests are in `dev/plic.rs:334-410`. The already-existing
  `jit-runtime/tests/chaining.rs::device_completion_fires_inside_chained_loop` checks bounded
  delivery against a warmed loop; it is a regression check, not an exact interpreter/JIT
  retirement-parity proof (its own lines 477-481 say so). Carry unchanged polling/chain authority
  and N/M/F/image/harness results; do not demand their redesign or rerun full historical tasks.

- **One bounded critic variant and one sabotage after freeze.** A suitable novel attack restores
  a held-high source 31 claimed in both contexts, with hostile source-0 bytes: completing it in
  one context must leave it blocked by the other, and completing the other must expose the
  correct live priority/enable/threshold result. The critic can vary the completion order and
  recorded seed. One isolated sabotage removes the selection-time bit-0 exclusion (from both
  paths if duplicated). The restored bit-0 rows must fail for the resulting false EIP or missing
  real winner. Restore and hash-check source before final proof; no extra sabotage campaign.

If activated, Main should freeze one task-specific acceptance command around those focused PLIC
tests and relevant existing integration tests, scoped format/clippy and affected native/wasm32
builds. Main owns the task-prescribed demo and one final pristine clone under the repo's high-risk
policy; these are future submission work, not actions performed or authorized by this preflight.
No new workload boot, fresh F latency run, old image rebuild, full old task replay, second clone,
new timer test matrix, or general PLIC conformance campaign is needed for this source boundary.

## Limits of this GO

The selector's sparse work bound is justified by source inspection. Any runtime speedup, current
CPU share, or benefit to F's deadline remains unproven. Main owns F closure, current profile
attribution and the activation decision. If activated, Luna may implement the frozen narrow
task and a fresh Daybreak critic must audit the resulting diff and evidence. This document
neither creates that task nor changes the sealed runtime or F's in-progress status.
