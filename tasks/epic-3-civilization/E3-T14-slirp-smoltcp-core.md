---
id: E3-T14
epic: 3
title: Slirp-style user-mode network core on smoltcp with NAT
priority: 314
status: pending
depends_on: [E3-T13]
estimate: L
capstone: false
---

## Goal
A user-mode TCP/IP stack — our slirp — that terminates the guest's ethernet world entirely
in Rust: smoltcp parses/answers guest frames, guest-initiated TCP connections are accepted
locally and NATed onto an abstract `OutboundConnector` trait, UDP flows get per-flow NAT
entries, all with no privileged host networking. Architecture documented before code.

## Context
This is the largest networking task; the design doc is a deliverable, not an afterthought.
Adopt slirp conventions: guest subnet 10.0.2.0/24, guest 10.0.2.15 (via T15 DHCP), gateway
10.0.2.2, DNS 10.0.2.3. Architecture: virtio-net frames feed a custom `smoltcp::phy::Device`
impl; the smoltcp `Interface` owns the gateway IPs and answers ARP/ICMP; TCP interception —
any guest SYN to any external IP:port is accepted by a listening smoltcp socket (promiscuous
accept: sockets created on demand keyed by 4-tuple), then bridged byte-for-byte to an
`OutboundConnector::connect(host, port) -> (tx, rx)` future implemented by T16/T17
transports (and by plain `tokio::net::TcpStream` in the native harness — enabling full
native testing against real localhost servers). Flow control is the hard part: transport
backpressure must propagate into smoltcp's window (stop reading from the smoltcp socket →
window closes → guest sender stalls) and vice versa. NAT table with idle timeouts (TCP
established 2h, UDP 30s), RST/FIN propagation in both directions, and bounded per-flow
buffers.

## Deliverables
- `docs/design/slirp.md`: addressing plan, socket-interception design, connector trait
  contract (incl. backpressure and half-close semantics), NAT table lifecycle, buffer
  bounds, what is out of scope (inbound connections, IPv6 — record explicitly).
- `slirp` crate (core, no_std-unfriendly deps avoided; native + wasm): smoltcp device glue,
  TCP interception/bridging, UDP NAT, ICMP echo to 10.0.2.2, flow table + timeouts.
- `NativeConnector` (tokio) for the native harness.
- Native integration tests: guest-side smoltcp test client (or booted Alpine under the
  native harness) doing HTTP GET against a local hyper server; concurrent-connection test;
  half-close (`shutdown(WR)`) test; large-transfer (100 MB) integrity test via sha256.

## Acceptance criteria
- [ ] Native harness: booted Alpine fetches `http://192.0.2.1:8080/file` (a test-net
      address the `NativeConnector` maps to a local hyper server) via `wget`; body sha256
      matches the served file — i.e., guest TCP through slirp to a real socket,
      content-identical.
- [ ] 50 concurrent guest TCP connections complete with correct data (no cross-flow bleed —
      each flow carries a distinct pattern, verified server-side).
- [ ] 100 MB transfer both directions is content-identical and memory stays bounded
      (per-flow buffer cap enforced; assert peak RSS delta in test).
- [ ] Guest `ping 10.0.2.2` gets ICMP replies; NAT entries expire (observe table size
      return to zero after idle timeout with time mocked or shortened).
- [ ] Half-close works: guest `shutdown(WR)` still receives the server's remaining data.

## Adversarial verification
Attack flow control and teardown. Stall the server side of a transfer for 60 s mid-stream —
guest connection must survive and resume, slirp buffers must not grow past their cap. Kill
the outbound socket abruptly (RST) and verify the guest sees ECONNRESET promptly, not a
hang. Open 1000 flows and abandon them — table must shrink via timeouts; leaked sockets or
unbounded memory refutes. SYN to a port the connector refuses: guest must get RST within
the connect-timeout. Run the 100 MB test with a connector that delivers data in 1-byte
chunks (pathological framing) — corruption or quadratic slowdown refutes. Diff `docs/design/
slirp.md` claims against behavior; any contract stated but unimplemented refutes.

## Verification log
(empty)
