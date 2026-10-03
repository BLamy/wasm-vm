VERDICT: verified

# E6-T12e4c1 — independent ordered-mask verification

Fresh critic of the diff from verified `7be4e09748bc4acfcdf167bd66cd6f3d890132d5`
to frozen runtime/harness `d549500106399ada00fcd48f1439bd107377ebc5`.
Worker submission: `d21fc8a48fe9f9da1ea328ba56a427d5580e2377`.
No product or evidence finding remains. This session did not edit implementation
or worker harnesses. All 20 predictions in `predictions.md` were written before
worker evidence inspection; its SHA256 remains
`1b60d857daf075a80497f212c6c2cfddcfb69fbf157ff4ff203323a67f0f5554`.
A separate binding helper's six pre-evidence predictions also all held.

## Predictions and observed evidence

1. **HELD — exact ordered semantics.** `knowledge-binding.json` records
   1,576,064 direct comparisons against a sign/exponent/significand oracle,
   including all pairs among 40 signed boundary encodings and 262,144 random
   pairs, same-word pairs, and sign-flipped pairs. No product key transform or
   float cast is used by that oracle. `worker-semantics.json` independently
   interprets the TGSI using arbitrary-precision integers in units of 2^-149.
2. **HELD — unordered NaNs.** Both signed quiet/signaling NaNs in either operand
   yield zero. Worker sabotage `unordered-guard`, probe `fslt`, vector `nan-left`,
   byte 0 instead yields `0x3f7f8000` in lanes z/w where `0x3f000000` was expected.
   `controls-audit.json` recomputes the exact corruption and bytes.
3. **HELD — signed zero.** All four zero combinations are equal. Worker
   `signed-zero` sabotage, `fslt/zeros/byte0`, changes lane y from the expected
   `0x3f000000` to `0x3f7f8000`. Both shaders compile/link and actual capture fails.
4. **HELD — negative order.** Negative subnormal/normal/infinite boundaries and
   adjacent magnitudes retain their order. Worker `negative-order` sabotage,
   `fsge/negative-normal/byte0`, reverses the three expected y/z/w carrier values.
   `controls-audit.json` predicts every observed bit from that exact mutation.
5. **HELD — positive order/infinity.** The direct constant oracle, independently
   authored GPU data, and every recorded worker VS/FS word agree on exact
   positive boundaries and infinities, without sending private words to floats.
6. **HELD — all 32 mask bits.** Independent TGSI replay checks 768 worker words,
   384 full VS captures and 3,072 FS bitplanes. The novel probe checks 192 more
   words with four lane-specific VS byte-carrier programs, 24 dynamic vectors,
   three positions per capture, and 768 fragment bitplanes. Mask consumers
   include UADD, raw equality, UCMP, shifts, AND and OR.
7. **HELD — integer contrast.** Recorded `integer-contrast` shaders preserve
   USEQ's distinct signed zeros and equal identical NaN payloads. The independent
   novel pipeline combines ordered comparison masks with raw equality and
   preserves wrapping sums of all-ones masks; the complete word is checked.
8. **HELD — aliases/initialization.** Independent public-API cases cover both
   opcodes, both stages, every lane, supported/unsupported masks, swizzled aliases,
   initialized consumed lanes and missing initialization. Every one of 2,965
   cases has exact native/Wasm full-result equality; 5,930 post-case recovery
   conversions retain their complete results. The novel hardware probe exercises
   overlapping `FSLT TEMP[117].xy, TEMP[117].yxwz, CONST[43]` sources.
9. **HELD — known bits/output safety.** Five new seeds, 800 trials, 32 concrete
   schedules each and 51,200 instructions produce 3,493,824 known-bit assertions,
   94,240 input-origin assertions and 43,968 safe-output assertions. Both new
   opcodes retain exact constant masks and discard unsupported dynamic facts.
   True all-ones/unknown masks reject at float outputs; false masks and proven
   finite UCMP choices pass. Worker finite choices are independently interpreted
   from their actual source and uploaded operand arrays: 24 complete results.
10. **HELD — profiles/recovery.** All accepted new-opcode cases report v3. A
    separately compiled parent binary agrees on 718 complete unaffected results,
    including all 19 originals (12 accepted), so existing v1/v2/v5 output text,
    metadata and errors are retained. Malformed opcodes/operands and mutations
    recover without profile or response-buffer contamination.
11. **HELD — mixed interfaces.** 38 worker full/partial smooth/flat pair draws
    match all 37,696 non-diagonal pixels independently, including cleared exterior
    pixels. Only exact diagonal primitive ownership is excluded, as before.
    Full pair results, semantic keys and exact standalone fragment results bind
    to the checked native records; float vec4 interface declarations remain.
12. **HELD — delivered float inputs.** New private exceptional data arrives in
    actual uvec4 host uniforms, with readback evidence. IN sources retain the
    existing `floatBitsToUint` boundary; no arbitrary raw payload across that
    float interface is claimed. Novel TF positions use ordinary finite inputs.
13. **HELD — six explicit migrations.** `binding-notes.md` cites every exact old
    input/promoted input/replacement line and digest. Only two raw and four
    integer lexical slots change name/opcode; their rejection objects remain
    exact. Other 233 raw and 373 integer lexical cases and 15 older proof files
    are unchanged. Every promoted input executes in native and Wasm.
