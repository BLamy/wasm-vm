# Compile-queue observer — closed gates and independent collector attack

Frozen source/build `2ace135363cf0fa3cf7ba978fe6810e564eecc03`.
Prior source predictions are in `preflight.md` and `gates.md`. This increment
reviews closed gate/demo evidence only; the new cold/reuse remains unopened.

## Independent attack prediction — written before execution

Use a synthetic, same-generation completed-pump interval with **zero staged
nominations** and no admissions/backpressure delta, while ten pre-existing
residents drain: three cancel and seven pop, only two submit. Prediction:
`staged=0`, signed depth delta−10, cancelled3, popped7, poppedUnsubmitted5,
incomingRejected0, residentDisplaced0; historical backpressure remains visible.
This targets backlog-only accounting rather than the worker fixture's positive
staging/draining case. It is not guest/browser evidence or a claim that this
distribution occurred in F.

Change only the second endpoint's submission total so its delta is8 while pops
remain7. Staging conservation still balances, but the collector must refuse the
negative popped-unsubmitted residual. Both calls must leave their input objects
unchanged. No runtime or collector-source mutation is involved.

## Closed evidence result

**Observer plumbing P1–P4 HELD; P5 demo portion HELD, new cold/reuse NEEDS EVIDENCE.**
No material refutation. These dispositions cover the read-only observer and
collector, not F acceptance or a performance improvement. L and all unchanged
functional/architecture results carry.

Read the entire132-line recorded `make verify-E5-T26f-compile-queue-observation`
output. Its first line names the exact frozen head; completion line132 confirms
the scoped target finished. Source pins from the pre-launch review match both
current bytes and that commit, checked again after the attack.

- Log3–8: core/WASM fmt and core/native + WASM-target lib clippy complete.
- Log23–31: **five real WASM queue tests** pass, including both wrapper projections,
  actual backlog/backpressure/pops, detached-object/read immutability and real
  restore/cancellation lifetime behavior. The assertions described in `gates.md`
  now have recorded execution, not just worker claims.
- Log33–50: three affected capacity + six discovery WASM tests pass; total
  **14 actual WASM**, no ignored/failed tests. These are Node-hosted real WASM
  bindings/guest execution, not a Chromium desktop run.
- Log52–54,124–132: both helper syntax checks and **69 Node tests** pass:
  eleven new collector/wrapper tests plus affected held discovery/resident/protocol
  coverage; zero failed/skipped/cancelled. Synthetic collector and stubbed wrapper
  tests are not promoted into browser evidence.
- The pre-existing `hart_ctrl` unused-import warning remains visible at11–19.
  No warning suppression or unrelated runtime proof repeated.

The immutable getter and shared projection's nonzero/read-only paths execute in
the new five-test recording. Accounting refusal and exclusive CLI-output branches
execute in the six synthetic tests. Wrapper closed-child failure/head/source
checks execute with explicit mocks, as already classified. New actual runtime
binding/gesture/PCM/default-policy measurement awaits the separately owned cold
and reuse; no unfinished browser record was opened here.

## Independent attack observed

The standalone Node invocation imported the actual frozen
`compileQueueObservation` and exited0; all predictions above held. Exact
synthetic queue inputs were:

| Scalar | Before | After |
|---|---:|---:|
| admitted | 23 | 23 |
| droppedBackpressure | 7 | 7 |
| cancelledStale | 2 | 5 |
| popped | 11 | 18 |
| queueDepth | 10 | 0 |
| queueHighWater / capacity | 20 /256 | 20 /256 |
| nominated / discovery FIFO depth | 30 /0 | 30 /0 |
| jitSubmittedMembers | 8 | 10 |

Both discovery generations5, high-water30, candidate/drop/excluded values0;
dedup100→101, guestRetired100→101, JITretired50→51. Synthetic run used the real
collector's required resident/play5ms/JIT1/repack-off24/decoded4096/no-observers
shape, frozen bound head, T0=100, end=3100, beforeRPC101–102 and after3100–3101,
with the exact original cap error. Snapshot label was explicitly
`unit-only-not-a-browser-snapshot`, not a fabricated authenticated guest artifact.

Actual result: staged0/submitted2/depth−10/drops0/cancelled3/popped7,
poppedUnsubmitted5/incomingRejected0/residentDisplaced0,
`backpressureObservedLifetime:true`, `acceptance:false/fVerified:false`.
Deep equality confirmed no raw input mutation.

