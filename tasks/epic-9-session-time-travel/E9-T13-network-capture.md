---
id: E9-T13
epic: 9
title: Capture network sessions and replay them with zero live egress
priority: 524.913
status: in-progress
depends_on: [E9-T09, E9-T03]
estimate: S
risk: high
capstone: false
---

## Goal

Reproduce recorded network observations offline without repeating external actions.

## Boundary

The VM transport boundary for incoming bytes, connection outcomes, delivery order and replay egress suppression. Record relevant outgoing intent for validation; retain payloads locally by hash.

## Acceptance criteria

- [ ] A pinned real guest network exchange records byte payloads, close/error outcomes and exact delivery positions, then replays with the original server unavailable.
- [ ] During replay, the provider cannot open sockets or send packets/HTTP actions; observe zero egress with an independent transport witness.
- [ ] A changed guest send intent, missing payload or exhausted network trace stops as divergence; do not retry against a live server.

## Deterministic acceptance

`make verify-E9-T13` records the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Record a state-changing request against a local counter server, replay repeatedly and prove the counter never increments again. Replay with changed DNS/server content and failed connectivity.

## Verification log

### 2026-10-18 — worker — begin

E9-T13 is the next eligible slice after independently verified E9-T12
(critic commit 564438556f77e038bac5d6bbae34adfbf3f9b184). Risk remains high:
network payloads, external actions and persisted replay state cross the guest/host
boundary. The qualified adapter will own bounded Ethernet send intents and incoming
payload/close/error deliveries, bind them to the common guest event clock, and keep
the live transport absent from replay construction. Outgoing bytes must match the
recording before a completion can be consumed; a missing payload or exhausted tape
must fail explicitly.

A pinned guest program will drive actual virtio-net queues against a local
state-changing counter server through the recording transport driver. Independent
connection/send/server witnesses must prove replay creates no live network action,
including with the server gone or changed. Native and built-browser runs will retain
complete frames/traces and payload objects under different execution budgets.
Pending queues, request/cursor/reset state and callback incarnations must survive
checkpoints without allowing an old reply into the restored VM. The browser demo
will expose the owned network replay check with a safe same-origin request; the
acceptance server supplies the state-changing attack. Full software Linux session
assembly follows in T14. No implementation or verification claim is made here.

### 2026-10-18 — worker — implemented; recorded exact-head local submission

Frozen runtime and deploy bundle:
43031d92822be59b8ddd15a599428194dc1470aa.
Parent boundary: 76cc2c8dc1df4b17572bf09c73618e10ad848d63.
make verify-E9-T13 passed all **24 recorded commands** from a separate clean
checkout with an initially empty compiler target, no inherited Node installation,
scrubbed compiler/wrapper flags and authenticated local build dependencies.
The exact commands, exits, source hashes and original file inventory are retained:

- Original final report:
  /Volumes/e9-final-proof-ram/cold-proof-e9-t13-43031d92822b/report.json,
  SHA-256 67cf9b564a4bf01ae254dba5d0642abeed45d4179645644b960c98c3d20436ae.
- Durable lossless primary packet:
  evidence/e9-t13/worker-final/provenance.json,
  SHA-256 800d1348c378f950d2457cde1e8cca1b69bd89280461b5d69b2539bf39b20576;
  216 files, 24,356,547 compressed bytes. Complete guest traces/frames,
  actual HTTP bytes, all durable CAS objects, Playwright traces/screenshots/
  coverage, build/test logs, source diff and original receipts are included.
- Full authenticated archive, retaining derived GPU browser cache files:
  /Volumes/e9-final-proof-ram/e9-t13-full-archive/provenance.json,
  SHA-256 9c47b24009b2bc81d442ff0fb9b17f6d01732152299ddc68a15a264e6b089638.
- Cold checkout receipt and producer are retained as
  origin/cold-wrapper-receipt.json.gz and origin/cold-producer.py.gz.
  The disclosed read-only shared Git object store is the sole clone
  accommodation for the full persistent disk; source, refs/index,
  compiler target and Node install were independent.
- Original browser/desktop.png, browser/mobile.png,
  browser/browser-trace.zip and browser/report.json are retained
  losslessly under acceptance/ in the primary packet.

