# Fuzzer sensitivity fixtures (E1-T21)

These `.S` programs are **not** bug regressions. They are the checked-in evidence that the
differential fuzzer *catches and minimizes real CPU bugs* — acceptance criterion #2. Each
one reproduces a divergence **only against a documented seeded mutation** of our core; on
the correct emulator they **MATCH** Spike (verified). They exist to make the rig's
catch → minimize → reproducer loop auditable without having to re-inject the bug blind.

## `div_by_zero.S`

- **Seeded mutation:** in `crates/core/src/hart/mod.rs`, the `Div` div-by-zero result
  `-1i64` (spec §7.2: division by zero returns all-ones) changed to `0i64`.
- **How it was found:** `fuzz campaign --from 0 --to 40 --count 128 --isa rv64im` against
  the mutated build. Seed `0x0` diverged; ddmin shrank the 128-instruction body to **2
  instructions in 14 oracle calls**:

  ```asm
  sraiw t2, t3, 25   # t3 = 0x3f → 32-bit arithmetic-shift-right by 25 → t2 = 0 (the divisor)
  div   t3, t1, t2   # divide by zero: correct = -1 (all ones); mutant = 0  ← DIVERGENCE
  ```

  ddmin correctly kept the `sraiw` — it is the dependency that manufactures the zero
  divisor — and discarded everything else. This is the minimal witness.
- **Verification:** with the mutation reverted, `fuzz run --seed 0 --count 128` reports
  `MATCH` — so the divergence was caused solely by the seeded bug, and the rig has no
  false positives.

To re-demonstrate: apply the one-line mutation above, `cargo build --release -p
wasm-vm-cli`, run the campaign, observe the same 2-instruction reproducer, then revert.
