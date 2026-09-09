# F read-only compile-queue observation

This increment exposes existing lifetime queue counters and gauges through the
existing shared WASM `jitStats` path. It changes no execution policy, scheduling,
queue order, profiling, clock, guest image or helper. L's independently verified
selection boundary remains unchanged. F still requires the original two-second
physical interaction, and this collector is never an F acceptance verdict.

## Reproduction

- `make verify-E5-T26f-compile-queue-observation`: scoped formatting/clippy,
  actual WASM queue/discovery/capacity tests, collector and runner safeguards.
- `make web-dist`, then one built-page `e5-t18e-demo-smoke.mjs` run for E5-T26f.
  Preserve this worktree's two unrelated dirty dist manifests using their known
  backup, and stage only owned generated files.
- `node tools/verify/e5-t26f-browser-compile-queue.mjs`: always a NEW cold
  resident checkpoint on origin61635, followed by one unchanged default4096,
  repack-off24, explicit-JIT1 reuse with actual physical `play` at5ms/key.
  `E5_T26F_COMPILE_QUEUE_OUT` selects a new output directory only. Existing
  attempts refuse; no old-seal option exists. Closed-child logs/exits are retained,
  including failed/signalled children. Process-creation errors are not a tested
  transcript-retention guarantee.

The collector composes the held discovery observation checks. It requires the
actual nested authenticated head, same generation and safe monotone counters,
allows signed queue-depth changes, and checks conservation with exact BigInt
intermediate arithmetic. From successful nominations minus FIFO-depth change,
it derives staging and distinguishes incoming rejections from displaced
residents. Popped minus submitted is pre-submission refusal, not a count of
compiler failures or a per-PC timing explanation. Both original RPC endpoints
and lifetime values remain visible. A zero interval drop does not erase history.

The six collector and five wrapper unit tests use explicitly synthetic numbers
or child/filesystem stubs; they are not browser evidence. Luna's five actual
WASM tests instead exercise real guest execution in both wrappers, nonempty
backlog, backpressure/pop, detached object mutation, unchanged snapshots/digests/
guest clocks, and restore preserving queue lifetime counters before24 actual
stale cancellations. No counter reset is introduced for the projection.

## Evidence boundary

Daybreak's source predictions are in `compile-queue-verifier/preflight.md`.
Final frozen head, build/gate/demo/browser records and independent dispositions
will be appended after those runs close. No deployment or merge is performed by
this observation increment. The old42bb cold seal is invalid for this new served
runtime and must not be reused or relabelled.

## Frozen build and closed gates

Frozen head: `2ace135363cf0fa3cf7ba978fe6810e564eecc03`.
Actual source and dist WASM SHA256:
`39c674d0707a1a0d4348df078128b8a83cd9bec0b5fe943239f25497b3bf127c`.
The two unrelated dirty dist manifests retain their original hashes and are
excluded from the commit. The rebuilt demo service-worker version is30911c6ea3e2.

