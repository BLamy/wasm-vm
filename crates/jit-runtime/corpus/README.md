# E4-T25 lockstep/fuzz regression corpus

Minimized repros distilled from divergences the lockstep comparator + fuzzer found. Each entry is
the exact prior architectural state + RAM + block that made the JIT (wasmtime master) disagree with
the shadow interpreter (`Hart::exec_oracle`).

## Layout
- `*.repro.txt` — human-readable divergence reports (seed, minimized block, prior register/RAM
  state, and the block's disassembled wasm bytes). Everything needed to reproduce OFFLINE (AC5).
- The **replayable** cases live as Rust literals in
  `crates/jit-runtime/tests/lockstep_fuzz/corpus.rs` and are replayed by the `corpus_replays_clean`
  regression test on every run. With the CORRECT translator they must lockstep-CLEAN; they are the
  exact operand shapes that DIVERGE the instant the corresponding bug is reintroduced.

## Provenance
The current corpus is seeded from the mutation-adequacy sweep (the deliberate, never-shipped
translator bugs behind the `mutation-testing` cargo feature). `sraw-wrong-shift-mask.repro.txt` is a
verbatim capture of the AC2 killer-gate run: the fuzzer caught a mis-translated `SRAW` (64-bit
arithmetic shift instead of the *W form) at program 11 / block 3 and auto-minimized it to a single
instruction. Reproduce the whole sweep with:

```
cargo test -p wasm-vm-jit-runtime --features mutation-testing --test lockstep_fuzz -- --nocapture
```

## Adding a new repro
When the fuzzer finds a NEW divergence (injected or, more valuably, real):
1. Save its `report()` text here as `<slug>.repro.txt`.
2. Add its minimized block + prior state to `tests/lockstep_fuzz/corpus.rs::cases()` so
   `corpus_replays_clean` guards it forever.
