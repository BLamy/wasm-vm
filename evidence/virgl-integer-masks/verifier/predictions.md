# E6-T12e4b independent critic — predictions before evidence

Written after reading task, AGENTS.md and runtime diff against verified E4a
`98314e2ddb082cf372a46ab90871b7cfdb77d587`, before opening worker run outputs.
Runtime snapshot is not yet frozen. These predictions will be bound to the final
runtime source digests before the verdict. This critic owns no product changes.

## Scope and preserved authority

The claim is the isolated, guarded TGSI compiler backend. It does not claim Mesa
closure, production virgl negotiation, guest desktop acceleration or MIPS changes.
E4a unchanged semantics/ABI holds carry forward only when source and evidence
boundaries remain unchanged; compact source storage, opcode selection, new
abstract propagation and new emitted expressions require fresh examination.

## Falsifiable predictions

1. **P01 wrap arithmetic.** At actual VS and FS reconstruction of UADD, every lane
   equals `(a+b) mod 2^32`. In particular ffffffff+1=0, 7fffffff+1=80000000,
   80000000+80000000=0, ffffffff+ffffffff=fffffffe. Dynamic independent uniforms,
   swizzles, partial writes and destination aliasing must agree with an independent
   oracle; signedness must not alter this operation.
2. **P02 signed order.** At ISGE output reconstruction, signed two's-complement
   comparison produces ffffffff for true and 0 for false. 80000000 >= 0 is false,
   7fffffff >= ffffffff is true, ffffffff >= 80000000 is true, equality is true.
   A separate signed-value oracle, not the emitter's XOR expression, checks these.
3. **P03 raw equality.** USEQ/USNE compare all 32 bits and produce exact all-ones/
   zero masks. +0 and -0 raw words differ; equal NaN words compare equal; two
   different NaN payloads differ. The proof must reconstruct every bit rather
   than compare only truthiness or a float rendering.
4. **P04 selection.** UCMP chooses src1 for *any* nonzero raw condition, otherwise
   src2. Conditions 1, 2, 80000000, ffffffff and NaN words are all true. Per-lane
   distinct conditions select independently and preserve arbitrary payload words,
   including NaN/Inf/subnormal words, inside private raw storage.
5. **P05 instruction snapshot.** All consumed lanes of all three UCMP sources are
   read from pre-instruction state before any masked destination update. Aliased
   reversed/rotated swizzles and a destination used as condition or either arm
   must match a whole-instruction snapshot oracle; unwritten lanes remain intact.
6. **P06 definite initialization.** Every consumed source lane, including an arm
   excluded by a statically constant UCMP condition, must be initialized. Missing
   consumed TEMP components reject deterministically; unconsumed components need
   not be initialized. Source3 receives the same range/modifier/declaration checks
   as source1/source2; 2-source UCMP and surplus-operand instructions reject.
7. **P07 abstract integer facts.** UADD/ISGE/USEQ/USNE with completely known operands
   produce exact known bits; unknown operands never acquire unsound bits or input
   origin. Arithmetic by zero does not preserve an unknown float-input origin.
   Independent concrete samples consistent with every abstract input must agree
   with all claimed zero/one bits after each changed opcode.
8. **P08 abstract selection facts.** Known-zero UCMP selects no; any known-one bit
   selects yes. An unknown selector intersects facts of both payloads, retaining
   input origin only when both payload origins match exactly. Different input
   registers/components may not be conflated. Concrete schedules must satisfy
   every claimed output origin and known bit.
9. **P09 float-output safety.** Direct unknown integer arithmetic, all-ones masks,
   NaN/Inf/subnormal words cannot be exposed as float outputs. Known finite normal
   or signed-zero results and unchanged matching float input origins can. UCMP
   selecting two distinct unknown float origins remains rejected. Output proof
   must reject unsafe values even in mixed-stage pairing.
10. **P10 profile selection.** Validated UADD/ISGE/USEQ/USNE/UCMP selects v2 only for
    that stage; bitwise-only selects v1; legacy-only selects v5. Tokens in comments,
    malformed instructions and unsupported suffixes do not publish successful v2
    metadata. The complete input is validated before a conversion succeeds.
