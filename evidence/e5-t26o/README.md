# E5-T26o: sparse PLIC selection

Runtime and worker fixtures freeze at `02c79f5672c3f1a08a3429f7b32dce4e051a41ec`.
The only production diff is the ascending set-bit loop in `PlicState::best_source`.
Source SHA256: `9f5def69ccf6e98fb72185a9a2714c00caa5de16fe97c218d5555f93f4dc55f1`.
The shared fixture after edition-2024 formatting and equivalent seed-literal grouping
has SHA256 `8d9e49aacdb6709c331e53b210d84e148f900345a7be6c180fddf3c6d63e3814`.
Worker markdown files are self-validation claims, not raw recordings. Earlier draft
guest fixtures were corrected before freeze; none is offered as final evidence.

## Recorded local gate

`main-gates/01-frozen-gate.log` retains a setup failure: compiling existing core lib
tests with only `trace` fails because the GPU test references `cursorq_commands`.
Commit `a7240d6d41dd030e6b715b9a5aa38ce7ff9b9a89` enables the existing `gpu-trace`
feature on that unit-test command only. There is no GPU runtime fix in this task.

The corrected command, from the repository root:

```sh
env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR \
  -u CARGO_ENCODED_RUSTFLAGS -u MAKEFLAGS -u MFLAGS make verify-E5-T26o
```

`main-gates/03-corrected-gate.log` records exit0: scoped fmt and clippy, two PLIC
snapshot unit tests, thirteen interrupt tests, ten existing PLIC tests, four new
native fixtures, one existing chained-device-delivery test, both affected target
builds and three actual wasm32 fixtures. Thirty native and three WASM tests pass.
The captured native invalid-index panics are expected and caught. The unchanged
`hart_ctrl.rs` unused-import warning is not a PLIC result.
Log SHA256: `036a1b0a0162a6c84c53b93e44e3a9c51a203af367810a901876ac07449e0f89`.

The new fixture executes 152 explicit/fixed-seed context cases, 27 real-bus hits,
and a real machine-external interrupt followed by claim, deasserted completion and
MRET. `main-guest-oracle.mjs` derives words, architectural effects, canonical trace
and the SHA256 of independently constructed RAM without importing the emulator or
observed output. Its JSON predates this recorded run. The 21-retirement trace and
asserted trap/return state agree. Digest
`c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891`
is RAM-only, not a full architectural-state hash.

## Built demo

`make web-dist` is retained in `main-gates/02-web-dist.log`; an EXIT trap preserves
the user's two unrelated dirty dist artifact manifests. The built WASM is 1549483
bytes, SHA256 `20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238`.

```sh
E5_DEMO_TASK=E5-T26o E5_DEMO_OUT=evidence/e5-t26o/demo-02c79f56 \
  node tools/verify/e5-t18e-demo-smoke.mjs
```

One local Chromium load yields 126 passed / 0 failed, no non-favicon console or
HTTP errors, and the visible in-progress task. JSON, viewed PNG and stdout are
retained in `demo-02c79f56/` and `main-gates/04-demo.log`. Screenshot SHA256:
`46a753395058747ae625cdc575bcabb1ecfb0700d4f960e01d1536a25dda88a6`.
This is ISA/demo evidence, not an Omarchy boot or F latency measurement.

## One isolated mask sabotage

Scratch `/private/tmp/e5-t26o-mask-sabotage.jn4zZS0E` contains a git-archive copy
of the frozen workspace, no real-repository runtime mutation. Only its selector's
`& !1u32` is removed. An EXIT/HUP/INT/TERM trap copies `plic.rs.original` back.

The first launch did not execute tests: the partial archive omitted a workspace
member. That failure remains in `main-gates/05-mask-sabotage.log`. After completing
the archive with `guest` and `tools/fuzz`, one actual mutant test was executed:

```sh
env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR \
  -u CARGO_ENCODED_RUSTFLAGS cargo test -p wasm-vm-core --features trace \
  --test plic_sparse selector_and_snapshot_cases_match_old_range_oracle \
  -- --exact --nocapture
```

`main-gates/06-mask-sabotage-complete.log` records the expected exit101: the
ordered explicit source0-MAX plus source31-(MAX-1) case asserts EIP true but
observes false at shared fixture line220. Earlier explicit rows, including bit0
alone, did not fail. Log SHA256:
`964edaac68021bd2ee95d221818fe5db40c69c2d0fd0401246fea9fe0102b1b9`.
The trap restored the scratch source; `cmp` with its backup succeeds and both
scratch and real source hashes equal the frozen `9f5def69…` above. This is one
executed mutation, not two semantic attacks.

## Promoted variant and sole final clone

The critic's independent seed0x260f0031 executes128 context claims (69 nonempty,
59 empty), then tie1/31 exhaustion and hostile both-bank reversed completion.
Both native and actual-WASM variants pass; the regression is promoted under
`plic_sparse_verifier`. Final source/test/gate/bundle freeze is
`aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0`. No production change followed02c79.

```sh
bash evidence/e5-t26o/run-final-clone.sh aaa8d40625eaf3a2bf9ba6a5dbe4ef0909495ca0
```

The sole clone `/private/tmp/e5-t26o-final.9J3lj8Wm/repo` starts and ends clean,
has no object alternates, uses a fresh target and scrubbed compiler/test settings.
The complete final task gate passes31 native and4 actual-WASM tests, both clippies,
format and target builds. Raw `main-gates/07-final-clone.log` SHA256:
`0aa00c3c134abf74209dae64b4f45691eb61c08a6c98fe1ccc36a826f0390597`.
The critic's files document its independent coverage, state predictions and novel
attack. Final verdict follows the implemented submission. No F acceptance,
speedup, merge or deployment is claimed.
