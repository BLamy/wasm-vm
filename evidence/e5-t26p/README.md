# E5-T26p evidence index — implemented

The static-code gate is admitted by fresh Daybreak in
`verifier/artifact-verdict.md` (SHA256
`19e852e324a1db3beb1c1f977306d22b29a4e35d30a2caedcda2cc3142e2b6df`).
The subsequent canonical semantic comparison passes 266 cases/modes with
byte-identical old-source native, candidate native, and actual-WASM output.
This is not a completed verifier verdict, browser latency result, or release claim.
The final clone below passes; no F boot, merge, or deployment is represented here.

- `artifact-notes.md` and `artifact-index.json`: actual native and authenticated
  production-WASM caller/callee analysis, exact function bodies and size tradeoffs.
- `artifact-baseline-d7d308a5-r2/` and `artifact-candidate-d7d308a5-r1/`: matched
  external public-API compiler probes, pinned toolchain/config/lock/commands.
- `baseline/` and `production-candidate-r1/`: retained real production artifacts.
- `release-baseline-d7d308a5/` and `release-candidate-r1/`: named companions whose
  eleven executable/non-custom sections match the corresponding exact release.
- `artifact-baseline-d7d308a5/`: excluded first attempt, missing the archived
  toolchain/config; keep the failure and builder revision, do not promote it.
- `verifier/plan.md`: pre-results predictions and ordered gates.

Large completed compiler artifacts are stored losslessly as `.gz` to keep the
committed evidence bounded. `packed-artifacts.json` records both compressed and
original SHA256/lengths. Decompress a named `.gz` to its corresponding filename
before following raw disassembly line citations or inspecting the original binary.
`pack-artifacts.mjs` checked each round-trip against the original bytes, and no
original was deleted locally. These derivative archives do not change the
artifact verdict's input digests.

`worker-handoff/` preserves the initial incomplete scaffold and its original
outputs, plus Luna's revised producer before Main's final gap closure. The first
22-case comparison is not the final semantic matrix. Main added the missing
opposite reservation relationships for all store widths, overlapping PMP store
faults, AMO sign extension and nonoverlap before recording the canonical result.

`record-semantics.mjs r1` ran the same final fixture (SHA256
`62ce60205676c1ed59b2e11395c36337278cdd65d6fd9d4f56be4a4e13e7c5c9`) against the
untouched old runtime archive first, then candidate. `semantics-r1/result.json`
holds both binaries/source pins/commands; 266 cases produce exactly 202,466 bytes
on each side, SHA256
`5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`.
The old output—not candidate output—is `baseline-semantic.stdout`.

`wasm-pack test --node crates/wasm --test retirement_capture_baseline -- --nocapture`
executes the identical source in actual WASM, captures its output without WASI,
and asserts exact equality with that old-source golden. It passes (one test,
266 cases) in `semantics-r1/wasm.log`, SHA256
`dbeefd2e7f15c5e4a8b85b6eb8ea952c432fc6d3226f0f25ed737b9fe362f995`.

## Scoped gate and single built demo

`main-gates/02-task-gate.log` records the full task gate at the frozen runtime:
74 native tests and 82 actual-WASM tests pass; there are no failures and one
pre-existing ignored E4-T33 long-churn test. The gate also executes the native
266-case producer, relevant fmt/clippy/build checks and the zero-cost detector's
positive-control selftest. Log SHA256
`fbec932669aa9749f5f23f6a4f960f2d091943a44a70ffe1e0ddc338aefedbf2`.
The native predecode differential covers 127 vendored ELF files under ordinary,
large-cache and one-entry-cache execution. `main-gates/04-fence-wfi.log` adds the
existing exact `csr::fence_i_and_wfi_retire_as_noops` test (one pass), now part of
the final gate; unchanged workspace suites were not restarted for this addition.

`main-gates/01-web-dist.log` builds the normal deployable bundle. Both source and
dist WASM match admitted release `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.
An EXIT trap preserves the user's unrelated dirty artifact manifests. There is
no deployment. The single Chromium152 demo load is `demo-a3ce0252/`: 126 passed,
0 failed, empty console/page-error and HTTP-error arrays, visible in-progress
E5-T26p panel. Main viewed the PNG, SHA256
`997b0ca38ce7de4b911cd034a3e6dab5a8b1140a53061fc41bc9ed63c118db26`.
This proves the demo ISA suite, not a Linux/Omarchy boot or performance budget.

`verifier/semantic-and-novel-verdict.md` records independent admission of the
canonical semantics, the promoted native/WASM x0-MMIO false-sink attack, and
one executed reservation-effect sabotage in a separate archive. The sabotage
fails the first seeded overlap assertion as required; scratch and real runtime
hashes are restored/unchanged.

## Sole final clone

`bash evidence/e5-t26p/run-final-clone.sh 078500ebbef1c5d90adf973790ad68b7579a5879`
passes in `/private/tmp/e5-t26p-final.NtmIRa0D/repo` at that exact committed head.
Both checkout checks are clean, with no object alternates and fresh target output;
the scrubbed task gate passes 75 native and 82 WASM tests, the canonical producer,
checks/builds and detector selftest. `main-gates/06-final-clone.log` SHA256
`661b13b6656bbbece2131a0c982b79d78b13e3a67016f251d28a5ee55c513c9d`.
No second clone or semantic change was made. Final critic verdict is pending.
