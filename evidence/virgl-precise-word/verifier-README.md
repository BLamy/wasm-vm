VERDICT: verified

The fresh independent review supports frozen implementation/harness
`09afcaa29bda5206b98fb14e019f41395d669fec`, based on
`220c2640d8c75df4decae10a3aa12a7be150897f`. The worker evidence submission is
`8322ee6c6c6fc2148d7b4bc70cc567f09879e87b` and changes only evidence/task files.

`verifier-verdict.json` carries ten predictions as HELD with observed state,
raw file/line/digest citations, coverage waivers and promoted-test results.
The task log is the human-readable verdict. The earlier allocation refutation
at b874 is retained; its repaired failure behavior is independently proven at09af.

`verifier.tar.gz` contains 220 original files (1,035,068,076 uncompressed bytes),
including complete independent hardware pixels for both seeds and the bounded
novel attack, literal prediction/oracle scripts, native allocation traces,
LLVM/V8 counters, eight raw proof-forgery inputs, source-fault binaries and
promoted-test outcomes. `verifier-manifest.json` binds every member by size/SHA-256.
The archive SHA-256 is
`2b967384003681a3e96c7bd4a6064ecd81378e58c34a3a01a3631830eb5f2207`.
Every member was streamed against its original, then originals rechecked.
Reproducible full scratch clones and duplicate vendor/build trees are omitted;
relevant runtime source snapshots, compiled fault binaries and all raw records
needed to interrogate the findings remain. Immutable implementation history
supplies the omitted unchanged source. Extract this archive to a scratch directory;
references of the form `verifier.tar.gz::path` name its members. Worker/cold
references name the separately committed archives and `manifest.json`.

`final-review-record-audit.json` reconstructs the canonical native/Wasm record,
re-reads every physical word/pixel and actual source-fault mismatch, checks source
coverage and the precise carry-forward boundary. `final-review-cold-audit.json`
verifies the scrubbed pristine clone and byte-identical native/Wasm transcripts.
`final-review-package-audit.json` verifies all worker/cold/refuted package bindings.
`trace-points.jsonl` provides 90 exact physical-state citations into the canonical
GPU report. `coverage-scope.md` classifies all changed hunks, including static and
proof-tool waivers. These are record inspections, not substitute acceptance runs.

Permanent tests are:

```sh
node renderer/virgl-command/tests/precise-word-regressions.mjs
bash renderer/virgl-shader/native_tests/precise_upstream_allocations.sh target/evidence/precise-upstream-regressions
```

The first uses the normal Wasm build and literal admission/contract assertions;
the second builds only in the supplied scratch directory with ASan/UBSan and
forces each actual upstream malloc/realloc failure. Their recorded final results
are `final-promoted-js.json` and `final-promoted-native/results.jsonl`.
Actual retained-flag and allocation-latch source faults fail the promoted tests.
No production injection API is added. No further broad acceptance is required
for promoting these tests after the exact-source worker/cold proof.