`compile-queue-gates/runtime-2ace1353.log` records HEAD then
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_TARGET_DIR make verify-E5-T26f-compile-queue-observation`.
It closes exit0: format/core+WASM clippy,14 actual WASM tests (5 queue,6 discovery,
3 decoded capacity), and69 Node tests. There are no ignored tests in this scoped
run. The existing unrelated `hart_ctrl` import warning remains in the raw log.
This local command's three explicit unsets are not a new cold-clone claim.

The viewed `compile-queue-demo-2ace1353/demo-suite.png` and its JSON show the
actual Chromium demo126 passed/0 failed, empty console/page and HTTP error
arrays, and F IN PROGRESS. This built-demo proof is distinct from the slower
desktop checkpoint run, which began14:20:11 UTC and remains unjudged here.

Closed-artifact SHA256 pins:

| Artifact | SHA256 |
|---|---|
| `compile-queue-gates/web-dist.log` | `81a5b642d9263b71a597925624af9b03ef98224113ba41faed56d578a2125a49` |
| `compile-queue-gates/runtime-2ace1353.log` | `995ca2ed74ea4d883df85b2552d0c5ca1249bd93a90da7df82708b8d68e8ded2` |
| `compile-queue-demo-2ace1353/demo-suite.json` | `2ca1402240977863ab7fd19039cf6f8cf148903414263a00d27fc4c67c217d17` |
| `compile-queue-demo-2ace1353/demo-suite.png` | `7d786cde95a8a9b82b5ab9981d1d1e3f17927f0a17e0d7e99ce0a430e0c1153c` |

## Independent gate disposition

Daybreak's `compile-queue-verifier/gates-results.md` independently checks these
closed logs/pins and the actual screenshot: observer P1–P4 HELD and P5's demo
portion HELD; the new cold/reuse remains NEEDS EVIDENCE. Its bounded novel pure
collector attack drains10 existing residents without staging anything, correctly
accounting3 cancellations,7 pops and2 submissions while retaining lifetime
drops. Changing only submissions to8 refuses the impossible negative residual.
Both inputs stay unchanged. This synthetic attack is not guest/browser evidence.
Report SHA256: `b2c9f13a8de84cb023f5cf04bb5f18932c541be1cb2115171211ee6c62445bcb`.
PR365 is OPEN/DRAFT above PR364 and linked to native stack338; no merge/deploy.

## Closed cold/reuse observation — F cap still failed

`compile-queue-2ace1353/` retains the exact invocation/eight source bindings,
cold JSON/PNG/log/exit0, and reuse raw JSON/PNG/server log/transcript/exit1.
Outer `compile-queue-2ace1353.log` exits0 only because the collector accepted a
valid diagnostic record. The actual original F assertion failed.
`compile-queue-digests.txt` binds the22 closed recording/gate/review artifacts.

Cold began14:20:11.639 UTC, reached desktop readiness14:28:03.494, and sealed
14:34:16.575. The reuse cap assertion closed14:34:26.858 UTC. It used NEW
`e5-t26f-compile-queue-GhPcGG` under the platform temp directory, headless
Chromium152.0.7977.76, origin61635 and the unchanged resident image/helper.
Runtime digest `83ef1097b58fde5be5440871acae201aa750aaabbcf5e7a568fa1e47f53ff4fb`;
profile digest `0f1cf069e42283764ea9757d36d39e158c2eafb507baf5e4dd2fe8364fdea523`.
Snapshot2818820 bytes, SHA256
`06901857ddb25196d8f9212ad981782ba02eae45d0eb456e792a287239339bfb`,
pre/first-present CRC `4a8f326b`, overlay generation645, fresh agentHELLO2,
and only fetching→instantiating→restored states, not a guest boot on reload.

Original T0 `1191.6350001096725`, frozen end `5504.760000109673`:
**4313.125 ms FAIL**, not the later interaction ledger4313.525 ms.
Before RPC1454.135–1463.210 and after5505.595–5548.500 are sequential samples
outside an exact frozen timing interval. No profilers, default changes or clock
overrides were enabled. This unpaired different-checkpoint run is not evidence
of a speedup or regression against the old4727.945-ms L screen.

Both pre-gesture observations show locked/suspended fresh zero PCM. Actual
physical `play` has10 matching keyboard/DOM transitions, fresh green marker,
5679 changed pixels, and frame4→10. The cursor matches94 pixels at828.400 ms.
Fresh playback produces1440 written/non-silent PCM frames, max amplitude
0.999969482421875. The4279.710-ms completion observation is **not first PCM**.
The viewed upper terminal retains actual PID999/start26812 across pre1/pre2/post,
read-only child FIFO FD3, parent-only writer, PCM FD4/PREPARED/zero pointers and
new green `e5t26f-aplay`. The lower terminal's0.063-ms underrun predates the
snapshot: do not claim zero underruns for the whole recording.

The cold record explicitly has empty browser/HTTP error arrays. The generic
failed reuse record lacks complete error arrays; its presentation errors are
empty, but the cold/demo arrays are not a substitute for missing reuse evidence.
Later coherence, drag/second restore checks are not reached. Carry prior scoped
functional HELD results without claiming fresh coverage of those later paths.

### Exact queue conservation in this RPC interval

| Term | Before | After | Delta |
|---|---:|---:|---:|
| Successful discovery nominations |271|3122|2851|
| Discovery FIFO depth |0|78|78|
| Queue admissions |271|1682|1411|
| Queue resident depth |175|248|73|
| Backpressure drops |0|1908|1908|
| Stale cancellations |0|0|0|
| Popped jobs |96|888|792|
| Submitted members |95|647|552|

Staged `2851−78=2773 = 73+1908+0+792`.
Of the1908 backpressure drops, incoming rejections are `2773−1411=1362`
and displaced residents are `1411−73−0−792=546`. Popped-but-unsubmitted
work is `792−552=240`. The2221 staged/submitted difference therefore equals
73 pending-depth increase +1908 drops +240 pre-submission refusals, not2221
known lost unique PCs. Actual queue high-water221→256 at unchanged cap256;
discovery generation stays5 with stale/overflow/count-map-loss totals0.

Guest retirement advances49477545, JIT retirement19288440; actual installs552,
retranslations247, evictions91 and decoded builds637738. These totals identify
real queue pressure and pre-submission refusal but not the hotness of rejected
PCs, the specific refusal path, or their causal host-time cost. No next runtime
change is justified solely by treating every dropped job as needed compilation.
Daybreak independently closes P5 HELD for this honest observation, carrying
P1–P4/demo. It recomputed the812-file profile and150-file served-runtime trees,
checked the exact envelope/sound section, viewed both PNGs, reproduced the
aggregate and rechecked all22 closed digests. F remains failed/unverified; no
extra run, broad gate or clone is requested.
`compile-queue-verifier/browser-results.md` SHA256:
`8ab3c4f9fd3b7de713ac7aaac9443590174c2b0a3ac1ff6a3697ee89732512d8`.
The final log/demo metadata refresh is separate from this exact2ace browser
record and invalidates its seal for the newly served metadata; never rebind it.

The final metadata build retains identical WASM39c674d0 and stamps service
worker94effebd698f. `compile-queue-demo-final/` again passes126/0 with empty
error arrays and visibly shows F IN PROGRESS with the new honest evidence log;
the screenshot was viewed. Its PNG SHA256 is
`0410b331a2b6711fcee01471b2432823faeca33af2341b36e174465d2ad98f12`.
`compile-queue-final-metadata-digests.txt` separately binds this build/JSON/PNG
and final critic report without changing the22 original recording pins.
