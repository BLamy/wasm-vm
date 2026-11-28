# E5-T43b verifier predictions (written before running anything; code read only)

Head under test: `04edf1622` (change `b58713070`). Contract: `NetBackend::idle` doc
(`crates/core/src/dev/virtio/net.rs:99-105`): true promises `poll` does nothing and `rx_ready` is
false, and both stay so until `tx` or a host call between run calls. The core skips the whole
device pass (and lets the paced clock sleep) while every device is idle — so any slirp timer that
falls due while `idle()` is true is deferred until the next run call / guest kick.

- **P1** `cargo test -p wasm-vm-slirp --lib` passes (280) including the new test; the wasm forward
  compiles. Expect HELD.
- **P2 (mutants)** The new test pins only `egress.is_empty()` (ARP reply) and the flow triple
  (`!external_io_pending` / `udp_flows.is_empty()` / `manager.flow_count()==0`, redundant with each
  other for a UDP flow with a connector). Deleting any single one of `flows.is_empty()`,
  `pending_dns`, `dns_tcp_rx`, `dns_tcp_tx`, `dns_tcp_state()==Listen`, `file_connections`,
  `file_tcp_tx`, `local_http.is_none()` survives the whole slirp suite. Deleting
  `udp_flows.is_empty()` alone also survives (external_io_pending covers it). Expect most
  conditions UNPINNED.
- **P3 (half-open file-transfer socket)** The condition list checks the DNS-TCP socket is back to
  `Listen` but not the two file-transfer slot sockets. With a connector+DNS service attached (the
  browser shape), a guest SYN to the file-transfer endpoint, SYN-ACK drained, no guest ACK:
  `idle()` is TRUE while the smoltcp socket sits in `SynReceived` with a retransmit timer; a later
  `poll()` (clock advanced past the RTO) changes state / emits a retransmitted SYN-ACK
  (`rx_ready()` flips true). Contract violation. Expect FAILED (contract) — practical impact
  limited to a guest that abandons a handshake.
- **P4 (LastAck after guest close of an agent slot)** Guest FIN on an established, HELLO-less slot:
  the CloseWait path takes `file_connections[slot]`, closes → LastAck, FIN drained. `idle()` TRUE
  while the FIN's retransmit timer is pending; a `poll()` after the RTO emits a FIN retransmission.
  Expect FAILED (contract), same practical caveat.
- **P5 (DNS-over-TCP full cycle)** After a guest DNS-TCP query is answered and the connection fully
  closed (guest ACK of the host FIN), the socket returns to `Listen` inside the same `tx` service
  pass, so `idle()` returns to true without a further poll. Expect HELD.
- **P6 (quiet established agent connection)** With a guest agent slot Established (HELLO done, no
  transfer, no data in flight), `poll()` changes nothing observable, yet `idle()` stays FALSE
  forever, so a desktop running the wvft agent never gets an idle wait. Over-conservative, not a
  contract violation; outside this task's claimed scope only if the desktop does not run the
  agent. Expect: idle false (NEEDS EVIDENCE for E5-T43d's figure).
- **P7 (UDP NAT expiry during long idle)** With a UDP flow open, `idle()` is false (external I/O
  pending) so no wait is taken past NAT expiry. Expect HELD.
- **P8** E5-T37a paced-idle tests (`cargo test -p wasm-vm-core paced`) pass. Expect HELD.
- **P9 (relay data while worker sleeps)** No flow ⇒ the connector can deliver nothing to the
  backend (SyncConnector has no inbound/accept), DNS in flight ⇒ not idle. So "it must wake" is
  satisfied vacuously. Expect HELD by code reading.
