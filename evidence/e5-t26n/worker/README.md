# E5-T26n worker handoff — not verified

Main now owns integration. No further worker code/build/test changes or command runs.
The three implementation files are frozen at Main's reviewed SHA-256 values:

| File | SHA-256 |
| --- | --- |
| crates/wasm/src/jit_browser.rs | 62f0599f20d8faeb26dcb6d0664b795bf27daed562d27ce86b29860bb42fc7b0 |
| crates/wasm/tests/jit_browser_parity.rs | ecaca332a6d0474eb67614c2dd7e295de8da0b14520d8d43f8ca5f5d6fad3016 |
| Makefile | c4a4da2a59db318ddc90d49244db7f5f92d4b3f3ff511e1785ba31399afe691f |

## Recorded focused checks

These commands already ran; no checks were rerun for this handoff. Raw output was
captured with `2>&1 | tee <log>` and `set -o pipefail`.

| Command | Raw log | Result |
| --- | --- | --- |
| `wasm-pack test --node crates/wasm --lib -- browser_guest_sret --nocapture` | `sret-check-3.log` | exit 0; 3 passed |
| `wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture` | `wasm-focused-final.log` | exit 0; 12 library + 38 parity passed, 1 unchanged ignored churn test |
| `cargo fmt --check -p wasm-vm-wasm` | `fmt-final.log` | exit 0; no output |
| `cargo clippy -p wasm-vm-wasm --lib --test jit_browser_parity --target wasm32-unknown-unknown -- -D warnings` | `clippy-final.log` | exit 0 |
| `git diff --check -- crates/wasm/src/jit_browser.rs crates/wasm/tests/jit_browser_parity.rs Makefile` | `diff-check-final.log` | exit 0; no output |
| `make -n verify-E5-T26n` | `make-dry-run.log` | exit 0; dry run only |

`claim.md` contains source/log citations and acceptance details. `source-diff.log`,
`source-sha256.log`, `log-sha256.log`, and `base-head.log` identify the tested working
diff on Main's preparation head `5ebcc9df69b16885fd4c35f9c3a43c673080340a`.

## Rejected draft and comparison boundary

- The first pending-STIP draft cleared `csr.set_mip_bit(5, false)` directly. Main
  rejected that raw pending-bit surgery: calling it device-facing did not make it
  authentic source cancellation. `sret-check-1.log` is therefore superseded, not
  final proof. The final guest executes SBI TIME `set_timer(0)` to assert the actual
  CLINT/SBI timer source and `set_timer(u64::MAX)` to cancel it. SBI success, source-
  derived STIP clearing, unchanged enabled STIE, nested encoded SRET, and compiled
  target effects are asserted. No fixture raw pending-bit clear remains.
- `sret-check-2.log` failed an extra full serialized-CPU comparison: the cached CSR
  `time` shadow was 6 in the batched machine versus 8 in the interpreter at the timer
  baseline. It is sampled at different existing polling boundaries; actual CLINT
  mtime was 9 in both. Final proof does **not** claim full serialized CPU equality
  or cached `time`-shadow equality. It compares exact PC, current mode, all integer
  registers, full mstatus, S/M trap CSRs, minstret/mcycle, all RAM, and the real CLINT
  mtime source. No clock normalization or clock implementation change was made.
  JIT counters and cache/publication arrays are checked separately from the oracle.

## Remaining ownership

Main: one SUM sabotage, integration/freeze, remaining native/runtime and frozen
gates, build/demo, and final pristine-clone evidence. Fresh critic: independent
review and pending-source variant against the frozen diff. Worker verification is
not task verification. No latency cause, speedup, or satisfaction/waiver of F's
two-second gate is claimed.
