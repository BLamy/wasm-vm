# E6-T12e3 independent predictions — before worker evidence

Prepared against activation `9ed66780d4e476634cbe4b5296b302ab0579feec`, with the
E2 implementation independently verified at
`43113616971d026744c377b6bbe8fb58aa7f7d20`. No E3 worker output, new shared cases,
or developing implementation was inspected to form these predictions. Baseline
source was read with `git show` at the activation commit; the task and repository
manual were read before this preparation. These predictions are untested until
the worker freezes its source and provides evidence.

## Falsifiable predictions

1. **P01 — bounded scope.** Frozen runtime changes admit TEMP indices 0–117,
   CONST indices 0–45 and 179 non-END instructions, identify profile v5, and
   preserve file-specific IN/OUT/IMM/SAMP/SVIEW/GENERIC maxima 7. Production GPU
   negotiation, command constant transport and renderer state semantics do not
   widen in this slice. The scoped diff is the check.
2. **P02 — origin inventory.** Each of the nineteen captured original byte
   bodies still hashes to its content-addressed filename and matches the E2
   parent. An independent parser of their unchanged text finds maxima TEMP
   declaration 117/direct 113; CONST declaration 45/direct 25; 8,800 bytes;
   191 nonempty lines; 80 bytes per line; 178 non-END instructions. No fixture
   replacement, qualifier removal or recapture is used to reach those maxima.
3. **P03 — original acceptance.** Running the nineteen unchanged bodies through
   the new native and Wasm bridges yields exactly the twelve E2 successes and
   seven PRECISE-bearing rejections. Each complete native result equals its
   Wasm counterpart, except no normalization of semantic data is permitted.
4. **P04 — TEMP endpoints.** Both stages admit declared and actually consumed
   TEMP[10], TEMP[99], TEMP[100], TEMP[116] and TEMP[117], with initialization
   before use. TEMP[118] rejects as either declaration, destination, source or
   range endpoint before upstream conversion. High-but-valid access is not
   merely a declaration-only acceptance.
5. **P05 — CONST endpoints.** Both stages admit declared and actually consumed
   CONST[8], CONST[9], CONST[10], CONST[44] and CONST[45]. CONST[46] rejects in
   direct accesses and either range endpoint. Declaring a tail does not falsely
   mark an undeclared hole readable.
6. **P06 — independent small banks.** Index 8 and higher remain rejected for
   every IN, OUT, IMM, SAMP, SVIEW and GENERIC occurrence (including usages and
   semantics), despite the larger TEMP storage. Legal index 7 remains usable
   under the pre-existing stage, sequential-immediate and declaration rules.
7. **P07 — numeric grammar.** Register and semantic indices are canonical
   unsigned decimal with at most three digits; zero is exactly `0`. Leading
   zeros, plus/minus signs, exponent/hex spellings, embedded whitespace between
   digits, omitted digits and fourth digits reject. Cases 00, 01, 007, 010,
   045, 099, 0117, 118, 999, 1000, 4294967295 and 4294967296 cannot alias an
   admitted register or trigger sanitizer diagnostics. Normal outer whitespace
   remains permitted.
8. **P08 — ranges and overlap.** Full-bank and singleton ranges admit within
   TEMP/CONST bounds. Descending, overlapping and duplicate declarations reject,
   including an overlap at index 117 or 45 and singleton-after-range/range-after-
   singleton orderings. Adjacent nonoverlapping ranges work in either order.
   Other register files still reject range syntax.
9. **P09 — written-lane isolation.** A write to TEMP[17] does not initialize
   TEMP[117]; a write to TEMP[117].x does not initialize its y/z/w lanes. Reads
   use the existing destination-consumed and ordered-swizzle rules at high
   addresses. Rejection happens before an instruction can retroactively mark
   its destination written. A self-read of an uninitialized high TEMP rejects.
10. **P10 — independent file storage.** A CONST[45] or IN[7] declaration does not
    declare/initialize TEMP[45]/TEMP[7]; high TEMP writes do not make undeclared
    constants, outputs or immediates readable. Sanitized independent tests that
    interleave valid high accesses and cross-file invalid accesses retain exact
    recovery outputs.
11. **P11 — instruction neighbors.** A shader with exactly 179 admitted non-END
    MOV/ADD/MUL/MAD/TEX instructions and END succeeds under the other limits;
    the equivalent 180-instruction shader rejects. The same distinction holds
    with sequential labels and without labels, in both stages and in either
    side of a pair. END does not consume the non-END budget. Misnumbered and
    overlong labels retain rejection.
12. **P12 — fixed text/line boundaries.** Text length 16,384 remains the last
    possible admitted length and 16,385 rejects before conversion. 256 nonempty
    lines and 512 bytes in a nonempty line retain their guard boundaries, with
    the first neighbor rejected. The increased register storage does not bypass
    embedded-NUL, ASCII, final-END or post-END checks.
13. **P13 — finite static resources.** The frozen build retains 8,192 token
    words, 65,536 GLSL bytes per stage, 147,456 standalone response bytes,
    295,936 pair response bytes, fixed 16 MiB Wasm memory and 256 KiB stack.
    High-bank/budget maximum-stress cases return bounded valid JSON or an
    ordinary documented error, never truncation, a trap or a partial success.
    Do not infer a dynamic execution bound from the instruction budget.
14. **P14 — true declared uniform extent.** For disjoint `DCL CONST[45]` then
    `DCL CONST[0]`, unchanged upstream conversion exposes the truthful declared
    uniform extent 47. Reversing those declarations yields 46. Both can read
    CONST[45], but neither permits CONST[46]. Shader source and metadata agree;
    the bridge must not cap metadata at 46 or rewrite either original text.