The pinned RV64 guest negotiates virtio-net and posts real TX/RX descriptors.
Its HTTP-bridge request reaches a local state-changing counter server exactly
once. Native recording retains the actual HTTP request/response and transport
EOF. The independent browser counter sees one request, closes its original
listener, and offers changed content on subsequent live requests. Six offline
replays from initial and pending checkpoints match the complete final
CPU/RAM/device/disk/cursor frame at budgets 1, 7 and 4096. Both recording and
replay execute 9,216 guest instructions; an independent Python struct/hashlib
oracle checks every retired PC/opcode against the pinned program, used rings,
guest-observed IRQ/DMA response bytes and the entire persisted object graph.
The browser bridge maps only the pinned experimental Ethernet request to one
safe fixed same-origin GET. This qualifies the transport boundary, not a guest
TCP stack or complete Linux replay.

Seven native adversarial tests cover a real refused connection, 32 callback
schedules, changed actual guest TX bytes, duplicate/malformed/missing deliveries,
exhausted tape, wrong positions, foreign/stale/reset callbacks, queued RX
checkpoints, invalid checkpoint fields and bounded descriptors. Native and
built-browser JIT proofs execute translated code at 5000/5001/5002 with budgets
31/1/8/4096 and identical complete checkpoints. The built page reaches
**127 passed, 0 failed, zero console errors**, persists five network deliveries,
reopens them after reload, performs six matching replays, rejects 17 replay/
lifecycle attacks and 28 ABI attacks, and refuses a deleted required payload.
A separate fetch/WebSocket witness observes zero attempts inside replay,
alongside zero replay provider factory invocations and exactly one witnessed
original HTTP action. Shared device/time/input journal regressions pass.
The retained GPU factory passes with 2,999,712 actual guest retirements and
a fresh draw of resource 13 in epoch 4. The current Mac/guest evidence policy
applies; no retired-host rr proof is claimed.

Worker self-review withdrew the earlier abb77eb06a7e submission before handoff:
network-only exact saves could poll a queued receive. The repair preserves
owned RX without quiescing it, and a regression asserts that the guest used
index is still zero immediately after capture. The interrupted receipt,
stop reason and producer are preserved in origin/. All selected gates were
rerun on the repaired frozen runtime above.

Publication is **pending**, and is not counted as passing evidence.
Cloudflare's expired OAuth credential needs the already requested browser
login authorization. The full system disk also prevents computer-control
startup. The standard credential file has not been copied or printed;
official Wrangler login and a narrow existing-file write adaptation were
prepared outside the repository. Fresh independent verification must assess
the local claim and retain any publication proof gap until the new bundle is
deployed and directly checked. Complete software VM replay remains T14.

### 2026-10-18 — verifier — VERDICT: refuted

- P6 joint checkpoint observation conservation — FAILED and rechecked. Predicted
  that acknowledged sends plus queued receive frames cannot exceed the network
  cursor: each required a distinct accepted observation. At runtime43031,
  crates/core/src/session_network/codec.rs:181–207 checks sent<=cursor and
  sent+pending<=next_id separately but accepts sent1/queuedRX1/cursor1. The critic
  runs the pinned guest to1024, acknowledges its real TX once, saves, then adds
  only queued RXe19a73 to section21. Original clock/RAM/virtqueues and all other
  sections remain unchanged. Mutant SHA256
  e3412357af0cbbb62d137bea487fa4159e82faebd8795bf6bee5e6a6d0606a82
  is accepted into replay; receive-conservation-trace-recheck/to-9216.trace:1516
  loads injected0xe1 from DMA into x6 at transition2539, and line1517 stores it
  into the guest report at2540. Trace SHA256
  9c87c28578c0a6a80985105335f6589a7b65ad5a9eb56c22f3cb5898c9c12895.
  At9216, usedRX1/report[1,1,1] and DMAe19a73 are visible while sequence/cursor
  remain1; finish_session_network_replay(1) returns Ok. Observed frame SHA256
  5117fa6d87a50e8301d8dda48ccb4e25041cbd4ab8b2e0c96426e41520218914.
  Two untraced and two independently recorded traced runs agree. Demand: enforce
  the joint relation with checked arithmetic before restore mutation/incarnation
  replacement, add a transactional live-lease regression, and re-record the
  selected high-risk runtime gates on a new frozen head.
