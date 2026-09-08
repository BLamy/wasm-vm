# E5-T26l — bounded live compile-selection priority

Work in progress; no verification or F performance verdict yet. This task tests
one runtime candidate motivated by the independently reviewed public-type
reproducer in `../e5-t26f/compile-priority-reproducer/`. That earlier source-only
experiment is not real Machine integration or evidence of browser causality.

The runtime boundary preserves FIFO staging, post-staging stale cancellation and
recount, then refreshes only surviving resident job scores immediately before
selection. Incoming admission, tie semantics, queue limits, guest state and all
browser compilation/cache/clock defaults remain unchanged. The intended real
Machine regression covers a retained backlog with no new FIFO nominations;
actual WASM JIT parity remains a separate gate from the native stalled executor.

## Reproduction and evidence layout

- `make verify-E5-T26l-runtime`: affected native core/guest-trace differentials,
  no_std WASM build, actual WASM JIT parity/budget tests and recorder safeguards.
- `make web-dist` and
  `E5_DEMO_TASK=E5-T26l E5_DEMO_OUT=evidence/e5-t26l/demo node tools/verify/e5-t18e-demo-smoke.mjs`:
  one built-page 126/0 suite and visible task screenshot.
- `node tools/verify/e5-t26l-browser-priority.mjs`: always a new cold resident
  checkpoint on local origin61634, then one unprofiled physical `play` reuse with
  default4096 decoded capacity, repack-off24 and unchanged guest clock/divider.
  No old checkpoint option exists. All inherited E5/compiler flags are scrubbed.
  `E5_T26L_OUT` may select only a new evidence directory, never overwrite one.
- `make verify-E5-T26l` composes those phases. For this shared worktree's two
  pre-existing dirty dist manifests, the coordinator builds with an EXIT restore
  from their recorded backup and explicitly stages only owned generated files.

Browser invocation/source bindings are outside the proper runner's protected
child output directories. Each child transcript and exit are retained, including
failures. The unchanged proper runner authenticates the new seal and records
input, CRC and fresh PCM; the existing offline collector rejects failures other
than the original two-second cap. Its `fVerified` and `acceptance` remain false
even if timing passes. Unit tests use explicit filesystem/child stubs and do not
claim browser execution. No deployment or PR merge accompanies this candidate.

Fresh Daybreak predictions and eventual independent coverage/sabotage/clone and
browser reviews belong in `verifier/`. Exact frozen head, command logs, artifact
digests and results will be appended only after those runs close.

## Worker submission boundary

Luna changed three core files: a crate-private bounded in-place score refresh,
one pump call after the existing cancellation/recount sequence, five queue unit
tests and three real-Machine integration tests. Its scoped self-validation
reported9 queue and11 async-pipeline tests passed; this is a worker claim, not
the frozen recording or a critic verdict.

The integration guest nominates32 blocks, consumes8 attempts, and leaves24
residents while interpreting1000 additional entries of the last block. The next
run stages0 nominations and must select that later-hot resident first. A second
case keeps24 resident and8 incoming stale jobs across a logged same-PC patch,
then requires only the fresh encoding to install. Both compare exact retirement
boundaries, registers/PC and full-RAM snapshot digests with a separate interpreter
Machine. The stalled executor exposes selection but does not claim compiled
execution; the actual WASM JIT suite supplies that distinct proof.

Daybreak's preflight caught a wrapper contract mismatch before browser launch:
proper F success records carry the authenticated head in the nested runtime
binding, not a top-level field. The wrapper now requires that real nested head,
checks any present top-level field for consistency, and writes the checked head
only into its new aggregate. Raw records remain untouched. Its positive unit
case now uses the producer's absent-top-level-head shape and rejects mismatches
in either field for both success and failure records.
