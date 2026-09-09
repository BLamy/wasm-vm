# Independent review of the saved synthetic WASM comparison

**VERDICT: SOUND SUPPORT for the bounded fetch-preflight proposal.** The saved comparison measures a 12.601727% reduction in mean elapsed time for its synthetic all-miss workload, with all three paired quartets favoring the candidate. The JIT-off control changes +0.164406%. This verdict establishes neither task verification nor adoption, and makes no BrowserExecutor, production, browser, Omarchy, F/2-second, or clean-release claim.

The predictions in `review/wasm-predictions.md` were written before opening the new evidence. This review read the requested files and identical adapters, checked recorded input/artifact hashes, parsed WASM container metadata without compiling or instantiating it, and recomputed statistics from the saved rows. No build, benchmark, native run, browser run, new semantic test, or matrix expansion was performed. Writes are confined to the two requested review artifacts.

All line citations below are relative to `/private/tmp/e5-t26f-fetch-probe.83cUcL`. `adapter` denotes `baseline/crates/core/examples/e5_t26f_fetch_probe_wasm.rs`; its candidate counterpart is byte-identical.

## P1 — actual module identities: HELD

The actual module bytes independently hash to the values in both `build.jsonl:18,23` and `timings.jsonl:2–3`, under `wasm-probe/`. They are distinct artifacts:

| Module | Bytes | SHA-256 |
|---|---:|---|
| baseline.wasm | 10,555,782 | `dad5ef710880bab481d9679601c11c8397627a598280a16f290d2cb679ebaaad` |
| candidate.wasm | 10,556,215 | `4eabd93506b2dc778a1a7276854b351d1abd87a4aa6c8fe9b9188a289d0bfcee` |

Both have the WASM v1 header `0061736d01000000`, zero imports, and the same six probe functions, memory, and two exported globals recorded in the timing log. The binary check parsed section metadata only. The recorded runner itself creates `WebAssembly.Module` and `WebAssembly.Instance` objects at `wasm-probe/run.mjs:24–32` and calls their exports at lines 41–54. This establishes an actual WASM comparison; it is not a native executable benchmark labeled as WASM.

The logged module provenance names the corresponding `libwasm_vm_core.rlib` and dependency directory (`build.jsonl:16,21`). Recorded and current core-library hashes match the already reviewed baseline `9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053` and candidate `a63eb5b34305c4554ddc87b36bc0c9821df414b915ddbccd83b6c654daf655ce`. This is saved build provenance corroborated by artifact identities, not an independent reconstruction of the build.

## P2 — build and input symmetry: HELD for recorded inputs; exhaustive provenance NEEDS EVIDENCE

All seven `identical_input` pairs at `wasm-probe/build.jsonl:6–12` were independently rehashed and matched: Cargo.lock, toolchain file, local Cargo config, workspace/core manifests, native fixture source, and WASM adapter. Both adapters have SHA-256 `eea983152b6241544bcfe583680e67dc78a8b64b067ecb0cd1b2310dfb3a51d3`; their direct diff is empty. Baseline/candidate Cargo and adapter-rustc command records are identical after normalizing variant paths.

The recorded toolchain is rustc 1.96.0 (`ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96`), LLVM 22.1.2, cargo 1.96.0, host `aarch64-apple-darwin` (`build.jsonl:2–5`). Both core builds use `--offline --locked --release --target wasm32-unknown-unknown -p wasm-vm-core --lib`, separate scratch target directories, and default `std` features. Both adapter links use edition 2024, cdylib, opt-level 3, debuginfo 2, codegen-units 16, debug assertions off, and overflow checks off (`build.jsonl:14–22`). All six logged commands exit successfully. No wasm-opt step appears in the driver or command records.

`wasm-probe/build.mjs:11–14` constructs one compiler-child environment for both arms, excluding inherited `CARGO_*`, `RUST*`, NODE_OPTIONS, and NODE_PATH; the observed removal list is `["RUST_LOG"]` (`build.jsonl:1`). The local Cargo config sets release debug information to 2. These checks establish symmetry of the recorded setup. The stronger, exhaustive reading of P2 remains NEEDS EVIDENCE: the files do not attest every transitive source, compiler executable, ancestor/user Cargo config, or remaining ambient variable. No complete build-environment or whole-source-tree digest is supplied. That limitation does not defeat this bounded local comparison, and this verdict does not claim hermetic reproducibility.

