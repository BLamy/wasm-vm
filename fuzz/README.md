# Fuzzing scaffold (E0-T21)

Coverage-guided libFuzzer target for the instruction decoder — and the **reusable
scaffold** every later parser (ELF loader, virtio rings, device configs) clones.

## Requirements

- **Nightly** Rust (libFuzzer needs `-Z` flags): `rustup toolchain install nightly`.
- **cargo-fuzz**: `cargo install cargo-fuzz`.
- A libFuzzer-capable target. On **Linux** this works out of the box. On **macOS** it uses
  the bundled libFuzzer via `-C link-arg`; Apple Silicon works with the nightly above.

This crate is its **own workspace** (`[workspace]` in `fuzz/Cargo.toml`) so the
nightly-only `libfuzzer-sys` never enters the parent `core/wasm/cli` builds.

## Run

```sh
make fuzz-decode-smoke                       # 10^7-exec bounded smoke (~1 min), CI-friendly
cd fuzz && cargo +nightly fuzz run decode    # open-ended run (Ctrl-C to stop)
```

The **seed corpus** (`corpus/decode/*.text`) is the `.text` section of each committed
guest ELF (`guest/prebuilt/*.elf`), extracted with `riscv64-unknown-elf-objcopy
--only-section=.text`, so the fuzzer starts from real instruction streams.

## Property

`fuzz_targets/decode.rs` slices the input into little-endian 4-byte words and calls
`decode` on each: **it must never panic on any input**. The stronger guarantees live in the
sibling tests — `crates/core/tests/exhaustive.rs` proves no-panic over *all* 2³² words and
pins the legal-instruction count to an independent analytic tally, and
`crates/core/tests/decode_props.rs` proves `encode(decode(w)) == w` (round-trip) via a
spec-derived encoder. This target adds coverage-guided exploration and is the template for
fuzzing the untrusted parsers to come.

Any crash is written to `fuzz/artifacts/decode/`; a minimized reproducer can be replayed
with `cargo +nightly fuzz run decode fuzz/artifacts/decode/<crash>`.
