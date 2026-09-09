# Null-trace source preflight

**Verdict: CONDITIONAL GO for one bounded source candidate; no F or speedup claim.**

At `crates/core/src/hart/mod.rs:1211-1230`, `Hart::execute` is non-generic and returns
`Result<(u8, u64, Option<MemOp>), Trap>`. The function always declares `mem` at
`:1242-1245`, and the load/store arms materialize `MemOp` values at `:1435-1701` and
`:1920-2130`; the shared retirement tail consumes that metadata for reservation
invalidation at `:2331-2345`. This is before any sink dispatch.

The ordinary path destructures the tuple at `:768` and then builds a `TraceRecord` at
`:772-781`; the decoded-cache path does the same at
`crates/core/src/lib.rs:3880-3893`. `run_traced_inner` selects either `step_cached` or
`Hart::step_traced` at `:4841-4859`, while `NullSink` only makes `retire` empty and reports
`wants_records=false` (`crates/core/src/trace.rs:58-68`). Therefore the existing zero-cost
claim is narrower than “no retirement metadata is built”: `tools/check-zero-cost.sh` scans
the emitted `step_nullsink_probe` for trace references and checks for a non-inlined
`NullSink::retire` symbol, but does not prove that an out-of-line `Hart::execute` result has
no `MemOp` construction or tuple materialization. Source alone also cannot prove the
generated native/WASM artifact or explain the closed 4002.945 ms F run; audit-elided at
3410.355 ms closes that hypothesis as a timing explanation.

**One candidate.** Add a specialized untraced execute result at this shared boundary (a
const/generic capture mode or a factored `execute_untraced` using the same instruction arms),
so `step` and `step_cached::<NullSink>` receive only success/trap while traced callers retain
`(rd, value, mem)`. The specialization must leave every architectural write, PC advance,
CSR/counter ordering, MMIO/RAM effect, trap purity, and successful-store LR/SC reservation
invalidation unchanged; in particular, move reservation invalidation to an unconditional
retirement-side effect, not a discarded `MemOp`. Keep `exec_oracle` and recording callers on
the metadata result. This is source-review scope only; compiler artifact evidence is required
before claiming removed overhead or any latency benefit.

**Minimal deterministic proof if activated:** native
`cargo test -p wasm-vm-core --test hart_memory --test trace_mem_exec --features trace -- --nocapture`
plus actual-WASM
`wasm-pack test --node crates/wasm --test hart_mem --test jit_browser_parity -- --nocapture`.
The focused additions should compare traced/untraced register, memory, CSR, trap, and LR/SC
states across ordinary and decoded-cache execution. Affected risk is **high** (guest
architectural semantics and cache/tier boundary); no browser/build/profile run was performed
for this review. Existing guest guards and timing/clock/cache settings remain unchanged.
