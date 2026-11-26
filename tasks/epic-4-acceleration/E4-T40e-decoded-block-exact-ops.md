---
id: E4-T40e
epic: 4
title: Decoded blocks own exactly their ops; report decoded-cache occupancy
priority: 0.387643
status: pending
depends_on: [E4-T40d]
estimate: S
risk: medium
capstone: false
---

## Boundary

`crates/core/src/dispatch.rs` (`DecodedBlock`) and the block build in `Machine::enter_block`;
one read-only counter in `jitStats` and in the CLI's `block cache:` line.

Found by the E4-T40d verifier: with 262144 slots, the resident blocks' `ops` vectors hold
1.85 times the capacity they use (1,472,128 op slots for 794,353 ops at 140,000 resident
blocks), because each block is built in a `Vec::with_capacity(8)` that then grows by doubling.
Build each block's ops in a scratch buffer the machine keeps and store them as an exact-size
allocation. That is one allocation per block build instead of one plus the regrowths, and
about a third less cache heap.

Also report how many slots hold a live block (occupancy), so the memory cost of a cache size
can be read from a browser session instead of inferred from native peak RSS.

No change to which blocks are built, cached, evicted or invalidated.

## Deterministic acceptance

`bash tools/perf/decoded-cache-equivalence.sh` still ends `CACHE-INDEPENDENT` with the
E4-T40b digest; `cargo test -p wasm-vm-core --lib decoded_cache_capacity_tests turbo`,
`--test predecode_diff --test predecode_smc_diff` pass; a core test asserts that a built
block's op storage has no spare capacity; native peak RSS at 262144 over the 2e9 run falls
against E4-T40d's 1,548.5 MB; the browser latency benchmark does not regress.

## Adversarial verification

Medium risk: acceptance plus one bounded attack (for example a 128-op block, a block that
ends at a page edge, a block rebuilt after a code-page store).

## Verification log
