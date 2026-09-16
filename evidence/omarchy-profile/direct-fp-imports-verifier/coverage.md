# E5.5-T03ao changed-hunk coverage

Final coverage for worker submission `7d648143e92b7fe861fa4ae7b1f34c0a84451f39`,
runtime/harness freeze `8c302e1d6cd084ba1034cfd58c7efb9677dc3e46` and
artifact/cold/physical head `a3beb0e8dc5da21374a6d59e25658f5db5ce79da`.
Predictions preceded worker evidence in `predictions.md`; numerical benchmark
predictions preceded its result in `benchmark-predictions.md`. No remaining
AO behavior needs evidence. The recorded desktop outcome is negative.

## Runtime

| Changed boundary | Executed or waived | Evidence |
| --- | --- | --- |
| Five scalar `jit_fp_*` C exports and casts | Executed on actual optimized production WASM and generated private/shared WASM | `production-preflight.json`: all 22 literal results, all five correct types and 22 wrong-type rejections; `suites-frozen-inspection.json` and `suites-cold-inspection.json`: 264 literal probes of actual imports across 12 modules each |
| Arithmetic boolean selector and signed/raw integer casts | Executed with add and multiply, signed single bits, upper i64 bits, signed/unsigned W/L cases | Literal table in promoted `jit_fp_direct_imports_verifier.rs`; result digest `f5c775ff0b743b09` |
| Actual export lookup and five `env` bindings | Executed for private and shared constructors; captured import is exactly `===` the owning raw export | Six captured modules per mode, every module imports all five helper families; complete strict WASM parameter/result type mutation matrix |
| Replaced Closure bodies and removed five owner fields | Deletions; new lifetime behavior executed | Nine compiled mixed blocks per mode, two simultaneous executors, invalidation/reinstallation, replacement executor, originating executor drops, real 65,536-byte growth; all retained imports still callable after every guest/executor drop |
| Lookup/type/set failure guards | Waived as impossible with the separately checked complete artifact and a newly allocated ordinary JS Object | Raw production section parser proves all five locally defined exports with exact types; no externally supplied import object enters this constructor |
| Existing numerical backend, translator guards/ABI/publication and native runtime | Unchanged; carry prior proof | `carry-inspection.json`: unchanged whole tracked boundary and 19 named files; all 83 AN worker and 59 AN critic sealed files rehashed; all five independent verifier fixtures rerun on both WASM paths |

## Harness and metadata

- New independent verifier fixture: the actual constructor interception,
  identity/type assertions, literal oracle, guest state comparisons and lifetime
  transitions execute in two passing tests. The isolated copied-import
  sabotage preserves the numerical answer but fails the named identity
  assertion in both modes; a wrong-signature JS trampoline links, demonstrating
  why strict raw function type rejection matters. Restoration passes.
- Built-page harness: `harness-parity.json` proves the AN browser arithmetic,
  127-test ISA, memory-growth and visual assertions retained byte-for-byte
  after task/output labels. `production-inspection.json` and
  `cold-production-inspection.json` independently reconstruct the final full
  registers and RAM SHA `3510fa25cda976048c595e95ae16fabadebe668f0170d9615ac68c103430003e`,
  prove 4570/5000 compiled retirements and real 65536-byte growth. Both runs
  pass 127/0 with no errors; all six suite/capability/task images were viewed.
- Physical harness: the same parity receipt proves the prepared pair, cap,
  recycling, deadlines, event/readback audit, post-verdict capture and bounded
  cleanup unchanged. Only the exact candidate WASM pin and identifying labels
  differ. `physical-inspection.json` and `physical-fidelity.json` independently
  parse actual trusted events, 256 keyboard/sync acknowledgments, exact pair,
  properties, 37 independent reads, the input fence, no post-verdict ingress,
  post-verdict capture and 170 ms normal cleanup. The result is negative.
