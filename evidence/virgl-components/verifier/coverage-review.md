# E6-T12e1 changed-hunk coverage

Source range: `ebd18189..ae3bdf0f1d707f239b00907269f5c783fcf597e5`.
`coverage-audit.py` exports Clang source coverage from the actual independent
ASan/UBSan baseline executable. The 34,474 primary cases and 24 targeted branch
cases use only frozen runtime; the consumed-lane mutant has a separate profile
and is excluded. `coverage-census.json` binds source, binary and every merged raw
profile. Of 33 added C lines, all 24 executable lines have positive counters;
nine are type/field/function-signature/comment lines with no executable counter.
All reachable condition outcomes on changed lines execute.

| Changed hunk | Evidence and classification |
|---|---|
| `bridge.c:22–27` bank bounds and swizzle/profile fields | Type/storage configuration; compiled with assertions and ASan/UBSan. TEMP9 versus10, every CONST/TEMP range, and unchanged other-file boundaries execute. No semantic array-size waiver. |
| `:112–117` index parser limit | Limits, lower/upper nondigit, numeric continuation and per-file branches all execute. The limits remain bounded before any array access. |
| `:125–155` declaration ranges, identity/ordered selectors, masks | Both TEMP/CONST endpoints, reversed/overlapping/non-permitted ranges, operand ranges, destination/declaration mask cases, repeated/swapped four-selector sources and missing punctuation execute. Every changed condition has both reachable outcomes. |
| `:162–172` needed source lanes | Exhaustive 16 initialized subsets ×256 ordered swizzles ×7 destination masks for MOV; independent TEX xy set oracle; aliasing MOV/ADD/MUL; invalid source files/undeclared lanes. Needed-lane, initialization, declared-component, TEMP/non-TEMP and consumed/unconsumed branches execute. A separate source-mapping omission fails the expected native assertion. |
| `:217–230` GENERIC index and xyz declaration | xyz/xy/full forms, unsupported declaration masks, semantic index7/8/9, missing brackets and wrong semantics execute. One redundant parser-invariant condition is classified below. |
| `:246–259` opcode and partial-write gate | MOV/ADD/MUL all masks, unmasked full forms, TEX-only xy consumption and rejected partial MAD/TEX execute. Missing comma and invalid consumed source paths execute. Same-instruction alias tests ensure writes cannot initialize their own preceding reads. |
| `:287` IMM bank limit | IMM7 sequential success, index8/9/10, holes, declarations after instructions and missing bracket branches execute. |
| `:391` metadata profile | Both actual vertex and fragment success execute; every independent selected native/Wasm result is compared exactly, including v3 and binding metadata. |
| `index.mjs` new `temporaryRegisterIndex` | Actual browser assertion checks 9 alongside unchanged limits; all translation paths preserve existing wrapper behavior. |

The sole zero condition outcome is `bridge.c:230:58–69`, `r.mask != 7` being true
when both `semantic == 2` and `r.mask != 3` already hold. `register_name` accepts
only unmasked declarations (15), `.xy` (3) and `.xyz` (7). Full masks bypass this
expression; xy bypasses its last term; therefore the last comparison can only
see 7. This is a redundant private parser-invariant backstop, not an unimplemented
accepted declaration mode or unproven guest input path. The rejected xyz forms
for non-GENERIC semantics do execute. Waive this impossible outcome narrowly;
no acceptance behavior is waived and no unused semantic fallback is introduced.

Other changed hunks are covered as follows:

- `build.sh`, Makefile and shell gate: recorded complete worker/cold commands
  execute guard-check, native sanitizer, Wasm build, old gates, component browser,
  intended failed sabotage and receipt. The exact compiler, native artifacts and
  served Wasm hashes are checked by the independent binding audit.
- Native `components.c`, Python fixture runner, component fixture: worker and
  cold both execute 249 cases, truncations, four mutation seeds and exact original
  recovery. Literal admitted forms replace historical negatives only where the
  profile intentionally changed. The independent generator additionally attacks
  the same boundary without importing these tests or their expected outcomes.
- The old native/captured/browser profile assertions change v2→v3 and execute in
  the nested nine-draw and three-phase regressions. Historical negative fixture
  changes retain adjacent invalid syntax; no disabled assertion/test is used.
- New browser harness: actual compile/link/reflection/constants, fragment pixels,
  geometric/depth pixels and cleanup execute in both worker and cold. The
  independent binding audit derives its expected pixels from raw TGSI and literal
  constants. Its z-only-swizzle sensitivity limitation is resolved by the main
  verifier's exact hardware clip-vector proof and targeted generated-source
  sabotage; the limitation is not hidden or waived.
- Receipt and cold launcher: actual final clean clone and direct read-only hash,
  native/Wasm parity, independent rational pixel reconstruction and source checks
  execute. Failure/report-writing defensive tooling branches are configuration/
  diagnostics, not newly admitted shader semantics. Bound error arrays are empty.
- Contract checker changes execute in the final five negative unit tests and
  normal contract receipt, including all 19 execution-scope substitutions. JSON,
  README and decision-document changes declare exactly the verified boundary.
  Upstream, Rust and default web runtime are unchanged; prior results carry forward.

Two verifier-harness refinements were made before the final coverage export:
missing-bracket cases needed whitespace after a token to reach punctuation rather
than the earlier token-boundary reject, and the partial POSITION case needed the
vertex stage. They were rerun, never represented as runtime findings, and their
old profiles are isolated under ignored `target/.../calibration`. Final coverage
merges only the primary run and corrected supplement. No product change or
worker re-recording was needed.
