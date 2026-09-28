VERDICT: refuted

- **P3 unchanged public counters — FAILED.** Predicted the new page index would
  preserve the old `blocks_discarded` value after a generation flush and insertion
  on the same physical page. Reproducer: capacity64; insert block A at
  `0x80000000`; `flush()`; insert B at `0x80000002` (a different hash slot);
  `flush_page(0x80000)`. Baseline `b5308fc4` returns `(flushes, discarded)=(1,2)`;
  candidate `e92f702d` returns `(1,1)`. Both entries are invisible afterward.
  Citations: `baseline-counter.log:1`, `candidate-counter.log:1`, and the actual
  core public-API executable `public-counter/main.rs:14` / `public-counter.log`.
  The actual-core assertion fails with exit101. Repeated exact-source runs agree.
  **Demand:** preserve the task's explicitly required existing discard-counter
  behavior without restoring a capacity scan; add this stale-generation/same-page
  counter-parity case, then rerun the affected proof on the corrected runtime.

The counter difference is attributable to the changed implementation:
`crates/core/src/dispatch.rs:196` clears the new live-slot index on generation
flush, and `:216` restricts page invalidation to current-generation entries.
The baseline page flush also removed/counts old-generation slots on an active
page. That behavior was observable through the public `invalidation_stats()`
method. This is a narrow compatibility refutation, not a claim of guest register
or memory corruption. The task specifically says to preserve `blocks_discarded`
and leave the public counters unchanged, so the difference cannot be silently
waived as cleanup.

## Held predictions (carry forward where unchanged)

- **P1 no full slot walk — HELD.** `flush_page` performs `code_slots.remove`
  followed by an immediate miss return or iteration of those indices. There is no
  whole-table fallback. A deliberately missing private membership entry returns
  false and retains the corresponding slot (`candidate-attacks.log:3`).
- **P2 ordinary index operations — HELD.** Same-page replacement, target-page
  invalidation while retaining another page, reinsertion after invalidation,
  and generation clearing pass the focused attack. The worker's actual-core
  index test also passes (`core-index-test.log`).
- **P4 forged/missing indices — HELD within their stated private-state scope.**
  A forged valid slot index pointing to another page does not drop that page and
  does not inflate the live discard count. A deliberately removed map entry has
  no fallback scan. Missing membership is not a supported public operation;
  these tests interrogate the private structure directly.
- **P5 independent model and sabotage — HELD.** Three new seeds (311,912559,520205)
  at capacities1,2,8,64,16384 run 10000 operations each: 150000 insert/page-flush/
  generation-flush steps. After every operation a brute-force live-slot model
  exactly matches the map and live counts. This checks the new live-slot model;
  it intentionally does not excuse P3's historical counter difference.
  Removing the target-page guard causes the forged-other-page attack to fail
  (`sabotage-attacks.log`). Suppressing insertion into the index causes the exact
  new worker test to fail (`worker-test-sabotage.log`); its unmodified version
  passes. Sabotage is confined to verifier-owned extracted source, never the repo
  implementation.
- **Guest execution checks — HELD for the tested cases.** The eight actual-core
  `decoded_cache_capacity_tests` pass. They record hostile SMC trace hash
  `568b64d33599f3f5`, retirement/snapshot parity at4096/16384 entries, physical
  aliases, revoked PMP, pending patched instruction values7/127/1021, and reset/
  resize preservation (`core-capacity-tests.log`). These tests distinguish the
  counter-only refutation from a demonstrated architectural failure.
- **P6 browser identity/settings/negative verdict — HELD.** `browser-check.json`
  binds all47 helper hashes and67 distinct deployed resources to frozen
  `e92f702d573e8dcb4bb7b10fd06459ccc9178324`; report SHA256
  `b5922879a2e113022b4b5a67420c0e896c789a4e7750b790e76e7efcbfe79bdd` and WASM
  `3da4b21591b9e816e68361ca743ecaaffe4f0681f4cbe364feeb359c1682976b` agree with the
  receipt. Actual observations preserve cap1024/recycling/decoded16384/jalr-off/
  region-on/icount64, 1280x800, quantum500000 and300/60/120/20/30-second limits.
  Nonce `e834cbb919b48075` is in successful raw fence `mu4yrhys29`, 82.097 seconds
  after Enter, with128 trusted events and matching keyboard calls. I personally
  viewed the actual final PNG: the old empty prompt remains, with no typed command
  or returned prompt. SHA256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24` matches the
  stale baseline. `desktopAcceptance:false` is correct and T03q remains gated.

## Coverage and evidence limits

The new map field, constructor, insertion/replacement/unlink path, map misses,
target-only removal, and generation clearing are exercised by the actual-core
tests and the bounded structural/model probes. The generation-dependent count
is directly refuted by the public API. The browser option, runtime assertions,
new WASM and original physical input path execute in the recorded trial.
Imports, comments and generated binding/manifest metadata are declarative.

The structural probes extract the exact `DecodedBlock`/`BlockCache` source from
the named git revisions and use an opaque `MicroOp` stub because they never
execute instructions. Their purpose is to isolate bookkeeping. The separate
Cargo executable links the **actual** core crate and uses its real `MicroOp` and
`Instr::FenceI`, independently confirming the failure; it resides only under this
verifier evidence directory. The actual-core capacity tests supply guest-layer
semantics and trace evidence.

Stop at this semantic refutation. A final high-risk cold-clone submission has
not been established for a corrected implementation and must precede `verified`;
there is no reason to spend that final proof on this already-refuted head.
No unrelated workspace suites, deployment, or runtime fixes were performed by
the verifier. The unrelated user modifications were preserved.

**SUITE:** no runtime tests promoted while the task is refuted. Retain the
counter-parity reproducer as the worker's regression demand and the held
structural/guest/image results as incremental verification evidence.

## Reproduce

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test -p wasm-vm-core --lib decoded_cache_capacity_tests -- --nocapture
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test -p wasm-vm-core --lib block_cache_page_index_invalidates_only_indexed_live_slots
DEVELOPER_DIR=/Library/Developer/CommandLineTools CARGO_TARGET_DIR="$PWD/target" cargo run --offline --manifest-path evidence/omarchy-profile/code-page-index-verifier/public-counter/Cargo.toml
```

The last command is expected to fail `(1,1) != (1,2)` at this frozen candidate.
The baseline/candidate `.rs` files and attack/sabotage `.rs` files can be compiled
directly with `rustc --edition=2024 -A unused` (`--test` for `worker-test*.rs`);
their captured logs record the observed results.
