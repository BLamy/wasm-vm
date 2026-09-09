# Offline CPU symbolization sidecar

This fresh sidecar processed the existing target WASM once. It did not rerun the guest or browser and did not modify source, runtime, profiles, or served artifacts. The closed CPU replay is retained as diagnostic-only evidence: `evidence/e5-t26f/single-process-observer-96ecb801/cpu-default/record/failure-post-restore-interaction-checks.json` has `acceptance:false`, exit code 1, and the child1 canonical two-second cap failure.

## Binding

The generated named companion is `target/e5-t26f/spp-cpu-symbols-96ecb801/companion/named.wasm`; its gzip archive is `target/e5-t26f/spp-cpu-symbols-96ecb801/companion/named.wasm.gz`. The served `web/pkg` and `web/dist/pkg` WASM copies are byte-identical at `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`. `bindNames` authenticated all 11 non-custom sections before profile attribution and recovered 1,890 function names.

Named companion SHA-256: `372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116`. Source input `target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm` SHA-256: `89bf2f0ad3306efbf42aaaa0b54dda5aada6110f361d939b3eeca2c300323c2d`.

## Profile

Profile: `evidence/e5-t26f/single-process-observer-96ecb801/cpu-default/record/interaction-cpu.json`, SHA-256 `21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a`, 2,608 samples. Self and inclusive rankings below use the existing `summarize` implementation. Percentages use the sum of `timeDeltas`: **3,260,775µs**. Inclusive rows overlap.

### Self time

1. wasm_vm_core::Machine::run_traced::hfd8275d83dd0f97b: 384767µs (11.800%)
2. <wasm_vm_wasm::jit_browser::BrowserExecutor as wasm_vm_core::jit::CompiledBlockExecutor>::execute_with_budget::h1c6b17789b9d53e7: 305916µs (9.382%)
3. wasm_vm_core::hart::Hart::execute::h8a6da61cfda5db81: 281382µs (8.629%)
4. wasm_vm_core::Machine::sync_plic::h7f5c3bd066f966f0: 208905µs (6.407%)
5. wasm_vm_core::Machine::try_jit_block::h0ec09f3d40a79477: 179370µs (5.501%)
6. wasm_vm_core::dispatch::BlockDiscovery::on_block_entry::h603a5b4937cad8ca: 164913µs (5.057%)
7. wasm_vm_core::mmu::translate_cached::hf2b93220145a733d: 142235µs (4.362%)
8. wasm_vm_core::Machine::next_micro_op::hde9600194430e6db: 141315µs (4.334%)

### Inclusive time

1. (root): 3260775µs (100.000%)
2. js-to-wasm:iii:ii http://127.0.0.1:61637/pkg/wasm_vm_wasm_bg.wasm: 3073155µs (94.246%)
3. runTick http://127.0.0.1:61637/loader.js: 3073155µs (94.246%)
4. wasm_vm_wasm::WasmLinux::run_chunk::h07405c1400974665: 3069384µs (94.131%)
5. wasmlinux_runChunk multivalue shim: 3069384µs (94.131%)
6. runChunk http://127.0.0.1:61637/pkg/wasm_vm_wasm.js: 3069384µs (94.131%)
7. wasm_vm_core::Machine::run_traced::hfd8275d83dd0f97b: 3010341µs (92.320%)
8. wasm_vm_core::Machine::try_jit_block::h0ec09f3d40a79477: 875685µs (26.855%)

### Self-frame categories

| Category | Samples | Sample µs | Share |
| --- | ---: | ---: | ---: |
| Authenticated indexed release functions | 2495 | 3119632 | 95.671% |
| Unmapped generated WASM | 90 | 112301 | 3.444% |
| Runtime/synthetic labels | 12 | 15018 | 0.461% |
| JavaScript/other URL labels | 9 | 11309 | 0.347% |
| Literal release bridge labels | 2 | 2515 | 0.077% |

Unmapped generated WASM has 41 distinct `wasm://` module URLs. The raw profile tree contains 4 literal `js-to-wasm` bridge nodes; the served-module bridge label has 2 sampled self hits (2,515µs) and remains literal. No bridge or generated-module frame was force-indexed.

## Integrity and reproduction records

- [Section binding](section-binding.json)
- [CPU summary](cpu-summary.json)
- [Closed diagnostic failure](closed-failure.json)
- [Before inputs/runtime inventory](inputs-before.json)
- [After inputs/runtime inventory](inputs-after.json)
- [Tool commands and versions](commands.json)
- [Generated artifact digests](artifact-hashes.json)
- [Script provenance and preserved initial failure](script-provenance.json)
- [Command logs](logs/)

The exact proper-runner inventory is 150 files with aggregate `65935dd0535eb38ed23d78956f63ec800daf3f6bb63094c9c694e236786f74e1`; HEAD resolves to `96ecb801fdf8b67af75cd150db82d115bcf046cd` before and after. The profile source, target WASM input, served WASM copies, symbolizer/test sources, and runtime inventory are byte-identical before and after.

## Initial failed attempt provenance

The original `failure.json` is retained unchanged. Its initial script expected `275b4febbd10b186f9c2b34c85dbb346880de86f1e0522878c450ce25289a51f`, the enclosing baseline/checkpoint profile hash, while the CPU file actually hashed to `21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a`. It therefore stopped before generation, section binding, or attribution. The original full script was already changed; [worker-initial-failure-reconstructed.mjs](../../../target/e5-t26f/spp-cpu-symbols-96ecb801/worker-initial-failure-reconstructed.mjs) is explicitly labeled reconstructed—not original—and preserves only that exact failing comparison. The corrected worker is [worker.mjs](../../../target/e5-t26f/spp-cpu-symbols-96ecb801/worker.mjs), SHA-256 `aea606c91b96c97159182309de3e2d3b42e4d26bbe74c74ffc1bcdd8732edd9f`.

## Limitations

This is sampled attribution only. Sample weights are not exact unprofiled wall time, and they do not establish causation or explain the cap failure. Generated WASM modules and bridge frames were not assigned invented names.
