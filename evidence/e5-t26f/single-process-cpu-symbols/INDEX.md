# Authenticated offline CPU symbols

The named companion matches **all 11 noncustom sections** of the served WASM,
with 1,890 function names. All 85 distinct indexed functions observed in 234
profile nodes resolve. The 3 Chrome `js-to-wasm` bridge nodes retain their literal
labels and URLs. The existing `bindNames` and `summarize` implementations were used.

Producer: `05b82bc688a34e6a1abef7b6c761c01bf4a3f7c6`. Current Git HEAD is not a
symbolization input. The closed CPU recording has `acceptance: false`, exit code 1,
and the recorded two-second interaction assertion failure. This report supplies
sample attribution only; it makes no performance improvement or causal claim.

| Binding | SHA-256 |
| --- | --- |
| Served WASM (both `web/pkg` and `web/dist/pkg`) | `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c` |
| Named companion | `44ee774b2c8bca1bfc82426944f01e6c79b85dffcccdd6488d953342f7e6eba0` |
| Existing Rust WASM input | `49da07b51a507a453704bb3698a217d8f1cbd9474f26816bfe79d397c167d336` |
| Closed `interaction-cpu.json` | `1ca58077d82dda63ab722e9a58d12da102f7ac215669fee43b6433cfafa70b9a` |
| Summary (root copy and `postprocess-01` original) | `da4e6f6eddaa18ce5d0200cdc65c7ed72b9bd6bc05b5536f2c48f01aae2d3100` |

The recording's runtime aggregate is
`f897f34951ca3ab59909f0ce6bbe2e8a68a6620cdace4d1e4eca617cbd601ce8`.
The recorder's exact sorted path/size/digest algorithm was reproduced over 150
runtime files and matched before and after processing. The individual WASM digest
is present in that inventory. The profile hash also matches the saved CPU-profile
milestone in `record/post-restore.json`; `exit.json` was read before the profile.

## Sample rankings

2,181 samples have a time-delta sum of 3,253,226 microseconds. Chrome's profile
start/end span is 3,254,433 microseconds; the 1,207-microsecond difference is not
assigned to a function. Percentages below use the sampled time-delta sum.
Names are abbreviated here; the JSON retains complete names and distinct Rust hashes.

| Self rank | Function | Self µs | Self % | Inclusive % |
| ---: | --- | ---: | ---: | ---: |
| 1 | `BrowserExecutor::execute_with_budget` | 406425 | 12.493 | 18.601 |
| 2 | `Machine::run_traced` | 345971 | 10.635 | 92.643 |
| 3 | `Hart::execute` | 288203 | 8.859 | 15.372 |
| 4 | `Machine::sync_plic` | 194434 | 5.977 | 5.977 |
| 5 | `BlockDiscovery::on_block_entry` | 167179 | 5.139 | 5.139 |
| 6 | `Machine::try_jit_block` | 156469 | 4.810 | 31.512 |
| 7 | `mmu::translate_cached::hf2b93220145a733d` | 151708 | 4.663 | 5.710 |
| 8 | `Machine::next_micro_op` | 136758 | 4.204 | 15.255 |

Descending inclusive rank among those functions: `run_traced` (92.643%),
`try_jit_block` (31.512%), `execute_with_budget` (18.601%), `Hart::execute`
(15.372%), `next_micro_op` (15.255%), `sync_plic` (5.977%),
`translate_cached::hf2b93220145a733d` (5.710%), `on_block_entry` (5.139%).
The full JSON also retains the root, JS wrappers and bridge ancestors:
`runTick` 94.853%, `runChunk` 94.807%, and the Wasm entry/bridge chain 94.760%.

Inclusive rows overlap across ancestors and descendants and must not be added as
independent costs. Each label is counted once per sampled stack. Self rows partition
the sample weights; equal labels are aggregated. Sampling can perturb execution,
and these weights do not establish unprofiled wall time or explain the acceptance failure.

| Self-frame category | Samples | Sample µs | Share |
| --- | ---: | ---: | ---: |
| Authenticated indexed release functions | 2063 | 3077150 | 94.588% |
| Unmapped generated WASM (`wasm://`, 37 distinct module URLs in the tree) | 86 | 128502 | 3.950% |
| Runtime/synthetic labels | 17 | 24964 | 0.767% |
| JavaScript/other URL labels | 14 | 21103 | 0.649% |
| Literal release bridge labels | 1 | 1507 | 0.046% |

Only indexed frames at `http://127.0.0.1:61637/pkg/wasm_vm_wasm_bg.wasm` use
the authenticated name mapping. No names were invented for generated modules or bridges.

## Artifacts and reproduction

- [Canonical summary](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/cpu-summary.json)
- [Fresh postprocessing summary](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/postprocess-01/cpu-summary.json)
- [Section equality and digest record](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/section-binding.json)
- [Exact commands](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/postprocess-01/commands.json)
- [Tool command, output and exit logs](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/logs)
- [Final artifact checksums](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-cpu-symbols/SHA256SUMS)
- [Named WASM](/Users/blamy/Documents/Codex/wasm-vm/target/e5-t26f/single-process-symbols/companion-01/named.wasm)
- [Named WASM gzip archive](/Users/blamy/Documents/Codex/wasm-vm/target/e5-t26f/single-process-symbols/named.wasm.gz)

Tool versions: `wasm-bindgen 0.2.126`, `wasm-opt version 117 (version_117)` from
the installed `wasm-opt-50385c9e73ccee70` directory. Binary realpaths, hashes,
and the optimizer's `libbinaryen.dylib` hash are retained in `inputs-before.json`.
The existing symbolizer's two tests passed. No Rust build was run; the existing
Rust output was processed once with `wasm-bindgen --target web`, then `wasm-opt -O -g`
under the assigned fresh target directory. The companion was never served.

The first driver authenticated sections successfully, then stopped on an extra
assertion that every module-URL frame must be indexed. That assertion does not hold
for Chrome bridges. Its original script, logs and `failure.json` are preserved.
The fresh `postprocess-01` pass rechecked section equality and applied the held
symbolizer's existing literal-label behavior. It did not generate another companion.

Reproduction commands (the drivers require fresh outputs and refuse overwrites):

```sh
node target/e5-t26f/single-process-symbols/run.mjs
node target/e5-t26f/single-process-symbols/finish.mjs
node target/e5-t26f/single-process-symbols/seal.mjs
```

`run.mjs` intentionally preserves its recorded assertion failure; the successful
continuation is `finish.mjs`. Final preservation checks cover every original input
and the runtime inventory. All new files are confined to the assigned target and
evidence directories. The original profile, WASM, sources, tools and failed records
were preserved; no Git, task-status, PR, browser, deployment or core-build action was taken.
