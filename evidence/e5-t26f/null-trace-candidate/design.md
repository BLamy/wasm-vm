# Narrowed candidate contract (initial pre-implementation design)

The objective is optional **returned retirement metadata**, not optional architectural
effects or suppressed arbitrary sink callbacks. No timing cause or benefit is established.

1. Keep one instruction match and one architectural commit in Hart, specialized with a
   private capture-mode type. Recording output stays `(rd,value,Option<MemOp>)`; the
   non-recording output is unit. `rd/value` still drive the identical register/PC commit.
2. Successful-store range tracking (address/width) is an explicit local effect independent
   of the optional captured MemOp. Its final overlap check stays at the current retirement
   point. SC's existing reservation consumption stays INSIDE its arm before its fallible
   store, unchanged; do not move it into the success-only overlap check. Preserve every
   early trap and the existing bus/translation/FP/CSR/WFI/xRET side effects and ordering.
3. Public `Hart::step_traced`, `Emulator::run_traced` and all arbitrary sinks retain their
   existing calls/records, including a custom sink whose `wants_records()` is false.
   That method continues to govern only JIT admission. Do not add an opt-out to TraceSink,
   change its object safety, or reinterpret its existing method.
4. Select the unit-returning mode only from existing no-record public entry points
   `Hart::step` and `Emulator::run`, through private ordinary/cached dispatch parameters.
   Keep `exec_oracle` on its current recording semantic implementation as a compatibility
   entry point; it is not an independent candidate oracle. No duplicate instruction match.
5. Cache draining still runs unconditionally after successful cached retirement; preserve
   bus physical-page logging, FenceI cursor behavior, DMA and cross-page ordering.

Addendum approved by the fresh E5-T26p critic: `Emulator` above refers to the actual
`Machine` type. In `WasmLinux::run_chunk`, remove its local NullSink and replace only
`inner.machine.run_traced(step, &mut sink)` with `inner.machine.run(step)` so the
Linux browser caller reaches the existing untraced API. Keep the outer cooperative
scope and all UART/persistence slicing, outcomes, output and JIT admission unchanged.
See `evidence/e5-t26p/verifier/caller-preflight.md`; no other WASM source delta.

Before adoption, require matched optimized baseline/candidate native and actual-WASM
callee/caller evidence: source/toolchain/flags/digests, return-buffer and metadata stores,
recording positive control and code-size report. A null trace-symbol scan alone is not
enough. If actual code elimination is not demonstrated, stop this candidate before broad
submission or another F boot. Any measured loop improvement is bounded microbenchmark
evidence, not an F or Omarchy claim.

Semantic fixtures must exercise the critic's ordinary/cached × recording/untraced matrix
against independently retained baseline outcomes, JIT disabled for this seam, and compare
full integer/FP/CSR/PC/reservation/RAM/trap and ordered MMIO effects. Cover SC fault timing,
all scalar/FP/AMO successful-store ranges, failure paths, raw compressed tval and SMC/DMA.
The critic's listed native/WASM suites, one bounded reservation sabotage and final exact
head clone apply after the narrow artifact/semantic prechecks hold. Browser126/0 and the
fresh normal F screen remain later requirements; no old checkpoint can be rebound.