15. **P15 — active uniform distinction.** Actual linked WebGL2 reflection for
    a shader reading CONST[45] reports the active prefix through index 45
    (46 entries), even for the declared-47 ordering. A shader reading only a low
    prefix or no constant may expose a smaller/absent active uniform. Direct
    hardware upload respects reflection; this does not claim command-renderer
    transport support for the widened constants.
16. **P16 — native/Wasm exact parity.** Shared and independently constructed
    high-bank positives, negatives, declared-extent cases and budget neighbors
    have byte-for-byte equivalent structured native/Wasm results, including
    complete GLSL, metadata and errors. An accepted result has profile v5.
17. **P17 — high-address hardware dataflow.** Real ESSL300 compile/link and
    execution consumes distinct low/high TEMP and CONST values. The independently
    specified arithmetic anchor below yields its fixed vertex feedback bits
    and/or fragment RGBA bytes. Aliasing 117→17 or 45→5 changes that oracle and
    must fail. Merely inspecting emitted identifiers is insufficient.
18. **P18 — both stages and pairs.** Actual high TEMP/CONST use executes in a
    vertex stage and a fragment stage, with independently checked output. A
    paired translation can hold the two enlarged profiles simultaneously while
    preserving smooth/flat interface matching, immutable result ownership and
    sequential text/token scratch use.
19. **P19 — recovery and ownership.** After every bounded malformed/mutated or
    oversized case, a valid high-bank standalone shader and a valid high-bank
    pair exactly reproduce their earlier full outputs in the same instance.
    Results saved before later calls remain unchanged. Repeated maximum valid
    and rejected calls do not grow fixed Wasm memory or exhaust it.
20. **P20 — unsupported families stay rejected.** ADDR, indirect TEMP/CONST,
    unsupported instructions, integer/control-flow operations and PRECISE
    variants remain structured rejections, regardless of high valid indices.
    No upstream assertion or diagnostic is suppressed to admit them.
21. **P21 — sanitizer attacks.** Independently selected mutations, all relevant
    truncations, numeric/range/alias cases and recovery sequences terminate
    without ASan/UBSan errors, assertion failure, crash, hang or malformed JSON.
    Independent seed selection will be recorded before executing the attacks.
22. **P22 — evidence binding.** Every cited evidence digest recomputes from the
    saved file; executable/source/input/served Wasm hashes match the frozen
    runtime tree. The full acceptance command is recorded, exits zero and
    preserves all prior regression boundaries with explicit fixture migrations.
    No browser exception, page error or failed required network request is hidden.
23. **P23 — pristine clone.** The single final cold run starts from the frozen
    commit with a clean tree, scrubs compiler/log overrides, builds its own
    artifacts and executes the required acceptance successfully. Cold outputs
    carry independent digests and the same source/semantic result bindings.
24. **P24 — exercised diff.** Every changed executable guard/parser/metadata
    branch is covered by a source-bound recording or an independently recorded
    narrow run; each remaining type/config/documentation hunk has a reasoned
    waiver. No unsupported claim is excused as covered by an unrelated test.
25. **P25 — sabotage sensitivity.** At least one deliberate high-register alias,
    budget-bound or similar semantic mutation is detected by a new exact-output
    test, and the recorded failure points to the wrong state/pixel, not an
    incidental build/config error. The original code is unchanged afterwards.

## Independent arithmetic anchor (declared before observing output)

Use low TEMP[17] and high TEMP[117], plus unequal constants. Load TEMP[17]
from CONST[5]; load TEMP[117] from CONST[45]; multiply TEMP[117] by CONST[44];
add TEMP[117] and TEMP[17] into the observed output. Values are binary-exact:

- CONST[5] = (0.125, 0.0625, 0, 0.25)
- CONST[44] = (0.5, 0.25, 1, 0.5)
- CONST[45] = (0.25, 0.5, 0.75, 1)
- Expected output = (0.25, 0.1875, 0.75, 0.75)
- Expected float32 bit words = (0x3e800000, 0x3e400000, 0x3f400000, 0x3f400000)
- Expected normalized RGBA8 = (64, 48, 191, 191), with blending/dithering disabled.

The vertex proof may use transform feedback to avoid losing z/w precision in
rasterization. The fragment proof uses exact interior pixels with independently
specified screen geometry and clear color. The baseline pinned upstream shader
converter and driver are real; the oracle does not parse the generated GLSL to
compute its expected answer.

## Planned independent work after the frozen submission

1. Read the complete scoped diff before worker evidence. Recompute source,
   original inventory and result/evidence bindings. Record a finding only if it
   violates this task's scoped acceptance; e3b transport limits are not an e3
   defect.
2. Build an independent ASan/UBSan batch runner against the frozen actual source.
   Exercise grammar, bank limits/aliases, declaration orders, lanes, exact static
   budgets and recovery; retain full structured responses and input hashes.
3. Execute the arithmetic anchor on actual headed hardware WebGL2 for both
   stages, supplementing native/Wasm parity and high-bank paired recovery.
4. Inspect source-bound coverage; narrowly exercise any missing changed branch.
   Sabotage-check one of the new semantic oracles without editing runtime source.
5. Carry held facts forward unchanged; request only specific missing evidence.
   On complete proof, append verdict, set status, policy-check, rebuild queue and
   commit only verifier artifacts/task/queue. Until submission, HOLD.