- Benchmark: frozen and sole-cold source/ELF opcode audits reconstruct final RAM
  SHA and all 33 registers, validates 14 total runs and five alternating timed
  pairs, and recomputes medians. Static helper occurrences are derived, not
  instrumented; subtracting all noncompiled retirements gives independently
  positive conservative compiled-helper bounds for every family: at least
  49695 calls each for arith/from-int/to-word/div and 199695 FMADD calls.
  `benchmark-frozen-inspection.json` gives ratio 0.5877374020759919 and the cold
  receipt gives 0.5949656768504615. This covers the matched finite FP workload;
  it cannot establish desktop latency.
- Baseline materializer: existing cached baseline is checked against exact git
  bytes and AN WASM SHA. Fresh-directory branch executed in the sole final
  cold clone. The stale-cache rejection is a guard, not a numerical change.
- Documentation and roadmap explanatory text: waived as declarative; actual
  built task/capability images and committed generated assets inspected.
- Makefile target and recorders: all six affected commands pass; final native
  WASM library has 33 tests and final WASM acceptance has 32. Full CI remains
  exit 2 in the same five inherited categories (`ci-inspection.json`), with
  native ISA 128/128 and 58.8 MIPS. Broad CI is not green.
- Deployment recovery: original two timeouts retained. `recovery-inspection.json`
  checks 49 contiguous range receipts against the pinned unchanged 205050833-byte
  snapshot and audits full SHA/Content-Range guards and the identical final
  Pages command. The critic did not redownload that large artifact. Separately,
  `public-inspection.json` contains 12 independently fetched exact public file
  hashes from preview and canonical origins, including release WASM.
- Frozen/cold provenance: 52 frozen source/harness and six artifact files match
  final git/current bytes; sole pristine clone and scrubbed environment audited
  in `cold-inspection.json`. The rebuilt WASM is exactly
  `36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`.
- Final seal: `submission-inspection.json` rehashes all 89 worker files and
  compares each with committed `7d648143` bytes. No runtime or harness changed
  in the submission commit. The physical and broad-CI claims remain false;
  T03q remains pending.

## Physical proof correction and separate profile

The inherited wrapper wrongly equates the latest damage rectangle with the
fixed presentation dimensions and stops its post-run audit. Its original
failure remains in `physical-input/run.json`; no positive wrapper exit is
claimed. Existing `Resource::flush_rect` (resources.rs:65) narrows later changed
pixels; the WASM sink opts in at lib.rs:2336; presentation.js:499 reports
dimensions separately. Actual canvas/GPU stay 1280×800 and resource 1280×832.
The final damage rectangle (10,36,118,28) is contained and valid.

`geometry-inspection.json` independently checks both actual states and rejects
15 malformed geometry/error mutations. The worker's separate offline correction
rejects 16 mutations. `physical-inspection.json` independently completes raw
input/fence/profile/cleanup assertions rather than assuming the stopped wrapper
did them. No product change, deadline extension or guest rerun occurred. Fresh
initial and failure PNGs were personally viewed: no typed command or returned
prompt. The two images have different bytes; this does not make the desktop
criterion pass.

`profile-inspection.json` independently parses all 11 non-custom WASM sections
and 1912 names, then recounts every raw sample and stack. Raw SHA
`24a461f002de9a6a22c22088a6162599546793889f7a5652690b796e0fcf4256` has
19977 samples, 5211 nodes, a 30022968 µs span and 30022150 weighted µs. Worker
self/inclusive tables match exactly. The separate post-verdict profile is a
diagnostic; no inclusive percentage proves an isolated cost or input cause.

## Retained critic checker failures

The first full-register benchmark checker omitted hardwired UXL/SXL bits in
mstatus. The prior FS Dirty/SD prediction held. The checker was corrected from
`csr.rs:182-188`, and its failed log plus explanation remain recorded. No
product code or worker result was changed in response. The first exports
command hit host Xcode selection before reading WASM; retry used the required
DEVELOPER_DIR. The first cold browser checker used a relative/absolute path
comparison and selected the hot head; the parser path was corrected with
`.resolve()` after the independent cold source check had passed. Original logs
and explanations remain. None required product changes or new guest runs.
