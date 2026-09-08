# E5-T26f owned-worker CPU profile — bounded critic result

Scope: diagnostic localization only at frozen candidate `560c67431d0dcbae24fef7fda4af84df887d0751`. This does not change E5-T26f status, waive its unchanged all-success two-second deadline, or reopen verified E5-T19a/E5-T26h.

## Authentication

- **Raw artifacts — HELD.** SHA-256 independently matches `fbab2f35ceda24ea0bdb9f171f12269db984307ee93e81e3c42a4e47901d4c7b` for `interaction-cpu.json` and `a4c779b3d81606ac167fc6f465f5ffbc38ab1ef7303963dd6c930e4c565363d1` for `cpu-summary.json`. The summary records the raw digest again at `cpu-summary.json:1938`. The failure PNG hashes to the prior-capture value `f50e85d164e63a0581edf9c705702991634c03e47b99563d4ba89cfae8cf11f3`.
- **Frozen binding/isolation — HELD.** The raw record identifies exact head `560c67431d0dcbae24fef7fda4af84df887d0751`, runtime `75000f36186a075ede719bdd16f1fb953b36830bd23ff3ea7ac29c64bd97297c`, `diagnostic: true`, `acceptance: false`, reason `interaction-observed`, and the owned `linux-worker.js` URL (`interaction-cpu.json:18234-18246`). `interactionLatency` is absent. The canonical failure record independently cites the same raw digest and 3,244 samples under `milestones.cpuProfile`.
- **Boundary — HELD.** Profiling began at 1934.755 ms, after restore at 1162.270 ms and before command typing; fresh PCM was observed at 5944.690 ms (`1440/1440` non-silent frames, `maxAbs 0.082000732421875`), then output attachment and frozen `postRestoreEnd` at 5986.415 ms. The unchanged F interaction result is 4824.625 ms, so this remains a failed timing diagnostic, not acceptance.
- **Name map and executable identity — HELD.** The release module hashes to `551206882e7e3ec605dfe04571e53046a81678ebd542fdccafc2c08d8188c229`; the named module hashes to `54b350e9b9f628313ad2784886ed8749709a41162e6e3aa7663b703d30b37232`. An independent rerun of `tools/verify/e5-t22c-symbolize-cpu.mjs` rejected divergence, matched all 11 non-custom section payloads, recovered 1,884 names, and produced a byte-identical summary (`cmp` exit 0, SHA-256 `a4c779...63d1`). Citations: `cpu-summary.json:2,1888-1936`.
- **Profile arithmetic — HELD.** Raw arrays each contain 3,244 entries; weighting leaf nodes by `timeDeltas` recomputes 4,056,447 us and exactly reproduces the supplied summary. The profile wall span is 4,057,264 us; the sub-millisecond difference is sampling-boundary overhead, not attributed CPU.

## Prediction results

1. **Diagnostic isolation, worker ownership, command boundary, failure durability, and name-map sufficiency — HELD.** The authenticated fields above agree with predictions 1–5.
2. **Primary dominant interpreter/MMU/device prediction — FAILED.** No actual leaf dominates. The largest self entries are `Machine::run_traced` 11.8315%, `BrowserExecutor::execute_with_budget` 11.1103%, `Hart::execute` 9.1290%, `sync_plic` 5.6194%, `BlockDiscovery::on_block_entry` 5.1806%, `try_jit_block` 4.5940%, and `next_micro_op` 4.4202% (`cpu-summary.json:1941-1977`). Thus neither one named interpreter/MMU/device leaf nor one sub-run-loop component reaches the predicted 50% boundary.
3. **Mixed alternative — HELD.** Inclusive ancestry distributes work across `try_jit_block` 27.9262%, `execute_with_budget` 16.7905%, `next_micro_op` 16.2169%, and `Hart::execute` 14.9675% (`cpu-summary.json:2760-2784`). These overlap and must not be added; they establish a mixed execution/JIT/interpreter boundary, not a single magic cost.
4. **Compiler-secondary prediction — HELD.** Explicit compilation/translation/install leaves (`Module`, `DynamicLinkCache::install_at`, `pump_jit_translations`, `jit_translate::emit_store`) total 8,810 us, 0.2172% self. Even pessimistically assigning every unresolved generated-Wasm/idle leaf (2.9240%) to compilation leaves the upper bound about 3.15%, below the predicted 10%.
5. **Weighted-leaf aggregation — HELD.** The result uses `timeDeltas` and reports self separately from inclusive ancestry. `hitCount`, prior JIT counters, and inclusive percentages were not used as additive attribution.

## Interpretation boundary

This recording localizes the 4.8-second guest-visible interaction as broadly distributed emulator work; it refutes both a single dominant function and a pure disabled-JIT/compiler bottleneck. It does not identify a runtime remedy and does not satisfy F's two-second criterion.

The proposed CLINT/DT-rate mismatch is a plausible future hypothesis, not a result of this profile. `Machine::sync_clint` accounts for 2.1455% self, but CPU attribution neither measures guest timer-rate correctness nor proves that timer progression caused the command latency. A separate controlled clock-policy experiment would be required before treating it as causal.

Commands: `shasum -a 256` on both artifacts and modules; independent `node tools/verify/e5-t22c-symbolize-cpu.mjs <release> <named> <capture-dir> <scratch-dir>`; exact `cmp` of regenerated and submitted summaries; `jq` recomputation/inspection of sample weights, leaves, bounds, and milestones.
