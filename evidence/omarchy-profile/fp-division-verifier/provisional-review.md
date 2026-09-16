# Provisional independent review — E5.5-T03z

No open semantic refutation at this checkpoint. This is not the final verdict;
the frozen worker submission, final cold rebuild, public bytes and actual
physical trial remain to be audited.

- P1–P6 numeric rules — HELD. Native `native-preseal-fixed.log` records 11,328
  literal cases and the interpreter comparison. Private/shared WASM in
  `wasm-preseal.log` produce the identical digest `13921326542630639717`.
  The independent tininess/overflow predictions exposed inherited backend flag
  defects; the worker's F32-only correction now satisfies those literals.
- P7 guards and P8 publication/purity — HELD. 3,072 seeded cases include 1,488
  precise illegal exits. Separate instrumentation executes 1,536 cases with
  810 legal helper calls and zero illegal calls, canonical arguments, exact
  FPR masks, preserved frm and a full memory mutation envelope.
- P9 optional indices — HELD. Eight predecessor-helper combinations execute
  in both individual and batch modules. The all-helper chain has nine imports,
  function exports 9–13 and actual calls to helpers 5–8 and successors 10–13.
- P10–P11 handoff — HELD. Same/cross-module budgets 1/2/6/7 and later faults
  preserve exact prefixes. Private/shared memory-growth fixtures each execute
  success, store-fault and later-load-fault cases, each growing exactly 65,536
  bytes once. Real interpreted CSR changes take effect on re-entry.
- P12 sabotage — HELD. The isolated expected 1/3 RNE literal was changed by
  one result bit. `sabotage-mutant.log` fails at `CRITIC_FDIV_THIRD_GOLDEN`;
  `sabotage-restored.log` passes all 11,328 literal cases. The restored support
  digest matches the original. Final source/cold/seal checks remain pending.
- P13 production and desktop — pending final worker artifacts. Instruction
  correctness does not satisfy the original desktop responsiveness deadline.

The narrow fixture checks found and fixed only test-authoring issues: explicit
integer array types, then equivalent `is_multiple_of(5)` syntax for Clippy.
The latter follows the native/WASM preseal runs; the isolated restoration and
both Clippy checks use the final fixture. The final acceptance must repeat the
frozen native and WASM fixtures. No production code was edited by this critic.

Coverage is mapped in `coverage.md`. Unchanged predecessor HELD findings carry
forward. This critic has not repeated unrelated gauntlets or the physical trial.
