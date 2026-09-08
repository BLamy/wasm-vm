# Incremental collector repair review

VERDICT: HELD — repaired postprocessing admission and exact counter arithmetic. The original 05b wrapper failure remains REFUTED and recorded; neither its exit nor its missing original `observation.json` is rewritten. F timing remains FAILED at 4362.199999928474 ms. Other source/image/browser HELD results carry forward within their existing limits.

The review was completed against frozen patch bytes, originally uncommitted on producer HEAD05b. Main subsequently froze them at `001e80864911863145f2127192bae5df8186e68b`; the old browser record's HEAD still identifies its actual producer, not this later repair. Predictions were registered in `collector-predictions.md` before examining the new output/gate.

## Patch and coverage

The change adds one explicit new-kind admission branch. At [collector lines10–30](/Users/blamy/Documents/Codex/wasm-vm/tools/verify/e5-t26f-discovery-observation.mjs:10), only legacy `RESIDENT_KIND` and `OBSERVER_KIND` are supported. Legacy returns immediately, preserving its previous contract. Observer records must have equal run/binding fixtures, fixed base/helper/source/binary paths, strict same-directory task build paths through `residentSourceInputs`, 0555 mode, positive safe-integer size, valid SHA strings and matching binary/readback hashes. Optional helperPath, when supplied, is checked. No current build file is opened to validate historical recorded pins.

The independent check mechanically matched the entire discovery counter/timing/CLI body to the original 05b body after substituting just the admission call. Compile-queue implementation and resident-proof module SHA remain unchanged. This is recorded-provenance consistency, not a signature authenticating arbitrary fabricated JSON; the actual original file is separately hash-bound and already passed the retained-image/runtime/profile/envelope review.

The closed [24-test log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-collector-gates.log:7) includes the exact original SHA-bound record through actual discovery/compile collectors and actual discovery CLI, coherent legacy/unit paths, unsupported/missing/mismatched fields, malformed pins, paired-invalid metadata, traversal/mismatched build-directory, bad mode/size/readback, and preserved cap/nonacceptance results. Wrapper-only tests remain stubs; they are not credited as real collector compatibility or a new browser execution. No gate was repeated for this review.

Source SHA-256:

- Discovery collector: `423019e85fc480cb3badf91c412a558a1f7ffaf44ac54c033eac31e5c0f1380f`.
- Discovery tests: `bec3a06c8e466a490680463ab0db7a52f56dffec3fc503666566266e1c46cf1e`.
- Compile-queue tests: `6243d3aee5ec34333c496d6510d7db39bd514a0a03656bc4df7727a9de897c81`.
- Unchanged compile collector: `fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc`.
- Unchanged resident proof: `d5615b185536f0f0af3da7d4b133ec28ec9e2c62962d22b3cd57e8c24f5a5810`.

## Actual posthoc output and independent arithmetic

The [posthoc provenance](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-observer-05b82bc6/posthoc-provenance.json:4) retains original wrapper exit1/collector `4bc9…`, actual compile-collector CLI command and postprocessing exit0, plus all three postprocessing source hashes. Original input is `0881a4aa55808bd0884b5a6ef2f05af4da9601b119e188390cef94b4c667002a`; separate output is `7a0ec6b45330319c6a49457365f968538bbda0ce78bf6fad38565f984d01dc50`. They are not an original successful wrapper record.

`collector-integrity.mjs` recomputed arithmetic independently with checked integers/BigInt from the original raw samples, then compared the actual patched public function and every posthoc field. Inputs/source/output pins matched before and after. Exact relationships:

| Quantity | Original raw calculation | Result |
| --- | --- | ---: |
| Nominated delta | 2978 − 271 | 2707 |
| Discovery depth delta | 37 − 0 | 37 |
| Staged | 2707 − 37 | 2670 |
| Admitted delta | 1757 − 271 | 1486 |
| Pending delta | 248 − 175 | 73 |
| Backpressure delta | 1797 − 0 | 1797 |
| Cancelled delta | 0 − 0 | 0 |
| Popped delta | 896 − 96 | 800 |
| Submitted delta | 665 − 95 | 570 |
| Popped, unsubmitted | 800 − 570 | 230 |
| Incoming rejections | 2670 − 1486 | 1184 |
| Resident displacement | 1486 − 73 − 0 − 800 | 613 |

Conservation holds: `2670 = 73 + 1797 + 0 + 800`; `1797 = 1184 + 613`. Discovery deltas are nominated2707, deduped3394545, excluded9, stale/overflow/counter-loss0. Generation stays5; decoded cache4096, repack-off/24, executor enabled, entry timing disabled. Guest retirement advances49,977,871 and JIT retirement19,818,064. Before/after RPC timestamps remain ordered around the original frozen interval; they are not its exact endpoints. Counts are jobs, not unique PCs, and popped-unsubmitted is not proven compilation failure or a timing cause.

Posthoc before/after samples, complete binding, profile/snapshot hashes and original endpoints match raw. `elapsedMs=4362.199999928474`, `fTimingPassed:false`, `acceptance:false`, `fVerified:false`. No kind/cap/raw record mutation or missing-field reconstruction occurred. No latency/CPU replay is mixed into these counts.

## Evidence and P13

Command: `node evidence/e5-t26f/single-process-verifier/collector-integrity.mjs` (read-only inputs; own result only). SHA-256:

- Gate log: `65b83ca58cfc82f2d8c30c10ea9fbd2e7154c28ad8e43c6874758e566ca88df8`.
- Main's posthoc provenance: `72d046d9909bdc657a842cfae405b3c98885264078caca916768168740d8e454`.
- Independent script: `afb8b74a5e207a2bd27c7b8fd38ad36602cb10ba41958d21f2abe91f02c8bfe9`.
- Independent result: `c6a1f99eafc3f628f5e309a72472ec2099a5c316e6d9e72eaae3abee0dd5747b`.

With this bounded repair review HELD, Main has authorized P13 once at exact commit001e8086: one fresh local clone with RUSTFLAGS/RUST_LOG/all CARGO_* removed; only `make verify-E5-T26f-single-process-observer` and the changed discovery/compile-collector tests. No core/L/K/ISA/Docker/cross-build/browser, no implementation workaround in the clone. Clone/logs will be retained. Its outcome is a separate report; this paragraph does not claim it has already passed.

Subsequent result: [P13 HELD](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-review.md) at exact001e8086, one retained clean clone, 10,389 C checks +82 observer-gate Node tests and18 collector tests. No implementation workaround or repeated clone.

Changed paths for this incremental review are only the new collector prediction/script/result/report files under `single-process-verifier/`. Original P9 history is preserved in `browser-results.md`; this report is the subsequent repair result, not a retroactive rewrite.