Identical adapter inputs are concrete: 64 MiB RAM; S-mode Sv39 mapping of `VCODE=0x10000000` to `DRAM_BASE+0x300000`; permissive PMP; `addi x5,x5,1` followed by `bne x5,x6,-4`; x6 set to `u64::MAX`; decoded caching and interrupt batching enabled (`adapter:18–28,144–165`). Miss mode installs `AllMissExecutor`, uses maximum hotness threshold, and allows zero compilation/staging attempts. `is_compiled` counts and returns false; `execute` panics if reached (`adapter:95–131`). Both variants use these same settings, including the intentionally different off/miss setup.

## P3 — actual execution and observed order

**HELD for actual WASM execution and measured order. NEEDS EVIDENCE for the literal prediction of separately established observed warmup order in the timing records.** The rows do not contain standalone warmup events; the preregistered wording was stronger than that record. The narrower warmup-before-measurement claim is supported by synchronous source control flow and successful completion, as described below.

The observed sample rows are `wasm-probe/timings.jsonl:4–27`, with contiguous sequence numbers 0–23. Let B=baseline, C=candidate, O=JIT off, M=all misses. The exact observed order is:

| Round | Sequence and case order |
|---|---|
| 0 | 0 B/O → 1 B/M → 2 C/M → 3 C/O → 4 C/O → 5 C/M → 6 B/M → 7 B/O |
| 1 | 8 B/M → 9 B/O → 10 C/O → 11 C/M → 12 C/M → 13 C/O → 14 B/O → 15 B/M |
| 2 | 16 B/O → 17 B/M → 18 C/M → 19 C/O → 20 C/O → 21 C/M → 22 B/M → 23 B/O |

For each case separately, each round is B/C/C/B. This is six samples per variant/case, 24 total, from the recorded process PID 40695. It is sequential cross-version execution. The schedule is balanced within each quartet but fixed rather than randomized; samples share one process and are not six independent engine sessions.

Every sample calls `probe_prepare(jit)` before starting the timer, then `probe_run`, then reads and validates outputs, drops the probe, and emits the row (`run.mjs:41–58`). `probe_prepare` constructs a fresh machine, runs 10,000 warmup instructions, snapshots MINSTRET, and resets miss count (`adapter:182–194`). The measured budget is 12,000,000 instructions (`adapter:198–208`). Successful rows support that synchronous call sequence, but are not independently timestamped warmup traces. There are no module timing rows after the samples begin; both modules are loaded before sample 0.

## P4 — means and quartet arithmetic: HELD

Recomputed directly from the raw `elapsedMs` values, without executing the runner. All four saved summary rows (`wasm-probe/timings.jsonl:28–31`) agree in sample count, mean, median, minimum, and maximum.

| Case | Baseline mean ms | Candidate mean ms | Candidate elapsed change |
|---|---:|---:|---:|
| Off | 325.013437500 | 325.547777833 | +0.164405613% |
| Miss | 422.538763833 | 369.291583333 | −12.601726766% |

Elapsed change is `100 × (candidate_mean / baseline_mean − 1)`. Each mean uses six samples. For miss mode the corresponding speedup ratio is `baseline_mean / candidate_mean = 1.144187365`; 12.601727% less time is not a 12.601727% throughput increase.

Each quartet groups the two baseline and two candidate samples for one case and round. Its reduction is `100 × (1 − candidate_pair_mean / baseline_pair_mean)`:

| Case | Round | Baseline pair mean ms | Candidate pair mean ms | Time reduction |
|---|---:|---:|---:|---:|
| Miss | 0 | 428.503833500 | 373.308229000 | 12.881005999% |
| Miss | 1 | 416.645895500 | 372.210104500 | 10.665121505% |
| Miss | 2 | 422.466562500 | 362.356416500 | 14.228379554% |
| Off | 0 | 318.900771000 | 318.973312500 | −0.022747358% |
| Off | 1 | 328.916958500 | 332.737812500 | −1.161647006% |
| Off | 2 | 327.222583000 | 324.932208500 | +0.699943897% |

The README's rounded means, aggregate changes, and three miss reductions all agree (`wasm-probe/README.md:3–12`). The aggregate reduction uses aggregate means, not the unweighted average of quartet percentages. The off result is a small observed change; it is not a statistical equivalence result. No confidence interval, cross-process replication, system-load isolation, or proof of a universal performance bound follows from these rows. The adapter's “upper-bound probe” comment describes an intentionally favorable all-miss fixture, not a measured mathematical upper bound.

## P5 — engine, flags, and timer scope: HELD within recorded scope

`wasm-probe/timings.jsonl:1` records Node v24.20.0, V8 `13.6.233.17-node.53`, and exactly `--no-liftoff --no-wasm-lazy-compilation`. `run.mjs:12–15` asserts those versions/flags and absence of NODE_OPTIONS. The current executable at `/Users/blamy/.nvm/versions/node/v24.20.0/bin/node` independently matches recorded SHA-256 `9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a`.