Changing **only after.jitSubmittedMembers to16** leaves the first conservation
equation valid but makes submitted delta8 exceed seven pops. Actual refusal:
`impossible/unsafe popped minus submitted`. The rejected input also remained
unchanged. This one backlog-only attack, with its invalid companion, does not
suggest actual F cancellations/refusals or identify a guest timing cause.
SUITE: retain this bounded evidence; no source test promotion is necessary for
the observation-only increment.

## Independently inspected built demo

I viewed the actual PNG: **126 passed /0 failed /126 done**, F visibly
**IN PROGRESS**, L's verified pip retained. JSON binds Chromium152.0.7977.76 at
`http://127.0.0.1:57389/app.html?noAutoBoot=1`; metrics agree, `errors:[]`
and `httpErrors:[]`, and its screenshot SHA matches the PNG bytes.

The console is not literally empty: it retains the favicon404, Playwright's
blocked-service-worker warning and informational intentional illegal-instruction
suite traces. None is represented as a new failure or hidden. This single built
suite verifies the demo/projection release path, not restored desktop timing.
Source/dist WASM independently match
`39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c`.

## Limits and closure

All eight implementation/test/Make pins were rechecked against frozen Git and
current files at 2026-09-08T14:22:41.013Z. No compile, browser,
runtime/served/source/status/queue/commit changes were made by this review.
The only executed check was the lightweight pure collector attack.

The wrapper's retained-failure guarantee remains **closed-child** transcript/exit
retention, including failed/signalled children. A process-creation `error`
rejects before those writes; it is not a tested all-spawn-failures guarantee.
The collector's same-Machine/no-other-consumer preconditions are supplied by the
owned driver flow, not proved by algebra on arbitrary JSON. Same-generation,
safe-integer guards do not make these counters a frozen timing span, unique-PC
count or latency attribution.

No new requirement or repeat clone/gate is requested. F's unchanged2000-ms
criterion and all prior failed results stand. The new61635 cold/reuse outcome is
still pending independent review.

## Mechanically audited pins

Artifact hashes computed from actual closed files; table generated from the audit.
The historical preflight/gates reports remain unchanged.

| Artifact | SHA256 |
|---|---|
| `crates/core/src/lib.rs` | `7ff782fec3aa18b1b3729ac57e96dd999162b5c92b6fa36ef080cd9953bc2d3c` |
| `crates/wasm/src/lib.rs` | `d9b100a0b434688a34fdcd943e8f21f683c3c77e27d9fe6c240ee001399a38be` |
| `crates/wasm/tests/compile_queue_stats.rs` | `a0e0ba230cffd09e958da395385c04ccda2c1fd55c34aa678279751ab2541e56` |
| `tools/verify/e5-t26f-compile-queue-observation.mjs` | `fff0cf5e7bbbf9c822bbe6b62cb2dcf936076da1eeb3d455d3cdd7a915c02dcc` |
| `tools/verify/e5-t26f-compile-queue-observation.test.mjs` | `81ec6c8af96c3bcb963355996d46575f1481068717c8686b36b84fab0bf1e886` |
| `tools/verify/e5-t26f-browser-compile-queue.mjs` | `cd2ef6a05280f0845792bcac48b63822a4fb877a2afff95e39bdb0236dd6d2ef` |
| `tools/verify/e5-t26f-browser-compile-queue.test.mjs` | `50a4a008d8399660a0cf1e329b4a27eb4ef3c3180310b16680297538b210241b` |
| `Makefile` | `5875ee8fc7a97dab8400dba507074312098699ee791feb3bbfbe3c4736cbadaf` |
| `evidence/e5-t26f/compile-queue-verifier/preflight.md` | `b7bc983d6acae34272ea22784e8fc984ebdc2a44b444cf59eeac9676630a0f2e` |
| `evidence/e5-t26f/compile-queue-verifier/gates.md` | `29cf8a3161e7c7786df8663f45bdd82dc04dd26b32934b052e552ed9eb918748` |
| `evidence/e5-t26f/compile-queue-gates/runtime-2ace1353.log` | `995ca2ed74ea4d883df85b2552d0c5ca1249bd93a90da7df82708b8d68e8ded2` |
| `evidence/e5-t26f/compile-queue-demo-2ace1353/demo-suite.json` | `2ca1402240977863ab7fd19039cf6f8cf148903414263a00d27fc4c67c217d17` |
| `evidence/e5-t26f/compile-queue-demo-2ace1353/demo-suite.png` | `7d786cde95a8a9b82b5ab9981d1d1e3f17927f0a17e0d7e99ce0a430e0c1153c` |
| `web/pkg/wasm_vm_wasm_bg.wasm` | `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c` |
| `web/dist/pkg/wasm_vm_wasm_bg.wasm` | `39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c` |
