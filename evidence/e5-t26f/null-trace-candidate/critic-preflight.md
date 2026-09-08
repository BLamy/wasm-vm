VERDICT: NO-GO for activation as written; plausible specialization, not established removable overhead.

Read-only source preflight at HEAD `e37c3af9be3d54dbd613a97682b9803ef9186977`.
No code/test edits, builds, profiles or browser. Metadata HEAD is not an old-seal binding.

`Hart::execute` (`crates/core/src/hart/mod.rs:1217`) is generic over Bus, but not capture
mode. Its rd/value also drive architectural writeback; only their returned representation
could be optional. `MemOp` drives overlapping-reservation invalidation at2331. Ordinary
and FP stores populate it before fallible stores; successful SC/AMO populate it afterward.
SC consumes its reservation before a potentially faulting store at1475/1499; blindly moving
all reservation effects to successful retirement changes existing fault behavior.

Cached execution (`crates/core/src/lib.rs:3881`) shares execute. Precisely: current cache
invalidation does NOT directly branch on MemOp—the comment mentions it, but
`drain_code_writes()` runs unconditionally after retirement at3910. Physical RAM writes log
both touched pages in `mmio.rs:349`; preserve that bus path, drain ordering and FenceI handling.

**Required narrowed design:** one shared instruction match and architectural commit, with a
separate explicit successful-store address/width effect independent of optional trace capture.
Retain SC, WFI/xRET, faults, translation/MMIO calls and register/FP/CSR writes at their current
points. Only NullSink may specialize; preserve other sinks' retire calls—`wants_records`
currently controls JIT admission, not whether interpreter hooks fire. Do not duplicate the
executor. `exec_oracle` already returns unit at2353; keep its semantic path, but comparison
against the same modified implementation is not independent proof. This contract must be
concrete before activation; “move invalidation unconditionally” is insufficient.

**Indispensable proof:** ordinary/cached × recording/NullSink parity against retained baseline
state, with JIT disabled to reach both interpreter consumers. Compare integer/FP registers,
PC, CSR/counters, reservations, traps/raw compressed tval, RAM and ordered MMIO effects.
Cover overlapping/nonoverlapping scalar/FSW/FSD stores, faulting stores, LR/SC success/failure/
alignment/access faults, AMO old/new values, misaligned/cross-page effects, code-page SMC/DMA
invalidation and no record on traps. A bounded sabotage must expose lost reservation effects.

Luna's two native targets and two WASM targets exist; package/trace feature and installed
`wasm-pack test --help` support the stated commands. They are insufficient alone.
These additional existing targets are available; future focused additions belong in them:

```sh
cargo test -p wasm-vm-core --features trace --test hart_memory --test trace_mem_exec --test trace_retire --test rv64a --test rv64f --test rv64d --test predecode_diff --test predecode_smc_diff --test zicntr
wasm-pack test --node crates/wasm --test hart_mem --test jit_browser_parity --test rv64a --test rv64f --test rv64d --test mmio -- --nocapture
```

**Artifact comparison:** retain matched baseline/candidate optimized native and actual-WASM
artifacts, source/toolchain/flags and digests; compare reachable ordinary/cached callers AND
execute callees for return-buffer/metadata stores and code-size effects, with recording as
positive control. `tools/check-zero-cost.sh` only scans probe symbols/references, not callee
metadata construction; its fallback is weaker still. Keep its selftest, but neither source
constructors nor a green scan prove saved work. No F speedup inference or old-seal reuse.

## Design delta — GO for bounded S/high activation

`design.md` SHA256: `8f493e2b1196abcdfa94164819d17d5500de793276dcd3f225b03ecf1ad70891`.
Single-match capture, independent store effects, preserved SC fault ordering and unchanged
custom-sink hooks resolve prior blockers. Target existing core `Machine::run/run_traced`
(called Emulator in design). Carry parity proofs; probe actual specialized callers and stop
if artifacts show no elimination. Not verification/speedup evidence; no old-seal reuse.
