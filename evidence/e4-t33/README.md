# E4-T33 worker evidence

Frozen runtime/test implementation: `f725abf23f85ba2e98d6fa13d07affce07737ec4`
(Apple Silicon macOS, 2026-08-10).
This worker did not deploy; the fresh verifier owns promotion and the subsequent live-site update.

## Before/after release performance

The benchmark-only baseline commit `73d1e88ad60f0e548edc98bdb41b34e6347ce097` contains the
new harness on the unchanged E4-T31 runtime. Both baseline and final measurements used the same
command, five alternating samples per engine, untimed warmup, and exact architectural work:

```text
cargo test -p wasm-vm-jit-runtime --release --test perf_handoff \
  -- --ignored --nocapture --test-threads=1

                                      interpreter   JIT       JIT/interpreter
baseline 64-op, 6,400,000 retired       76.083      238.552       3.135x
final    64-op, 6,400,000 retired       81.092      608.741       7.507x

baseline six-op, 6,000,000 retired      26.773       10.267       0.383x
final    six-op, 6,000,000 retired      62.692       87.625       1.398x
```

The acceptance workload's same-workload JIT uplift is `608.741 / 238.552 = 2.551x`; the final JIT
is 7.507x the production fast interpreter. Even the six-op worst-case boundary diagnostic now
beats the interpreter. Every measured run asserts exact IRQ-retired, `mcycle`, `minstret`, JIT
retirement, PC, and register-oracle state before reporting MIPS.

## Bulk handoff and precise-fault attacks

The shared codec pins `[0x000, 0x238)` to exactly 568 little-endian bytes. Native Wasmtime performs
one direct fixed-memory slice copy in and one out; the browser executor performs one
`Uint8Array.copy_from` and one `copy_to` through a stable batch-owned view. Both precise-fault tests
dirty x1 through x30, fault the following load into a distinct x31 sentinel, and assert x0, every
writable register, cause, tval, virtual fault PC, and caller-owned PC. Unexpected engine traps do
not authorize state readback.

SoftMMU single-block and batch modules now declare private memory with `min=1,max=1`; directed
parser tests prove InlineTLB single/batch memories remain imported and growable. The browser attack
retains the 568-byte view, requires `memory.grow(1)` to throw, and proves the view's buffer identity
and length do not change.

## Browser ownership and churn

```text
wasm-pack test --node crates/wasm --test jit_browser_parity
  PASS: 9 passed, 0 failed, 1 ignored

wasm-pack test --node crates/wasm --test jit_browser_parity -- \
  browser_handles_remain_bounded_across_retranslation_churn \
  --include-ignored --exact --nocapture
  PASS: 1 passed, 0 failed; 4,096 install/execute/evict cycles
```

The ownership test establishes the exact algebra rather than guessing a historical OOM threshold:
a K=64 batch adds exactly K Functions + one state view + one Instance (`K+2` externrefs); under a
two-batch LRU budget every cycle equals `executor_floor + compiled_count + 2*module_count`; explicit
invalidation returns to the executor floor, and dropping the executor returns to the global
baseline. The 4,096-cycle rotating retranslation attack also proves active evictions and
retranslations, at most two live blocks/modules, all x0..x31 final values, every per-call exit PC,
and the final caller-owned PC. The repository has no trustworthy numeric record of the old
`addToExternrefTable0` failure point, so this evidence does not invent one; exact bounded ownership
is the stronger invariant, with the long run proving it under churn.

## Correctness and build gates

```text
cargo fmt --all -- --check                                      PASS
cargo clippy -p wasm-vm-core -p wasm-vm-jit-translate \
  -p wasm-vm-jit-runtime -p wasm-vm-cli --all-targets \
  -- -D warnings                                                 PASS
cargo clippy -p wasm-vm-wasm --lib \
  --target wasm32-unknown-unknown --release -- -D warnings       PASS

cargo test -p wasm-vm-core                                      PASS
cargo test -p wasm-vm-jit-translate                             PASS
cargo test -p wasm-vm-jit-runtime                               PASS
cargo test -p wasm-vm-cli                                       PASS
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown \
  --release                                                      PASS
wasm-pack test --node crates/wasm                               PASS
make web-build                                                   PASS
```

