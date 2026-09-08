# E5-T26l — bounded live compile-selection priority

Independently verified selection boundary. F timing remains failed. This task tests
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

## Frozen local recording

Candidate head: `42bb34d854aca091a3940191a8da3b7aff765cad`.
Source/dist WASM SHA-256:
`264db1b1f82664e115a14d68502977610a07339c94824f8a740c65261f242b54`.
Build log: `gates/web-dist.log`, SHA-256
`3758803637d9238d831902f6f7b2a3b32d9141f044ecaff2e93f33315ec22dda`.
The unrelated dist manifests retain their prior hashes and are not committed.

`gates/runtime-42bb34d8.log` records the exact head and successful
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_TARGET_DIR make verify-E5-T26l-runtime`.
This local command unsets those three variables; the critic's separate final
clone owns the full scrubbed-environment portability claim. Recording SHA-256:
`ec25fdaf1bbf1a6fdde2db7f21a1188b0467a924d6b15402c0b682120d5b3e87`.
It passes373 native tests (338 core plus35 integration), including the127-ELF
cache-off/4096/one-slot instruction-trace differential; no_std WASM build;
43 actual WASM tests (34 JIT parity/budgets,6 discovery,3 capacity); and63 Node
tests. One pre-existing long externref/eviction-churn test remains ignored by
its existing annotation, unchanged by this diff. It is not counted as passed.
The pre-existing `hart_ctrl` unused-import warning is retained, not suppressed.

The actual cross-pump recording selects `0x8000007c` first after zero new
staging, with snapshot/RAM digest
`e26a6c58d7f68718119123775969c6e4cec179dccaa0fbd7db0154b760e387a6`.
The stale-resident/incoming case installs only fresh `0x8000009c`, digest
`b29bb15887c0f21af7c7c88bf7c1dab120c5c56fd8d55798a78d242ec785eede`.
Both retain8-attempt/64-staging bounds; neither is a compiled-execution claim.

The viewed built-page capture `demo-42bb34d8/demo-suite.json` reports126/0,
empty console/page/HTTP error arrays and L visibly IN PROGRESS. JSON SHA-256:
`56270e1205dfc91dc39aec3888f570667d87ba8452045309e34ab83d8042a164`;
PNG: `880e5fb480c41a0bbdda5f354e04bfcdc66780f5dc12268f0c8fb3ad2af05181`.
This is the actual Chromium demo, separate from Node's WASM JIT tests.

The fresh cold run began at `2026-09-08T13:36:30.398Z` and sealed successfully at
`2026-09-08T13:50:43.923Z`; the reuse closed at13:50:54 UTC.
Raw invocation is in `browser-42bb34d8/invocation.json`; outer output is
`browser-42bb34d8.log`. Its new retained profile is `e5-t26l-priority-6hJ5Mu`
under the platform temp directory. No previous seal is rebound. Do not treat
these gate passes or an open draft PR as L/F verification.

## Independent runtime result

Daybreak's `verifier/native-results.md` carries P1–P6 HELD and the demo portion
of P7 HELD, pending the actual cold/reuse record. Its one no-local detached clone
at42bb34d8, with fresh build target and scrubbed compiler/test environment, passes
the same runtime target and stays clean. `verifier/pristine-result.json` records
the exact command interval13:37:37.379–13:40:17.115 UTC, unchanged source pins,
empty initial/final status and nine checked command logs. Pristine runtime log
SHA-256: `caadac154049d9e7e24cacf3f4f9006d3ebca216993343935d9235969937dfc6`.
The retained verifier recorder root-path typo occurred before Git/Cargo launch;
it was not a failed candidate proof or an extra clone.

Removing only the production refresh call in that isolated clone causes the
late-hot regression to fail at the intended assertion: actual `0x80000020`,
required `0x8000007c`. The stale/fresh-byte regression still passes under the
same mutation. After restoring frozen runtime bytes, the critic's novel external
cooperative-scope test passes: internal runs do not renew exhausted budgets;
a new zero-work scope's final pump stages0/submits8, selects `0x8000007c` first,
and leaves574 retirements plus the interpreter snapshot unchanged. Digest:
`4c2b6fc6fa51b0a242cd1d99da043e7fc21d37139208f8114ccace42d413f920`.
The test-only patch will be promoted after the live recording closes. All
independent heavy work ended13:42:48.990 UTC, before the timed restore/play leg.

[PR364](https://github.com/BLamy/wasm-vm/pull/364) is OPEN/DRAFT, based on
`codex/e5-t26f-discovery-observation`, and linked to native stack338. Its published
candidate head is42bb34d8. There has been no merge or deployment.

## Closed browser screen — original F cap failed

Cold child exit0 and reuse child exit1 are retained. The wrapper's exit0 means
it collected a valid measurement, not acceptance. Original restore completion
T0 is `1202.054999947548`; frozen end is `5930`; elapsed is
**4727.945000052452 ms**, failing the unchanged2000-ms assertion. The later
interaction-ledger sample4728.330 ms is not substituted for that frozen end.
This unpaired screen does not establish a speedup or regression versus earlier
checkpoints, and does not make the native selection claim into a timing claim.

The profile SHA-256 is
`270a9fb73270b94b63ff1b47c0f823a081e1602920c2ed8351ab049e6d213515`,
runtime tree `7d3c7e02a6b8ba9fd9d01f917be99377b5f427a67e4eea82ff2c2a3a5fddd007`,
and2,818,680-byte envelope
`b229532f4869e0246b3a8d82d3d9cf2cdf6c94263b387a4bb6ee9356b69e65cf`.
Paused overlay generation591 and first-present CRC `4b00f145` match. The
restore reports fresh HELLO2 and fetching/instantiating/restored, with no boot.

Viewed cold and reuse PNGs show the same actual player PID999/start28835,
read-only FIFO descriptor, parent writer, Prepared PCM with zero pointers,
then physical `play`, successful green output and that child's Done/prompt.
Two locked/suspended fresh host-ring observations are zero before the gesture.
Ten matching physical key/DOM events produce8453 changed pixels and frame4→11;
the real cursor matches94 pixels at807.430 ms after original T0. Completion
has1440 new written/non-silent PCM frames, maxAbs0.999969482421875. This run has
no first-PCM probe; its PCM-at-completion observation is4699.445 ms, not a bound
on when the first frame was produced. The lower terminal visibly retains a
2.864-ms underrun from **pre-checkpoint** playback; no zero-XRUN claim is made.

Default decoded4096/repack-off24, chaining, unprofiled timing and discovery
generation5 remain unchanged. Sequential JIT observations bracket the work,
not the exact F interval: beforeRPC1465.650–1471.620, afterRPC5930.810–5979.815.
Guest/JIT retirement deltas are54,474,872/20,596,042 (37.808%); installs/submissions
607, retranslations287, evictions105, decoded builds723607. Nominations increase
3253 and deduped hits3,739,950; since-reset discovery overflow/exhaustion/stale
totals remain zero. These are aggregate counters, not per-PC membership or a
causal cost breakdown, and do not describe the separate compile-queue drops.

The failed cap precedes coherence/drag/second-restore acceptance. Those phases
are not newly covered; unchanged prior HELD results carry separately. The
generic failed capture lacks complete browser-error arrays; the demo's empty
error arrays are not substituted for that missing capture. `digests.txt` binds
all closed main/browser artifacts including the raw failure and companion files.

After the browser closed, the critic's exact formatted63-line test-only patch
was promoted. `gates/promoted-outer-scope.log` records scoped fmt/clippy plus12
pipeline tests passed, including the same574-retirement/digest result. Core
runtime, served JS/WASM and the browser seal were not changed or rebound. No
second pristine clone or unrelated gate repetition was needed.

## Final independent verdict

Daybreak closes P1–P7 as HELD in `verifier/browser-results.md` and sets L verified.
Report SHA-256:
`90e24fa8e29eefbbf28a711a3c745c50565545cb44aac9046d869df03075669b`.
Its current-source/frozen-blob checks, all20 main artifact digests,814-file profile,
150-file runtime, actual kernel/image/manifest and decoded envelope/sound agree.
Full PNG/input/timing/coverage citations are in that report; earlier preflight and
native pending-browser statements are historical, not an outstanding finding.
F's original cap remains failed, and L has no remaining execution proof gap.

The final verified roadmap/task metadata refresh changes the served runtime tree,
even though the WASM stays byte-identical. Do not use that refreshed tree to
rebind or replay the old42bb seal. A later served-code increment needs its own
new authenticated checkpoint.

Final metadata build succeeds (`gates/verified-web-dist.log`, SW6deaaf1bebee),
retaining identical WASM264db1b1. The additional single built-demo pass with
`E5_DEMO_VERIFIED=1` shows L VERIFIED and296/464 tasks verified,126/0 and empty
non-favicon error arrays; main viewed its PNG. The three final metadata artifacts
are independently listed in `final-metadata-digests.txt`, leaving the original
20-entry measurement manifest unchanged.
