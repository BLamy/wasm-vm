# E5-T26p critic coverage and gate adjudication

**BOUNDED VERDICT: HELD — grouped runtime-hunk coverage, scoped gates, and the single demo are admitted.**

This file binds evidence already inspected by the independent verifier. It records no new run,
requirement, runtime claim, or task-status verdict. The final frozen-source commit and its single
pristine-clone proof remain owned by Main and are not adjudicated here.

## Frozen evidence carried forward

- Compiled-artifact A1–A7 verdict: `verifier/artifact-verdict.md`, SHA-256
  `19e852e324a1db3beb1c1f977306d22b29a4e35d30a2caedcda2cc3142e2b6df` — HELD. Actual native and
  authenticated production-WASM unit callers eliminate returned retirement metadata while
  recording callers retain it. The full artifacts grow; no speed, latency, or shrink claim is made.
- Retained-baseline semantics, novel attack, and reservation sabotage verdict:
  `verifier/semantic-and-novel-verdict.md`, SHA-256
  `425bb6e9bff20aa2ecc7f34fd67b3874c8ca3faea53d710427f598f422b3aff0` — HELD. The native
  old/candidate producer emitted 266 byte-identical case rows with stdout SHA-256
  `5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`; actual WASM compared the
  same producer output with that independently retained old-source golden.
- Fresh false-requesting-sink x0/MMIO attack: native log SHA-256
  `dc4e8ad1f02695c3a48014192f2cd10b3330839baa8257caf263c070b4b2b6b2` and actual-WASM log
  SHA-256 `b521328b8b8c311e67002658efeaa558c6035771e9b343ddeb4db9025483dfa6` — HELD, 2/2 on each
  target. Successful ordered MMIO reads retained callbacks and x0 suppression; faults emitted no
  callback and did not retire.
- Isolated successful-store reservation sabotage — HELD. Suppressing only the shared overlap
  clear made the canonical producer fail first at `scalar-sb-overlap`; SC's independent pre-fault
  consumption remained untouched. Mutant stdout/stderr SHA-256 values are
  `502f50ea7355b84dba082484e09cd2c16da7fc8a3a08ef4d237388a0ed29ee3c` and
  `207e303872eb26548cf444e32b389694f8022f857c45775dc00843faf7dd37db`; the scratch and workspace
  runtime hashes were restored.

The admitted candidate runtime pins are:

```text
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
```

## Grouped owned runtime-hunk coverage

| Owned runtime hunk group | Admitted execution/inspection | Classification |
|---|---|---|
| Hart capture strategies and `step`/`step_traced` routing | Artifact A2–A4 identifies distinct native/WASM unit and recording monomorphizations. The 266-case producer executes direct Hart unit/recording success and trap paths. The promoted x0/MMIO attack executes direct public unit and false-requesting traced paths with exact callbacks. | **HELD** |
| Shared `Hart::execute` signature, one instruction match, common finish/retire commit, and `exec_oracle` recording compatibility | Artifact A3–A5 proves unit return-metadata elimination, recording positive control, one instruction match, and one architectural commit. The producer compares full Hart/RAM/MMIO/trace state against independently executed old source across direct and Machine modes; `exec_oracle` is compatibility-only and is not used as the baseline. | **HELD** |
| Load/store capture calls and successful-store range decoupling for scalar, FSW/FSD, LR/SC, and AMO arms | The producer covers all scalar/FP store widths, overlap/nonoverlap, live PMP faults, LR/SC alignment/mismatch/success/access fault, AMO.W sign extension, AMO.W/D overlap/nonoverlap, misalignment and cross-page effects. The isolated overlap sabotage fails at the first intended scalar overlap case while leaving SC early consumption intact. | **HELD** |
| Machine capture policy, ordinary/cached `step` and `run` routing, cache-write drain, retirement/counter accounting, and recording callbacks | Artifact A2–A4 maps actual `Machine::run` and `run_traced` ordinary/cached caller-callee chains. The 266-case matrix executes ordinary/cached × unit/recording outcomes, counters, control flow, compressed traps, SMC and DMA. Focused native/WASM capture tests and the verifier's false-sink attack provide positive callback and trap-negative controls. | **HELD** |
| JIT-admission seam where `wants_records() == false` permits compiled admission without selecting unit capture | Source and artifact inspection bind false-requesting public sinks to recording capture; focused false-sink tests retain interpreter callbacks. Scoped WASM JIT/browser parity and wrapper tests exercise admission, compiled retirement, precise fault, code-store and invalidation seams. | **HELD** |
| `WasmLinux::run_chunk` removal of its local `NullSink` and sole call migration to `Machine::run` | `verifier/caller-preflight.md` SHA-256 `68c2e2c1daea9609bbfd1a0dfbb5df3a6d744c7bf729020a08d0c47f0d9bcded` admitted exactly this source delta. Production-WASM artifact A2 reaches candidate `WasmLinux::run_chunk` → `Machine::run` → unit execute. Scoped `discovery_stats`, `icount_divider`, and cooperative-run browser parity regressions exercise actual `run_chunk` accounting/JIT state and the preserved outer scope. | **HELD** |
| FenceI/WFI/xRET seams adjacent to capture and cached retirement | Native `predecode_diff::riscv_tests_cache_on_is_byte_identical` executes all 127 vendored ELFs through recording `run_traced` in cache-off, large-cache, and one-entry-cache configurations, including `rv64ui-p-fence_i`. The browser manifest includes the same FenceI ELF and the 126/0 suite executes `WasmMachine.run` with the fast interpreter enabled, covering actual-WASM unit cached dispatch. Supplemental direct unit `Hart::step` test `csr::fence_i_and_wfi_retire_as_noops` passed 1/1; native privilege tests cover WFI trap and xRET behavior. | **HELD** |
| `zicsr-stub`-gated compatibility adapters and non-executable comments/types | Structural inspection confirms the gated adapter uses the same capture strategy and introduces no second instruction match. It is outside the production artifact/effect claim; comments and type-only declarations require no execution classification. | **NARROWLY WAIVED** |

