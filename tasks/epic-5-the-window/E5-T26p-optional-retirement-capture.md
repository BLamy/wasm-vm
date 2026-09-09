---
id: E5-T26p
epic: 5
title: Specialize optional interpreter retirement metadata without changing effects
priority: 526.5996
status: implemented
depends_on: [E0-T16, E1-T04, E5-T26o]
estimate: S
risk: high
capstone: false
---

## Goal

Make returned retirement records optional at the shared interpreter boundary while
preserving every architectural effect. Source constructors and a trace-symbol scan
do not prove generated overhead; inspect matched actual artifacts before adoption.
This task makes no F latency or Omarchy performance claim.

## Boundary

One shared Hart instruction match and architectural commit, with private recording
and unit-returning capture modes. Track successful-store address/width independently
of optional trace records; retain the existing retirement overlap check. SC's current
reservation consumption before a potentially faulting store stays inside its arm.
Keep all translation, bus, register/FP/CSR/PC, counter, WFI/xRET and trap ordering.

Only existing `Hart::step` and `Machine::run` select the unit mode through private
ordinary/cached dispatch. Public `step_traced`/`run_traced`, arbitrary sinks (including
`wants_records=false`) and `exec_oracle` retain existing behavior. No TraceSink API or
object-safety change; its wants_records method still governs only JIT admission.
Do not duplicate instruction semantics. Cache write-log draining, FenceI handling,
physical cross-page logging and DMA invalidation remain unchanged.

The Linux browser caller selects this existing untraced API too: remove only the
local `NullSink` in `WasmLinux::run_chunk` and replace its one
`inner.machine.run_traced(step, &mut sink)` call with `inner.machine.run(step)`.
Preserve the outer cooperative-run scope, UART/persistence slices, pending-input
refill, pressure exit, outcomes, console output, retired accounting and JIT admission.
No other WASM production source change is in scope.

No JIT policy, clocks, budgets, guest/image/helper, F harness/deadline, snapshot format,
ISA capability, independent-machine or Epic6 work. Ownership is this one capture boundary.

## Acceptance criteria

- Matched optimized baseline/candidate native and actual-WASM artifacts retain exact
  source/toolchain/flags/digests. Inspect reachable ordinary/cached callers and execute
  callees: demonstrate removed return-buffer/metadata work for unit mode, retaining
  recording as positive control; report code-size effects. Stop this candidate before
  broad submission or another F boot if elimination is not demonstrated. Microbenchmark
  numbers, if collected, are not a browser speedup claim.
- Ordinary/cached × recording/untraced cases with JIT disabled agree with independently
  retained baseline outcomes for integer/FP registers, PC, CSR/counters, reservations,
  traps/raw compressed tval, RAM and ordered MMIO effects. Keep no trace records on traps
  and preserve custom-sink callbacks even when wants_records returns false.
- Cover overlapping/nonoverlapping scalar/FSW/FSD successful stores, faulting stores,
  LR/SC success/failure/alignment/access faults, AMO old/new values, misaligned/cross-page
  effects, code-page SMC/DMA invalidation, and ordinary/cached control-flow/counter seams.
  Guest traces and state digests are evidence; comparing only two new paths is insufficient.
- The bounded native and actual-WASM suites named by the critic pass, with focused parity
  fixtures and one isolated reservation-effect sabotage. Relevant format/clippy/build and
  the existing zero-cost selftest pass; the symbol scan is not the artifact proof.
- One built-demo126/0 capture has zero non-favicon browser/HTTP errors. Final frozen source
  passes one pristine local clone and fresh adversarial verification. Expose verified task
  metadata only after that verdict, preserving unrelated manifest edits. Defer production
  deployment to the user-authorized Epic5/merge/Omarchy boundary.

## Verification command

make verify-E5-T26p

Keep this command scoped to the affected interpreter/capture fixtures and existing
hart_memory, trace_mem_exec, trace_retire, rv64a/f/d, predecode_diff, predecode_smc_diff,
zicntr native targets plus actual-WASM hart_mem, jit_browser_parity, rv64a/f/d and mmio.
Include existing Linux `runChunk` regressions for the bounded caller migration.
Main owns artifact admission, the single built-demo and final clone. Unchanged prior
PLIC/JIT/image/observer evidence carries forward.

