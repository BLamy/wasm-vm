# Frozen native and compatibility evidence audit

Head:72a8695ba92d734a6bead0c42ead3089d8611806. No final task verdict yet.

P7 HELD: `check-compatibility.py` independently reconstructed the entire1,195,201-byte
VGC5 stream from the verified E5 Git baseline with only the two literal DP3-to-absolute
negative substitutions. All2,083 complete case results,162pairs,19originals,12/10anchors,
four seeds, unchanged layout and exact statistics match. Eleven independent mutations
were rejected, including rehashed stream/log mutations and a fabricated predecessor
full-gate claim. The exact-head compatibility API also passed. See
`compatibility-audit.json`; digest in `frozen-native-bindings.json`.

P8 native HELD: `audit-native-recording.py` checked the full frozen native recording,
then reran LLVM export/show against its actual binary/profile and compared both output
files byte for byte. All46 executable added runtime lines are exercised; six blank,
comment or declaration lines are waived. All40 branches intersecting the added runtime
lines have nonzero true and false counts. Each changed line/branch and every waiver is
listed in `native-recording-audit.json`. A separately built public API also reproduced
all616 new shared/hardware case serialized outputs exactly. Whole recording totals:
2,699cases,203pairs,435,179calls,8,990truncations,324hostile cases and4,096mutations.

P11/P12 mathematical portion HELD:22 independently reconstructed RCP/RSQ enclosures
cover all authored reciprocal and sampled inputs. Separate224-bit isqrt brackets agree
with the worker's192-bit brackets; ULP radii, exact source values and nearest outward
endpoint rounding hold. See `frozen-math-audit.json`.

Runtime/independent-GPU findings from `interim-review.md` carry forward with unchanged
source/evidence digests. Frozen complete browser/regression receipt and pristine clone
remain to audit before any verdict or status change.
