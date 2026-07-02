---
id: E3-T18
epic: 3
title: WebTransport transport option evaluation
priority: 318
status: pending
depends_on: [E3-T16]
estimate: S
capstone: false
---

## Goal
A measured go/no-go decision on WebTransport (HTTP/3) as a third transport: a working spike
that tunnels one guest TCP flow over a WebTransport bidirectional stream to a Rust HTTP/3
server, benchmarked against the T16 WebSocket relay, with the decision and evidence written
down. No production integration in this task.

## Context
WebTransport's pitch over WebSocket for our relay: per-stream flow control and no
head-of-line blocking between flows (one QUIC stream per guest TCP connection maps naturally,
deleting most of T16's credit machinery), plus datagrams for future UDP. Costs to weigh:
server needs HTTP/3/QUIC (`wtransport` or `h3`+`quinn` crates — evaluate maturity),
certificate story is stricter (no self-signed convenience beyond
`serverCertificateHashes` with its ~14-day validity window — assess what that means for
local dev and for deployment behind CDNs that may not speak HTTP/3 end-to-end), browser
support matrix as of mid-2026 (Safari's state specifically), and proxy/firewall traversal
of UDP/443 in hostile networks (a fallback to WS remains mandatory regardless). The spike
reuses the T16 protocol's OPEN semantics but 1 stream = 1 flow.

## Deliverables
- `spikes/webtransport/`: minimal Rust WT server + wasm client bridging one
  `OutboundConnector` flow; explicitly marked non-production.
- Benchmark vs. T16 on the same machine: throughput (single stream and 8 concurrent),
  p50/p99 echo RTT, behavior under 2% simulated packet loss (tc/netem or clumsy-equivalent)
  — the loss scenario is where QUIC should differentiate.
- `docs/design/webtransport-eval.md`: results tables, support matrix with citations,
  cert/deploy analysis, the decision (adopt now / defer with trigger conditions / reject),
  and if deferred, the concrete follow-up task sketch.

## Acceptance criteria
- [ ] The spike moves real bytes: a guest-originated flow (or a synthetic
      `OutboundConnector` harness) round-trips 100 MB through the WT server, sha256-clean.
- [ ] Benchmark table complete for both transports across all listed scenarios, ≥3 runs
      each with variance.
- [ ] The packet-loss scenario is included — this is the differentiating case and its
      absence voids the evaluation.
- [ ] Decision doc states one unambiguous outcome with trigger conditions if deferred
      (e.g. "adopt when Safari ships X / when relay HOL blocking measurably hurts T20").
- [ ] Local-dev cert flow is documented and was actually executed (command transcript in
      the doc), including the `serverCertificateHashes` expiry caveat.

## Adversarial verification
Reproduce the benchmarks from the doc's own instructions on a clean checkout; >2× deviation
on any headline number refutes the doc. Check the loss test isn't fake: verify netem (or
equivalent) was genuinely active by observing the WS transport degrade. Probe the decision's
honesty: if "adopt" — demand the cert/deployment answer for a CDN-fronted production origin;
if "reject/defer" — check the stated trigger conditions are objectively evaluatable. Kill
the WT connection mid-transfer and confirm the spike fails cleanly (a panic in the wasm
client suggests the crate maturity assessment was skipped). Verify the support matrix
against current caniuse/browser release notes — a stale claim refutes.

## Verification log
(empty)
