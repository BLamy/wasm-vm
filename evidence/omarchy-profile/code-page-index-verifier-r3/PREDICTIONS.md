# BA R3 incremental predictions

Written after reading the `4099596d..ff39120a` correction and before executing its
tests or reading the R3 browser state. Prior held facts carry only where unchanged.

1. Both actual-core counter repros now pass: `(1,2)` and the nine-operation `(2,4)`.
2. Original-baseline versus corrected-candidate public counters and page-membership
   booleans remain equal over deterministic insert/page-flush/generation-flush
   sequences, including the previously failing seed24301/capacity8 sequence.
3. The index exactly owns physical slots (including old-generation slots), without
   duplicates or another page's slots. Its page-generation gate controls active
   membership. Same-page replacement, reinsertion, stale generation, and evicted
   empty current-generation membership preserve baseline behavior.
4. A forged valid index cannot discard another page; a forged out-of-range index
   cannot crash or count a block; a missing map entry performs no full-slot scan.
   These are bounded private-state attacks, not supported public corruption inputs.
5. The current worker regression detects removal of retained stale ownership; the
   independent forged-index attack detects removal of the target-page predicate.
6. Actual guest-trace/capacity cases stay equal and the final high-risk clean-clone
   acceptance passes at the corrected source with scrubbed environment.
7. The exact R3 WASM/runtime/pair identity, unchanged original timing/geometry and
   independent physical nonce remain bound to the raw receipt. The real image is
   reviewed separately; no machine-only result or frame count unlocks T03q.
