# E6-T12e3 changed-source coverage

The executable runtime delta is confined to the C bank/index guard and excluded
feature diagnostics, plus exported static limits/profile identity. Independent
ASan/UBSan execution (`native-attacks.py`) used the frozen C source with LLVM
source coverage enabled, not a replacement implementation.

`coverage-census.json` records nonzero hits for all **25 changed executable C
lines**: 120–127,129–130,132,137,141,145,152,219–222,225–228,230,512.
`native-coverage.json` binds the exact source and branch counters;
`native-coverage.txt` provides human-readable line counts. Decimal length,
leading-zero and per-file range checks take both outcomes. TEMP/CONST/small-bank
choices all execute. ADDR recognition and non-ADDR rejection both execute.
UINT32 syntax/delimiter checks and each excluded subnormal/nonfinite/magnitude
class execute. Two zero-width LLVM branches at226:9 are C `isfinite` macro
expansion alternatives for operand types other than the concrete float operand;
they have no reachable guest-controlled path. The actual float finite predicate
at226:8 has both outcomes (8/34), as does magnitude (2/32). Waive only those
compile-time macro alternatives, not any runtime semantic branch.

Compile-time enum/header changes are exercised by every address, all relevant
one-past edges and179/180 instruction neighbors. Signatures/braces carry no
independent runtime effect. JS changes only frozen public limit data; the real
browser explicitly compares the full exported object to independent literals.
No command renderer/device/runtime file changes occur in the scoped diff.

The remaining changed files are proof, configuration or documentation:

| Files | Classification and recorded path |
| --- | --- |
| `renderer/virgl-shader/build.sh`, `Makefile` | Build/target wiring; exact worker and cold commands execute new bank mode and acceptance target. Guard-check compiles new C test with warnings as errors. Fixed Wasm memory/stack options are unchanged and checked. |
| `renderer/virgl-shader/native_tests/banks.c`, `tools/virgl-banks/native.py` | Test harness; worker/cold input streams, every case/pair, all four mutation seeds, hostile bytes/lengths and recovery counts are independently reconstructed. Failure-only reporting branches are waived as test diagnostics; the hardware sabotage tests the semantic oracle. |
| `renderer/virgl-shader/tests/bank-cases.json` | Declarative inputs/oracles;404 named full results in native and hardware. Independent guard cases do not derive their expectations from this fixture. |
| `renderer/virgl-shader/tests/banks.mjs`, `tools/verify-virgl-banks.mjs` | Browser proof harness; both stages, low/high/recovery, declared47, poisoned host tail, 179-instruction stress, fixed memory, and real source sabotage execute. Helper independently interprets TGSI arithmetic and recomputes full framebuffer hashes and TF words. Failure-reporting/cleanup scaffolding is waived as harness control, not a guest semantic claim. |
| `tools/verify-virgl-banks.sh` | Orchestration; worker and fresh cold logs run the entire sequence and detect expected sabotage failure before receipt success. |
| `tools/virgl-banks/inventory.py` | Inventory tooling; every original/path/content hash and independently recomputed maximum is audited. Parser error reporting is waived as tooling diagnostics for corrupted captures. |
| `tools/virgl-banks/receipt.py` | Evidence validator; successful worker and cold receipts audited independently (33,230 checks). Its failure-only diagnostics are waived, and its success is not the sole proof of evidence validity. |
| `tools/virgl-banks/cold.py` | Portability tooling; first pristine run completed from exact frozen head with clean before/after status and scrubbed compiler/runtime overrides; timeout/error cleanup is waived because no portability or timeout claim requires inducing a failure. |
| `native_tests/{captured,components}.c`, `tests/{browser,captured-textured-scene,components,pairs}.mjs`, `tools/virgl-{components,pairs}/{native,receipt}.py` | Existing regression assertions updated to v5/static limits; the nested full regression receipts bind their executions. Unchanged behavior carries prior verification forward. |
| `tests/{captured-invalid,component-cases,pair-cases}.json` | Historical negative neighbor migration only; count retained, newly accepted old neighbors separately covered positively. Neighbor118/46 rejects natively and in Wasm. |
| `docs/gpu-3d-{contract.json,decision.md}`, `renderer/virgl-shader/README.md`, pending `E6-T12e3b` | Declarative/documentation scope descriptions; truthful frontend-only boundary, fixed bounds and driver-retained47 correction audited. No executable behavior. |

All runtime additions execute or have the narrowly stated compile-time waiver.
No changed runtime behavior remains unproven. Observed serialization maxima are
reported as fixture maxima; neither worker nor verifier claims a mathematically
maximal GLSL expansion.
