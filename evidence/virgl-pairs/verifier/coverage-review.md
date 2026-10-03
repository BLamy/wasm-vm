# E2 changed-source coverage review

Boundary: `cffb8d57..8b7106488b84c256cae7f4eae87eee16a4f09eee`.
No implementation edits. `coverage-audit.py` binds bridge.c to the frozen Git blob,
merges only baseline/defensive profiles (never the mutated bridge), and exports
LLVM source regions and branch counters. `js-coverage.py` binds the same frozen
state.mjs/index.mjs to worker and independent CDP precise coverage. It checks the
most specific enclosing range, not the enclosing module's load count.

## Runtime hunks

| Source/change | Execution and disposition |
|---|---|
| bridge.c:30,36-39 and bridge.h | Profile field, bounded response arrays/pointer and type/API declarations: non-executable structure. Native and fixed-memory Wasm use the new pair entry point and both response capacities. |
| bridge.c:66-72 | Actual formatter writes execute millions of times; defensive.c forces a too-small capacity and observes overflow, then restores both capacities. Negative vsnprintf return is waived: trusted host formatter diagnostic, fixed valid format strings, no guest format string. |
| bridge.c:215,231-246 | Both smooth and CONSTANT declaration branches, malformed words/separators, duplicate declarations and stage errors execute in native permutation/mutation records. All native outcome predictions hold. |
| bridge.c:350 | Flat/smooth metadata conditional executes for vertex/fragment, and non-GENERIC metadata takes neither field. Native/Wasm outputs match. |
| bridge.c:359-394 | Struct/comments/signatures are structural. All three cleanup operations, response switching, length/ASCII rejection, guard rejection and success run. ASan/UBSan calls alternate 2,729 pair/single recovery sequences; NULL and SIZE_MAX inputs reject. |
| bridge.c:397-415 | Real stage conversion and both null/non-null fragment keys execute. Upstream parse rejection is reached. Successful upstream conversion, shader string traversal and cleanup execute. The false allocator return and failed/logged/overlong upstream-output returns are narrowly waived trusted implementation/OOM diagnostics: accepted bounded guest text cannot select them, pinned upstream is unchanged, and the task promises bounded translation rather than OS allocation fault recovery. JS first/second input-allocation failure is separately executed in worker controls. These waivers do not cover guest validation or renderer quota failures. |
| bridge.c:421-443 | Pinned conversion records exercise actual value-only metadata validation. Supplement defensive.c supplies impossible upstream count/sample/noperspective/semantic/index/location/duplicate/mode/unmatched records and asserts all reject (19 total defensive checks including formatter/API). These trusted fault cases exercise the exact included frozen source; they are not represented as guest inputs. |
| bridge.c:445-472 | Semantic matching, missing output, component coverage, matched flat/smooth assignment, semantic-sorted keys, empty and multiple entries execute against an independent admission/key oracle. |
| bridge.c:474-502 | Actual single/pair formatter covers constants, samplers, system blocks and both stages. Formatter-only trusted quote/backslash/newline values additionally execute escaped-string branches; real translator outputs are not replaced in acceptance. |
| bridge.c:504-537 | Both public APIs, invalid stage, input/guard/interface failure and successful stage/pair result publication execute. Conversion helpers and owned-output cleanup run after failures. The final overflow-report guards (513,536) and the entry-point diagnostic forwarding of an inconsistent upstream interface (527-528) are waived defensive diagnostics: direct guard behavior is tested, but the unchanged pinned converter never emits that inconsistency and the bounded accepted profile does not exhaust result space. No guest-reachable new success/admission path is waived. |
| state.mjs:52-80 | Actual smooth/flat/mixed semantic maps, semantic sorting and component/missing-interface errors execute in worker/independent recordings. Structurally impossible metadata cases are trusted compiler-contract validation, not an extra guest schema. |
| state.mjs new deleteProgram variant cleanup | Both actual variant and no-variant programs are destroyed. Worker renderer-first and independent store-first disposal finish with zero budgets and `is*` false on all 98 independent tracked native objects. |
| state.mjs:294-326, cache publication/unwind/inspection additions | Cold/warm smooth and flat links, distinct native IDs and reuse; new shader/context/subcontext generations; pair metadata/source faults; exact/short quotas; null allocation, compile/link/reflection failure and recovery execute. The initially unhit `?? "smooth"` at310 is now executed by independent `unused varying remains smooth` renderer draw with an extra unmatched VS GENERIC7 output. |
| index.mjs translatePair | Strict own data, symbols/nonenumerable/accessors/revoked Proxy and reflected exception; bounded reentrant ownKeys; per-side length/ASCII; input allocations/failure/finally; full pair result and later recovery execute. Worker first/second malloc controls cover actual allocation unwind. No unhit changed V8 ranges remain. |

LLVM export reports403/416 lines covered for the entire bridge (not a promise of
100% branch coverage). The168 added C lines have130 with measured regions and38
structural/comment/signature lines; all remaining missing branch outcomes above
are explicitly classified. `coverage-census.json` retains exact branch coordinates
and counts, including seven remaining condition outcomes: negative vsnprintf,
strarray allocation failure, three upstream conversion diagnostics, final single
response overflow and the upstream-inconsistency forwarding condition. Pair
response overflow is also explicitly waived even where optimized coverage shares
its implementation. There is no dead semantic fallback identified.

## Other changed files

- `build.sh`/Makefile pair target, header export and fixed-memory configuration:
  executed by both complete recorded gates; native strict check/ASan+UBSan and
  actual served Wasm exports bind to the frozen sources. Usage text is configuration.
- `native_tests/pairs.c`, `tests/pairs.mjs`, command `tests/flat-pairs.mjs`, fixture
  pair-cases.json, gate/native/receipt scripts: their ordinary, hostile, recovery,
  sabotage and pixel paths are recorded by worker and cold gates and interrogated
  by independent binding-audit.py. Harness file/argument/timeout/error messages
  protecting missing files or broken host tools are waived tooling diagnostics;
  no runtime acceptance path is inferred from merely loading the harness.
- Shared browser-runner CDP setup/export: both new recordings actually contain
  source-bound counters. Coverage transport failure catch is a reporting-only
  diagnostic, waived. Exact record hashes include coverage output.
- Existing captured/components tests/fixtures and component receipt changes:
  version/interpolation expectations intentionally update to v4 and remove only
  the now-supported original flat rejection. Frozen same-source lower gates
  execute all old literal/component/state/draw oracles; input body hashes remain
  unchanged. No old pixel assertion was loosened.
- Contract JSON/decision/README changes are declarative scope documentation;
  six contract tests and source inspection retain production disabled,12/19,
  PRECISE rejection and no compositor/guest execution claim. `verify.py` and its
  added rejection tests execute in the full scoped gate. README limits/schema
  declarations are configuration, not executable runtime.
- cold.py ordinary scrub/clone/gate/copy/hash/cleanliness path executes once at
  the frozen head. Timeout/OS process-termination and missing-environment/file
  diagnostics are waived harness defenses. Independent audit verified the live
  retained clone is still clean; no second clone or unrelated suite is needed.

Build objects, binaries, generated native streams and raw profiles stay ignored
under target/virgl-pairs-verifier. Replayable verifier source, exported counters,
reports and hashes are retained. No widened Rust/default web claim is made.
