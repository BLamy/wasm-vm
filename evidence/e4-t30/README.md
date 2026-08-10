# E4-T30 worker evidence

Frozen implementation evidence recorded on 2026-08-09 (Apple Silicon macOS), commit `c648468`.

## Performance

```text
$ cargo test -p wasm-vm-core --release --test perf_baseline \
    perf_fast_interpreter_does_not_trail_legacy -- --ignored --nocapture
fast-interpreter: legacy=44.7 MIPS fast=70.4 MIPS ratio=1.57x
test result: ok. 1 passed; 0 failed

$ cargo test -p wasm-vm-core --release --test perf_baseline \
    perf_smoke_alu_above_floor -- --ignored --nocapture
perf-smoke: alu median 44.8 MIPS ≥ floor 15
test result: ok. 1 passed; 0 failed
```

The independent pre-fix audit at `f2260c7` measured the cache-on diagnostic path at 5.7 MIPS,
so the final 70.4 MIPS production cache + bounded-batching mode is 12.35x that result. An earlier
absolute-floor attempt failed at 10.3 MIPS while `uptime` reported load averages
`40.58 34.95 29.07`; the paired same-process ratio still passed. It was rerun rather than counted,
and the final frozen-tree commands above passed after contention subsided.

## Correctness and build gates

```text
cargo test -p wasm-vm-core
  PASS (all non-ignored unit, integration, doc, RISC-V corpus, cache differential,
        PMP, SMC/DMA, snapshot/resume, timing, and device tests)

cargo test -p wasm-vm-core --test hotness_discovery --test boot_contract --test pmp \
  --test predecode_diff --test predecode_smc_diff --test predecode_batching \
  --test predecode_entry_safety
  PASS

cargo fmt --all -- --check
cargo clippy -p wasm-vm-core -p wasm-vm-wasm --all-targets -- -D warnings
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release
make web-build
  PASS
```

The directed entry-safety test covers execute permission revoked for a cached entry, execute
permission revoked only for an interior instruction, two virtual aliases sharing one physical
block, and a DMA-style code patch made while a bounded run is yielded mid-block.

## Browser proof

Fresh origin: `http://127.0.0.1:8129/?guest=busybox&nosw&jit=0&worker=0`

- `data-interpreter="fast"`
- status `linux: restored`
- real terminal reached `~ #` and the UI reported `guest ready`
- `?slowInterp=1` selected `data-interpreter="legacy"`
- console errors: 0; console warnings: 0

Screenshot: `browser-fast-interpreter.jpg`

SHA-256: `37d43d60b89ebfbce995ad7269eb24800be885174ef336de884217c7177bd762`
