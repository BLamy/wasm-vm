---
id: E9-T22b
epic: 9
title: Connect the shared owned network path to witnessed local HTTP
priority: 524.92202
status: in-progress
depends_on: [E9-T22a]
estimate: S
risk: high
capstone: false
---

## Goal

Supply the real exact-mode guest network workload required by unchanged T01.

## Boundary

One live provider boundary shared by recording and unrecorded controls: a real
Slirp Ethernet/TCP pump and an explicitly bounded local HTTP service at the
frozen gateway `10.0.2.2:9191`. Actual guest TX/RX/link/pending/completion results
cross existing owned leases. Only recording mode appends their receipts;
replay cannot construct/open/poll the live provider. Do not add general egress,
remote credentials, fixture-only replies or a different OFF transport.

## Acceptance criteria

- [ ] Full pinned Alpine BusyBox wget reaches the real local service via guest Ethernet/TCP at the unchanged URL, receiving ten exact indexed 1024-byte bodies `(17+INDEX)%256` with independently retained server request/body counts.
- [ ] Both OFF and ON use the same live network pump/service. ON records every real owned network observation and replays exact state and HTTP bytes with zero server/provider/host egress; OFF retains no event/observation history.
- [ ] Bound all queues, payloads and callback lifetimes; reject malformed/stale/replay callbacks before mutation and settle cancellation/provider failure.
- [ ] Record the high-risk prescribed gates, native/guest/browser witnesses, final exact-head cold proof and fresh actual Daybreak adversarial verdict; update demo/roadmap and deploy the verified browser boundary to the main Cloudflare URL.

## Deterministic acceptance

`make verify-E9-T22b`. Planned target with a counted real full-guest HTTP proof,
source/event/raw-state digests, direct failures and the high-risk local gates.

## Adversarial verification

Use different HTTP indices/bodies, fragmented TCP, duplicate/stale completions,
server close/refusal and cancellation races. Refuse arbitrary gateway ports or
unbounded local-service registration. Open a fresh replay with the live server
unavailable and inspect original/independent server counters. Sabotage the replay
provider-construction guard and show that the bounded proof detects egress.

## Verification log

### 2026-10-22 — worker — begin shared owned live HTTP provider

Activated after fresh actual Daybreak verified all E9-T22a criteria at
`615629bfa111e4b586d0a03337013ec53415f318`, including actual main deployment
`1fe76e3b`. All dependencies are verified; this task alone occupies the active
lane. The native branch `codex/e9-owned-live-network` is stacked on the verified
control, with every existing PR still open and unmerged. Risk is high because
live provider ownership, callback lifetime and replay egress boundaries change.

Implement one shared real Slirp Ethernet/TCP pump and the bounded local service
at unchanged `10.0.2.2:9191`. Use existing owned TX/RX/link/pending leases in
both OFF and ON; only ON appends receipts. Replay must refuse the provider
factory before construction and any stale/cross-owner handle before live work.
Server parsing, queues, response staging, registration and cancellation must be
bounded. Retain independent request/body counters and all ten real full-Alpine
BusyBox-wget body witnesses; fixture Ethernet responses are not acceptance.

No runtime code or passing T22b target exists at activation. Add the meaningful
direct native/browser/replay attacks first, then freeze the final exact head
for the full high-risk submission and one final cold proof. A fresh actual
Daybreak verifier must run its full charter, novel attack and replay-construction
guard sabotage; a later independent public-path verdict closes publication.
Surface the accepted boundary on the demo/roadmap and ship main Cloudflare.
T22c/d full real workloads and unchanged performance budgets, T23 recovery and
T24 capstone remain required. No merge is authorized.

### 2026-10-22 — worker — implementation and Daybreak preflight corrections

Development work adds the fixed real Slirp HTTP service, shared owned Rust
pump, read-only core lease/capacity preflights and VM-owned browser API. The
service accepts only the ten fixed paths; ordinary Slirp keeps the service
disabled. The pump retains accepted TX and popped RX across staging pressure,
uses the guest clock, captures actual pending/link edges, and closes/cancels
without adopting historical connections. The demo now exercises the complete
Alpine HTTP OFF/ON/replay path and has a matching live roadmap pip.

A fresh actual `gpt-daybreak-blue-latest` preflight, with fallback disabled and
`daybreakBlue`, reviewed a frozen source snapshot. It found two blockers:
legacy network callbacks could bypass the new provider, and `rx()` could hide
an un-preflighted service pass. The worker fenced all legacy request/lease/
completion methods while the provider is installed, split a pure egress dequeue,
and added an immediate RX preflight. Retained pre-open leases are attacked by
the product probe in both modes. Daybreak also requested OFF/WFI and quota
proof: native tests now exercise real pending TCP in both modes, four active
clients/fifth refusal, and the 128/129 boundary with owned-link failure and
queued-TX settlement. The original preflight report is retained unchanged at
`target/evidence/e9-t22b-daybreak-runtime-preflight/final-message.md`, SHA-256
`c780ebbc766ddb5c59d44d57c6707d083bd4c848049235aed4ad1b028715c2ce`; this is a development preflight, not acceptance.

Development self-checks passed strict affected native/Wasm Clippy, the ten
owned-pump tests, and real HTTP fragmentation/tiny-window/half-close/refusal/
header/cancel/timeout/queue-limit checks. A bounded native recorded run retains
8192 instructions and equal replay traces for quanta 1, 7 and 101. The latest
self-checks `target/evidence/e9-t22b-alpine-development-5/report.json` and
`target/evidence/e9-t22b-demo-development-1/report.json` pass the full guest
provider path and the visible 127/0 suite. Earlier failed development runs
remain intact (boot-reset revocation, harness progress-before-open, and a
renamed immutable-chunk route); they are not relabelled as passing evidence.

No frozen final submission, final cold checkout, fresh full adversarial
acceptance verdict, or B production deployment is claimed here. Freeze and
record `make verify-E9-T22b`, then the one final cold proof. A fresh actual
Daybreak session must independently falsify the evidence, audit changed hunks,
run the charter's novel attack and replay-factory sabotage, and later close the
main-publication criteria. Every PR remains open; T22c/d, T23 and T24 remain
required.