11. **P11 compatibility.** Every unchanged original shader has identical acceptance,
    full JSON/GLSL/metadata or exact error object versus E4a. Exactly12 of19 original
    captured shaders remain accepted;7 PRECISE cases remain rejected. Unchanged
    v1 corpus full results remain byte identical. New expected admissions are
    explicitly migrated, not hidden by relaxing negative assertions.
12. **P12 migrated historical inputs.** The old captured UADD followed by MOV of
    the same output now succeeds as v2 because final output provenance is safe.
    The old one-operand bank UADD inputs now reject with parse-error; replacement
    UMUL negative fixtures remain unsupported. Prior unsafe-output UADD/UCMP/ISGE
    negative fixtures still reject, with no broad 'any error' weakening.
13. **P13 mixed pairing.** v5/v1/v2 stage combinations preserve standalone FS output,
    interface semantic/mask/interpolation key and checked vertex qualifiers. Actual
    mixed smooth/flat and partial GENERIC pairs compile, link and draw expected
    independently checked pixels; interface mismatches still reject.
14. **P14 bounded storage.** Compact checked sources are24bytes, raw instruction112,
    raw IR26232. Parser validation occurs before compact copying; source3 cannot
    expand register or indexing authority. All previous hard text/token/line/
    instruction/TEMP/CONST/immediate/GLSL/JSON/fixed16MiB Wasm/256KiB stack caps remain.
    Maximal179-instruction programs stay bounded; an emitted-GLSL overflow fails
    safely instead of truncating or publishing a successful shader.
15. **P15 recovery and allocation.** Failures including malformed source3, source
    overflow, shader-output overflow and IR/GLSL allocation pressure release owned
    resources and leave subsequent complete single/mixed pair conversion results
    identical. Allocation-capacity comparisons use the same module, not historical
    heap chunk constants. All retained GPU objects are released.
16. **P16 native/Wasm parity.** Independent native and built Wasm guard/conversion
    results match as complete JSON objects for fixtures and fresh attacks. Native
    sanitizer runs show no memory/UB finding. Reflection keeps float vec4 IO,
    existing constant extents and VirglBlock656/winsys_adjust_y640 behavior.
17. **P17 proof is hardware and independent.** VS transform feedback and FS32bitplanes
    reconstruct raw results using original bound source + actual uniform values.
    Expected words are independently computed, never derived from GPU/emitter
    output. Browser shows zero errors, uses actual hardware backend, and stores
    captures/complete word evidence, not only pass summaries.
18. **P18 sabotage.** A source-bound mutation changing signed ISGE to unsigned,
    a comparison true value to1, or UCMP arm selection still compiles/links and
    fails an independently expected actual hardware bit/byte. Mere text matching,
    compile failure or a self-referential expected result does not satisfy it.
19. **P19 changed-code sufficiency.** Every changed executable line is hit by recorded
    deterministic/native/browser proof, narrowly waived as unreachable through the
    public guard, or explicitly marked needs-evidence. Coverage/source digests bind
    to the final frozen implementation; comments/declarations/build wiring have
    explicit non-runtime reasoning. No ignored tests or disabled assertions hide
    a failing changed path.
20. **P20 exact-head and clean-clone.** Final worker receipts enumerate and verify
    source/build/evidence digests. A pristine clone at the frozen head with scrubbed
    compiler/environment variables runs the prescribed gate successfully; the
    resulting Wasm hash matches. Any carried prior evidence has unchanged sources
    and an explicit limited boundary. Production capability/feature bits stay off.

## Planned independent attack

Generate bounded abstract-lane states and concrete schedules using fresh seeds;
execute the five new operations with swizzles/partial masks/aliasing; verify known
bits and origin against independently computed u32/signed arithmetic. Separately
probe source3 validation/recovery and original/full-v1 parity through separately
compiled native baseline/current binaries. A new composed UCMP/ISGE/UADD alias
program will be executed on actual WebGL2 hardware and sabotaged independently.

## Verdict ledger

All predictions start **NEEDS EVIDENCE**. No worker execution output has been read
while writing this document. A separate ledger will cite each final disposition.