- P1/P2/P3/P9/P10 — HELD for the authenticated local happy paths. Independently
  checked all216 primary/393 full-archive original+gzip entries,379 acceptance
  inventory files,35 source hashes and58 contract hashes against Git43031, the
  clean cold source and its disclosed independent/empty compiler origin. All24
  commands passed. A separate Python struct/hashlib decoder validates actual
  positions, HTTP bytes, descriptors, guest DMA/used/IRQ witnesses, durable CAS
  objects, six exact trace suffixes and whole browser frames. All24 native/browser
  compiled-edge CPU witnesses agree with independently computed loop arithmetic
  at5000/5001/5002 and q31/1/8/4096. These observations remain scoped to the
  documented experimental Ethernet proof bridge; full Linux/TCP replay is T14.
- P13 publication — NEEDS EVIDENCE, separate from the semantic refutation. No T13
  deployment/public-browser recording exists yet. T12 live assets are not proof
  for this changed runtime. Preserve this gap until the repaired bundle is
  published and directly checked.
- COVERAGE/SUITE — Remaining independent capacity/schedule/forwarding attacks,
  changed-hunk coverage and scratch sabotage are still under review. No complete
  coverage or permanent-suite promotion is claimed before correctness holds.
  Held evidence, predictions, original failures and exact source/dependency
  boundaries will be carried forward according to the incremental policy.

Evidence: evidence/e9-t13/verifier-refutation/provenance.json, SHA256
3af3e6c6b86ae94683ef9a213276ae1565ab6af118b5a8c165611e65ed079a1b.
The42 lossless entries include original/mutant/observed frames, both repeated
guest traces, exact executable/source/linked-core hashes, prediction, producers,
receipts, logs, independent decoder and the held ledger. Originals remain at
/Volumes/e9-final-proof-ram/t13-critic-main. No implementation code changed.
Commands: python3 run_receive_conservation.py; python3 record_refutation_trace.py;
python3 authenticate.py; python3 guest_oracle.py (all from that critic directory).
The first two intentionally retain the failing assertion. Policy is checked before
queue regeneration and this refutation commit. Task returns to in-progress for
worker repair; no dependent may start.

### 2026-10-18 — worker — repaired conservation; recorded exact-head submission

Frozen repaired runtime and deploy bundle:
e91c7af9bd8ec64c200c7d5a6687d9e4e124db12.
This addresses the independent refutation at a7b2b475aad61aa9b7fe0e62a0827261ccf9a95f.
The decoder checks, with overflow refusal, that acknowledged sends + queued
receive frames + one represented nonzero link result + represented external
pending work cannot exceed the accepted network cursor. Validation precedes
restore mutation and callback-incarnation replacement.

The eighth native regression rejects the independently reported extra RX,
a zero-cursor link, zero-cursor pending work and two represented results at
cursor one. Both Record and Replay retain identical complete checkpoints on
refusal; a previously issued valid recording lease still completes afterward.
A genuine four-result state at cursor four restores and later delivers its
queued RX. The built-browser probe also refuses the reported extra RX without
changing its checkpoint. The exact new regression linked against the
authenticated old43031 core fails with exit101 at case zero; its immutable
source, binary/build log, red result and linked-core digest are in origin/.

make verify-E9-T13 passes all24 recorded commands on this repaired head.
The independent clean checkout initially had an empty compiler target and no
Node installation. That first attempt passed12 gates but npm registry reading
timed out during browser-build. Its original receipt/report/build log remain
unaltered. All24 gates were then repeated in the same unchanged clean source,
using only the compiler cache that attempt itself built and an offline package
download cache. npm ci installs afresh and enforces the committed lockfile
integrities; no installed Node tree or foreign compiler cache was copied.
Both producers, receipts, compiler-origin disclosure and failure logs are retained.

- Final report:
  /Volumes/e9-final-proof-ram/cold-proof-e9-t13-e91c7af9bd8e-retry/report.json,
  SHA256 270360a734ea719e09cc6722a91fffd3f56c5f8f9a22fc4d4531a8492271aa31.
