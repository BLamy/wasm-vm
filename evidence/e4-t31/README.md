# E4-T31 worker evidence

Frozen runtime/test implementation: `fad321f6b75fa695e1a83182bcad8fad17e1a677`
(Apple Silicon macOS, 2026-08-09).

## Exact work and retirement

Before this task, the exact six-op hot-loop probe requested 1,000,000 instructions but executed
about 191,927,424 compiled instructions (roughly 192x), took 48.78 seconds, and CLI trace-derived
reporting printed only 378 retirements.

At the frozen implementation:

```text
cargo test -p wasm-vm-jit-runtime --release --test jit_execution \
  six_op_loop_respects_exact_budget_tail_counters_clock_and_trace_gate \
  -- --exact --nocapture

test result: ok. 1 passed; finished in 0.08s
```

The test proves exactly 1,000,000 total retirements, 999,996 via JIT, an interpreted short tail,
exact `mcycle`/`minstret`/IRQ/CLINT accounting, and zero compiled execution for an observing trace
sink. The same bounded loop is green in the browser executor at 1,000 total / 996 JIT retirements.

## Correctness gates

```text
native JIT runtime affected suites:
  chaining 6/6
  invalidation 13/13
  jit_execution 17/17
  precise_traps 3/3
  timekeeping 3/3
  total 42/42

compiled builtin-SBI exact-work regression: 1/1
core unit + CLINT + Zicntr: 169/169 + 12/12 + 10/10
CLI run suite: 22/22
wasm-pack node browser-JIT parity: 8/8
wasm-pack node wrapper: 9/9
```

Directed attacks cover a successor block that cannot fit the remaining chain tail, a compiled
MMIO store followed by a precise fault (one side effect, no replay), Sv39 virtual-PC fault
accounting, CLINT divider residue, stale counter-suppression flags, a compiled SBI `continue`, and
traced CLI/Wasm runs that must emit every retirement while executing zero JIT blocks.

## Build gates

```text
cargo fmt --all -- --check                                            PASS
cargo clippy -p wasm-vm-core -p wasm-vm-jit-runtime -p wasm-vm-cli
  --all-targets -- -D warnings                                        PASS
affected wasm lib/jit_browser_parity/wrapper clippy                    PASS
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release PASS
tools/check-zero-cost.sh --selftest                                    PASS
make web-build (pre-commit hook)                                      PASS
```

Full wasm all-target clippy still encounters the pre-existing unused `Exception` import in
`crates/wasm/tests/hart_ctrl.rs`; this task neither touches nor waives that unrelated warning.

## Browser observation

The rebuilt COOP/COEP-served fallback page at
`http://127.0.0.1:8131/?guest=busybox&nosw&worker=0&jit=0` selected the fast interpreter, restored
BusyBox to `~ #`, reported `guest ready`, and produced zero console errors/warnings. Screenshot:
`browser-fallback.jpg`, SHA-256
`3c22907f2852b7c41c928c36930b4c201d1347eab2db749a4565f4071d038264`.

An explicit `?jit=1&jitThreshold=1` live page no longer has hidden 32-block budget multiplication,
but it still starved a main-thread CDP inspection. That is not counted as a throughput success:
E4-T33 removes per-register host crossings, and E4-T32 moves the whole machine to a worker before
browser JIT can be a responsive default.
