---
id: E7-T06
epic: 7
title: Full network stack hardening — throughput, IPv6, connection scale for a desktop
priority: 706
status: pending
depends_on: [E6]
estimate: M
capstone: false
---

## Goal
Mature the Epic 3 user-mode network stack from "apk add works" into a **full network fabric a
desktop can live on**: sustained throughput for large downloads, many concurrent connections
(a browser/app opens dozens), IPv6 where the transport allows, and graceful behavior under
loss and reconnection. Layer F is not only box64 — a real desktop needs a real network.

## Context
Builds directly on E3-T14/T15/T16 (slirp/smoltcp, DHCP/DNS, WebSocket/fetch transports). The
new pressure comes from desktop workloads: a package manager pulling in parallel, a GUI app
streaming, and (looking ahead to E8) a browser opening many sockets. Profile the slirp core
under load, fix head-of-line and buffer-sizing issues, add connection-count and throughput
budgets, and decide the IPv6 story (full dual-stack vs documented v4-only with rationale).
Coordinate with E3-T19 proxy hardening for the relay side.

## Deliverables
- Throughput and connection-scale benchmarks (guest `iperf3`-style or bulk HTTP), with a
  ledger and target numbers, over each transport (relay, fetch gateway).
- Fixes to the slirp/smoltcp core surfaced by load (buffer sizing, connection table limits,
  fairness), each with a regression test.
- A decision record on IPv6 support.

## Acceptance criteria
- [ ] A bulk download in the guest sustains a documented throughput floor over the relay
      without stalls; 50+ concurrent connections stay live without the stack wedging.
- [ ] Connection teardown/reconnect under induced packet loss recovers cleanly (no leaked
      connection-table entries, measured before/after).

## Adversarial verification
Open connections up to and past the configured limit — the stack must refuse gracefully, not
crash or corrupt existing connections. Kill the transport mid-transfer repeatedly and confirm
no fd/connection leaks accumulate over 100 cycles (counter check). Run a mixed workload (bulk
download + many small requests) and confirm the small requests aren't starved beyond a stated
latency bound. If IPv6 is claimed, exercise a v6-only destination; if it's declined, confirm
the documented v4-only behavior is what actually ships.

## Verification log
(empty)
