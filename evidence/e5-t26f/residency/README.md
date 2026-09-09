# Existing-residency screen: negative for F acceptance

The corrected four-arm ABBA comparison at `884dc59a81970a96f9fc4672a7241eee2454d5d0`
restores the same sealed desktop and completes real input and non-silent playback,
but **every arm fails F's unchanged two-second bound**. This is diagnostic evidence,
not F verification or a production/default-policy decision.

| Order | Existing policy | Original-T0 interaction (ms) | Installs | Retranslations | Evictions |
|---|---|---:|---:|---:|---:|
| A1 | repack-off / 24 | 4997.115 | 594 | 233 | 105 |
| B1 | cap-256 / 256 | 3691.095 | 414 | 0 | 0 |
| B2 | cap-256 / 256 | 4582.245 | 462 | 0 | 0 |
| A2 | repack-off / 24 | 3991.010 | 445 | 117 | 84 |

The larger cap removes eviction churn in these observations, but does not meet the
deadline. Substantial within-policy variation and only two observations per policy
do not establish a generalized speedup. `compiledBlocks` is a live gauge, not a
compilation-event counter. Counter deltas bracket worker RPC responses and include
work beyond the frozen interaction end; do not attribute the full interval to a
single command or add overlapping profile costs.

## Reproduction and provenance

At `de9c9feae6e20dd906145fb5fab3913666b18f8a`:

```sh
node tools/verify/e5-t26f-residency-comparison.mjs
```

This creates one cold checkpoint, then runs the first restored baseline. The first
baseline completed functionality in 4000.815 ms and exited 1 for timing. Its
collector then rejected the real nested `entryCost.hostEntries` field because it
incorrectly read a flat field. Preserve `checkpoint/` and `1-repack-off/` as this
initial aborted attempt; it did not complete ABBA or generate an aggregate.

After the collector-only fix, at `884dc59a`:

```sh
E5_T26F_RESIDENCY_CHECKPOINT=/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-residency-L5pPJH \
E5_T26F_RESIDENCY_OUT=evidence/e5-t26f/residency/replay \
node tools/verify/e5-t26f-residency-comparison.mjs
```

Aggregate exit 0 means all four diagnostic records are valid, not F success. All
four children exit 1 solely for the exact timing assertion. The driver refuses
existing output directories and copies, never launches, the sealed baseline.
Each arm is headed Chromium 152.0.7977.76, ICount, explicit JIT-on, physical
`sh /tmp/a`, and 5 ms key pacing. No profiling, command override, guest reboot,
changed clock, changed WASM, or reset of the original restore timestamp occurs.

Shared SHA-256 bindings:

- Served runtime: `45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b`
- Closed profile: `f6a145f7c15572d77968a5af5a477f7b4231b98fc222922c5d740e1bf40c4c78`
- Normal snapshot: `e2186e00eb85fb4b82dc6edc7780fef02590ffd666c6ae68b90176d4726ecdf7`
- Image: `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550` (1 GiB)
- Manifest: `b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`
- WASM: `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`

Origin is `http://127.0.0.1:61629`. Creator/current HEADs differ only in the
collector, not served bytes. Exact image paths and all kernel/browser bindings are
in the canonical records. Runtime changes require a new cold checkpoint.

## Evidence and scoped gates

`replay/comparison.json` SHA-256:
`bba06bea873de0d2876ccebe8a923239040cbc66d97c63da7380305685536745`.
It names and hashes all four canonical `failure-post-restore-interaction-checks.json`
records. Corresponding PNGs and server/run transcripts are retained beside them.
All four PNGs have SHA-256
`61bc9fe101e574fe7fbaaf15876d608e2097605cfb49270f5c38ea3988d5fe31`.
The inspected screenshots show green conditional completion and prompts in both
terminals; the lower, pre-checkpoint terminal also contains the recoverable ALSA
0.063 ms underrun. This does not prove absence of guest XRUNs.

- 122 focused JavaScript tests: `submission/helper-tests.log` (passed).
- Local deployable build: `submission/web-build.log` (passed).
- Built-page demo: `demo/demo-suite.json`, 126 passed / 0 failed, no browser or
  HTTP errors; the verified T26i capability is surfaced, F remains in progress.
- Six collector regressions run the actual pure collector assertions against the
  retained real nested-counter record. They reject malformed, flat, stale or
  decreasing counters and non-timing child failures. The focused F Make gate now
  includes this file; no guest/browser run is launched by these tests.
- Final combined harness gate: 75/75 passed in
  `submission/final-harness-tests-browser-permitted.log`. The preceding sandboxed
  attempt is retained in `submission/final-harness-tests.log`: 74 tests passed,
  but the existing real-browser profiler adapter aborted inside Node before its
  test completed. Running that browser-dependent gate with browser permissions
  passed; no source change was made between attempts.
- Fresh Daybreak review: `critic.md`, including policy and flat-counter sabotage.

The normal coherence audit, drag saves and second restore were not reached in
these timing-failed runs. They remain unproven, as does the F acceptance command.
