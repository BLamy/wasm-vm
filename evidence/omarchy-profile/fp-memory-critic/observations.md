# E5.5-T03u critic observations

## 2026-09-15 — pre-freeze P12 falsification

The worker explicitly requested this one narrow attack before freezing the
runtime. This is not the final task verdict; the task remains in progress.

- **Prediction P12 — FAILED.** An S-mode NA4 PMP entry permits exactly
  `0x80004000..0x80004003`; a second word access at `0x80004004` must fault.
  The shared browser generated module instead reuses the first access's
  whole-page tag. FSW writes the forbidden adjacent word and FLW reads it.
  Both retire two instructions and fall through to `0x40002008` rather than
  fault at `0x40002004` with tval `0x80004004`.
- **Recheck/control.** The same two instructions through the private browser
  module's checked imports fault precisely. Integer load/store controls
  exhibit the same shared-memory bypass. `hart/mod.rs` and `jit_browser.rs`
  were unchanged from activation head `9a9639545842c840322a82deb79874c9960ce492`
  at the time of the test; this is inherited authority, newly exercised by
  the FP transfer boundary.
- **Evidence points.** `pmp-r0-recheck.log:19` is the correct private FP store;
  line 20 is the shared store changing `data1=0x81234567` to `0x7fa05678`.
  Lines 43/44 show private/shared FP load, the latter illegally setting
  `f1=0xffffffff81234567`. Lines 67/68 and 91/92 are the integer controls.
  The complete log SHA256 is
  `fdef6c58eed33a96b07f5ba5881e5ae534ce6784b109df37d03b9170a967bce3`.
- **Demand.** A published inline page tag must be authorized for the page
  range it permits, or narrower permissions must remain on checked imports.
  Repair the existing authority boundary rather than giving FP a permissive
  separate import. Rerun the four promoted tests after the worker's fix.
- **Command.**
  `DEVELOPER_DIR=/Library/Developer/CommandLineTools wasm-pack test --node crates/wasm --test jit_fp_memory_critic -- --nocapture`
  Both the original run and private-control recheck exit 1. The recheck ran
  four tests, 0 passed / 4 failed, 0 ignored, in 0.02 seconds after compilation.

Fixture: `crates/wasm/tests/jit_fp_memory_critic.rs`, SHA256 at recheck
`26ab10eff1faef4e58f4fbacb0240d999551fabfeec778d2b8328ca3ef7ca761`.
The immutable copy is `pmp-r0-recheck-test.rs`. All other predictions remain
pending the worker's frozen source and evidence.
