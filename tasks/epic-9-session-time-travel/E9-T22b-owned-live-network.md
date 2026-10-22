---
id: E9-T22b
epic: 9
title: Connect the shared owned network path to witnessed local HTTP
priority: 524.92202
status: pending
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

(pending; no implementation or verification claim)
