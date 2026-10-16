# E6-T10d independent receipt and harness audit

Scope: assisting fresh verifier, read-only implementation review of frozen runtime
`8759a30622e6604b8cd3d5c35d110260c6fd1943`, against parent `d0a5b1fc`.
No implementation or task-status changes were made. This report does not replace
the separate guard-coverage and independent semantic attacks.

## Predictions made before reading worker evidence

Recorded in this verifier session before the first evidence-content read:

1. Worker and cold-clone reports bind the same frozen head and source hashes.
2. All 19 captured bodies match the contract's accepted/rejected entries.
3. The extracted browser runner retains the nine-draw literal regression result.
4. Texture sabotage fails at a real independent pixel comparison.
5. Unchanged upstream files, JS boundary, and production paths permit the relevant
   T10a HELD proofs to carry forward; changed grammar requires new proof.

## Results

**All five predictions HELD. No actionable finding in this audit's scope.**

`receipt-audit.py` is the independent reproducible checker. Its captured output is
`receipt-audit.json`. It recomputes, rather than trusting receipt success labels:

- Both sets of 102 source hashes against current bytes and `git show 8759a306`.
  All match and both source maps are identical. All six compiler hashes match.
- All six subordinate receipt/report bindings per run, all eight browser report
  heads and empty tracked-change arrays, every source/served-file size and hash,
  all screenshots, native binary/log hashes, and zero browser errors.
- Cold-clone wrapper log and acceptance-receipt bindings; clean before/after state
  (`../cold-clone/report.json:22`). Its saved script unsets all `CARGO_*`,
  `RUSTFLAGS`, `RUST_LOG`, Python injection and C build overrides before cloning
  and invoking acceptance; only `RUST_LOG` was present to remove.
- The Wasm served by worker and cold clone is identical:
  `ef4e5567cee381cffc19aece8c92671dca3707e7c8f21feb15a3eaa55f71642f`.
- Independently invoked the current native CLI on each of the 19 SHA-256-checked
  captured bodies. Full outputs equal the worker's contract receipt, with seven
  translations, eleven unsupported-feature errors and one parse error.

Runtime observations: `../worker/acceptance.log:216` retains nine literal draws,
4,336 pixels, 13 rejections and 416 recoveries. `:218` records two unmodified
captured shaders, three draws, 768 pixels, 112 grammar attacks and 1,792 Wasm
recoveries. Native sanitizer log `../worker/native/native.log:115` through `:125`
records 302 positive boundaries, 112 negative boundaries, four independent
2,048-mutation seeds, 18,246 exact captured recoveries, and 27,371 total calls.
This audit verified report integrity and actual native corpus outcomes; the
main verifier separately audits the semantic/pixel oracle and new guard coverage.

Sabotage reaches actual compiled-program execution and fails the first texture
pixel at (4,4): predicted red `[255,0,0,255]`, observed black `[0,0,0,255]`
(`../worker/sabotage/report.json:905`, report SHA-256
`7c3040a8cd2fc0357e81ac36dacb7da561f233e1bcb1846e26106b88e22ac0cd`).
The shell's expected nonzero exit is paired with `receipt.py:72` through `:76`
checking the exact failing draw/pixel, so an unrelated browser crash cannot
satisfy this sabotage gate.

## Changed harness coverage and justified waivers

