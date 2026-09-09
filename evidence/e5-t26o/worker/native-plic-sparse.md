# E5-T26o worker evidence — native

Command:

```text
cargo test -p wasm-vm-core --features trace --test plic_sparse -- --nocapture
```

Result: `4 passed, 0 failed` in 0.07s.

Recorded bounded stream: seed `0xe5260badcafe1234`, 12 explicit cases, 64 stream
cases, 2 contexts, 152 context-case executions. The independent old range-scan
oracle was built from each raw 156-byte snapshot and was not implemented through
the optimized selector.

The real-bus sequence recorded 27 PLIC MMIO hits. Every PLIC read/write wrapper
asserted exactly one additional hit; direct EIP queries added none. The pre-restore
claim-count array had only source 31 at 2, and the post-restore array was all zero.
The native invalid-context test caught and asserted both empty and pending direct
`eip(2)` panics.

The encoded guest route recorded 16 setup retirements, one MEI boundary with no
retirement, and 5 handler retirements: 21 records total. It asserted:

```text
trap: pc=0x80000100 mepc=0x8000003c mcause=0x800000000000000b mstatus=0x0000000a00001880 retired=16
final: pc=0x8000003c mstatus=0x0000000a00000088 x10=31 x11=31 source31_claim_count=1 pending_after_deassert_and_complete=false
live counters: mcycle=21 minstret=21
memory SHA-256: c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891
```

The canonical 21-record trace is asserted against the independent Main oracle
`evidence/e5-t26o/main-guest-oracle.json` literal.

