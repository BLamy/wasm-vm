# E5-T26p Linux `runChunk` caller preflight

**VERDICT: GO — bounded source-delta only.**

Read-only inspection, before candidate results, finds `WasmLinux::run_chunk` in
`crates/wasm/src/lib.rs` constructs a local `wasm_vm_core::trace::NullSink` and routes every
internal slice through `inner.machine.run_traced(step, &mut sink)`. This keeps the Linux
browser caller on recording capture despite discarding records. The small-ELF driver already
uses the intended split: `machine.run_traced(...)` only when tracing is enabled and
`machine.run(...)` otherwise.

The admissible source expansion is exactly:

1. Remove the one local trace `NullSink` declaration from `WasmLinux::run_chunk`.
2. Replace its one `inner.machine.run_traced(step, &mut sink)` call with
   `inner.machine.run(step)`.

No other WASM source delta is authorized. Preserve the existing outer
`begin_cooperative_run`/`end_cooperative_run` scope, UART and persistence slice selection,
pending-input refill, persistence-due exit, `remaining` handling, `RunOutcome`, finished/done
state, console output, retired accounting, and JIT admission. Core traced APIs and arbitrary
custom-sink behavior remain unchanged. Main should add this precise caller to the task boundary
and rely on existing `runChunk` regressions plus the task's focused evidence.

This is source-routing approval only. No build, artifact elimination, semantic equivalence, or
performance/effect claim has been inspected or established. The reported native baseline probe
PASS and missing archived WASM toolchain are not admitted by this preflight.
