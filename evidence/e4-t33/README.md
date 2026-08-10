# E4-T33 repaired worker evidence

Frozen runtime/test/build commit: `8ef240df8ee9690a1f7f0a36af99de208ead04bf`
(Apple Silicon macOS plus x86_64 Linux rr-soft, 2026-08-10). This is a worker
submission after the refutation recorded in the task log; it is not a verifier verdict.

## Refutation repairs

- Browser dispatch now keeps a Box-stable 568-byte `CpuStateHandoff` image and one cached
  `Uint8Array` view into the outer Wasm memory. Each direction is one direct TypedArray `set`; the
  promoted clean-dispatch attack observes zero `Uint8Array.prototype.subarray` calls. A detached
  outer view is refreshed immediately before copy-in and again after the compiled call, covering
  outer-memory growth both before dispatch and inside imported MMIO.
- Clean growth, growth followed by a recorded precise fault, and an unrecorded JavaScript exception
  all keep the externref floor stable. Recorded faults commit the precise module register image;
  unrecorded post-dispatch exceptions clear host pointers and rethrow a fixed primitive sentinel, so
  the core cannot replay already-observed MMIO.
- Native Wasmtime also fails closed after an unclassified engine trap. A malicious injected module
  dirties module x5, performs one MMIO write, then executes `unreachable`; the test proves one write,
  no Hart register/PC commit, cleared host pointers, and a later clean dispatch.
- The four private native registries use a fast per-executor secret-keyed integer mixer. The
  promoted attacks constructing 1,024 arbitrary aligned keys and 128 mapped-DRAM PCs against the
  old public permutation now remain below their bounded probe thresholds. The secret is acquired
  only when the executor is constructed; u64/u32 lookups remain one keyed SplitMix operation.
- SoftMMU single-block and batch memories remain fixed at one page, while InlineTLB single/batch
  memories remain imported/growable. `execute(None)` remains a pure pre-dispatch metadata miss;
  once native or browser execution begins, unexpected engine failure is fail-closed rather than an
  interpreter fallback.

## Exact release performance

Both baseline and final measurements used the ignored release-only `perf_handoff` harness, five
alternating samples per engine, untimed warmup, and exact architectural work. The benchmark-only
baseline commit is `73d1e88ad60f0e548edc98bdb41b34e6347ce097`; the final numbers below are from
`8ef240d` after the keyed mixer and fail-closed repairs.

```text
cargo test -p wasm-vm-jit-runtime --release --test perf_handoff \
  -- --ignored --nocapture --test-threads=1

                                      interpreter   JIT       JIT/interpreter
baseline 64-op, 6,400,000 retired          —        238.552          —
final    64-op, 6,400,000 retired       61.026      439.354       7.199x

baseline six-op, 6,000,000 retired         —         10.267          —
final    six-op, 6,000,000 retired      41.698       55.233       1.325x
```

The same-workload JIT uplift is `439.354 / 238.552 = 1.842x` for the acceptance workload and
`55.233 / 10.267 = 5.380x` for the six-op boundary diagnostic. Every sample asserts the exact
retired budget, IRQ retirement, `mcycle`, `minstret`, JIT retirement, PC, and register oracle.

## Bulk handoff, fault, and lifetime attacks

The shared codec pins `[0x000, 0x238)` to exactly 568 little-endian bytes for the current integer
translator. Native Wasmtime performs one direct fixed-memory slice copy each way. The browser uses
one retained outer-Wasm view and one batch-owned child view, with no per-dispatch Function/view
clone and zero slice-glue `subarray` calls. Native and browser precise-fault tests dirty x1 through
x30, fault the following load into a distinct x31 sentinel, and assert x0, all writable registers,
cause, tval, virtual fault PC, and caller-owned PC.

The ignored Node stress runs 4,096 install/execute/evict cycles with a two-batch budget. It proves
active eviction/retranslation, exact final x0..x31 state and exits, and the ownership equation
`executor_floor + compiled_count + 2*module_count`: a K-block batch owns K Functions plus one state
view and one Instance (`K+2`). Invalidation returns to the executor floor and dropping the executor
returns to the global baseline. This exact bound is stronger than guessing the historical
`addToExternrefTable0` OOM threshold, which the repository never recorded numerically.

## Final local gates

```text
cargo fmt --all -- --check
git diff --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate \
  -p wasm-vm-jit-runtime -p wasm-vm-cli --all-targets -- -D warnings
cargo clippy -p wasm-vm-wasm --lib \
  --target wasm32-unknown-unknown --release -- -D warnings
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release
cargo test -p wasm-vm-jit-runtime
cargo test -p wasm-vm-cli --test run
cargo test -p wasm-vm-core --test async_compile_pipeline \
  interpreter_progresses_while_compiler_stalled -- --exact
bash tools/check-zero-cost.sh --selftest
wasm-pack test --node crates/wasm
wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_handles_remain_bounded_across_retranslation_churn \
  --include-ignored --exact --nocapture
make web-build
cd web && E3_T17_DEMO=1 npx playwright test \
  tests/e3-t17-demo-proof.spec.js --reporter=list
```

