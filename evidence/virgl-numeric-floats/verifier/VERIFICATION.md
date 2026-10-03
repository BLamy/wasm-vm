VERDICT: verified

Fresh adversarial review of E6-T12e4c2. Predictions were written before inspecting
worker recordings in `predictions.md` (SHA-256
`1c242d1e8f1fd3f361a15a318d4e92c01fcf8ab751e6532cd5f7ef4a33faf277`).
Baseline: `59f1b924286af70096d9fb19fbdb35b9ec2ed7a1`.
Frozen implementation and proof harness: `1ce9b75b182b5411aee9922f329dc898e2a28b4e`.
Worker submission: `752b4f677b7c3266080d5924cca780d9bde81468`.
The verifier did not edit implementation or worker harnesses.

Every prediction held:

- **P01 HELD — validated profile selection and exact compatibility.** The independent
  sanitizer driver checked 2,024 programs with 4,048 exact recovery conversions.
  All 1,178 parent complete-result comparisons held, including all 19 original
  programs and their 12 accepted/7 rejected outcomes. Frozen worker bindings also
  preserve all 1,159 earlier standalone cases and 92 pairs byte-for-byte.
  Evidence: `native-report.json`, `audit-native.jsonl`, `audit-parent.jsonl`, and
  `binding-audit.json#/worker/native/retained`.
- **P02 HELD — instruction-time authority.** Future writes did not authorize earlier
  numeric reads (`audit-native.jsonl:109`, unsupported-feature). The independent
  fact audit checked 889,320 recorded per-source lane modes against pre-instruction
  state; all 18,050 rejected numeric instructions left the entire IR unchanged.
  Evidence: `knowledge-report.json:1`, `knowledge_attack.c`, `native-citations.json`.
- **P03 HELD — enforced raw numeric domain.** Unknown constants, subnormals and
  exceptional words reject. Negative zero admits at `audit-native.jsonl:502`;
  negative subnormal rejects at line 508. The independent exponent-enumeration
  predicate and 718,784 concrete decode checks held. Actual GPU negative numeric
  operands and the negative raw immediate in the novel MAD chain also held.
  Evidence: `knowledge-report.json:1`, `hardware/report.json#/acceptance/vertex`.
- **P04 HELD — partial invalidation.** Raw replacement invalidates exactly the
  overwritten lane: rejected use at `audit-native.jsonl:823`, admitted unaffected
  lane at line 826. The worker invalidation probe and varied-seed state model
  confirm stale float data cannot authorize raw replacements.
- **P05 HELD — aliases and parallel publication.** Novel partial cross-lane MOV,
  UCMP and MAD chains reproduced all expected words on hardware. The first
  vertex vector records both the final numeric value and four raw byte carriers;
  all 16 output words, including the outside-write guard, match.
  Evidence: `hardware/report.json#/acceptance/vertex/0/vectors/0`, then all four
  lane probes; `worker-semantics.json` independently interprets worker TGSI.
- **P06 HELD — selected arms and initialization.** A statically selected shadow
  survives an initialized arbitrary raw unselected arm at `audit-native.jsonl:787`;
  the unknown-selector equivalent rejects at line 808. An uninitialized
  unselected arm rejects at line 829. Independent GPU selector values include
  zero, one, two, high-bit-only and all ones.
- **P07 HELD — mixed-only origin joins.** A wider UCMP before a later numeric
  instruction admits as v4 at `audit-native.jsonl:820`; retained no-numeric
  v1/v2/v3 results, including their rejected origin joins, remain exact.
- **P08 HELD — captured modes survive later state changes.** Native instruction-time
  cases, the independent state audit and the worker MOV snapshot hardware probe
  held. The novel GPU program overwrites an earlier source after copying/selecting
  it; the recorded final numeric/raw observations still match the prior value.
- **P09 HELD — actual arithmetic and both representations.** An independent rational
  TGSI interpreter reproduced 9,152 output-word assertions across 1,856 worker
  captures/draws, without importing either authored oracle. The worker reconstructs
  352 complete numeric/texture words, including 144 vertex captures and 1,664
  fragment bitplanes; 48 additional draws jointly consume raw and numeric views.
  The verifier's separate program reconstructs 512 distinct numeric/raw words.
  Evidence: `worker-semantics.json`, `worker_semantics.py`, `hardware/report.json`.
  These are exact dyadic witnesses, not a claim about one rounding mode for
  non-exact MAD or exceptional numeric payloads.
- **P10 HELD — texture semantics and metadata.** All eight declared sampler slots
  are tested natively; sampler 7 admits at `audit-native.jsonl:988`, vertex TEX
  rejects at line 991. Independent hardware samples distinct textures at samplers
  0 and 7 and reconstructs both raw and subsequently computed values. The worker
  binds sampler identifiers to separate actual units, records texture upload
  readback, and executes all 4,096 full-frame pixels. Each checked TEX emits one
  logical `texture` expression; no physical-fetch-count claim is made.
- **P11 HELD — interfaces, masks and orientation.** All 26 mixed interface draws
  preserve the recorded derived keys and standalone fragment results. Independent
  barycentric/flat calculations match all 25,792 nonedge pixels. Both system-UBO
  orientation signs remain covered in worker and cold recordings.
