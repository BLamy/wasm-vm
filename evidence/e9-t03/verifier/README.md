# E9-T03 fresh critic evidence

Predictions were written before opening worker evidence. P1–P8 held. P9 and all original
file/source checks held. The single pristine clone at final test head `c51133ca` passed
all 14 gates and all 442 file receipts. See `verdict.md` for the final decision.
Runtime bytes remain at
`8461ae9f661deb0841dabf00ab9b99e1fd431e2f`.

The original worker report SHA-256 is
`63983b74f3018128ea0d649fc7baeaa24c2163865eadc111100bb11af95bea1d`.
All 420 receipts were independently checked before interrogation and again afterward.
Only the copied profile was launched. `recording-receipts.json` binds the original
worker receipt, independent traces, raw supplement coverage and final copied profile.

`independent-report.json` records four new two-tab races and actual renderer crashes
(seeds 13411–13414, both tabs win in different runs) and four metadata corruption
attacks. All those assertions completed. Its final status is honestly failed because
the subsequent scratch sabotage fixture inherited the initial checkpoint's sequence
cursor at a later position, and the codec correctly refused it with `IndexOrder`.
`supplement-report.json` records the corrected narrow sabotage: original code returns
`NotAppend`, deleting the append guard admits the removal, and the rejection assertion
fails. No implementation fix or rerun of held crash/corruption attacks was involved.

The supplement also independently reads every byte of the original 97-part large
object against its constant-pattern oracle, verifies the independent whole hash, and
executes the promoted critic helper. The helper attacks corrupt descriptors/cursors,
immutable chunk/object reuse, each final transaction recheck, cancellation at final
publication, explicit close/reacquisition, version changes and catalog limits. Standard
quota injection and an actual native duplicate-key error also prove object-write aborts.
All use real IndexedDB transactions;
out-of-band corruption is deliberate fault injection, not the storage implementation.

The worker trace ZIP passes archive integrity and parses as 1,571 JSON events.
`trace-index.json` points to relevant calls in the original `trace.trace` member.
`compact-observations.json` preserves the actual factory receipt: original retained
worker, resumed 3,999,540 instructions and a drawn 1280×800 physical repair present in
epoch 4. A null guest sequence is allowed by the existing readiness contract.

## Diff coverage

| Changed boundary | Evidence or explicit waiver |
| --- | --- |
| `web/session-store.js` and deployed copy | Worker plus final supplement precise coverage covers every nonempty source line; `combined-line-coverage.json` binds both raw digests and explicitly waives five remaining defensive branch ranges (unknown error normalization, abort-after-settlement, blocked future upgrade, host lock-service rejection, external catalog deletion). Reuse and close were absent from the final-navigation worker instance and were separately executed. The worker trace covers earlier reload/stream/crash/race behavior. |
| Shared publication helpers | Six named `session_publication` native cases cover direct/GPU/root references, event payload discovery, conflicting lengths, malformed/unindexed/oversized chunks and append identity/prefix checks; worker storage log lines 173–181. The fixed-shape serde JSON error mapping is a defensive impossible-serialization branch, waived. |
| Independent Wasm adapters | Known `abc` hash and finished-hasher errors, malformed manifest refusal, direct references, out-of-line event references and append refusal execute in the real browser. Native and nine codec Node/Wasm tests plus exact bundle rebuild pass. |
| 47 retained runtime files, both copies | All bytes match `6b4b3789:web/dist/<path>`; `retained-byte-comparison.json`. Carry predecessor results unchanged. The retained build digest is independently recomputed by the prescribed gate. |
| New GPU routing in host/main/root worker | The recorded actual factory restore selects `/gpu-runtime-worker.js`; all new invalid selector guards execute. Ordinary worker routing is the unchanged predecessor path. |
| Generated independent bindings/Wasm and current VM Wasm | Adapter rebuild matches committed bytes, all exports are exercised, and CPU suite is 127/0. Generated loader fallback branches are toolchain output, waived; no machine runtime source changed. |
| Build copy/hash commands and hook trigger | Worker bundle-build log records successful build before its documented index-restage lock failure; committed dist includes both packages and retained runtime. Gate independently checks source/dist and exact adapter rebuild equality. Hook path additions are declarative trigger configuration. |
| Cargo metadata, module export, Make recipe | Affected native/clippy/no_std/Wasm gates execute; dependency manifests and target declarations are declarative configuration, waived. |
| Contract source pointer and design docs | Contract gate passes and pointer retains exact predecessor build stamp. Documentation has no execution requirement, waived. |
| Roadmap, generated task catalogs, queue and SW version | Recorded DOM shows verified storage pip. Catalogs add the 24 E9 records without changing existing task records. Queue/policy pass. Generated catalog and cache-version values are declarative metadata, waived. |
| Recorder and promoted tests | Original recorder executes all 14 commands; supplement executes critic helper. The final clean clone executed the promoted helper through the acceptance target. Receipts/reports are evidence metadata, waived. |

No new architectural, disk-descendant, replay, throughput or cross-browser claim is
made by these tests. Guest/rr evidence does not apply to this metadata-only boundary.