- Durable lossless packet:
  evidence/e9-t13/worker-conservation-final/provenance.json,
  SHA256 3afe4dcde2a9e931e41891f1086e0b900d9a79a106a164d9059232e5ba39b96e;
  239 original files, 54,772,500 compressed bytes.
- Full archive:
  /Volumes/e9-final-proof-ram/e9-t13-conservation-full-archive/provenance.json,
  SHA256 6b2015d244d0c54ce1b945c4c18948a0f8c6387f5831e5f1083738e578e4a71a.
- Native traces/frames, all malformed and valid conservation checkpoints,
  browser traces/screenshots/coverage, exact HTTP witnesses, complete CAS
  exports, native/browser translated-execution frames, source diff and all
  selected command logs are preserved. Prior refuted worker and critic packets
  remain intact. Only the task-owned abandoned abb77 compiler cache on RAM was
  released; its inventory is included, and its source/Git/raw recordings remain.

The repaired run passes400 core tests, eight native network tests, affected
session/device/storage/wasm gates and actual native/browser translated paths.
The built page reaches127 passed, zero failed and zero console errors; it
retains five deliveries, performs six identical offline replays and rejects18
probe cases plus28 ABI cases. Independent fetch/socket witnesses observe zero
replay attempts, and the local state-changing counter is reached exactly once.
The independent Python guest/object oracle and retained GPU browser gate pass.
These remain transport-boundary proofs with the documented Ethernet HTTP
bridge; complete Linux session assembly is T14.

Publication remains pending official Cloudflare account authorization, and is
not counted as passing evidence. The previously prepared43031 publication
payload is withdrawn and must never be deployed. The repaired e91c bundle is
the sole publication candidate. Fresh independent review must carry the prior
HELD results, interrogate this repair and remaining coverage, and retain the
separate public-site proof gap until the repaired bundle is deployed and tested.
No worker verification verdict is asserted.

### 2026-10-18 — worker — saved normal-reset failure; semantic rework

The independent session saved a second failing ordinary test before its turn
was stopped by automatic security review for possible cybersecurity risk.
The worker preserved and read those existing files; the stopped test execution
was not retried. No independent final verdict is claimed.

At frozen e91c7af9bd8ec64c200c7d5a6687d9e4e124db12, the normal capacity/reset
test fails twice at harness/tests/critic.rs:956: a checkpoint taken immediately
after Status=0 does not roundtrip byte-for-byte. Its existing exact command is
cargo test --offline --manifest-path
/Volumes/e9-final-proof-ram/t13-critic-main/harness/Cargo.toml --target-dir
/Volumes/e9-final-proof-ram/t13-critic-main/coverage-target --test critic
critic_combined_owned_capacity_frees_exactly_the_acknowledged_tx_bytes
-- --nocapture. Both recorded exits are101.

Original reset frame SHA256
cb3066ac4b8a8d1c9c323ebbec8581db6dde6cc51cfa93e15fb14c25eb4fa806;
restored frame SHA256
850164c283134047ea402cc71370ef1e74db28620cfb9a2ddeb62ddcf35c7a7b.
Only section7 differs: payload bytes277,282,283,285 change from1 to0.
A pending transport reset has invalidated the old service-ring views; exact
save still serializes them while restore drops them because the transport's
queues are no longer ready. The repair must capture those invalidated views
canonically without polling the backend, delivering queued RX or advancing
the guest, and add an ordinary reset/restore/resume regression.

Lossless saved evidence:
evidence/e9-t13/worker-reset-finding/provenance.json,
SHA256 69a4f951b982c044f2a67e90b752c65558ad0ff94b53deff61e254b5b8be4531.
It retains65 original files, the two repeated failures, all four before/after
capacity/reset frames from each run, original critic source/build identity,
pre-evidence predictions and already produced normal schedule artifacts.

The e91c publication candidate is withdrawn and has never been deployed.
The conservation repair and its local24-command pass remain recorded, but
this newly observed reset gap requires semantic rework and a new frozen run.
The independent review is incomplete because its execution was stopped;
publication also still needs Cloudflare account authorization. The official
device-code attempt expired after five minutes without that authorization.
No dependent E9 task may start.

### 2026-10-18 — worker — reset capture repaired; final recorded local submission