- **P12 HELD — exact integer/comparison observations.** Full earlier raw, wrapping
  integer and ordered comparison GPU gates pass unchanged. The v4 joint-consumer
  draws independently compare captured words before numeric consumption. No
  ordinary-float shadow is substituted for raw integer payloads.
- **P13 HELD — bounds and recovery.** Layout assertions retain 112-byte instructions,
  26,232-byte IR and 12-byte lane facts. Fixed 16-MiB Wasm memory identity and
  allocation-pressure recovery hold. Frozen native evidence records 219,699
  calls, 5,626 truncations, 324 hostile inputs, 4,096 mutations, 115,550 standalone
  and 92,440 pair recoveries; exact byte-stream and transcript accounting was
  independently checked in `binding-audit.json`.
- **P14 HELD — changed executable coverage.** All 155 changed executable C lines
  ran. All 111 conditional regions beginning on changed lines record both
  outcomes (222 outcomes). `coverage-audit.json` enumerates lines and counters,
  bound to the frozen native LLVM records. There is no new runtime waiver.
- **P15 HELD — source, recording and cold binding.** `binding-audit.json` checks
  40,028 assertions across worker and cold evidence, including 9,522 nested source
  bindings, 142 receipt artifacts per run and all 151 copied cold files. The
  retained clone is clean before/after and still clean at review. Both runs use
  the frozen head and identical Wasm digest
  `eefc0899be746bdbb246285e9c8bfe8c802d29e0480bf052be9790c78631c02d`.
  All twelve worker-claim evidence digests match. The cold scrub/isolation
  algorithm is identical to the verified predecessor except task/artifact names
  (`cold-control.json`). Earlier verifier attacks remain valid at the frozen head
  because implementation and Wasm digests are unchanged (`freeze-carry.json`).
- **P16 HELD — adversarial controls fail semantically.** All three worker mutations
  compile/link and cause independently reproduced GPU contradictions:
  unswizzled shadow publication, numeric integer conversion instead of bit decode,
  and exchanged sampler identifiers. The verifier's novel shadow-copy mutation
  changes first-vector numeric x from expected `0x3f400000` to `0x3e400000`, with
  raw-carrier mismatches and an intact outside-write guard. Evidence:
  `controls-audit.json` identifies exact probes/vectors/selectors and binds all
  four reports. This is an actual hardware failure, not a compilation failure.
- **P17 HELD — varied independent state attack.** Five independent seeds drive 960
  generated programs with sixteen concrete schedules each: 74,110 accepted
  instructions, 23,715,200 concrete fact checks, 3,051,568 origin/shadow checks and
  15,248 aliases. Every opcode is exercised. `knowledge-report.json:1` and the
  source-bound `knowledge-binding.json` preserve the exact assertions and runner.
- **P18 HELD — scope remains explicit.** Production negotiation is unchanged and
  disabled. Contract/README/task notes explicitly reject unknown raw numeric
  constants and preserve the unresolved seven original bodies. No guest Mesa,
  PRECISE, NaN-payload, signed-zero/subnormal preservation after computation,
  display responsiveness, FPS or MIPS claim follows from this task.

Coverage and artifact disposition:

- Runtime C is covered by the recorded counters, independent fact audit and
  actual two-stage GPU observations; headers/layout declarations are compiled
  and statically asserted. Comment/syntax/continued-expression lines are marked
  nonexecutable in `coverage-audit.json`, not treated as missing runtime proof.
- Owned GLSL emission is exercised in native/Wasm parity and actual hardware;
  numeric/captured-word paths, partial aliases, selection and sampler use are
  independently attacked. Unchanged historical failure branches keep their
  earlier evidence and waivers; no unrelated requirement is added here.
- All authored cases execute through native and Wasm; positive/negative workload,
  original bodies, streams and full outputs are independently bound. Gate,
  receipt, recording and cold scripts execute at the frozen head. Declarative
  documentation, task metadata, fixture lists and layout declarations require
  direct inspection/source binding rather than runtime instruction counters.
- **SUITE:** retain the committed worker acceptance plus verifier drivers,
  independent state attack, exact-rational TGSI interpreter, binary-stream/source
  audit and novel GPU/sabotage fixtures as reproducible permanent evidence.
  Native executables and platform debug-symbol bundles are rebuildable local
  outputs, not promoted artifacts. No product repair or evidence demand remains.

Commands:

```sh
python3 evidence/virgl-numeric-floats/verifier/native_audit.py
python3 evidence/virgl-numeric-floats/verifier/run_knowledge.py
node evidence/virgl-numeric-floats/verifier/run_browser.mjs --output evidence/virgl-numeric-floats/verifier/hardware
node evidence/virgl-numeric-floats/verifier/run_browser.mjs --output evidence/virgl-numeric-floats/verifier/sabotage --sabotage alias # expected failure
python3 evidence/virgl-numeric-floats/verifier/coverage_audit.py
python3 evidence/virgl-numeric-floats/verifier/worker_semantics.py
python3 evidence/virgl-numeric-floats/verifier/controls_audit.py
python3 evidence/virgl-numeric-floats/verifier/binding-audit.py --frozen 1ce9b75b182b5411aee9922f329dc898e2a28b4e
```

Both worker and independent hardware screenshots were visually inspected. Clean
runs have zero console/page/request errors. The independent clean GPU probe
released all 434 created GL objects; the worker released all 1,118. Generated
coverage transcript blank lines are preserved byte-for-byte as recorded data.
