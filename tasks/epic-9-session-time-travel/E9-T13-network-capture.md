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