14. **HELD — bounds/recovery.** Unchanged layouts and fixed Wasm limits are
    source-bound; actual pressure covers both owned allocation errors and exact
    recovery. Independent v3 emitter-overflow cases reject with translation-error
    at `audit-native.jsonl:3625` and `:3628`, then recover in both native/Wasm.
    These replace one parent long-program instruction with FSLT and retain a
    proved final float-input origin, isolating the GLSL output cap from safety.
15. **HELD — gated features.** Independent invalid cases and complete retained
    fixtures reject numeric mixing, unsupported comparisons, PRECISE/modifiers,
    control flow and invalid/indirect banks. Production remains capsets=[] and
    all guest renderer/virgl flags false. The guest command transport is unchanged.
16. **HELD — sanitizer/Wasm parity.** 2,965 independently authored/retained cases,
    8,895 native calls and all full result objects agree with actual frozen Wasm;
    sanitizer stderr is empty. The worker's distinct native run and clean-clone
    rerun each execute 139,049 calls with four mutation seeds and no violations.
17. **HELD — changed coverage.** All 31 changed executable C lines are executed
    in frozen worker coverage. `coverage-branches.json` checks both outcomes of
    24 relevant new conditions (48 outcomes), including every ordered helper
    decision, new parser tokens, backend/profile selection and emission branches.
18. **HELD — retained gates/isolation.** Complete earlier bank/pair/component/
    captured/state/draw, constant/async, raw/integer hardware and sabotage gates
    pass. All worker/cold browser error arrays are empty; 494 worker GL objects
    are released. The novel successful probe releases all 40 objects.
19. **HELD — independent GPU sabotage.** The novel mutation changes only the
    first alias comparison's source from y to x. Both shaders compile and the
    program links; `sabotage/report.json`, `acceptance.vertex[0].vectors[0]`,
    `alias-sign-boundary`, records the first word as zero instead of all ones:
    expected carrier `0x3f7f8000`, actual `0x3f000000`. TF guard words remain
    `0xdeadc0de`. This is an actual semantic failure, not a compile-failure test.
20. **HELD — final evidence/cold binding.** The separate helper passes 34,022
    assertions, independently decoding every native input-stream byte and
    checking results, counts, sources and digests. It rehashes 118 worker records,
    126 copied cold files and 118 cold receipt records; each run binds 223 root
    sources, 3,861 nested source entries and 34 browser reports. The retained
    scrubbed clone is still clean at the frozen head. Wasm and screenshot bytes
    match worker/cold exactly. All 12 submitted worker-claim digests recompute.

## Coverage classification and scope

- C runtime: all changed executable lines run; no new runtime waiver.
- Header enum/mask additions: declarative, no separate instruction; both opcodes,
  version precedence and fixed layouts execute in native/Wasm evidence.
- Emitted GLSL strings: native emission coverage plus actual both-stage GPU
  captures and three targeted helper corruptions prove the semantic body.
- Build recipes/new gate: the exact frozen worker and scrubbed clone invoke them.
- Fixtures/proof harness: full native/Wasm records bind every literal case;
  independent interpretation, input decoding, mutation checks, browser coverage
  and source digests challenge the harness's claims rather than trusting prints.
- Documentation/contract/task metadata: non-executable, audited against the
  resulting profile, limits, explicit exclusions and disabled production flags.
- Existing guard-excluded operand default and historical generated HTML remain
  narrowly waived as previously justified; neither is changed by this diff.

This verifies private shader lowering only. No Linux/Mesa execution, live guest
acceleration, numeric float-shadow semantics, FPS or MIPS claim is made.

## Permanent proof and commands

Keep the authored native cases, exact-rational TGSI interpreter, conservative
fact harness, actual GPU alias fixtures and sabotage, branch map, and binding
checker as deterministic verifier artifacts. Keep `make verify-E6-T12e4c1` and
the worker's frozen literal fixtures/hardware proof as the recurring gate. No
transient native executables or dSYM directories are committed; their exact
binary hashes and build commands remain in the reports.

```sh
python3 evidence/virgl-float-masks/verifier/hardware_fixture.py
python3 evidence/virgl-float-masks/verifier/native_audit.py
python3 evidence/virgl-float-masks/verifier/run_knowledge.py
node evidence/virgl-float-masks/verifier/run_browser.mjs --output evidence/virgl-float-masks/verifier/hardware
node evidence/virgl-float-masks/verifier/run_browser.mjs --output evidence/virgl-float-masks/verifier/sabotage --sabotage alias # required exit 1
python3 evidence/virgl-float-masks/verifier/worker_semantics.py
python3 evidence/virgl-float-masks/verifier/hardware_details.py
python3 evidence/virgl-float-masks/verifier/controls_audit.py
python3 evidence/virgl-float-masks/verifier/coverage_branches.py
python3 evidence/virgl-float-masks/verifier/binding-audit.py --frozen d549500106399ada00fcd48f1439bd107377ebc5
```

All report and source digests are enumerated in `manifest.json`.
