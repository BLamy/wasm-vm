# Resident playback CPU localization — 33a65efb

Diagnostic-only analysis of exact head `33a65efb90d1656be45931ea5aacb9b670c0c35f`.
No acceptance claim, threshold change, browser run, or runtime/helper/image edit.
This recording has both CPU sampling and periodic LATENCY probes enabled; it is not an unprofiled benchmark.

## Exact name binding

The existing `e5-t22c-symbolize-cpu.mjs` authenticated **all 11 non-custom section payloads** and
recovered **1,889 names**. No function number was inferred from another build. Functions belonging
to generated `wasm://wasm/...` modules remain unmapped (3.856% of weighted leaf time including their trampolines).

- Served `web/pkg` WASM: `8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a`.
- Named companion: `c2e5156819783abb458d65318ef05b4a7036484a66b9c96f6d74c1caadbc17ea`.
- Recomputed full served-runtime binding: `42aced7a2dfc4d0a69e1ea5a15685f5d9a605f797f8df1c5db89f95051ba0425`, matching both raw records.
- Raw profile: `1b4763eb02fc912a4cf4a20c0aee9366ed09ffb619160f60a61f856f8df36194`.
- `post-restore.json`: `497cc356e24521c9228062c135c7e01870db639f494fff0fff995db29d496b10`.

`prepare-symbols.mjs` records the exact wasm-bindgen 0.2.126 / wasm-opt command paths and arguments
in `symbol-build.json`. It reads the existing raw release artifact and writes only under
`target/e5-t26f/resident-symbols/`; no Cargo invocation or shared build-output write was needed.
Before/after hashes of the shared raw module and served release agree. The named module was never served.

## Weighted CPU results

2,592 samples account for **3,857.677 ms**, against a CDP span of 3,858.149 ms.
Requested interval was 1,000 us; actual median interval is **1,506 us**, maximum 4,698 us.
These are sampled stack/time weights, not exact per-function timers. Inclusive ancestry overlaps.

| Leaf (Rust hash suffix omitted only for display) | Whole ms | Whole self % | Before PCM % | After PCM % |
| --- | ---: | ---: | ---: | ---: |
| `BrowserExecutor::execute_with_budget` | 478.990 | 12.417 | 13.351 | 9.890 |
| `Machine::run_traced` | 447.565 | 11.602 | 11.303 | 12.747 |
| `Hart::execute` | 304.755 | 7.900 | 8.429 | 6.771 |
| `Machine::try_jit_block` | 210.588 | 5.459 | 5.842 | 4.212 |
| `BlockDiscovery::on_block_entry` | 204.274 | 5.295 | 4.989 | 6.364 |
| `Machine::sync_plic` | 202.756 | 5.256 | 4.819 | 6.716 |

Disjoint name-based leaf buckets (explicit rules and complete members in `analysis.json`):
interpreter/decode/run loop **27.229%**; JIT executor/selection **18.757%**;
MMU/PMP **11.889%**; interrupt/clock synchronization **10.409%**;
dispatch discovery/cache **8.490%**; devices **7.134%**; collections/hash/allocation **5.270%**;
integer division/multiply **3.728%**; unmapped generated Wasm **3.856%**; other **3.236%**.
This is mixed emulator work, not one dominant leaf. The bucket rules classify names, not guest subsystems.

`runTick` is **94.687% inclusive overall**, **94.676% before PCM**, and **94.835% after PCM**.
Explicit sound-service self time is 32.726 ms (0.848%); GPU service/cursor leaves total 61.665 ms (1.599%).
`Module` plus `Instance` self time is 13.144 ms (0.341%). `__udivti3` is 108.143 ms (2.803%).
These do not establish a sound-service, compilation, or division-only explanation for several seconds.

## PCM boundary and observation cost

Restore T0 is **1144.145 ms**; profiling's page anchor is **1979.510 ms** (835.365 ms after T0).
The initial restored cursor/gesture interval is therefore outside this profile.
Last observed zero PCM is **4831.815 ms** (T0+3687.670); first actual non-silent readback is observed
at **4881.210 ms** (T0+3737.065), completed at 4881.285 ms, with **960/960 non-silent frames**.
The first green marker is observed at **5795.380 ms** (T0+4651.235): **914.170 ms after the first PCM observation**.
Final readback has 1440/1440 non-silent frames, and output attachment is true.

The profile starts before the page anchor and stops after frozen `postRestoreEnd`.
Assuming equal-rate host monotonic clocks, the two endpoint gaps sum to **5.954 ms**; the record has
no direct shared-origin clock synchronization. Combining that alignment uncertainty with the
49.395 ms zero-to-first-PCM polling interval gives a nominal **55.349 ms boundary exclusion**
(plus the 0.075 ms first-PCM inspection span and ordinary sampling uncertainty).
The approximate before/after table excludes this boundary window: **2852.305 ms before**, **950.023 ms after**.
Samples straddling window edges have their interval weight split; this is an approximation, not sub-sample precision.

The existing marker predicate ran 228 times: **8.550 ms total**, maximum **3.460 ms**.
Thus its direct synchronous read cost does not explain the 914 ms PCM-to-marker gap.
The worker continues executing emulator work throughout that interval; this is not a worker-idle wait.
However this worker-only profile does **not** sample the page's canvas thread or guest syscall identities:
it cannot distinguish shell `/proc` guard work, player drain/exit, guest compositor work, or unrelated guest work.
No guest-source root cause or runtime optimization benefit is established by these samples.

Frozen end **5831.705 ms** minus original T0 is **4687.560 ms**. The retained assertion measurement
separately says **4687.870 ms** (0.310 ms later); both actual fields are preserved, and both fail the original 2000 ms cap.

## Narrow follow-up anchors

For host execution-cost inspection, the measured entry points are
`crates/wasm/src/jit_browser.rs:1915`, `crates/core/src/lib.rs:3797,4213,3937,3384`,
`crates/core/src/dispatch.rs:613`, and `crates/core/src/mmu.rs:123` in the inspected checkout.
For the current resident-helper refinement, the useful timing targets are the approximately
2.85 profiled seconds before PCM and 0.95 seconds after PCM, not a presumed expensive marker reader.
A guest-side attribution or controlled unprofiled comparison is still required before selecting a causal fix.

Full exact leaves and inclusive rankings: `cpu-summary.json`
(`2a9092b30a850d4623b103eaf01a77ea03489d505290e07af320abf11eb2808a`).
Phase calculations, complete buckets and raw timing fields: `analysis.json`
(`06abfae5b4e443d4d9bae15638b5aa72f7138cadbde3a924ab01d1ce55c60910`).
Both analysis scripts pass `node --check`; no tests or browser were run.