The explicit flags select eager optimizing WASM compilation; the runner's synchronous module construction occurs before timing. This does not provide an engine compiler-event trace or enumerate every default V8 setting. NODE_PATH removal is stated in the saved entry command (`README.md:90`), but unlike NODE_OPTIONS it is not asserted in `run.mjs`. No ambient CPU-frequency, scheduler, thermal-state, or other-process telemetry is recorded; the README's no-concurrent-worker-benchmark statement is not a whole-machine isolation measurement.

`performance.now()` brackets only `probe_run` (`run.mjs:44–46`). Preparation, output checks, checksum construction, and drop are outside that interval. A precision limit on `README.md:79`: the assertion that `Machine::run` returned `MaxInstrs` is inside `probe_run` (`adapter:200`), and any allocation or checks internal to `Machine::run` remain timed. Thus “validation, allocation ... outside timing” applies to wrapper preparation/postprocessing, not every validation or allocation in the emulator. This is symmetric and does not invalidate the observed comparison.

## P6 — checksum scope: HELD

`adapter:134–141` hashes exactly **PC, then x0 through x31, then MINSTRET**, each as a little-endian u64. The runner's `checksumScope` string lists x0..x31 before PC but does not define serialization; the adapter and README define the actual order. The checksum excludes RAM, floating-point state, devices, other CSRs, and translation/cache metadata. It covers 34 u64 values (272 bytes), not a full architectural snapshot or independent correctness oracle.

All 24 raw rows match `96fe1c05f4f3e8d052066f6477c891088ca6a0b8d081c62b7edc1f22c63b8c6d`. Each reports exactly 12,000,000 retirements; the 12 miss samples report 6,000,000 false executor queries each, and the 12 off samples report zero. The source also asserts final PC `0x10000000` and x5 `6,005,000` before returning the checksum (`adapter:217–223`). Those checks support the loop's selected outputs. No TLB-hit reduction or fault/invalidation matrix was measured by this probe.

Artifact checksums have a separate, finite scope. `shasum -a 256 -c wasm-probe/SHA256SUMS` passes all 19 listed files. The manifest does not include README.md, candidate.patch, itself, the two Cargo manifests, compiler binaries, intermediate rlibs, or the entire source/dependency tree. Cargo manifest hashes are recorded separately in `build.jsonl`; the Node executable hash is recorded in `timings.jsonl`. Manifest success must not be represented as coverage of unlisted files. The unchanged core-library hashes bind this comparison to the prior source candidate without reopening that review.

## P7 — performance claim boundary: HELD

The evidence supports the observed local difference between the two identified WASM modules on a warm, two-instruction, all-uncompiled-miss loop, with a JIT-off control. The counting executor never compiles or executes guest-generated WASM; this exercises the core's interpreter fallback compiled into WASM. It does not exercise BrowserExecutor or a production release's full build/packaging path. Actual Node/V8 WASM execution does not establish browser behavior, guest-boot speed, representative Omarchy workload benefit, semantic-matrix completion, or F acceptance. These exclusions are explicit in `wasm-probe/README.md:20–50` and are consistent with the adapter.

The manifest, raw rows, and symmetric fixture are sufficient support for considering the bounded proposal. The provenance and warmup-observation limits above restrict the claim; they introduce no additional gate or requested follow-up in this review. The existing source report, preregistered source predictions, and deterministic test matrix are unchanged.

## Evidence digests

| Artifact | SHA-256 |
|---|---|
| review/wasm-predictions.md | `43ca02e4e937dab5210cba31629c856c7baf6c2686c84f7f45dffbe9569f7b13` |
| wasm-probe/build.mjs | `383f26d89db088e7f0f8d37b38ec4043960cb98033400920449b73ccf1d8f96c` |
| wasm-probe/run.mjs | `cea44d98c19c3d533c5855b229bca68633d820e4fc9c51bf8d3b01bf1c7272a4` |
| wasm-probe/build.jsonl | `c6842a8bcc374f1720f4eb904d8954a65053600b3d23e616212f1259185b65eb` |
| wasm-probe/timings.jsonl | `fc54cc6a86ee23297da423d8a0d2d09d719f77ef12da5b3bdc87e67706256c27` |
| wasm-probe/README.md | `110c255f85b0aba0bf2d15c6e21686438022f908d997e13c6ebbc103c2b3c041` |
| wasm-probe/SHA256SUMS | `c2bb928596861e482f048d5aa697a74634767dad82bada3b717f1cf36f6cf5e8` |
