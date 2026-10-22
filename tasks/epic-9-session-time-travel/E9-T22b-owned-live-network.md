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
