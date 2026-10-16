# E6-T12e4c2 independent adversarial predictions

Written before inspecting worker recordings. Baseline 59f1b924286af70096d9fb19fbdb35b9ec2ed7a1. Scope ordinary numeric chains and float authority in validated owned v4 stages; production remains disabled. Pending predictions are not verdicts.

1. P01 — Numeric ADD/MUL/MAD and fragment 2D FLOAT TEX select v4 only when a validated raw stage exists. Earlier no-numeric stages keep complete prior results, all 19 originals remain 12 accepted/7 rejected, and malformed numeric tokens do not escape full grammar validation.
2. P02 — Every numeric source lane has authority at its own instruction: original input, previously computed/copied float shadow, or a sound finite-normal/signed-zero raw proof. Later writes cannot retroactively authorize an earlier unsafe numeric read.
3. P03 — Unknown raw CONST, subnormal/Inf/NaN immediate words and unsafe dynamically masked words are rejected as numeric sources. Safe normal/zero masks with arbitrary signs decode their actual words, including negative normal values.
4. P04 — Raw integer writes invalidate float authority on exactly their written lanes; untouched lanes retain it. A stale float shadow cannot authorize a subsequent numeric use or final output after unsafe raw replacement.
5. P05 — MOV and UCMP aliasing reads every RHS before publishing any destination lane. Cross-lane partial writes produce the independently calculated dyadic values and captured bits.
6. P06 — Known UCMP selectors may choose an authorized arm with an initialized arbitrary raw unselected arm. Unknown selectors require both arms to authorize later numeric/output use; neither one authorized arm nor coincident observed runtime selection suffices. All consumed arms remain initialization-checked.
7. P07 — Wider unknown-selector UCMP joins between different original/computed float origins work even before the first numeric opcode of a valid mixed stage, while old v1/v2/v3 joins keep exact earlier acceptance/errors.
8. P08 — Instruction-time float modes remain correct after their source registers subsequently change; emitted source modes cannot be derived from final register state.
9. P09 — Exact small dyadic numeric chains execute on actual hardware with the same lane observable through numeric and captured raw consumers. Independent sign, exponent and mantissa expectations agree; no non-exact MAD outcome is constrained to only fused/separate binary32.
10. P10 — TEX samples once per instruction, with consumed x/y coordinates, declared matching fragment samplers 0..7, truthful count/name metadata and independent texture inputs. Vertex TEX, wrong views, absent samplers and partial TEX destinations reject.
11. P11 — V4 pairs preserve exact interface semantics/masks, smooth/flat qualifiers and standalone fragment outputs across legacy/v1/v2/v3 peers. Padding and screen orientation remain unaffected.
12. P12 — Raw comparison results retain full-word masks and all-encoding ordered rules when mixed with numeric authority; numeric shadows are never used as a shortcut for integer consumers.
13. P13 — Checked instruction size remains 112 bytes, owned IR 26232 bytes, lane 12 bytes, fixed Wasm 16 MiB; instruction/text/register/output limits, hostile/OOM failure and recovery remain bounded and deterministic.
14. P14 — Every executable changed path is exercised by source-bound frozen evidence or a narrow justified waiver. Relevant use-site modes and branch outcomes must not be inferred from aggregate success alone.
15. P15 — Worker receipts bind actual source, build, original fixtures, native/Wasm results, GPU inputs/outputs, objects and screenshots; a final pristine clone passes with scrubbed build environment at the frozen head.
16. P16 — Independent sabotage of a shadow copy or ordinary numeric interpretation causes a real GPU mismatch under an oracle computed without the emitter. Successful compilation alone cannot pass it.
17. P17 — An independent bounded varied-seed fact audit agrees with concrete lane values/authority and instruction snapshots under aliases, selection, partial writes and later raw invalidation; failed numeric admission publishes no facts/instruction.
18. P18 — Production negotiation remains off, the documentation states the unresolved unknown raw numeric constant boundary, and no live Mesa or performance claim is inferred.

Evidence will cite concrete JSON paths, trace/test state points and source-bound digests. Held prior results are carried forward when their boundaries and evidence remain unchanged.