| Changed surface | Evidence / bounded coverage classification |
| --- | --- |
| `tools/lib/virgl-browser-runner.mjs` extraction | Worker and cold-clone literal/captured/sabotage runs execute options, source inventory, input allowlisting/hashing, pinned files, local serving, actual headed hardware Chrome, Wasm consumption, report validation, source stability checks, screenshots and cleanup. Sabotage executes the catch/recovery screenshot/report path. The old literal checks, hardware checks, source checks, zero-error check and pixel entrypoint survive extraction. |
| Runner failure-only infrastructure | CLI misuse; invalid fixture hash/size; disallowed or missing URL/symlink; timeout rejection; browser launch/transport failure; failure-screenshot failure; and close-error suppression are harness/config diagnostics. They do not advertise TGSI or rendering behavior. Waive induced infrastructure failures; successful requests and actual shader rejection/sabotage paths are recorded. Optional explicit Chrome path parsing is unchanged from the accepted runner. |
| `tools/verify-virgl-shader.mjs` | The nine-draw baseline executes through the extracted runner. All six original source/GLSL hashes and all nine complete RGBA hashes/pixel counts exactly match T10a's accepted recording. |
| `tools/verify-virgl-captured-shaders.mjs` | Both normal and `texture-texel` modes execute. Input pin, three draws, 768 pixels, no guest execution, and success/failure handling are present in the receipts. Unsupported CLI mode diagnostics are harness configuration, waived. |
| `tools/verify-virgl-captured-shaders.sh` | The complete ordered acceptance pipeline runs at frozen head in both working tree and pristine clone. New Python/Node syntax checks and contract unit tests run; native, old sanitizer, new sanitizer, Wasm, both browser suites, expected sabotage and contract cross-check run. The cold clone exercises dependency installation. The fallback setup script is unchanged from T10a; installer/environment diagnostics are waived. No unrelated Rust/web gate is required by this isolated task. |
| `tools/virgl-captured-shaders/native.py` | Input-byte pins, 112-case serialization, sanitizer subprocess, bounded timeout setup, native output capture and native receipt execute. Its malformed fixture/duplicate-name/non-ASCII/oversize/input mismatch rejection and subprocess timeout paths validate test inputs or diagnose infrastructure, not the bridge's accepted grammar. They are waived; actual grammar rejection executes in the sanitizer binary and Wasm. |
| `tools/virgl-captured-shaders/receipt.py` | Positive receipt validation executes all three browser modes, compiler provenance, screenshot checks, native/Wasm equality, literal/captured pixels and explicit sabotage failure. Normal and sabotage screenshot choices both execute. Negative stale/missing/corrupt report, mismatch, missing-toolchain assertions are evidence-integrity guards, not product features; their induced failure branches are waived. This audit independently rechecks the underlying hashes and recorded observations. |
| `tools/virgl-contract/verify.py` delta | Seven translation and twelve rejection branches execute, including both rejection codes; two executed-pair and seventeen not-executed evidence classifications execute. The independent native replay agrees on all 19 full results. Incorrect schema/status/hash/classification assertion-failure branches are declarative contract integrity checks, waived as harness diagnostics. |
| Contract/decision/README changes | Declarative scope and result inventory only. Native replay corroborates each changed shader result; exact accepted pair remains distinct from five translated-only bodies. PRECISE and Z32_UNORM retain rejection, one render target and zero production capsets remain explicit. No claim of complete captured command replay appears. |

These waivers do **not** cover newly changed C guard branches or new shader
semantics; those require the main verifier's coverage/attack evidence.

## Incremental T10a HELD proofs

Recomputed all 25 entries in `evidence/virgl-shader/verifier/digests.json`; each
matches, and the entire old evidence tree has no diff in this task. Compared
against the accepted T10a runtime `6993efb1540cf7f5a01f6c82b8dac32cee734b39`:

- Vendored upstream sources/licenses, generated files, upstream pin, regeneration
  tools, toolchain setup, `bridge.h`, CLI and `index.mjs` are byte-identical.
  Prior pin/license/regeneration and JS allocation/lifetime/instance proofs carry
  forward for these unchanged boundaries. Newly reachable upstream parser or
  converter paths still require this task's native/Wasm/browser evidence.
- Literal corpus is unchanged. `tests/browser.mjs` only exports existing helper
  functions, preserving the literal oracle and behavior. Fresh literal recording
  yields identical six GLSL outputs and nine RGBA outputs; prior original-feature
  pixel assertions carry forward, now also rerun at this head.
- Old grammar rejection categories are **not** blindly carried forward: intended
  range/mask/swizzle changes replace adjacent legacy hostile cases and require
  the new grammar attack suite. Old complete bridge line coverage also does not
  prove new guard/metadata lines. The parent verifier owns those checks.
- Cargo manifests/lockfile, crates, src and production web have no diff from this
  task's parent. Prior default-2D isolation proof carries forward. There is no
  production demo exposure or guest 3D claim in this slice.

Replay: `python3 evidence/virgl-captured-shaders/verifier/receipt-audit.py`.
This reads the preserved cold-clone native binary and compiler paths, so replay
requires retaining that scratch clone or rerunning the final acceptance first.
