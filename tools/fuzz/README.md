# `tools/fuzz` — differential fuzzer vs Spike (E1-T21)

A constrained-random RV64GC instruction-stream generator that runs each stream in
**lockstep against Spike** through the E0-T20 canonical-trace harness and auto-minimizes
any divergence to a short, standalone `.S` reproducer. It finds the bugs the curated
riscv-tests / RISCOF suites were not written to find.

## Design in one breath

1. **Generate** (`isagen.rs`) — a seeded, weighted opcode stream over a *small* register
   pool (forces aliasing/hazards), with immediates biased hard to boundary values (0, ±1,
   INT_MIN/MAX, shift-amount edges). Output is **assembly mnemonics**, so the toolchain
   assembler does the encoding — a hand-rolled encoder would only inject the fuzzer's own
   bugs into the stimulus.
2. **Lockstep** (`harness.rs`) — assemble via the Docker toolchain gcc, then hand the ELF
   to the already-verified `tools/diff/run_diff.sh`, which runs it under our CLI *and*
   Spike, normalizes both traces to the canonical grammar, and byte-compares ours as a
   prefix of Spike's. The fuzzer's novelty is the *stimulus*, not the comparison.
3. **Minimize** (`minimize.rs`) — classic ddmin over the body's lines; sound because the
   stream is straight-line (deleting any line still assembles and still halts). Emits the
   minimal witness as a `.S` reproducer.

Reproducibility is a first-class property: the PRNG (`rng.rs`, SplitMix64, no `rand`
dependency) makes `--seed N` a pure function to a stream, identical on every host.

## Usage

```sh
# Inspect a generated program (no execution):
cargo run -p wasm-vm-fuzz -- gen --seed 1 --count 32

# Lockstep one seed against Spike (exit 0 match, 3 divergence, 2 harness error):
cargo run -p wasm-vm-fuzz -- run --seed 1 --count 128 --isa rv64im

# Sweep a seed range; minimize + write a reproducer on each divergence:
cargo run -p wasm-vm-fuzz -- campaign --from 0 --to 32 --count 128 --isa rv64im

# The smoke tier (fixed seeds, CI):
make fuzz-diff-smoke
```

Requires Docker (the `wasm-vm-toolchain:local` image, per `tools/toolchain/`) for the
assembler + Spike reference, and a release build of the CLI. Works from a cold clone with
only Docker + Rust.

## Current stimulus class and what's deferred

This increment generates **straight-line RV64IM** (integer + mul/div, no memory, no
control flow) — a deliberate, safe first slice that already densely probes the
highest-divergence-density corner of the ISA (division edge cases, `MULH*` signedness,
`W`-suffix sign-extension, shift-amount masking). The rig is structured so follow-on
stimulus classes slot in as new `Op` arms and ISA strings:

- loads/stores over a bounded scratch region;
- branches/jumps (with a generated-CFG halt guarantee);
- F/D/C (fcsr + NaN-payload comparison) and A;
- a U-mode + Sv39 profile comparing **trap events** (cause, tval) as first-class stream
  items;
- a nightly high-count tier and the wasm32-side reproducibility leg (leans on E1-T22).

The seeded-mutation **sensitivity** proof lives in `sensitivity/`; real divergences (none
yet — the covered class is RISCOF-compliant) would land in `tests/fuzz-regressions/`.