All passed. Runtime totals were lib 4/4, batching 3/3, chaining 6/6, eviction 3/3,
invalidation 13/13, JIT execution 20/20, lockstep 3/3 plus one intentionally ignored heavy soak,
precise traps 5/5, and timekeeping 3/3. CLI integration was 22/22. The full Node/Wasm matrix passed;
browser parity was 14 passed plus the one explicit ignored churn test, which separately passed 1/1
in 0.35 seconds. The real browser compliance gate passed 1/1 in 1.2 minutes and asserted the full
`126 passed, 0 failed, complete` result with zero console errors. The only Wasm-test warning is the
pre-existing unused `Exception` import in `crates/wasm/tests/hart_ctrl.rs`.

## Host-layer rr-soft evidence

The exact `8ef240d` sources were built on `ssh dev` with cargo 1.97.1 and recorded by rr-soft 5.9.0
using software counters and chaos scheduling. Each trace was packed, copied to this Mac, and
successfully replayed with `rr replay -W -a` on the Linux host:

```text
rr-traces/e4-t33-repair/e4-t33-failclosed
  tests::unexpected_engine_trap_after_mmio_fails_closed_without_register_commit
  PASS 1/1; manifest SHA-256 ae567b153e85bd165c2fdb2d486a56befe040d434853941a31fa2648f887849b

rr-traces/e4-t33-repair/e4-t33-keyed-cache
  tests::deterministic_jit_hasher_resists_chosen_probe_clusters
  PASS 1/1; manifest SHA-256 559b78b2fb4bee8424bff0e6aa96801434b8d39a5666b7b

rr-traces/e4-t33-repair/e4-t33-precise-bulk
  bulk_handoff_preserves_all_registers_and_virtual_pc_on_precise_fault
  PASS 1/1; manifest SHA-256 64e928674c1cbe1fdb3e852b0ba7bff75457a31f5e668d45429201a9226993e1
```

The trace directories are intentionally gitignored; adjacent `.sha256` manifests enumerate every
packed file. The remote disk initially reached 100% and the linker failed with SIGBUS before any
test ran. Removing only this worker's abandoned remote tree/failed outputs plus recoverable apt
cache restored space; the clean rebuild, recordings, pack, and replay then succeeded.

## Portability, browser, and deployment evidence

A pristine archive of `8ef240d` at `/tmp/wasm-vm-e4t33-dist.gcQQ4w/repo` contains the generated
inline module named by `web/dist/pkg/wasm_vm_wasm.js`:

```text
clean-clone-snippet: PASS ./snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js
```

This catches the nested wasm-pack `.gitignore` failure from the superseded pre-freeze commit. The
final build removes that copied ignore file and tracks the snippet deterministically.

Fresh local page evidence at port 8167 reached a real BusyBox `~ #` in 0.69 seconds, reported
`guest ready`, exposed exactly one filtered E4-T33 roadmap row, and emitted zero errors/warnings.
The roadmap capability deliberately remains `in-progress` until the fresh critic returns.

Artifacts:

- `browser-repair-demo.jpg` — SHA-256
  `d0f7915e1962775fa8bf21f69cdbecc7b2635b370f63f7f3505ef30bbb86b8ee`
- `browser-repair-roadmap.jpg` — SHA-256
  `b4acaca5529585b88c5f8350414c71eca7b65e904c27321b5059980850f54eee`
- `browser-repair-task.jpg` — SHA-256
  `7aa84d87a5e93ddc0b28e96fcc9d9363c6ed50885afabe7ab623ff3b5aad4f1a`
  (rebuilt task detail showing the repair entry and `implemented` status)

Cloudflare Pages production deployment completed from `8ef240d`:

- immutable preview: `https://719132bb.wasm-vm.pages.dev`
- production: `https://wasm-vm.pages.dev`
- live `app.html?guest=busybox&nosw&worker=0&jit=0`: real `~ #`, `guest ready`, zero console
  errors/warnings
- deployed `pkg/snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js`: HTTP 200, 170 bytes, SHA-256
  `b42727c1c9a8e533cd165ce533824d67bd20bd55e690e123787965f164fde04d`, byte-identical to `web/dist`

## Claim

`8ef240d` removes scalar register crossings from both executors, reuses stable browser views without
slice-glue allocation, bounds browser roots to K+2 per batch, preserves exact clean and precise-fault
state across outer-memory growth, fails closed after post-dispatch engine exceptions, and makes the
native registry mixer resistant to the promoted chosen-cluster attacks without losing the release
speed gate. Exact-head native/Wasm/browser tests, 4,096-cycle churn, paired release measurements,
three replayable rr-soft recordings, pristine-clone packaging, a 126/0 browser run, and the live
Cloudflare deployment support that claim. Submitted for a separate adversarial verifier; not
worker-verified.
