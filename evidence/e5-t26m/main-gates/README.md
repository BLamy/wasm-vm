# Coordinator integration checks

Luna produced the narrow runtime projection, actual-WASM tests and scoped make
target. The worker's final message reports only `make -n`; no executed semantic
red/green or final submission is attributed to that draft.

This directory retains Main's integration checks. Compilation/setup failures
are not semantic refutations. The old full-mstatus comparison must fail the
new reuse regression, the exact four-bit projection must pass it, and the
separate pending-interrupt test must keep a genuinely compiled successor
present before guest execution. Final risk-tier recording follows a frozen head.

## Integration results at activation HEAD aa03fe85

The implementation is still a working-tree draft during these checks. These
records are not the final exact-head submission:

- `01-clippy.log`: actual wasm32 library/parity-test clippy passed with warnings
  denied. The scoped format check also exited0.
- `02-full-status-inputs.sha256`, `02-full-status-red.log`: replacing the named
  mask with `u64::MAX` reproduces the original full-status comparison. The private
  real-WASM test fails at bit1 (`jit_browser.rs:2393`); execution stops before
  the parity binary, so no old-semantics static/dynamic test result is claimed.
- `03-four-bit-inputs.sha256`, `03-four-bit-reuse.log`: restored exact four-bit
  source passes the private64-bit partition and both actual static/dynamic
  reuse tests (1+2 passed). The dynamic test includes SUM invalidation.
- `04-interrupt-preemption.log`: the real Machine M/MTIP and S/delegated-STIP
  cases pass against interpreter state, with the compiled successor asserted
  present before guest execution (1 test, four machine runs).
- `05-sum-sabotage-inputs.sha256`, `05-sum-sabotage-private.log`,
  `06-sum-sabotage-dynamic.log`: one temporary mutation additionally ignores
  bit18/SUM. Both focused commands compile and exit1 at semantic assertions:
  private test line2402 says bit18 did not change context; dynamic test line2085
  observes4 retirements instead of2 (stale target entered). The outer recording
  command exits0 only after checking both child exit statuses are nonzero.

The exact four-bit source was immediately restored after sabotage. Its digest
is `5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`;
the unchanged parity test digest is
`0b0def0e3b074926bdd8f017eb858c60570d3f413d876bc713c1318399aa1889`.
The wasm-pack prebuild reports a pre-existing unused Exception import in
`hart_ctrl.rs:8`; it is not a new warning in the changed parity test.
