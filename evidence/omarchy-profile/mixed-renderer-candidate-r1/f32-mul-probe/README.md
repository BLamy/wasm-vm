# Isolated f32 multiply probe

Diagnostic experiment only. This is not a product implementation, runtime change, compliance
verdict, or integration proof. The temporary Cargo project was created at
`/private/tmp/wasm-vm-f32-mul-probe.18n1gL` and depended on the existing repository
`crates/core` softfloat API without editing it.

The candidate uses an unsigned `u64` product of two 24-bit normal significands. It returns a
candidate result only for finite normal inputs, RNE, and a normal rounded result. It uses a
nearest-even half-way comparison, propagates NX when discarded bits are nonzero, handles sign and
normalization carry, and returns `None` for the existing `rustc_apfloat` fallback path. No special,
subnormal, zero, non-RNE, overflow, or underflow case is admitted by the candidate.

Review copy of the probe code: [probe.rs](probe.rs). Exact source used for the run:
`/private/tmp/wasm-vm-f32-mul-probe.18n1gL/src/main.rs`, SHA-256
`5049415d86240802f803fb4032a13c6fce3ffea8efa418f512997139f772306f`.

## Command and result

```text
cargo run --offline --release --quiet
```

Exit: `0`

```text
directed tie-even: 3fc00000 × 3f800003 -> 3fc00004 flags=01
directed tie-odd: 3fc00000 × 3f800001 -> 3fc00002 flags=01
directed carry: 3f7fffff × 3f800000 -> 3f7fffff flags=00
directed negative-sign: bf7fffff × 3f800000 -> bf7fffff flags=00
synthetic carry: rounded_significand=01000000 nx=true
differential: checked=100000 fast_normal_results=74527 mismatches=0
benchmark: iterations=2000000 candidate_ns=5.649042ms reference_ns=34.314542ms sink=00000000
```

The directed tie cases exercise both even and odd retained-significand parity; the odd case rounds
up. The exact normal-boundary case and negative-sign case agree with the reference. The carry
normalization branch is present and guarded. The synthetic carry check exercises the retained-
significand carry and NX path; the selected real normal boundary case is exact and therefore does
not set NX.

The native release black-box loop measured this candidate at roughly 6x faster for the selected
normal workload. This is a microbenchmark only: it excludes dispatch, conversion, FSW, guest
memory, JIT admission, and fallback mix costs. No WASM benchmark was run.

The initial non-offline Cargo attempt exited 101 because the sandbox could not resolve
`index.crates.io`; the final probe used the local cache with `--offline`. No repository runtime,
WASM, dist, instruction, task-boundary, or core/JIT files were changed.
