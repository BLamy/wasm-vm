# Final diff coverage disposition

Diff: verified E5 `3adaa72f` through frozen source `cb6726dc`; 26 changed source
files. This matrix supplements line/branch records in
`native-recording-audit.json` and exact CDP ranges in
`harness-coverage-waivers.json`. Final cold evidence is under
`../cold-clone/acceptance`; `cold-audit.json` independently binds it.

| Changed files | Execution evidence and disposition |
| --- | --- |
| `renderer/virgl-shader/bridge.c`, `raw_bits.c` | All 46 added executable lines and both outcomes of 40 changed branch records have positive LLVM counts. Six comments, blanks or prototype lines are waived as nonexecutable. Final cold counters equal the independently re-exported HELD warm counters. |
| `renderer/virgl-shader/raw_bits.h` | Enum, opcode-mask and prototype declarations are compile-time data. Native and Wasm compilation, v6 admissions, numeric-negation tests and exact layout records exercise their uses; declaration lines are waived as nonexecutable. |
| `renderer/virgl-shader/build.sh`, `Makefile` | Final cold log records the new make target, guard-check and instrumented build mode. All added compile/link commands executed. The added usage-string alternative is waived as CLI failure diagnostics. |
| `renderer/virgl-shader/native_tests/dot_reciprocals.c` | Full native transcript and independently reconstructed statistics prove originals, pair setup, all profile outcomes, recovery loops, hostile arguments, every truncation and all four mutation schedules. Counter totals and all serialized results were independently checked. Fixture I/O/allocation/assertion failure exits are waived as harness diagnostics, not compiler admission behavior. |
| `renderer/virgl-shader/tests/dot-reciprocal-cases.json`, `dot-reciprocal-hardware.json`, `dot-reciprocal-migrations.json`, `numeric-float-cases.json` | All fixture entries are source-bound and ordered native/Wasm results are checked. Hardware definitions each have exact or rational actual-output evidence. Both migration records are independently reconstructed; every other full result is exact. Declarative labels/descriptions are waived. |
| `renderer/virgl-shader/tests/dot-reciprocals.mjs` | All 151 remaining functions entered in five final-head CDP recordings. One unused helper was deleted. Every residual unentered range has its exact source text and individual rationale in `harness-coverage-waivers.json`: defensive cleanup/diagnostics, permitted opposite zero signs, generic arithmetic outside witness domains or optional metadata. |
| `tools/verify-virgl-dot-reciprocals.sh`, `.mjs` | Cold transcript executes full native, E5 compatibility, C2, browser and four deliberate-fault paths. Passed report proves JS success validation/counters and scope fields; four controls prove numerical rejection. Unknown-argument and escaped-fault messages are waived as diagnostics. |
| `tools/virgl-dot-reciprocals/native.py`, `native_receipt.py` | Full source-bound stream/report/coverage construction and final read-only validation execute every workload/profile group, migration, layout, limits, seed accounting and binding operation. Independent APIs reproduce all 616 new results. Eleven compatibility mutations exercise rejection checks; remaining malformed-transcript diagnostics are waived. |
| `tools/virgl-dot-reciprocals/component_compat.py`, `component_compat_receipt.py` | Final cold runs unchanged E5 C harness on the explicit successor stream; receipt API enforces current-source and exact-head bindings. Independent stream reconstruction and eleven tamper controls test the adapter. CLI and invalid-baseline diagnostics are waived. |
| `tools/virgl-dot-reciprocals/oracle.py`, `receipt.py`, `reciprocal_receipt.py`, `browser_receipt.py` | All authored numeric, sampled, reciprocal, exceptional and interface definitions execute on actual hardware and are reconstructed by the final validator; four source faults exercise failure reconstruction. Independent Fraction/isqrt GPU oracles, 22 mathematical enclosure checks and eight coherent evidence mutations challenge numerical and transcript expectations. Unknown-operation/invalid-type diagnostics and general rational fallback cases outside declared witness domains are waived; they make no runtime admission claim. |
| `tools/virgl-dot-reciprocals/regressions.py` | Final read-only revalidation reconstructs the complete E5/C2/earlier chain, compares it to the final receipt, checks retained source identity, complete workload counts and all inherited faults. Error messages on invalid evidence are waived as diagnostics. |
| `tools/virgl-dot-reciprocals/cold.py` | Final report/log and retained clone prove fresh clone, scrubbed environment, exact-head checkout, full command, clean pre/post state, complete evidence copying and digests. Timeout, process-signal escalation, incomplete-copy and exception diagnostics are waived as harness cleanup paths; no portability claim depends on their executing. |
| `docs/gpu-3d-contract.json`, `docs/gpu-3d-decision.md`, `renderer/virgl-shader/README.md` | Read directly against source definitions and primary Mesa/Khronos references; final receipt binds committed bytes and unchanged production contract. Documentation and declarative metadata are waived as nonexecutable. |

No ignored or disabled test was introduced. Test fixtures do not obtain expected
values from the runtime under test: full predecessor outputs are pinned to the
verified baseline; authored scalar GPU values use independent rational math.
The shared native harness intentionally records current serialized outputs,
which are then constrained by authored expectations and independently audited
against old results, native APIs and actual GPU semantics.
