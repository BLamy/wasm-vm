# E6-T12e9 verifier predictions, before evidence
- P1: Each accepted graph executes at most max(1,signed count) <=18 headers for every allowed count word. For every possible early break j, header uses j+10; true tail uses j+9, j+28, j+27, with union10..45.
- P2: Changed role aliases, recurrence immediates, count lane/source, comparison guard, missing/extra exits, nesting, before-break indirect use, or body-carried undefined reads reject. Equivalent TEMP/IMM/lane renaming may admit.
- P3: Profile v12 requires exactly one finite domain/access/count contract naming the same stage/bank/extent46or47, count register9/component0/max18. Old profiles reject the new constraint.
- P4: Raw count18 and finite signed-negative/zero words may admit;19 and positive larger counts reject. NaN/Inf words fail finite policy even when signed-negative. Booleans, fractional numbers, missing/accessor words reject without GPU work.
- P5: Sync and async preparation validates owned immutable bank words; bank replacement during yield invalidates pending draw. Failed count cannot restore prior approved words or synthesize zeros.
- P6: Original captures stay12/19, both loop captures retain PRECISE rejection; native/Wasm accepted/rejected result shapes match unchanged predecessor semantics.
- P7: Recorded accepted hardware outputs equal independent literal TGSI word/pixel oracle at early/interior/final/count boundaries. Changed early-comparison GPU fault fails but remains bounded.
- P8: Deliberately disabled count admission/structural proof fails deterministic tests. Receipt numeric counters reject boolean/fractional substitutions even if JSON compares numerically equal in Python.
- P9: Frozen-source digests and pristine clone receipt identify same runtime/harness source; coverage executes each changed runtime hunk or has specific nonsemantic waiver.
