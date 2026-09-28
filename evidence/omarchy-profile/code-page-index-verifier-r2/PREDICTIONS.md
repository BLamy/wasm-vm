# BA incremental verifier predictions

Written after reading the correction diff and updated task, before running the
corrected core or reading its browser evidence. Carry prior HELD results only
where the code and evidence boundary are unchanged.

1. The original actual-core public parity probe now returns `(1,2)`.
2. Counter parity must also hold over multiple generation flushes and reuse of
   slots already counted by a prior page flush. A per-page stale count must not
   be decremented for a historical slot whose count was already consumed.
3. Differential public-API operation sequences against the original baseline
   must keep `(flushes, blocks_discarded)` equal after every operation, including
   live replacement on previously active pages. Cache hit availability itself
   is not architectural truth; a miss can legally rebuild.
4. Missing-page map miss and target-page-only invalidation remain bounded;
   forged valid indices must retain other-page blocks. Same-page replacement,
   reinsertion and current-generation index membership still hold.
5. The corrected browser receipt must bind the new source/WASM/settings and
   preserve the failed 120-second nonce deadline and negative image honestly.
   No frame count or later readback is a responsive-desktop pass.

Source inspected: correction `0a5970cc..0e3c0641`, task submission `a17619d3`, and
the prior independent refutation. No corrected runtime state inspected yet.