Frozen runtime and built deploy bundle:
04f628dd02a0bf57331682e05607829e25a0ca46.
Exact capture now omits net service-ring views invalidated by a pending
transport reset. It preserves the recorded reset flag, all transport/counter
state and guest state; it does not service the backend or deliver queued RX.
The next ordinary service already drops these views before using them.

The ninth ordinary worker regression takes a normal reset with queued work,
checks revoked old callbacks, captures without advancing the guest, roundtrips
in Record and Replay and resumes at budgets1/7/4096. Complete final frames and
instruction traces match all six restored executions. Its exact source linked
to authenticated pre-repair e91c core fails101 at the reset roundtrip.
That standalone red binary/source/build log/receipt are retained under origin/;
receipt SHA256
2ad50c7f8096dac17d37d4c650ff95efe8bbe4dbc6c46760f4fe3ccbbd5b7873.

A separately predicted worker byte comparison against the critic's already
saved restored-reset frame holds: new paused checkpoint
28e6b071904333fb5581e8f1cf41f9afe25f1329cab9d6263ddc6087751db736
has the same section7 bytes, SHA256
ded04079b6bfd3de9987a2b67aaeaae17bd402e2e56a19df2356cd725755a6e2,
with both invalidated cached queues absent. Network cursors outside that
component remain their respective accepted values. The prediction and read-only
observation are origin/reset-canonical-observation.json.gz. This is a worker
check of saved evidence, not an independent verification verdict.

make verify-E9-T13 passes all24 selected commands on the new frozen runtime.
This run uses a separate clean exact-head source/Git checkout, an initially
empty compiler target, no inherited Node installation, scrubbed Rust/compiler
wrapper flags and an offline integrity-checked package download cache.
Git object storage is shared read-only as disclosed for the full persistent
disk; compiler caches and source working files are not inherited. Full source,
dependency/toolchain provenance and all original command logs are retained.
Only task-owned incremental/Wasm compilation caches were released for RAM
space, with inventories; native executables/rlibs, built browser assets,
source/Git metadata and recordings remain intact.

- Final report:
  /Volumes/e9-final-proof-ram/cold-proof-e9-t13-04f628dd02a0/report.json,
  SHA256 e8976823db2791f96502b8da745360148f92647eb189d00ae43a4556c18280f5.
- Durable lossless packet:
  evidence/e9-t13/worker-reset-final/provenance.json,
  SHA256 60304b99d0b98842aa4c5fbacc10025b82169927972fa08f2cd6365d66358d5b;
  255 original files, 27,332,768 compressed bytes.
- Complete archive including derived browser GPU caches:
  /Volumes/e9-final-proof-ram/e9-t13-reset-full-archive/provenance.json,
  SHA256 be39c608d8fa89c862b3ee6aa678445d41d6f2bda172d5de26eb83e68ce0c1ab.
- Runtime/source diff excludes evidence directories to avoid recursive copies
  of previous recordings. Their immutable committed manifests and original
  packets remain available; no prior findings or failing recordings were removed.

All400 core tests and nine network tests pass, alongside affected session,
device, storage, native/Wasm boundaries and actual native/browser JIT gates.
The new built page reaches127 passed, zero failed and zero console errors,
retains five events, performs six identical offline replays, rejects18 probe
cases and28 ABI cases, and shows the network capability live. The independent
transport witness remains one original local counter request, zero replay
provider construction and zero replay fetch/socket attempts. Independent Python
guest/object checks and the retained GPU browser gate pass.

These are local worker transport-boundary claims with the documented
experimental Ethernet HTTP bridge; complete Linux replay remains T14.
The earlier43031/e91c publication candidates are withdrawn and were never
deployed. A separately staged04f628 candidate is prepared only after this
complete pass. Cloudflare device authorization expired without human approval,
and the independent session was stopped by automatic security review before
completing its coverage/verification charter. Those external proof gaps remain.
No worker may mark this task verified or start its dependent tasks.

### 2026-10-18 — worker — blocked on external publication and fresh verification

Local implementation and risk-tier recording are complete at frozen
04f628dd02a0bf57331682e05607829e25a0ca46; submission commit
7f5af6e4ad3e566542412a73668fc1f73eb5b8a9 records the claim and full packet.
The task cannot reach verified until these named external proof gaps change:

1. Required Cloudflare Pages publication needs human account authorization.
   Exact official login command/environment and the observed five-minute
   device authorization timeout are retained in
   evidence/e9-t13/external-proof-blockers/provenance.json under auth_repro.
   No new device request is started while the human's response is pending.
   The sole eligible prepared payload is04f628; its750 staged files total
   about84MiB, with original frozen bytes, unchanged public boot bindings and
   Pages file limits authenticated. Prepared receipt SHA256
   8a6341d9ee6a8cdf0bd1bef583c8ffd81b016256c0fa1f375ce6b523de4f3796.
   Earlier43031/e91c candidates remain withdrawn and were never deployed.
   After authorized publication, run the retained public-browser command
   against the exact staged asset hashes; no T12 live asset is T13 proof.
2. A completed fresh independent review remains required by AGENTS.md.
   Automatic security review stopped /root/verify_e9_t12 and reported
   possible cybersecurity risk. The actual stopped dispatch and service
   response are retained as critic-dispatch.json and
   independent-service-block.json in that packet. The saved normal-reset
   failure was repaired using an ordinary worker regression; the stopped
   independent execution was not retried and no other model/session was
   substituted. Worker tests and read-only observations cannot issue its verdict.

External accounting packet:
evidence/e9-t13/external-proof-blockers/provenance.json,
SHA256 5ec84e92650c0afe8455a7d75dae0296620b401bdbf96c9d56229905f845f81b.
It contains exact commands, observed results, the prepared-payload inventory,
public manifest bytes and producer, without credentials or private auth logs.
This entry is a worker blocker report, not a verifier verdict. Status becomes
blocked with named blocked_on dependencies, leaving the active lane. E9-T14
through E9-T24 remain pending because their verified dependency chain reaches
this task. No PR is merged and no new runtime is published.

### 2026-10-18 — worker — preserved separate read-only sufficiency assessment

The existing separate critic /root/verify_e9_t12 completed a bounded read-only
source/saved-record review at frozen runtime04f628. It issued **no verification
verdict** and ran no VM/test binary, recorded producer or new attack. Saved raw
LLVM profiles and their executable object were decoded only as coverage data.
The stopped independent execution was not retried or replaced.

Its authored ledger accounts for52 files and156 textual hunks, authenticates
the255 final packet artifacts and35 source hashes, supports canonical pending
reset capture and all six matching resumes, and carries32 byte-identical
previously HELD artifacts. The ledger distinguishes direct support, explicit
waivers and missing evidence; a zero in one recording is not asserted to mean
the code never ran. It identifies G1–G8 narrow ordinary component-proof gaps:
broker limits/sticky stop, idle scheduling, installation refusals, Wasm cursor,
protocol refusals, codec outcomes, browser result serialization and network
journal policy rejection. Those can guide additional worker evidence without
claiming the unfinished independent charter.

Lossless preservation of its original34 inputs/outputs and provenance:
evidence/e9-t13/independent-read-only-review/provenance.json, SHA256
ac380ac9a586203293c8fc0d89d9da29cc69775d6e02d77caeca541963159f92.
The original authored ledger SHA256 is
708d74ad9e6978448191c316792c591022cc4dacf8810e5a567576ee163b5827;
authored provenance SHA256 is
a7fd8006df45744730cb6d489f5ee64b37b97694886e17836769353af9108ba2.
The worker authenticated and compressed these existing files, not their verdict.

G9 independent execution/sensitivity/suite disposition and P13 required public
publication/browser proof remain unresolved. Official read-only Wrangler whoami
still reports unauthenticated; no token was printed or copied. A new device
request awaits human readiness after the previous code expired. Task remains
blocked and unverified; no dependent task starts and no PR is merged.

### 2026-10-18 — worker — ordinary WFI proof finds semantic rework

The partial review's G2 request led to an ordinary worker WFI/pending test,
not a retry of the stopped independent harness. Frozen04f628's session path
checks only generic SessionClock.external_pending when consuming idle_pending;
it skips the owned NIC's guest TX/external work getter. With owned Pending(true),
after two transitions the saved run has retired1, mtime1000000 and x1=0.
The predicted result was retired2, mtime2 and x1=1. The only retired instruction
is wfi at0x80060000 (wfi-red/native/components/wfi-txfalse-pendingtrue.trace:1);
the second transition jumps to the timer deadline despite outstanding work.
The no-pending control correctly performs that idle advance.

