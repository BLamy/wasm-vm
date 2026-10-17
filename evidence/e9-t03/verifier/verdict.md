VERDICT: verified

Fresh-session predictions preceded evidence inspection. No acceptance criterion was
refuted. Runtime head is `8461ae9f661deb0841dabf00ab9b99e1fd431e2f`; final test head is
`c51133cacd48408e9ef054370b0503a32f645f32`. Subsequent changes are verification metadata.

- **P1 — HELD.** Both reloaded manifests exactly match the independently reconstructed
  fixture with distinct IDs and sequence `9007199254740994`. Their hashes are
  `5611c6267d4604f67b9c60f7727bba06c6c15c60e136420e28848c2ad2206d19` and
  `45ebdc8ab230537a6780bf34efec3561c9dea04addb6157a91f6ff00b99fa780`.
  Points: `independent-manifest-oracle.json:3`, worker `browser-summary.json:504`;
  original trace calls `call@50`/`call@52`, `trace.trace:345`/`:349`.
- **P2 — HELD.** Raw original-IDB inspection confirms 97 ordered parts: 96 × 1 MiB
  plus 123 bytes, each matching an independent constant-pattern byte oracle. Whole
  SHA-256 is `85ef7d9af1213e77e2b8585805d66d434c0875dc5a20fc1dac7d57277caa46f9`.
  Retained-memory delta is 2,471,464 bytes in the worker and 2,610,144 in the cold run,
  below the 64 MiB bound. localStorage remains unchanged. Points: worker
  `browser-summary.json:514`, `supplement-report.json` → `large`,
  `cold-inspection.json:71`; source `web/session-store.js:321` owns only one write buffer.
- **P3 — HELD.** Real renderer crashes at chunk/object/pre-commit/commit-durable recover
  revisions 1/1/1/2 and exact independently reconstructed manifest hashes. Four new
  races/crashes at seeds 13411–13414 also hold, including a multi-part interrupted put.
  Points: `independent-manifest-oracle.json:18`, `independent-report.json:10`;
  original crash calls `call@846`, `call@878`, `call@910`, `call@942` in `trace-index.json`.
- **P4 — HELD.** All 20 original two-tab races admit one frozen lease, refuse the loser
  with `WriterBusy`, preserve the winner's unique checkpoint payload, and reject prefix
  replacement with `NotAppend`. Both contenders win in the independent seeded runs;
  crashed owners release their lock. Points: worker `browser-summary.json` → `races`,
  `independent-report.json` → `crashes`; source `web/session-store.js:108` and
  `crates/storage/src/session_publication.rs:82`.
- **P5 — HELD.** Missing/corrupt required chunks and malformed descriptors/cursors stay
  outside the playable catalog without changing committed manifests. Missing external
  event payloads cannot publish. Points: worker `browser-summary.json:526`, `:590`,
  `:602`; `supplement-report.json:30`, `cold-inspection.json:73`.
- **P6 — HELD.** Six native publication cases cover identity/policy/prefix preservation,
  wide append positions, GPU/root references, conflicting lengths, malformed/unindexed/
  oversized event chunks and external payload discovery. The independent adapter hash,
  finished-hasher refusals, native/no_std/Wasm builds and nine codec Node/Wasm cases
  pass. Points: worker `storage-native.log:173`, `adapter-native.log:5`,
  `codec-node.log:9`; repeated cold logs under `cold/`.
- **P7 — HELD.** Immutable reuse refuses corrupted existing data. The final real IDB
  transaction detects stale cursors, changed descriptors and removed chunks; cancellation
  refuses publication and releases ownership. Explicit close, a pending acquisition,
  version change, quota/native transaction errors and catalog bounds refuse safely.
  Points: `supplement-report.json:70`, `cold-inspection.json:113` and promoted
  `tools/verify/e9-session-store-critic.mjs`; source final transaction at
  `web/session-store.js:268`. The permanent helper is called by the acceptance target.
- **P8 — HELD.** All 47 retained/deployed files are byte-identical to predecessor
  `6b4b3789:web/dist/<path>` and retain build `222950026e3e01ed…`. The actual factory
  pair uses `/gpu-runtime-worker.js`, restores, retires 3,999,540 new instructions and
  physically draws 1280×800 in fresh epoch 4, without GPU loss/poison/disposal. A null
  repair-present sequence is permitted by the existing readiness contract. Points:
  `retained-byte-comparison.json:5`, `compact-observations.json:12`,
  `cold-inspection.json` → `gpu`. This is factory readiness, not T17/T18 qualification.
- **P9 — HELD.** All 420 original receipts match, the original profile remains untouched,
  and the single pristine sparse clone at the final test head passes all 14 commands.
  All 442 cold file digests and source hashes match; the clone is clean, has no alternates
  or inherited target/npm directories, and the wrapper scrubs the prescribed environment.
  Cold browser proof is 127/0 with all promoted cases, 1,716 parseable trace events and
  zero raw trace console errors. Three absent factory artifacts use actual public R2
  HTTP-200 responses. Points: `cold/receipt.json:1`, `cold/record.py:8`,
  `cold/acceptance-report.json:1`, `cold-inspection.json:1`.

**COVERAGE — HELD.** `README.md` maps every changed hunk. Combined raw precise coverage
has no wholly unexecuted nonempty storage source line. Five remaining defensive branch
ranges have explicit scoped waivers in `combined-line-coverage.json`: unknown-error
normalization, abort after settlement, a future blocked schema upgrade, host lock-service
rejection, and concurrent deletion outside the append-only API. Byte-identical retained
runtime semantics carry forward; generated bindings, metadata and documented future
boundaries have justified waivers. No unproven changed semantic hunk remains.

**SABOTAGE — HELD.** A scratch-served copy with the append guard removed admits committed
checkpoint removal, and the rejection assertion fails; original code returns `NotAppend`.
Point: `supplement-report.json:10`. The first scratch setup was refused with `IndexOrder`
before reaching that guard; the corrected narrow supplement passed. It required no runtime
fix and did not discard or rerun the held independent crash/corruption results.

**SUITE.** Promoted the bounded real-IDB critic helper into `make verify-E9-T03`. Guest/rr
execution does not apply to this metadata-only boundary. Disk descendants, coherent
machine decoding and complete GPU replay remain T04/T05/T17/T18 as scoped by the task.

Original worker report SHA-256:
`63983b74f3018128ea0d649fc7baeaa24c2163865eadc111100bb11af95bea1d`.
Final pristine receipt SHA-256:
`f0e4812a4d12c2b6fb114983d74fce71e3b3acfd6c552817775da50e18983de6`.
Final pristine acceptance report SHA-256:
`c04bb9c95bca209d663fb6789891cafe56323c9622e5608a7f9026e3cfa99acf`.
`SHA256.json` and `recording-receipts.json` bind the compact files and retained original
recordings, respectively.

Publication follow-up: [publication-addendum.md](publication-addendum.md) records the
narrow harness review at `54a270af`. All original HELD product/cold results carry
forward; authenticated HTTP revalidation and exact favicon attribution pass, and the
corrected public process exits 0 with all browser/product assertions intact.