## Adversarial verification

Predict concrete state before inspecting retained baseline/candidate results. In particular,
distinguish SC's existing early reservation consumption on a fault from successful-store
overlap invalidation. Attack a custom non-record-requesting sink with observable callbacks;
it must not be silently disabled. Check recording metadata widths/values, x0 suppression,
compressed trap tval, counter suppression and both pages of a crossing write. In an isolated
scratch copy, sabotage one successful-store reservation effect and demand test failure;
restore/hash it afterward. Audit generated untraced code and its reachable callee, not only
source-level constructors or the presence/absence of trace symbols. No old-seal reuse,
weakened guard, timing inference, rr, WebKit, second clone or unrelated replay.

## Verification log

### 2026-09-08 — coordinator — bounded activation

Fresh Daybreak preflight first refused the vague candidate, then approved the concrete
design; both findings are retained in `evidence/e5-t26f/null-trace-candidate/`.
Design digest `8f493e2b1196abcdfa94164819d17d5500de793276dcd3f225b03ecf1ad70891`;
critic report `de0d2d43ee454e604384b13601dd56c3af6fcfcd848bdadeea43d7f17047d897`.
Existing runtime before any implementation is web WASM
`20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.
No generated overhead, semantic equivalence or latency benefit is claimed at activation.

### 2026-09-08 — coordinator — Linux caller routing preflight

Fresh Daybreak approved only the two-line Linux caller migration described above,
in `evidence/e5-t26p/verifier/caller-preflight.md`. The caller otherwise always uses
the recording API with NullSink, so a core-only specialization cannot reach this
browser path. This is source-routing approval, not artifact or runtime verification.

### 2026-09-08 — coordinator — artifact admission, semantics still pending

Fresh Daybreak's `evidence/e5-t26p/verifier/artifact-verdict.md` holds A1–A7:
actual native and authenticated production-WASM ordinary/cached unit callers
eliminate returned retirement metadata, while recording remains a positive control.
`artifact-index.json` digest is
`dc53ee61a9caa4e6d93c72617b2ab94f8e7c044bab395a19737db7edf0a08d07`.
The actual release WASM grows 5,863 bytes (code section +5,850); native text grows
7,112 bytes. The old Linux-specific execute body was smaller than the new unit
specialization despite the removed stores. This is not a speed or F-latency claim.

Commands and exact source/toolchain/flags/binary identities are retained in the
matched probe results, `production-candidate-r1/result.json`, and both release
`binding.json` files. The earlier baseline build missing archived toolchain/config
is excluded; its failure record remains. No broad gate, final clone, demo, F boot,
merge or deployment is claimed. The first semantic scaffold lacked the required
four-way hazard coverage and actual seeded reservations in overlap-labelled cases;
it is being corrected before independent old-source comparison.

### 2026-09-08 — coordinator — canonical native/WASM state comparison

Final shared producer digest
`62ce60205676c1ed59b2e11395c36337278cdd65d6fd9d4f56be4a4e13e7c5c9`.
`node evidence/e5-t26p/record-semantics.mjs r1` executes the same public-API fixture
on the untouched old runtime archive before the candidate. Both complete 266
cases/modes, with byte-identical full output (202,466 bytes; digest
`5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`).
`semantics-r1/result.json` binds both retained native binaries, compiler versions,
fixture/source hashes, commands and outputs. No candidate semantic oracle is
substituted for the old-source execution.

The actual-WASM wrapper runs that identical producer and asserts its whole output
equals the old-source golden: `wasm-pack test --node crates/wasm --test
retirement_capture_baseline -- --nocapture`, exit0, one test/266 cases.
`semantics-r1/wasm.log` digest
`dbeefd2e7f15c5e4a8b85b6eb8ea952c432fc6d3226f0f25ed737b9fe362f995`.
This covers the recorded state comparisons; it is not yet a completed fresh
verifier verdict, full task submission, F latency or Omarchy proof.

### 2026-09-08 — worker — frozen submission before the sole clean clone

Runtime diff against activation `d7d308a58825e6856db532822e36e1681230027a`
has SHA256 `f941c441bd0be5938a45abd9db36994be5ee451f999894e42cdd37581ccfe989`.
Frozen files: Hart `ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39`,
core lib `9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053`,
WASM lib `676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034`.
Production WASM remains `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.

