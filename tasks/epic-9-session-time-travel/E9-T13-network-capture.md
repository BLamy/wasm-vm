---
id: E9-T13
epic: 9
title: Capture network sessions and replay them with zero live egress
priority: 524.913
status: implemented
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
