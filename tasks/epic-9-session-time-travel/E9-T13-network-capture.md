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

`make verify-E9-T13`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

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
