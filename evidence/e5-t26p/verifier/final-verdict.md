# E5-T26p final independent verifier verdict

**VERDICT: verified**

Fresh independent verification failed to refute E5-T26p. The bounded optional-retirement-capture
claim, owned runtime hunks, promoted tests, artifact proof, retained-baseline semantics, adversarial
attack, sabotage, scoped gates, built demo, and sole pristine clone all hold. No F latency,
Omarchy/Linux boot, whole-artifact shrink, merge, deployment, or broader performance claim is
included.

## Exact frozen identity — HELD

The runtime/test/bundle/evidence freeze is commit
`078500ebbef1c5d90adf973790ad68b7579a5879`. Implemented-proof commit
`9186874841ce39df380a3cf36f17b0eca01e63b8` adds the retained clone log, implemented claim, and
generated task metadata without changing `Makefile`, Cargo inputs, runtime, promoted tests, or the
production WASM. Incremental carry-forward is therefore valid under the repository's verifier
policy.

Committed candidate pins at both commits are:

```text
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42  web/dist/pkg/wasm_vm_wasm_bg.wasm
```

## Carried independent findings — HELD

- Artifact predictions A1–A7 remain HELD in `artifact-verdict.md`, SHA-256
  `19e852e324a1db3beb1c1f977306d22b29a4e35d30a2caedcda2cc3142e2b6df`. Matched optimized native
  and authenticated production-WASM caller/callee code removes returned retirement-metadata work
  from actual unit ordinary/cached paths while recording paths retain it. The disclosed tradeoff is
  net growth: native text +7,112 bytes and production WASM +5,863 bytes; no speed or shrink inference
  is admitted.
- Semantic predictions P1–P13, the promoted x0/MMIO false-requesting-sink attack, and the isolated
  reservation-overlap sabotage remain HELD in `semantic-and-novel-verdict.md`, SHA-256
  `425bb6e9bff20aa2ecc7f34fd67b3874c8ca3faea53d710427f598f422b3aff0`. The independently executed
  old and candidate native producers emitted 266 byte-identical cases, and actual WASM matched the
  retained old-source golden, all with canonical output SHA-256
  `5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`.
- Every owned production runtime hunk is HELD, with only the documented non-production
  `zicsr-stub` compatibility/type group narrowly waived, in `coverage-and-gates.md`, SHA-256
  `7df1d78113331c5a180982720d3c2db4d24de2ff7889717301f285ee1ebbb06b`. No hunk remains dead or
  needs evidence.
- The scoped pre-freeze gate remains HELD: `main-gates/02-task-gate.log`, SHA-256
  `fbec932669aa9749f5f23f6a4f960f2d091943a44a70ffe1e0ddc338aefedbf2`, passed 74 native and 82
  actual-WASM tests plus the native 266-case producer, format, clippy, target builds, and zero-cost
  positive-control selftest. The direct unit FenceI/WFI supplement passed 1/1 in
  `main-gates/04-fence-wfi.log`, SHA-256
  `792d2caa0797b66005b47680ec1d4203d8de555b09f608e2e73484242ff94754`.
- The single built demo remains HELD at production WASM `a3ce0252…`: 126 passed, zero failed, empty
  admitted page/browser and HTTP error arrays. Screenshot SHA-256 is
  `997b0ca38ce7de4b911cd034a3e6dab5a8b1140a53061fc41bc9ed63c118db26`; the permitted favicon 404
  is not a finding.

## Sole pristine clone — HELD

Prediction: the committed frozen source, without workspace artifacts or inherited build settings,
would reproduce the complete task gate and leave its checkout clean.

Observed: `bash evidence/e5-t26p/run-final-clone.sh
078500ebbef1c5d90adf973790ad68b7579a5879` created the retained non-local clone
`/private/tmp/e5-t26p-final.NtmIRa0D/repo`, detached it at that exact commit, verified no object
alternates and a clean initial checkout, scrubbed Rust/Cargo/E5/WASM build variables, and used fresh
target output. The final recipe passed:

- 75 native tests with zero failures;
- 82 actual-WASM tests with zero failures and the one unchanged pre-existing E4-T33 long-churn
  ignore;
- two complete 266-case producer invocations (532 `CASE` rows), including actual-WASM comparison to
  the retained old-source golden;
- scoped format, clippy, wasm32 builds, and the supplemental zero-cost positive-control selftest.

The log ends `verify-E5-T26p ... OK` and `Final checkout clean; make exit=0`. Evidence:
`main-gates/06-final-clone.log`, SHA-256
`661b13b6656bbbece2131a0c982b79d78b13e3a67016f251d28a5ee55c513c9d`.

## Coverage and suite disposition

The permanent focused native/WASM `retirement_capture` tests, independently promoted
`retirement_capture_verifier` tests and shared support, old-source semantic golden/producer, artifact
index, and scoped `verify-E5-T26p` recipe survive as the regression suite. The first incomplete
semantic scaffold and excluded baseline artifact attempt remain preserved as non-canonical failure
history.

There are no findings demanding rework or more evidence. E5-T26p satisfies its stated acceptance
criteria and may move from `implemented` to `verified`.
