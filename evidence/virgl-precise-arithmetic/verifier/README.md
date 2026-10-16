# Fresh E6-T12f5 verifier evidence

The verifier did not implement or repair production code. Predictions preceded evidence inspection in `predictions.md`. The worker submitted source 7e444f2e3523b5b46b4aedbff3ace0c409ff6a83; the allocation-count prose was corrected separately at 187b432e204f3230545235cc1ea4b4ccf5dd6b56. The runtime recording and all HELD outcomes stayed unchanged.

`manifest.json` and `records.json` bind the complete supplemental recording in `recording.tar.gz` (290 files). Every member was streamed back and checked by size/SHA-256, and originals were rechecked. It includes predictions, independent quotient-rounding oracle and input generator, actual GPU shader/packet/uniform/pixel recordings and screenshots, native executable/profiles/source/tool bindings, consumer V8 counters, real authority-fault compiler source/build, and regression sensitivity. Extract with:

```sh
mkdir -p /tmp/precise-arithmetic-verifier
tar -xzf evidence/virgl-precise-arithmetic/verifier/recording.tar.gz -C /tmp/precise-arithmetic-verifier
```

The independently written Python reference chooses a binary32 quantum by rational bit length and rounds exact integer quotient/remainder ties to even. It does not use the GPU alignment/jam/limb algorithm or the worker's adjacent-value search. It checked 13,896 final reference words and all 35,280 final physical words / 1,134,720 pixels across the three worker schedules. The contraction witness separately rounds to 0 and rounds once to 0xa8800000.

Fresh hardware evidence uses seed 0xd6316ac7, 165 additional limb/cancellation/underflow/gap vectors, and supplementary exceptional/compound-condition cases. `novel-gpu/report.json` records 26,448 exact words / 846,336 pixels; `condition-gpu/report.json` records another 13,368 / 427,776. Both use the actual unchanged compiler/shared renderer on Apple M4 Max Metal, with zero browser errors and all 39 helper markers in each stage. The observer-only counter runs remain separate from unmodified compiler exact-word draws. `evidence-points.json` cites marker/fault positions and source/digests; `coverage.md` classifies the diff and bounds the few unreachable helper edges.

The main recording did not take the asymmetric right-operand denial condition. Fourteen additional actual native/Wasm calls, including a safe left operand and private right operand, preserve exact results and cover both sides at raw_bits.c:255: left true/false 48/48; right 16/32. `native-authority-report.json` binds the exact TGSI/stdout/profiles, binary, compiler and source/tool identities. No full million-call rerun was needed.

The promoted test is `renderer/virgl-command/tests/precise-arithmetic-verifier-regressions.mjs`. It rejects private-word and zero-shortcut output authority, derived private-bank raster lanes, erased v28/v27 obligations, and getters, while preserving the certified mixed xy/zw mask. The real isolated source fault replacing the arithmetic authority predicate with `true` makes its first assertion fail (`private output/vertex`: actual true, expected false). A separate one-bit oracle sabotage fails at physical pixel (0,0), showing that the GPU harness consumes its independent expectations.

The final worker and cold archives were independently streamed: 1,096 / 1,098 members matched every inventory digest. The exact clone's unmodified receipt assertions were replayed; only the final output write was diverted into the fresh verifier directory. The recreated receipt bytes equal submitted receipt SHA-256 43485e0d1874ba1ba225eac7ec840672d4104cd79e68b24fdae64ad12e2f848f. The pristine clone and all 1,096 final acceptance file digests were checked again. Allocation counts are 260 total = 240 owned + 20 upstream.

This verifies private binary32 shader arithmetic and the retained ordinary numeric/raster authority boundary. It does not verify guest GPU negotiation, the full 19-original hardware closure, desktop responsiveness, MIPS/FPS or deployment.