Lossless worker counterexample packet:
evidence/e9-t13/worker-wfi-finding/provenance.json, SHA256
76825ff1d7eb7e6a40ad32065da8775dbac20dd4f43f2b63a6afb7b8dd07fde5.
It retains199 originals, the pre-state prediction, exact new regression,
authenticated old-runtime binary, failed101 log, frames/trace and ordinary
coverage records. The first harness attempt incorrectly compared a budget1
call before reaching its target; it is retained as a harness failure, not
this semantic finding. The corrected v2 loops to the target and exhibits
the predicted pending-work fault.

The existing nine worker tests pass under instrumentation. Its first combined
oracle attempt required the separate JIT recording and remains recorded as
failed; an additive view explicitly carries those12 unchanged04f JIT inputs,
and the combined struct/hashlib oracle passes. No carried recording is called
a fresh execution. The original independent charter remains unfinished.

Status returns to in-progress for this semantic repair and remaining bounded
worker component evidence. The prepared04f628 publication candidate is withdrawn
and has never been deployed. Its prior local24-command pass remains historical;
the repaired runtime must earn a new frozen risk-tier submission and browser
bundle. Cloudflare human authorization, required live publication/public proof
and a completed permitted fresh independent review still gate verification.
No dependent starts and no PR is merged.

### 2026-10-18 — worker — WFI repaired; component prechecks complete

The session idle decision now consults the owned NIC's pending work as well as
generic pending controls. Four ordinary native and browser cases distinguish
outstanding guest TX, recorded external_pending, and their idle controls.
Pending work retires the next instruction instead of jumping to the timer;
Record/Replay complete checkpoints and traces match across execution budgets.
The demo's existing Offline network check now runs these timer-order cases.

The nine existing worker regressions and eight new native component tests pass.
The latter record256 pending TX intents, exact4MiB RX ownership and one-byte
overflow, fatal stop/lease/snapshot forwarding, allocator/cursor exhaustion,
installation refusals, wrong-mode/common-queue/unfinished replay refusals, and
bounded wire-format/joint-overflow fixtures with transactional restore checks.
The sent-counter increment overflow is dominated by the earlier cursor check
under the admitted sent<=cursor invariant; unreachable topology needs no
fabricated fixture.

Focused development-browser self-validation passes zero console errors,
four WFI cases, actual failed/cancelled-send plus failed-link durable prefixes,
matching offline frames/traces, the exact cursor9007199254740999, actual
factory-throw lease cleanup and six named policy/format/adapter refusals.
Real SessionStore writers, reopen/read, native Wasm methods and the pinned
RV64 virtqueues are used. This is a worker precheck, not the final built-page
submission or an independent verdict. The ordinary struct/hashlib decoder
passes the retained files; an intermediate report-only variable collision is
preserved in its original failed log before the correction.

Precheck originals:
- /Volumes/e9-final-proof-ram/e9-t13-worker-wfi-green/report.json
- /Volumes/e9-final-proof-ram/e9-t13-components-precheck-v1/report.json
  (two fixture setup expectations corrected; original failure retained)
- /Volumes/e9-final-proof-ram/e9-t13-components-precheck-v2/report.json
- /Volumes/e9-final-proof-ram/e9-t13-wfi-web-precheck/report.json
- /Volumes/e9-final-proof-ram/e9-t13-wfi-browser-precheck-v1/report.json
- /Volumes/e9-final-proof-ram/e9-t13-wfi-browser-precheck-v1/network-oracle.json

Formatting, the touched native Clippy target and local web/dist rebuild pass.
Only1771576522 bytes of this task's derived native incremental cache were
released for the new clean-clone proof; retained native executables/rlibs were
hashed unchanged, and source/Git/recordings were preserved. The exact inventory
is /Volumes/e9-final-proof-ram/e9-t13-wfi-incremental-cache-release.json.

The next frozen submission runs all25 selected commands, including the existing
127-test built suite, actual native/browser JIT, the new component proofs,
byte/object oracle and retained GPU gate. Earlier04f628 remains withdrawn.
No fresh full verifier verdict, publication or public proof is claimed.
