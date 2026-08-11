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

---

## 2026-08-10 incremental re-verification at `ca0753b`

**VERDICT: needs-evidence.** Runtime behavior remains unrefuted, the new capacity admission holds,
and the committed matrix is internally coherent. P8 is still not independently interrogable,
because the field named `oracleTranscript` is reconstructed from regex captures after the bounded
raw terminal buffer is discarded. The rerun therefore preserves parser conclusions rather than the
terminal recording needed to distinguish measured Node output from unrelated output before the
completion marker.

### Incremental prediction results

- **I1 HELD; P1-P7/P9-P15 carried forward.** `3a497a5..ca0753b` changes only the Node evidence
  harness/tests, evidence, and task/generated metadata. Runtime source and the generated Wasm remain
  frozen; `web/pkg/wasm_vm_wasm_bg.wasm` is still
  `6c2f93745877550b74c031d0d170539a1b29cc910aabdf09c7239394455c64a1`.
- **I2 NEEDS EVIDENCE.** The ledger has twelve exact commands, standalone-output fields, positive
  PIDs, zero exits, attempt-scoped sequences, markers, and reconstructed transcripts. All twelve
  sequence/PID identities are unique, and each restored session has two distinct PIDs. Raw PIDs
  repeat as `838` x4, `839` x2, and `846` x6 because each independent snapshot restore resets guest
  process state; the frozen prediction that all twelve numeric PIDs would differ was over-strong and
  is not a task finding. The recording finding below remains.
- **I3 HELD.** Exactly six clean attempts occupy the fixed counterbalanced order, with no discarded
  or recovered attempt. All 30 phase sidecars bind to the corresponding started/finished event and
  identity; the pre/post root evidence files match the ledger evidence byte-for-canonical-byte.
- **I4 HELD.** The reference worktree bytes equal
  `ab3e6fc4:evidence/e4-t32/node-walltime-aca4484/E4T32_NODE_LEDGER_V2.json`. Independently
  reproduced physical/logical hashes are `787e44783bfe73a1e716661e8e9da5d6e00715b660504970faaae9838c02d130`
  and `f3e584282ebe150fce9e128b126aa6502e6264334c2ad7653a24fd9ad0d1bea0`;
  the 12 accepted old phase medians derive the exact 329.125/329.7250000014901 ms capacity
  baseline. Every new phase's raw pairs, alternating order, checksums, summaries, relative verdict,
  and absolute verdict recompute. Window/Worker phase medians span 316.800-343.750 and
  319.900-337.850 ms; absolute ratios span 0.962552-1.044436 and 0.970202-1.024642.
- **I5 HELD.** Result, aggregate, physical-ledger, logical-ledger, candidate identity, source,
  generated-package, sidecar, and inventory identities reproduce. The 46-file / 1,070,124-byte
  bundle inventory is `74ee019c19c0ea1889d1e7694547998c9f18e72b4b6c26cf8b9a7b727ee0c0ff`;
  result/aggregate/physical/logical ledger hashes are `a656321d6fad9fa51b31b57e8f6aa429242f511f90e5497fd2c63c2fb3bee6d3`,
  `87f82788d7f7583e4e8aad7ffb6c21732c2b8dabb4beb99e611427f01d09ece4`,
  `b6c62884c097d44c259d662fcec1defe5fe997f4e9216117b98d0d0a7778bfdd`, and
  `8d26f4ecf80310f729b7cbd66f3ceb4f8077e2990c458fed7359c7486cce6768`.
  Recomputed worker/main ratios are 1.005110 first, 1.004543 completion, 1.003298 cold first,
  1.003158 cold completion, 0.994996 later median, 0.996014 later max, and 0.993668 stretch.
  Worker rAF p99 is 18.585-18.660 ms; input/RPC is 175.220/51.085 ms; JIT512 executed
  24,458,996 blocks and retired 132,315,918 instructions through JIT.
- **I6 HELD for canonical-field sabotage, but the novel raw-stream attack exposed the remaining
  gap.** The focused calibration/oracle/ledger/journal/identity/store/failure suite passed 81/81.
  Mutating one accepted output field and independently mutating a raw calibration sample both made
  ledger validation fail closed. The stream-equivalence attack below instead survives because the
  distinguishing raw bytes are intentionally discarded.

### Remaining finding

**NEEDS EVIDENCE — `oracleTranscript` is a synthesized reduction, not a frozen terminal
capture.** `runNodeProcess` retains sanitized terminal text only in memory at
`web/tests/e4-t32-node-walltime.spec.js:423-437`, extracts two regex groups at lines 438-450, then
constructs `${outputLine}\n${completionMarker}\n` at line 451 and persists only those reduced
fields at lines 462-474. The shared helper repeats that construction at
`web/tests/helpers/e4-t32-node-oracle.mjs:55-69`, and validation requires the reconstruction rather
than raw bytes at lines 126-129.

A bounded novel attack supplied (A) the submitted source, standalone `3`, and marker, and (B)
`UNRELATED_STALE_OUTPUT\n3\nNODE_NEVER_PROVEN_AND_INTERVENING_NOISE\n<marker>`. Both produced
byte-identical validated oracle objects. Consequently the committed artifact cannot show that no
unrelated output intervened, or independently attribute the retained `3` to the child waited on by
the marker. This is the same acceptance-critical raw-recording gap identified in the first verdict,
not a runtime contradiction.

**Demand:** persist the bounded raw sanitized terminal slice from subscription/command echo through
the concrete marker (including exact output/marker offsets or an equivalent hash-bound raw record),
or record a guest exec/output trace that binds the Node PID and output. Then rerun only the six-slot
Node evidence boundary; unchanged runtime, rr, browser, cold-clone, and HELD results carry forward.

### Commands and suite disposition

- `node --test tests/e4-t32-node-calibration.test.mjs tests/e4-t32-node-oracle.test.mjs
  tests/e4-t32-node-ledger.test.mjs tests/e4-t32-node-attempt-journal.test.mjs
  tests/e4-t32-node-identity.test.mjs tests/e4-t32-node-ledger-store.test.mjs
  tests/e4-t32-node-failure.test.mjs`: 81/81 passed.
- Independent Node auditors recomputed the commit-object provenance, canonical identities, all
  phase/sample verdicts, sidecar bindings, raw run aggregates, ratios, responsiveness, and JIT
  counters without calling the production reducer.
- Sabotage: accepted `outputLine = "4"` was rejected as `refuted/invalid-session`; one raw
  preflight duration mutation was rejected on recomputed pair-ratio mismatch.
- The current artifact's twelve timing triples are coherent and its calibration samples are stable.
  Separate probes found future-harness hardening opportunities (explicit timing relationships,
  per-sample absolute dispersion, and canonical decimal marker spelling), but none contradicts this
  exact evidence and none expands the present demand.
- **SUITE:** no promotion while the raw-recording gap remains. The two requested mutation checks are
  already load-bearing in the focused suites; the stream-equivalence probe is retained here as the
  exact verifier demand.
