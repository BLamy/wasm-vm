# E5-T26o worker source scope

Production diff is limited to `PlicState::best_source` in
`crates/core/src/dev/plic.rs`: it computes `pending() & enable[context] & !1u32`,
then visits set bits in ascending order under a nonzero guard using
`trailing_zeros` and clear-lowbit. Unsigned strict priority and threshold comparisons
are unchanged; `eip` remains delegated to the selector.

The production diff is 4 insertions / 5 deletions. No cache, API, state, snapshot,
polling, clock, budget, MMIO decoder, claim, complete, or source-0 normalization
changes were made. No production private unit test was added.

Owned file SHA-256 at the worker head:

```text
9f5def69ccf6e98fb72185a9a2714c00caa5de16fe97c218d5555f93f4dc55f1  crates/core/src/dev/plic.rs
67a9266d3e93433380291982841ac59e3f049ee86e572a02380777104ba6916f  crates/core/tests/plic_sparse.rs
b5a88a793ebb5d576d35353d93c6fe6774be8ab71f51258f238d4e41f8a332d6  crates/core/tests/support/plic_sparse_cases.rs
805de1b55be09a342d77614d5f310ca4a97ff90c878fa195d3ca6d4c241da9ef  crates/wasm/tests/plic_sparse.rs
```

