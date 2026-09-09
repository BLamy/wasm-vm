# F discovery observation — independent gate review

Gate-level projection/accounting predictions HELD within the scopes below.
No contradiction found. **New built-browser/cold/reuse evidence remains pending;
no F verdict or timing acceptance.** Unchanged K/H/I/J/T19a and F functional
results carry forward. No tests, builds, browser, status change or commit by this
critic; only this report was written.

## Recording and source binding

Read all 121 lines of `evidence/e5-t26f/discovery-gates/runtime.log` after the
pre-evidence ledger. Mechanically rechecked all nine source pins in
`discovery-verifier/preflight.md`: every file still matches, including the
20-line WASM projection, six-test source, collector, unchanged proper runner and
Make target. HEAD was `4671c61bf0bc0f7cac151f4b4eb6955a45db1dd3`; these are the
pinned uncommitted projection/gate sources, not a claimed final release head.

The transcript reaches the target's final success line121 after WASM fmt,
wasm32 library clippy with warnings denied, nine selected real WASM tests,
collector syntax check and 72 Node tests. Independently matched all nine WASM
test names to their source definitions and counted all 72 Node pass lines.
WASM summaries at lines26/37 show 3+6 passed, zero failed/ignored/filtered;
Node lines113–119 show72 passed, zero failed/cancelled/skipped/todo. This supports
the reported exit0. The inherited hart_ctrl unused-import warning and
wasm-bindgen installer fallback are visible, not suppressed, and do not refute
this scoped result. This is a local warm-target recording, not another pristine
clone or a Chromium run.

## Prediction ledger outcomes

| Prediction | Gate disposition | Re-openable evidence point |
| --- | --- | --- |
| P1 read-only actual projection | HELD for both real WASM wrappers and detached observations | runtime.log:31,33,35 |
| P2 exact counters/gauges/reset | HELD for exercised nonzero producers; droppedStale limit below | runtime.log:30–35 |
| P3 fail-closed accounting | HELD for recorded field/bound/policy/generation/counter refusal and lifetime-drop cases | runtime.log:41–43 |
| P4 isolation/original timing | HELD for source wiring and deterministic cases; actual browser interval pending | runtime.log:43,62–73; unchanged runner pins |
| P5 new-byte provenance | NEEDS EVIDENCE for the planned new seal and raw worker endpoints | no new browser record reviewed |

P1's passing assertions repeatedly read unchanged statistics, snapshot bytes,
architectural digest and clock, mutate a returned JS observation, and require
later observations unchanged. Real JIT execution still progresses afterwards.
This covers the new getter, not an assertion that observing statistics costs
zero host time.

P2's guest-derived assertions include nominated1/deduped19 and a real compiled
loop; CSR exclusion1 with nomination1/deduped18; a 5000-entry stream reaching
queueDepth/high-water4096 with positive overflow and no countsDropped; and a
65537-entry cold stream reaching candidates65536/countsDropped1. These values
are passing source assertions, not separately printed numeric trace fields.
Restore clears counters/current queue/candidates, advances generation and keeps
the existing high-water4096 while guest digest/clock remain equal. The three
held capacity regressions also pass (lines22–26); this does not reopen K.

Positive droppedStale is deliberately **not** claimed: the fixture observes
zero, and source inspection establishes direct `discovery.dropped_stale`
projection from the unchanged producer. No new stale-job workload is demanded
for this read-only field addition.

P3's three Node tests use explicitly synthetic discovery fields on an old
record. They establish safe-integer/bound refusal, accurate six-counter deltas,
retained falling gauges/raw input, generation/regression rejection and nonzero
since-reset overflow/exhaustion even at delta0. They do not establish actual
desktop discovery values. A positive drop total is neither a count of unique
suppressed PCs nor proof of the current latency cause.

For P4/P5, resident admission and worker-protocol regressions preserve the
existing isolation/transport boundary. The new helper's additional guest/JIT
progress checks, positive-cap branch and CLI file output are source-reviewed;
this log is not claimed as separate execution coverage of every rejection or
CLI path. Actual provenance/CRC/physical input/conditional completion/PCM still
come from the canonical proper-runner record and PNG, not collector output.
The planned newly authenticated cold/reuse run can supply that evidence without
rebinding K's seal. Original T0, 2000-ms cap, default4096/repack-off24/divider10,
and all prior functional proof limits remain unchanged.

## Mechanically audited SHA-256

Paths relative to the repository. This table pins the original gate/ledger
snapshot; the three-test source hash is historical (the `690e2324` Git blob),
not the current seven-test file pinned in the incremental section below.

| Artifact | SHA-256 |
| --- | --- |
| evidence/e5-t26f/discovery-gates/runtime.log | 45c22cf53c68e19a7529b4aef46633ff0a2cf56316ecf982a4b5ecbbc2c002cd |
| evidence/e5-t26f/discovery-verifier/preflight.md | 8323bbaeff8a6fe954766901edab83f172c0bed61e0fce3575489eb9a6cedfa8 |
| crates/wasm/src/lib.rs | bd19b54e044ca5497d4624fe299ce561f9b676de6467b1f112a3bba58fd5f77a |
| crates/wasm/tests/discovery_stats.rs | ecb473af2ca60ebea0db3d2a6e16fbad0df9d4ed59560820fd62634c7b02f8e9 |
| tools/verify/e5-t26f-discovery-observation.mjs | 4bc9e00027a42465a37364cad1b707c87da78806a1c0d20d5729109728004d04 |
| tools/verify/e5-t26f-discovery-observation.test.mjs | 35eb06ea4a414d2cb9d68e4ec338b66e70e0715ba9cd91d5c6af392c9ba1d56b |

## Incremental test-only follow-up — HELD

At HEAD `690e23245b4b376c55c0b830f7690c8a0f72059e`, reviewed the complete
101-added-line test diff and closed `collector-guards.log`. The original fixture
and three test bodies remain byte-identical; only imports and four tests were
added. Helper, proper-driver and WASM source pins still match. No test was run
by this critic, and no cold/reuse output was inspected.

- Log line4 executes the previously source-only positive-cap branch with
  synthetic elapsed1/1999.5/2000 ms: fTimingPassed=true while acceptance and
  fVerified remain false. Missing/false completion, a retained error and 2001 ms
  refuse. The input object remains unchanged. These unitOnly timestamps are not
  a real browser success or a relaxed F criterion.
- Line5 launches the actual helper CLI as a bounded child. It checks output
  identity against SHA-256 of the exact input bytes (including extra whitespace),
  false acceptance/F verification, and agreement with printed deltas. Both input
  bytes and helper source remain unchanged.
- Line6 exercises the real `wx` EEXIST failure and input=output rejection,
  preserving unrelated output and input bytes with no success stdout.
- Line7 gives the actual CLI a non-cap failure, requires exit1 and no output
  creation. Only per-test newly created scratch directories are cleaned up.

All seven source test names independently match pass lines1–7; lines8–14 report
7 passed, 0 failed/cancelled/skipped/todo. This closes the positive-cap and CLI
execution dispositions left open above, not the separate actual-browser P5
requirement or every possible refusal branch. No new blocker or policy claim.
Prior HELD projection/accounting results and failed F timing remain unchanged.

| Incremental artifact | SHA-256 |
| --- | --- |
| tools/verify/e5-t26f-discovery-observation.test.mjs | 6df97cb14355b8793e6865b8a2e014ab66fa996d648177c8b6cd27762fc670b5 |
| evidence/e5-t26f/discovery-gates/collector-guards.log | 99c8e795cf423d7b7631819180927891f92f5c47769883e7b3d029af12e24889 |
