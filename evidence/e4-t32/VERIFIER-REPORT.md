# E4-T32 fresh adversarial verification

- Submission: `ab3e6fc4ee68179a197d9f82d3a124a043d9e27d`
- Runtime/evidence head: `aca44846c85ea1e07c9c6d7534203fbab3f3b9f5`
- Final harness-only head: `2b2c34018cfdc546bb32f7f5d6c27e52d89301cc`
- Date: 2026-08-10
- Verdict: **needs-evidence**

The runtime claim was not contradicted. One acceptance-critical recording gap remains: the exact
Node matrix persists a reducer's booleans and timing fields, but not the terminal oracle that those
booleans summarize. That prevents an independent verifier from reopening the accepted artifact and
observing a runtime-only standalone `3`, its concrete completion marker, or distinct fresh process
identity.

## Prediction results

- **P1-P6 HELD.** Default/fallback backend selection, explicit policy and cooperative JIT limits,
  explicit FIFO controller semantics, quiescent teardown, generation-safe file transfer, and async
  UI consumers survived the focused Node/browser suites. The exact ownership sabotage described
  below failed the load-bearing test.
- **P7 HELD.** The accepted Node ledger records worker-interpreter input/RPC at
  114.030/53.175 ms and worker rAF p99 at most 18.655 ms. A fresh selected-JIT browser run under
  sustained `yes` load observed terminal input in 208.990 ms and RPC completion in 89.100 ms, with
  positive compiled/executed/retired JIT counters and no console errors. This combines the exact
  Node matrix's rAF proof with a direct selected-JIT input/RPC proof.
- **P8 NEEDS EVIDENCE.** The six-slot order and counts held, but the accepted artifact cannot
  independently prove the fresh, non-echo-spoofable process oracle; see the finding below.
- **P9-P10 HELD.** Independent derivation reproduced all parity ratios and all declared physical,
  logical, result, aggregate, source, generated-package, guest, browser, and rr hashes. The ledger
  has exactly two counterbalanced sessions, four accepted runs per variant, and positive JIT
  execution/retirement.
- **P11 HELD.** Every packed file passed its adjacent manifest. The three traces replayed
  byte-identically. In the budget trace, rr event 459 at `crates/core/src/lib.rs:2745` exposed
  attempt/staging/staged counters 8/32/32 and request/valid lengths 8/8. In the terminal trace, the
  second line-2351 hit at rr event 459 exposed `Exited(0)`, attempted/final-pump counters 0/0, and
  preserved budgets 64/256. Marked protocol replay exposed `1..22`, 22 passes, and zero failures at
  events 6779-6796.
- **P12-P13 HELD.** The fresh browser set covered deterministic initial-RAM/output/fallback parity,
  default and explicit Worker paths, fatal handling, timer fallback, cross-flavor ownership,
  teardown, and async transfer races. Core dispatch/JIT/cooperative-run/profiling hunks are covered
  by the eight async pipeline tests, the full core suite, rr, and the selected-JIT browser test.
  Worker protocol/host/worker/loader/main/quiescence hunks are covered by the 22 protocol cases and
  nine whole-worker cases; file-transfer hunks by the 15 transfer cases. Node ledger/journal/store/
  identity/failure harness hunks are covered by 63 focused cases. Asset preparation/serving,
  declarations, static roadmap text, and generated `web/dist` mirrors are waived as recording
  tooling or generated/static surfaces whose identities/builds were checked. No behavioral hunk
  was found dead or silently dependent on `cfg(test)`.
- **P14 HELD.** A `--no-local` pristine detached clone at the submission head, with `RUSTFLAGS`,
  `RUST_LOG`, and present `CARGO_*` overrides absent, passed policy, 85 focused Node cases, all eight
  async compile-pipeline cases, and `make web-build`. The rebuilt Wasm SHA-256 was
  `6c2f93745877550b74c031d0d170539a1b29cc910aabdf09c7239394455c64a1`.
- **P15 HELD.** A bounded end-to-end protocol attack sent a nonzero-offset subarray, immediately
  overwrote the caller's backing array, and observed the original `[1,2,3]` at the worker while the
  caller retained a five-byte attached buffer.

## Finding

**NEEDS EVIDENCE — the accepted Node artifact is a reduction, not an interrogable oracle
recording.** The harness constructs the exact `node -e 'console.log(3)'` command and matches a
standalone output line plus a completion marker (`web/tests/e4-t32-node-walltime.spec.js:432-475`),
but returns only timings, exit status, `sawExpected`, and progress (`:455-462`). Its durable leg log
further excludes `sawExpected`, command text, raw terminal bytes, and the concrete marker
(`:798-829`). Correspondingly, `E4T32_NODE_LEDGER_V2.json` path
`events[1].session.runs[0]` contains `sawExpected: true`, `exit: 0`, timings, counters, and an empty
progress list, but no raw standalone `3`, command, marker, or process identity. The marker at line
437 embeds shell `$$`, not Node's PID. This does not contradict the runtime result or the soundness
of the reducer, but it is insufficient to independently replay the acceptance criterion's explicit
"record a non-echo-spoofable fresh node -e matrix" claim.

**Demand:** rerun only the Node evidence/harness path and bind a bounded per-process oracle capture
into each attempt sidecar and accepted ledger (or bind a guest/host trace that exposes the same
state). It must let a verifier observe the submitted command, runtime-only standalone output,
concrete completion/exit marker, and either distinct Node process identity or trace events proving
distinct execs, without changing the user's timed one-shot command. Runtime semantics are unchanged,
so previously held hashes/gates may be carried forward where their boundary and digest do not move.

## Fresh commands and suite decision

- `cargo test -p wasm-vm-core`: passed, including 8/8 async compile-pipeline attacks.
- Focused protocol + ledger/store/journal/identity/failure Node suites: 85/85 passed.
- `npx playwright test tests/e3-t21c-file-transfer-ui.spec.js tests/timekeeping.spec.js
  tests/e4-t32-file-transfer-async.spec.js tests/e4-t32-whole-worker.spec.js`: 25/25 passed in 1.5m.
- Three rr-soft replays passed; the Rust event states and protocol TAP event anchors above were
  independently queried.
- Pristine clone gates and the bounded P15 attack passed.
- Sabotage in a disposable clone changed `privateBytes()` from `view.slice()` to `view`; the exact
  ownership case failed at `web/tests/e4-t32-worker-protocol.test.mjs:149` with caller byte length
  0 instead of 5.
- **SUITE:** no new test promoted while the recording gap remains. Existing deterministic ownership,
  compile-budget, lifecycle, file-transfer, and whole-worker tests are load-bearing; the immediate
  mutation probe is redundant with their stable ownership contract and was discarded.
