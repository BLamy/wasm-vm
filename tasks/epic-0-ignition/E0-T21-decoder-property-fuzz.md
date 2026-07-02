---
id: E0-T21
epic: 0
title: Property tests, exhaustive sweep, and fuzz scaffold for the decoder
priority: 21
status: pending
depends_on: [E0-T06]
estimate: M
capstone: false
---

## Goal
The decoder is armored by three independent adversaries: `proptest` strategies generating
field-wise-legal encodings per format (with an encode/decode round-trip oracle), an
exhaustive no-panic sweep of the entire 32-bit instruction space, and a `cargo-fuzz`
target — establishing the fuzzing scaffold every later parser (ELF loader, virtio rings,
device configs) will reuse.

## Context
The 32-bit space is only 2^32 words: exhaustive execution of `decode` is minutes of native
CPU, so "never panics" can be a *theorem*, not a sample. The round-trip oracle needs a
test-only `encode(Instr) -> u32` assembler in the test crate — its independence from the
decode tables is the point (write it from the spec, Unprivileged ISA §2.2–2.3/Ch. 24, not
from `decode.rs`). cargo-fuzz (libFuzzer, nightly) targets decode-then-if-legal-encode;
corpus seeded from the golden binaries' `.text` sections.

## Deliverables
- `crates/core/tests/decode_props.rs`: per-format proptest strategies (random legal
  fields → assembled word), asserting decode success, field equality, and
  `encode(decode(w)) == w`; reserved-encoding strategies asserting `IllegalInstr`
  (e.g. SLLIW with `insn[25]=1`, OP with undefined funct7).
- `crates/core/tests/exhaustive.rs`: `#[ignore]`-tagged full `0..=u32::MAX` sweep
  (release-mode, rayon-parallel, asserts no panic and tallies legal-instruction count
  against a committed expected number).
- `fuzz/` directory (`cargo fuzz init`) with `fuzz_targets/decode.rs`, seed corpus
  extracted from `guest/prebuilt/*.elf` text sections, and CI-friendly
  `make fuzz-decode-smoke` (60-second bounded run).
- Documentation of nightly requirement and macOS/Linux invocation in `fuzz/README.md`.

## Acceptance criteria
- [ ] `cargo test -p wasm-vm-core decode_props` passes with 10,000 proptest cases per
      strategy (config committed, not default 256).
- [ ] `cargo test --release -- --ignored exhaustive` completes with zero panics and the
      legal-count matches the committed tally.
- [ ] `make fuzz-decode-smoke` runs ≥ 10^7 execs with zero crashes; corpus committed.
- [ ] A proptest subset (1,000 cases) runs under `wasm-pack test --node`.
- [ ] The proptest failure-persistence files (`proptest-regressions/`) are committed when
      generated.

## Adversarial verification
(1) Run the exhaustive sweep yourself from a cold clone — it is the single strongest
check; any panic refutes. (2) Mutation-test the armor: flip one bit in a decode mask
(e.g. the SRAI funct7 bit-30 test) and confirm proptest *or* the exhaustive tally catches
it within one run — an undetected mutant refutes suite sensitivity. (3) Oracle
independence: diff `encode`'s field layout constants against `decode.rs` — copy-pasted
tables refute the round-trip's value; spot-check three encodings against
`riscv64-unknown-elf-as` output. (4) Check the legal-count tally actually constrains:
recompute it with an independent script over objdump of the sweep (or reason from the
opcode map) — a tally that was just "whatever the code produced on day one" is weak;
require a written derivation or cross-check in the log. (5) Let the fuzzer run 30+ minutes
locally; report exec/s and any slow-input findings.

## Verification log
(empty)