Fresh Daybreak holds the canonical 266-case comparison, its promoted x0/MMIO
false-sink native/WASM attack (two tests each), and the single isolated reservation
effect sabotage: `evidence/e5-t26p/verifier/semantic-and-novel-verdict.md`,
SHA256 `425bb6e9bff20aa2ecc7f34fd67b3874c8ca3faea53d710427f598f422b3aff0`.
The mutant fails the first seeded overlapping SB reservation assertion; retained
scratch and real-source pins prove restoration. No second sabotage is needed.

The scrubbed `make verify-E5-T26p` submission passes 74 native and 82 WASM tests
plus the full native producer, format, clippy, target builds and zero-cost positive
control. `main-gates/02-task-gate.log` SHA256
`fbec932669aa9749f5f23f6a4f960f2d091943a44a70ffe1e0ddc338aefedbf2`.
The existing exact `csr::fence_i_and_wfi_retire_as_noops` test adds one native
pass, now included in the final recipe: `main-gates/04-fence-wfi.log`, SHA256
`792d2caa0797b66005b47680ec1d4203d8de555b09f608e2e73484242ff94754`.
One pre-existing E4-T33 long-churn ignore is unchanged and outside this boundary.

`make web-dist` and the single `E5_DEMO_TASK=E5-T26p
E5_DEMO_OUT=evidence/e5-t26p/demo-a3ce0252 node
tools/verify/e5-t18e-demo-smoke.mjs` capture pass: 126/0, empty browser/HTTP
error arrays. Screenshot SHA256
`997b0ca38ce7de4b911cd034a3e6dab5a8b1140a53061fc41bc9ed63c118db26`;
demo log SHA256 `9c12cdde69b1d1ccd32e8440cd4483d2cb220f6b91e8270adcc52cb9fa34c1fd`.
The verifier's grouped hunk ledger and gate adjudication are in
`evidence/e5-t26p/verifier/coverage-and-gates.md`; artifact bindings and lossless
archives are indexed in `artifact-index.json` and `packed-artifacts.json`.

This submission demonstrates equivalent architectural effects with optional
retirement metadata on the admitted native/WASM paths. The sole exact-commit
clean clone and final verdict are next; no F speedup, Linux/Omarchy boot, merge
or deployment is claimed. The task remains in progress until that proof completes.

### 2026-09-08 — worker — implemented, exact-head clean clone passed

Frozen source/tests/bundle/evidence commit:
`078500ebbef1c5d90adf973790ad68b7579a5879`. Command:
`bash evidence/e5-t26p/run-final-clone.sh 078500ebbef1c5d90adf973790ad68b7579a5879`.
The sole pristine local clone is retained at
`/private/tmp/e5-t26p-final.NtmIRa0D/repo`, detached at that exact commit, with
no object alternates, scrubbed build settings, fresh target directories and clean
initial/final checkout. `make verify-E5-T26p` exits zero: 75 native tests,
82 actual-WASM tests, canonical 266-case native producer and WASM old-golden
comparison, prescribed checks/builds and detector selftest all pass.
`evidence/e5-t26p/main-gates/06-final-clone.log` SHA256
`661b13b6656bbbece2131a0c982b79d78b13e3a67016f251d28a5ee55c513c9d`.
The already-held hunk ledger digest is
`7df1d78113331c5a180982720d3c2db4d24de2ff7889717301f285ee1ebbb06b`.

The final clone reproduces the bounded optional-capture claim from committed
inputs, without relying on the worker's output directory or uncommitted fixtures.
All runtime pins and the single demo's admitted WASM digest remain unchanged.
Status is implemented pending fresh Daybreak's final verdict; F, Epic5 completion,
merge and Omarchy deployment are not claimed.
