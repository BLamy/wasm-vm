# E6-T12f5 precise binary32 GPU arithmetic evidence

The compiler and recording harness are frozen at
`7e444f2e3523b5b46b4aedbff3ace0c409ff6a83`. The final pristine-clone canonical
acceptance is the worker happy recording. `manifest.json` binds its complete
acceptance files, receipts, replay artifacts, clean-clone report and screenshot.

Extract either complete recording:

```sh
mkdir -p /tmp/precise-arithmetic-worker /tmp/precise-arithmetic-cold
tar -xzf evidence/virgl-precise-arithmetic/worker.tar.gz -C /tmp/precise-arithmetic-worker
tar -xzf evidence/virgl-precise-arithmetic/cold.tar.gz -C /tmp/precise-arithmetic-cold
```

The worker archive contains the complete acceptance; the cold archive includes
that same acceptance under `acceptance/`, plus the pristine-clone report/log.
Separate JSON inventories identify every original member's size and SHA-256.
Packaging streamed each archive member back, compared it to its original and
then rechecked the original inventory. Actual native/Wasm binaries match their
recorded digests. Source-fault compiler sources/builds, complete call transcripts,
LLVM/V8 counters, stack observations, raw GPU pixels and screenshots remain intact.

For strict receipt replay, use the exact clone named in `cold-report.json` and
restore the acceptance at its recorded `target/evidence/virgl-precise-arithmetic-cold`
path; source-fault URLs and LLVM source filenames refer to that original root.
The preserved final clone remains available locally. Then run
`python3 tools/virgl-precise-arithmetic/receipt.py target/evidence/virgl-precise-arithmetic-cold`.
The archives and member inventories can also be checked independently by digest.

The acceptance records 1,589,060 native calls over 5,101 single cases, 1,116 pairs
and all 19 unchanged original bodies. It includes 800,358 single and 774,540 pair
recoveries, 3,128 truncations, 324 hostile inputs, 4,096 mutations and 260 total
allocation failures, including 240 owned and 20 upstream failures. Wasm records 74,716 calls with full
native parity, 64 maximum-input calls and 82 real fixed-heap pressure calls.
Its original 16 MiB backing buffer and allocation capacity recover after failure.

Each of three hardware input schedules executes 25 rigs and 2,955 draws, checks
11,760 exact private words and all 378,240 physical pixels. Separate branch
observers add 1,544 draws and 197,632 pixels and exercise all 39 helper markers
in each stage. Instrumented branch observers never replace unmodified compiler
output in the exact-word runs. An independent BigInt rational oracle uses
adjacent-value search and distance/parity rounding, rather than GPU jam/limb
arithmetic. It covers normal/subnormal boundaries, all exponent gaps, all 23
subnormal leading-bit positions, cancellation, ties, overflow, signed zeros and
canonical quiet NaN. The contraction witness yields zero with separate rounding
and 0xa8800000 with one fused rounding.

Six separately compiled actual helper faults independently produce physical
pixel/word contradictions. Retained mask, word-PRECISE, equality, selected-lane,
radial and raster hardware leaves and promoted regressions pass. The consumer
checks 265 contracts, 6,461 forgeries, 265 owned snapshots and 65 combined cases
without calling hostile getters. New v28 arithmetic wrappers preserve each
existing base contract, including nested v27 raster obligations.

The IR remains 26,480 bytes, the profile 7,616 and the flow arena 52,644. Helper
strings measure 4,107 bytes below the 8,192-byte bound. Maximum stage GLSL remains
58,201 bytes below 65,536. The migration ledger changes 10 prior singles,
4 pairs and the final original admission; all unrelated predecessor outcomes
remain exact. The original 3f78a90d shader executes its multiply-by-zero and ADD
unchanged. Full 19-body hardware integration is the next task.

An initial complete run failed its receipt check because the error allowlist
omitted the pre-existing upstream allocation-error message observed under paired
heap pressure. `diagnostics/initial-receipt-gap.log` preserves that failure.
The one-line reader repair changes no production code; the final canonical
pristine-clone recording proves the corrected reader. Ephemeral in-memory reader
replays are not exact-head evidence.

The exact-word guarantee applies to private integer consumers. Ordinary float
outputs, interpolation and RGBA8 conversion retain their existing authority and
limits. This isolated compiler/shared-renderer proof does not enable guest GPU
negotiation or establish desktop offload, 300 MIPS, compositor FPS or deployment.