Affected runtime totals include batching 3/3, chaining 6/6, eviction 3/3, invalidation 13/13,
JIT execution 20/20, precise traps 4/4, and timekeeping 3/3. CLI totals include 53 unit tests,
22 integrated run tests, and the relay/token/chunk suites. The full Node Wasm matrix, wrapper
tests, browser I/M/A parity, SMC invalidation, linking, exact budgeting, precise traps, and the
explicit long churn gate are green. The only emitted Wasm-test warning is the pre-existing unused
`Exception` import in `crates/wasm/tests/hart_ctrl.rs`.

## Diff-to-evidence audit

- `core/hart/regs.rs` and `core/jit.rs`: codec layout, endian bytes, and x0 preservation are covered
  by `cpu_state_handoff_pins_frozen_layout_endian_and_x0` plus both integrated fault paths.
- `jit-runtime/src/lib.rs`: one-copy native handoff and clean/fault exits are covered by the JIT,
  precise-trap, chaining, invalidation, and perf suites. The mixed integer hasher has a 32K-key
  aligned/same-low-bit insert/get/remove adversarial unit test; all four registries are exercised by
  batching, chaining, eviction, and SMC invalidation.
- `jit-translate`: single/batch SoftMMU fixed memory and single/batch InlineTLB growability are
  parser-asserted; browser view growth rejection covers the runtime invariant.
- `wasm/jit_browser.rs`: I/M/A, precise trap, SMC, chain, eviction, exact K+2 ownership, full-register
  churn, invalidation, and drop-floor tests cover clean exits and every changed lifecycle path.
- `web/roadmap.js`: the E4 capability remains `in-progress` until a fresh critic verifies it; the
  rebuilt page and filtered E4-T33 row are captured below.

## Fresh browser observation

Fresh COOP/COEP origin:
`http://127.0.0.1:8147/?guest=busybox&nosw&worker=0&jit=0`.

- Fast BusyBox snapshot restore reached `guest ready` and a real `~ #` prompt in 0.41 seconds.
- The built suite marker reported `126 passed`; console errors and warnings were both zero.
- Filtering the roadmap to E4-T33 produced exactly one matching issue.
- An aggressive `?jit=1&jitThreshold=1` page loaded with zero console errors, but main-thread Linux
  saturated DOM automation. This is not claimed as a responsive JIT-demo success; moving the whole
  machine to the default Web Worker remains E4-T32.

Artifacts:

- `browser-bulk-jit.jpg` — SHA-256
  `8d783bb16165726fd6c913a8a770577f1229387bd2ec5364093f7b92aae2b0a6`
- `browser-roadmap.jpg` — SHA-256
  `e30a4778a85f91e56464756df0a1ac2811286e4caab64501e2c52ce32e5036c5`

## Verification-log draft

`f725abf23f85ba2e98d6fa13d07affce07737ec4` removes scalar register crossings from both executors,
freezes the 568-byte state
view lifetime, bounds browser roots to K+2 per batch, preserves exact precise-fault state, and moves
native registry lookup off SipHash without changing the guarded executor protocol. The exact-head
native/Wasm/browser gates above are green; paired same-workload release evidence records a 2.551x
JIT uplift and a final 7.507x JIT/interpreter ratio. The 4,096-cycle tiny-budget attack proves exact
externref ownership, active eviction/retranslation, and full-register architectural parity. The
fresh rebuilt demo restores BusyBox to a real prompt with zero console errors/warnings and surfaces
E4-T33 as in progress. Submitted for a separate adversarial verifier; not deployed and not verified.
