# Benchmark state predictions before opening any benchmark result

Read the raw construction in `omarchy-direct-fp-fixture.mjs` and the proposed
paired runner, not its output. For 50,000 iterations:

- The ten-instruction loop executes 500,000 guest instructions. Its numerical
  results are exact: 1.5×0.5+0.25 = 1; 2×4+0 = 8; 3×0.125+0 = 0.375;
  float 4 converts to integer 4 and back; 4+4 = 8; 4/4 = 1; 1×0+1 = 1.
  Thus x10 = 4, x13..x19 contain boxed single bit patterns
  `3f800000,41000000,3ec00000,40800000,41000000,3f800000,3f800000`.
- x5 = 0x80002000, x6 = 0, x20 = 0 (no new FP flags), x21 = 2;
  x22 has FS Dirty and SD set. After exactly 500,065 retirements, PC is the
  final self-jump at 0x800000ac. RAM's seven 64-bit spills match x13..x19.
- Each of arith/from-int/to-word/div has 50,000 dynamic instruction occurrences;
  fmadd has 200,000. The loop is finite and the final spin is only 32 instructions.
  Therefore, for every helper family, `occurrences - (retired - retiredViaJit)`
  is a valid conservative lower bound on compiled executions. Requiring 99%
  compiled retirements makes every bound positive; it cannot be explained by
  compiling only the final spin or excluding a full helper family.
- Actual imports from the separately tested executor and unchanged translator
  bind those compiled instructions to the five claimed helpers. Reported
  `expectedHelperCalls` are static dynamic-count derivations, not sampled or
  instrumented call counts. The audit must preserve that distinction.
- Warmups must precede ten timed runs in five pairs; order alternates BC, CB,
  BC, CB, BC. Recompute both medians from all five retained times. Every run
  has the same independently predicted register/RAM values and state digest.

This bounded finite arithmetic workload measures the import boundary. It does
not establish keyboard latency or desktop responsiveness.
