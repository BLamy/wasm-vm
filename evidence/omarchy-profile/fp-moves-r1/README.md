# E5.5-T03t worker evidence

This submission demonstrates exact compiled FSGNJ.S/FSGNJN.S/FSGNJX.S,
FMV.W.X and FMV.X.W state transitions. **The Omarchy desktop remains
unresponsive:** the physical-input trial failed its unchanged 120-second nonce
readback deadline. T03q remains gated; T03u is the next measured memory-transfer
slice, pending independent verification of T03t.

## Frozen code and incremental proof

- Runtime and built WASM: `c7a3c38b84d462eba585c9f7081c70c88cdd2534`.
- Recorder-only repair: `6910e7952ef215463de9982d20c42fa26869cbfb` retains the
  exact manifest response bytes delivered to the loader. The first physical
  recording failed before typing because CDP no longer held its response body;
  it is not a keyboard result. The repair passed 27 focused recorder tests.
- Screenshot-only repair: `c07f562afb6038d2b6fe20d4aa907a444f969d9e` captures
  the actual suite and computed capability. The legacy capability container is
  explicitly revealed for inspection; its text, class and result are unchanged.
  This fixture's existing test hooks are never used in the physical-input trial.
- Independent promoted attacks: `ac6bcc8b`; cold clone head `b4b7c70d` includes
  these tests and all runtime/recording changes above.
- Later test-only proof repairs: `3a068128` corrects an old input fixture's empty
  advertised capabilities; `9e89c516` tests four equal-version FPR replacements
  and four CSR-only FS permission changes. Fresh critic logs record the focused
  native and browser reruns. Runtime bytes did not change.
- `ac773549` updates the native admission-probe fixture to admit FMV.W.X while
  explicitly retaining FADD.S and CSR rejection. Its focused test and format
  check pass; the change is entirely in `cfg(test)` code and the acceptance recipe.
- Deployment receipt/manifests: `0699e65d` commits the exact content-addressed
  URLs staged by Cloudflare. Artifact payload hashes are unchanged.

Production WASM SHA-256:
`55557d7a158bb274d214692a76a2a876bbe56ecd7798cbc9adfcbb4bfc9a0c40`
(1,590,113 bytes; service-worker version `2048756890e4`).

## Deterministic and browser evidence

`acceptance.log` records the initial `make verify-E5_5-T03t` acceptance. The
shared fixture executes 1,984 directed/seeded cases and records architectural
state FNV `dc6031f4c37c7ec3`. The independent critic adds 3,840 cases, 960
FS-disabled traps, independent raw-bit goldens and a four-thread identity test;
its state FNV is `ba4ecacfdc4b9707`. See the sibling `fp-moves-critic` evidence.
The targeted browser JIT regression passes 38 tests with one existing ignored
test; all six FP browser tests pass, including same-/cross-module successors
and FP prefix preservation on a successor memory fault.

`browser-r2/report.json` and `cold/browser/report.json` each record a real
Chromium run of the built exported WasmMachine. Both compare all integer
registers, guest RAM digest and retirement/statistics with the interpreter:
4,000 guest instructions, 3,639 retired through generated code, 31 host entries,
915 direct entries and 884 links. Guest RAM SHA-256:
`2292761e0dadbc7ba225714d941fed3c585352ccd3b6912882818ae22b213661`.
The old-bundle negative control produces the same architectural result but
only 441 compiled retirements, correctly failing the fixture's 2,800 minimum.

Both built-page runs pass the complete live ISA suite **127/127**, with zero
console/page/HTTP errors, and the FP move capability is `live`, 1/1 passing.
`suite.png` and `capability-inspection.png` are the corresponding captures.

`cold/report.json` records a pristine clone, scrubbed RUSTFLAGS/RUSTDOCFLAGS,
RUST_LOG and CARGO_* environment, a clean `make web-dist` rebuild, and
`make verify-E5_5-T03t`. Every command exits zero; the rebuilt WASM exactly
matches the committed binary. Later test-only repairs carry this unchanged
runtime proof forward under the incremental verification policy.

## Actual physical input: failed

Command: `node tools/verify/omarchy-desktop-services.mjs
evidence/omarchy-profile/fp-moves-r1/physical-input-r2`.

`physical-input-r2/desktop/report.json` records the unchanged R3 snapshot/delta
and actual delivered manifest digest
`5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44`.
At the default 1280×800 mode, 128 trusted keyboard events were accepted without
rejected or dropped device events. Enter completed at
`2026-09-15T17:45:39.762Z`; readback failed exactly at
`2026-09-15T17:47:39.762Z`, 120,000 ms later. Thirteen completed independent
reads found no nonce file; the final read was still pending. Frames remained
2 → 2. The captured Foot terminal shows no typed text. The owned browser closed
normally after the failed trial (exit 1, no watchdog).

No nonce was injected through the serial control channel. Opcode correctness,
successful restore, accepted input events and compositor readiness do not
constitute a responsive application result.

## Local gauntlet and deployment

`ci.log` records the prescribed `make -k ci` once at frozen runtime. It is
**not green**. Pre-existing failures include the Linux-only wvseccomp helper on
macOS, all-feature dead code, stale zicsr-stub browser unit helpers, and the
lexical determinism sweep matching existing test-only clocks. The original
default-WASM input-queue fixture failure was repaired and rerun independently.
Native ISA compliance passed **128/128**. `no-host-float.log` and the affected
production-crate Clippy check pass. The broader native Clippy check hits the
unchanged CLI `display_metrics` unused variable.

`native-workspace.log` records the Mac-compatible workspace run: 680 tests
passed before the old lexical `no_stdout_in_core` failure in unchanged
test-only print statements. The full affected JIT/runtime targets are recorded
separately, with their exact command array. An extra pure-interpreter core
sweep was stopped after 17 completed targets and 86 passing tests, with no
semantic failure, because its remaining unchanged paths do not cover any
T03t diff hunk. `extra-core-sweep-stop.json` records the stop, agreed with the
fresh critic; this sweep is explicitly incomplete. Its first narrowed command
omitted the workspace-unified `trace` feature and failed at compilation; the
corrected command restored it. None of these failures or stops is reported as
a pass. The affected native JIT/runtime/wasm command completed with 124 passing
tests and one stale admission-probe expectation; the focused repair passes 1/1
in `admission-fixture.log`. All native JIT/runtime/translator tests passed,
including full ISA comparisons, randomized differential tests, precise traps,
and 52,800 clock samples during repeated compilations and evictions.

The original performance guard failed during competing builds (12.3 MIPS;
the post-cold attempt was 14.3 MIPS while other builds remained active). The
recorded sequential B-C-C-B comparison ran after task-owned builds/tests
finished: baseline **26.0, 25.4 MIPS**; candidate **25.7, 25.8 MIPS**. All four
runs pass the unchanged **15 MIPS** floor. `perf-comparison.json` binds their
binary hashes, exact commands and logs. The fresh critic independently verified
all baseline core/config blobs and all retained dependency versions/checksums.
These numbers establish the local floor; they do not establish desktop latency.

`cloudflare-deploy.log` records successful deployment to
<https://2a2104a3.wasm-vm.pages.dev>. `cloudflare-public.json` records HTTP 200
and byte-for-byte identity at the immutable deployment and
<https://wasm-vm.pages.dev>, using system curl with TLS verification enabled.
The production WASM, JS glue, roadmap and app match the tested local build.
The live deployment exposes the verified opcode capability; it makes no new
desktop-responsiveness claim. No GitHub Actions or merges were used.
