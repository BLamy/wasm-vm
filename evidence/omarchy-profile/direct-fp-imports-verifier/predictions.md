# E5.5-T03ao fresh critic — predictions before worker evidence

2026-09-16. Read AGENTS.md, the full active task, an empty task runtime diff,
and baseline helper/executor/test source. No worker result or profile has been
opened. `source-before.json` pins the source boundary at this point.

## Falsifiable predictions

- **P1 — scope.** Relative to activation 72fc438a, the core numerical helpers,
  software floating point, translator and native runtime remain byte-identical.
  Browser changes are five pure raw scalar exports and their import binding;
  contextual memory/atomic closures, handoff and scheduling retain their behavior.
- **P2 — actual identity and type.** At every captured generated-module
  instantiation, all five `env.fp_*` values are `===` the corresponding
  `wasm_bindgen::exports().__jit_fp_*` raw functions. Correct scalar signatures
  link; changing any one parameter or the result between i32 and i64 raises
  `WebAssembly.LinkError`. This must hold for private and shared modules.
- **P3 — outputs and all integer bits.** Calling those captured functions with
  no active guest yields literal expected packed results. In particular,
  `(2^32+1)` signed 64-bit to single RNE is `0x000000014f800000`, and
  `(2^63+1)` unsigned to single RUP is `0x000000015f000001`.
  FMA `(0x3f800001,0x3f7ffffe,0xbf800000,RNE)` is `0xa8800000`
  with no flags; separate multiply/add would incorrectly produce zero.
- **P4 — execution and ownership.** Mixed generated blocks execute all five
  helpers with exact guest registers/flags in two simultaneously live executors,
  then still work after the other executor is dropped, after own invalidation
  and reinstallation, and after real main-memory growth. Captured functions
  remain callable after every originating executor is dropped, without state
  from an earlier guest. Actual compiled execution counters must advance.
- **P5 — carried numerical boundary.** Frozen candidate executes all existing
  independent FP verifier fixtures on private/shared WASM without ignored tests
  or changed expected values. Their unchanged code/evidence digests support
  carry-forward of AN native/translator results; no new claim hides behind
  untested fallback, malformed boxes, FS/rm guards, faults or module chains.
- **P6 — benchmark.** Both baseline and candidate execute the same full mixed
  guest with positive compiled retirements and every helper reached. Five
  alternating matched timed pairs follow warmup. All architectural digests
  match and the candidate median is lower. Raw times and state let me
  independently recompute the result; this does not establish desktop latency.
- **P7 — final artifacts.** The final source, built page and publicly served
  files match their recorded digests. A final pristine clone with scrubbed
  environment rebuilds the same WASM and passes scoped acceptance; the built
  page reports all 127 ISA tests and zero relevant browser errors.
- **P8 — physical outcome.** The one candidate trial uses the exact AJ R2
  snapshot/overlay, cap 256 with recycling ON and unchanged deadlines. Its
  independent nonce read and inspected fresh screenshot either both establish
  typed-command/returned-prompt success by Enter+120s, or its negative result
  is preserved and T03q remains gated. Trusted input counts, deadline arithmetic,
  raw agent reads and cleanup must agree with the reported outcome.
- **P9 — novel attack and sabotage.** The strict signature test rejects a JS
  trampoline even if it computes the same scalar answer. An isolated deliberate
  import-identity substitution must fail the identity assertion, and restoration
  must pass; production source must not be altered for sabotage.

Each prediction remains NEEDS EVIDENCE until its independently cited check.
