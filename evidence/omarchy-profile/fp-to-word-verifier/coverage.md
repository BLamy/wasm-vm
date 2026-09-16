# E5.5-T03y critic coverage map

The predictions were recorded in `predictions.md` before worker evidence. These
are source-to-test mappings. The final verdict is recorded in `final-verdict.md`;
none of these instruction checks is a desktop acceptance claim.

| Changed runtime hunk | Independent exercise |
| --- | --- |
| `core/src/jit.rs::fp_to_word_s`: W/WU width, RoundMode, low-word/flags packing | 55 literal operands, all five static modes and dynamic mode, all prior flags, signed/unsigned clipping and NaNs in native/private/shared executors. |
| Native `env.fp_to_word_s` registration | Real WasmtimeExecutor literal/alias/control runs; separate instrumented Wasmtime module asserts all helper arguments and results. |
| Browser helper closure, env registration, closure lifetime | Real private/shared BrowserExecutor runs, repeated calls and actual outer-memory growth across calls. |
| `uses_fp_to_word`, optional import/type allocation in individual/batch modules | Instrumented helper call at index 5, all four combinations of earlier optional helpers, actual execution of an eight-import mixed chain and exact function exports. |
| `FpConversionImports` propagation/refactor of from-integer index | Actual mixed integer → from-integer → arithmetic → to-word execution plus both single/batch forms of all optional combinations. |
| X register write-mask extension | Exact mixed chain mask (only x30/x31), same/cross-module integer consumption, alias tests where conversion overwrites a prefix-modified register. |
| Admission, FP classification, FS and rounding guards | Every static rm, dynamic frm 0..7, FS Off/Initial/Clean/Dirty, raw parcel and virtual fault PC, prefix-only retirement, instrumented zero-helper illegal paths. L/LU/D remain rejected. |
| Lowering NaN-box decode, helper call, result sign extension and X store | Literal boundary results above bit31, malformed-box canonical helper argument, f0/f31 and X/F register-number aliases. |
| Lowering flags/FS write without FPR mutation | Byte-for-byte full FPR image in instrumented module, all prior flags and mode-dependent NX/NV, exact x0 dirty transition, subsequent genuine interpreted fcsr clear/change. |
| Exit writeback of new integer destinations | Native/private/shared later load/store/illegal faults; browser same/cross-module budgets and faults; real browser memory growth before and after conversion with exactly one import invocation. |

Type declarations and comments are waived as non-executable; their runtime
consumers are covered above. No changed runtime hunk is classified as dead.
Frozen source and cold-clone fixtures match exactly. `final-audit.json` closes
the evidence identity checks; production, cold and public identities match.
`physical-inspection.json` records the failed 120-second desktop result.
The helper's invalid-rounding `expect` is a caller-precondition assertion:
instrumented guard tests prove guest illegal modes never enter that helper.
Generated bindings and SW metadata are covered by the real built/cold browser
runs and independent public-byte checks. Documentation and pending task metadata
are waived as non-executable. Final deployed boot manifests are byte-identical
to the verified predecessor; their transient local/R2 URL rewrite is unchanged.

The independent literal table uses no host float conversion, no SoftFloat call,
and no worker fixture. The interpreter is a secondary comparison only: each
JIT result is first held against the independent literal and full register
images. The instrumented helper calls the production helper to preserve the
real implementation path, while its expected state and call arguments remain
independent literals.