No owned production runtime hunk remains classified as dead or needs-evidence within the bounded
E5-T26p claim.

## Scoped gate adjudication

`main-gates/02-task-gate.log`, SHA-256
`fbec932669aa9749f5f23f6a4f960f2d091943a44a70ffe1e0ddc338aefedbf2`, is **HELD**:

- format and the task-scoped native/WASM clippy commands completed;
- 74 native tests passed, including focused capture/verifier tests, memory/trace, RV64A/F/D,
  predecode/SMC, counters, and privilege; the 127-ELF three-cache differential completed;
- the canonical native producer completed all 266 cases;
- both required wasm32 builds completed;
- 82 actual-WASM tests passed with zero failures and one documented pre-existing ignored long
  churn test; focused capture/baseline/verifier, Hart, MMIO, RV64A/F/D, JIT parity, runChunk and
  wrapper targets were present;
- the supplemental zero-cost selftest passed. It remains supplemental static evidence, not the
  compiled-artifact proof.

`main-gates/04-fence-wfi.log`, SHA-256
`792d2caa0797b66005b47680ec1d4203d8de555b09f608e2e73484242ff94754`, is **HELD**: the existing
direct-unit `csr::fence_i_and_wfi_retire_as_noops` test passed 1/1. This closes the only coverage
item identified during the prior gate/demo adjudication; it did not change a fixture or runtime.

## Built-demo adjudication

The single built demo is **HELD**:

- the emitted production WASM is 1,555,346 bytes with SHA-256
  `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`, matching the admitted
  production candidate release;
- `demo-a3ce0252/demo-suite.json`, SHA-256
  `0c5700b74413e512fd592333ee531f5fd6b961482589802394f9511ebfd3f84a`, records 126 passed, zero
  failed, 126 done, with empty admitted browser-error and HTTP-error arrays;
- `demo-a3ce0252/demo-suite.png`, SHA-256
  `997b0ca38ce7de4b911cd034a3e6dab5a8b1140a53061fc41bc9ed63c118db26`, visibly shows the same
  126/0 completion. The captured favicon 404 is the explicitly permitted exception.

## Remaining boundary

Artifact, semantic, novel-attack, sabotage, grouped hunk coverage, scoped gates, supplemental
FenceI/WFI check, and the one demo are all held. This adjudication creates no requirement for a
rerun. It does not pre-adjudicate Main's exact frozen-source commit, explicit staging, tasklog or
metadata update, nor the one final pristine clone.
