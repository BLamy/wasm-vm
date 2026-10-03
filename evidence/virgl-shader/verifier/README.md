# Independent E6-T10a verifier

VERDICT: verified

Runtime under examination: `6993efb1540cf7f5a01f6c82b8dac32cee734b39`.
The verifier did not implement or modify the bridge. This is a bounded isolated
TGSI-to-GLSL module, not guest GPU acceleration. The native fault probes below
include unmodified source and replace only their test translation unit's calls.
They do not alter production sources or claim synthetic failures came from
upstream.

## Predictions and evidence

Before evidence inspection, the verifier predicted: the upstream/compiler pin
and exact-head identities hold; supported shaders compile/link and produce
literal pixels; malformed/oversized/unsupported inputs return bounded errors;
valid results survive failures without aliasing; metadata matches actual active
interfaces; emulator/default-2D bytes remain unchanged.

- `identity.json`: all 93 source, seven build and six compiler hashes rechecked;
  99 browser source/served identities rechecked; all 67 vendor files independently
  compared byte-for-byte with upstream commit `ca50e008863837e094747a69974dde3ae148aeaa`.
  Original per-file licenses and COPYING are consequently preserved.
- `cold-clone-check.json`: the worker's pristine clone has the same 93 source
  identities and both Wasm/loader digests, clean tracked state, hardware identity,
  zero browser errors and 4,336 passing pixels. `../provenance.json` records the
  exact scrubbed environment and commands; no second cold clone was needed.
- `regeneration.log`: independently repeated PyYAML 6.0.2 regeneration matches.
- `boundary-attacks.json`: exact 16,384-byte text, 512-byte line, 128-instruction
  and sequential-label endpoints accept; one-past limits reject. Native and Wasm
  successful payloads match. Unknown properties, overflow/negative/range indices,
  NUL, indirect access, uninitialized temporaries and unwritten outputs reject.
  Independent seed `bace9137` produced 1,536 mutations with 1,556 successful
  recoveries including named cases. Retained JS results, separate instances and
  caller mutation of an old result cannot alter a future conversion. An injected
  JS input allocator failure returns `allocation-failed`, then recovers.
- `independent-sanitizers.log`: four independent seeds (`8bcff135`, `03254865`,
  `ad71567c`, `6518322b`) execute 8,769 calls, including 4,096 mutated rejections
  and byte-identical recovery, under ASan/UBSan with immediate failure enabled.
- `fault-guards.log`: injected allocation refusal, converter failure, diagnostic,
  over-limit GLSL and JSON escaping overflow return structured errors and recover.
- `novel-pixel-prediction.txt` was written before its hardware run. TGSI MAD of
  IN=(0,0,0,1), IMM=(.5,1,0,.5), CONST=(0,.5,1,0) gives (0,.5,1,.5).
  Source-over red gives (.5,.25,.5,1), hence RGBA8 [128,64,128,255]. All 576
  selected interior pixels matched in `novel-browser/report.json:2128`; the full
  browser run retains nine draws/4,336 pixels and zero errors on Apple M4 Max
  ANGLE Metal. Its VirglBlock is 656 bytes with winsys_adjust_y at byte 640.
- `sabotage-prediction.txt` was written before its run. Swapping generated fragment
  RGB to BGR immediately before actual compilation still links but fails the
  first literal pixel: expected red [255,0,0,255], observed blue [0,0,255,255].
  `sabotage/report.json` and `sabotage.log` record the expected failure.

The native/Wasm byte comparison is a consistency oracle, not an independent
semantic oracle. Independent literal pixel math and hardware observations supply
that semantic proof. The sabotage and novel browser runners deliberately alter
only served test bytes, record those served hashes and retain the original
source hashes. Original frozen source and Wasm bytes remain unchanged.

## Diff coverage classification

| Changed files/hunks | Evidence or waiver |
| --- | --- |
| bridge.c operational adapter | `bridge-coverage.txt` records real upstream execution under independent sanitizer seeds; `fault-coverage.txt` covers otherwise-unhit diagnostic/defensive failure lines. Their union has every instrumented executable line hit (`coverage-summary.json`); this is line coverage, not a claim of every path combination. |
| bridge.c structures/constants, bridge.h | Waived as type/ABI/bound declarations, compiled in native and Wasm; limits are independently attacked. |
| index.mjs | Worker hardware execution plus independent named rejections, lifetime/instance checks and allocator-failure injection execute the module loader, request guards, allocation/copy/JSON conversion and finally/free path. |
| cli.c | Native differential endpoint cases exercise reads, dispatch and JSON output. I/O failure is host stream infrastructure, not a shader acceptance claim. |
| build.sh, setup script, verify shell/JS, Makefile | Native, sanitizer, Wasm and browser modes execute in worker/cold clone. Source inventory, frozen revisions, compiler identities, served hashes, error checks and direct result were interrogated. Usage/setup diagnostics are configuration scaffolding, waived from runtime shader coverage. |
| verify_sources.py, regenerate.py, UPSTREAM.json, generated files | Complete source inventory verified; generators independently reproduce all three generated files. Generated format tables are pinned upstream dependency data, not new advertised image-format support. |
| vendor/ | All 67 files are unchanged upstream dependencies. Supported MOV/ADD/MUL/MAD/TEX, VS/FS declarations, constants/immediates, temporaries, linkage, sampler and system block paths execute. Other upstream stages/opcodes/features are intentionally unreachable through the guard; hostile cases test their rejection. No coverage claim for the full upstream renderer. |
| corpus/harness/native tests | Six literal shaders and all nine draw patterns execute on hardware; independent seeds and sabotage establish the assertions are sensitive. The novel blend oracle exercises a separately predicted parameter set. |
| README/task planning/queue | Waived as documentation and declarative scheduling; policy check and queue generation validate them. |
| Rust/default 2D/demo/dependencies | No diff from parent in Cargo manifests/lockfile, crates, src or web. Existing unrelated emulator gates carry forward; no guest or demo exposure is claimed. |

No product contradiction or remaining proof gap was found. No source branch was
deleted or altered by the verifier.

## Permanent replay commands

Run from the repository root after `make verify-E6-T10a`:

```sh
node evidence/virgl-shader/verifier/boundary-attack.mjs "$PWD" /tmp/virgl-boundaries.json
python3 evidence/virgl-shader/verifier/run-native-attacks.py
node evidence/virgl-shader/verifier/novel-browser-runner.mjs --output /tmp/virgl-novel-browser
node evidence/virgl-shader/verifier/sabotage-runner.mjs --output /tmp/virgl-sabotage
```

The sabotage command must exit 1 with the exact red-versus-blue pixel failure;
all others must pass. Native replay uses Clang, ASan/UBSan and Xcode LLVM coverage
on this Mac. The existing `make verify-E6-T10a` target, literal shader corpus,
hardware pixel oracles and hostile-input tests remain the recurring acceptance.
The independent attack scripts and seeds are retained here as promoted verifier
regressions. `digests.json` binds the final verifier artifacts.
