---
id: E5-T43b
epic: 5
title: Paced idle with networking on — the slirp backend reports when it is idle
priority: 0.387661
status: in-progress
depends_on: []
estimate: S
risk: high
capstone: false
---

## Why this exists

E5-T37c item 1: a network backend that does not answer `NetBackend::idle` keeps the quiescence
marker unset, so no idle wait is reported and the paced clock never lets the worker sleep.
`SlirpLocalBackend` and `SharedSlirpBackend` are such backends. Turning networking on for the
Replay desktop (E5-T43d) would take its idle worker time from about 1.2 % back to nearly 100 %.

## Boundary

`crates/slirp` (and the core's net seam if needed): the slirp backends report idle exactly when
no frame is queued for the guest, no timer of the stack is due before the wait would end, and no
outbound transport has data or a pending event; the next deadline bounds the wait. No other
device changes.

## Deterministic acceptance

- Core/slirp tests: idle is reported with an empty, quiet stack; not reported with a queued
  frame, a due DHCP/ARP/TCP timer, or pending relay data; a reported wait never passes a stack
  deadline; the existing paced-idle tests (E5-T37a) pass.
- (Moved to E5-T43d, which turns networking on for the Replay desktop and already measures it:
  idle worker time with networking on within 2 points of generation 2's. No page here can boot
  the desktop with networking on.)

## Adversarial verification

High risk (guest timing). Attack list: a TCP retransmit timer due during a long idle wait; DHCP
renewal; relay data arriving while the worker sleeps (it must wake); a guest polling the NIC.

## Verification log

### 2026-11-27 — worker — claim (head `732c5c654`)

Commits `b58713070` (the change) and `732c5c654` (the regenerated build id that matches the
rebuilt `web/dist`).

**Changed**: `SlirpLocalBackend::idle` (`crates/slirp/src/local_backend.rs`) is true exactly
when, per the trait's contract (`crates/core/src/dev/virtio/net.rs`: "`poll` would do nothing and
`rx_ready` is false, and both stay so until the device hands the backend a frame or the host
calls into the backend between run calls"): no frame waits for the guest (`egress` empty);
`external_io_pending` is false (no NAT flow with a connector, no pending DNS, no file transfer, no
local HTTP work); no TCP flow (`flows`, `manager`) and no UDP flow (`udp_flows`); no pending DNS
entries, no DNS-over-TCP bytes either way, and the guest's DNS-over-TCP socket is back to
`Listen`; no file-transfer connection and no queued file-transfer bytes; no local HTTP service.
The remaining sockets are listeners, which carry no smoltcp timers. `SharedSlirpBackend` (the
browser's) forwards `idle`, as `SwitchableNetBackend` already does.

**Tests**: new `idle_only_with_nothing_queued_no_flows_and_no_work_in_flight` — a fresh offline
stack idle; an ARP reply waiting: not idle; drained: idle; with a connector and no flows: idle;
a UDP flow open: not idle; after NAT expiry: idle again; a poll of an idle backend leaves it
idle and not ready. `cargo test -p wasm-vm-slirp --lib` 280 passed; core network tests pass;
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` and clippy (slirp, wasm) clean.

**Not shown here**: the browser figure (idle worker time with networking on). No page boots the
Replay desktop with networking on until E5-T43d, whose acceptance measures it (within 2 points of
generation 2's 1.2 %). With a relay connector and an open flow (a browser holding a keep-alive
connection), the backend is not idle by this rule — those polls are needed for replies and NAT
expiry — so idle worker time while the guest holds open connections is not claimed.

### 2026-11-27 — verifier — VERDICT: refuted

Head `04edf1622` (change `b58713070`). Predictions written first:
`evidence/e5-t43b/verifier/predictions.md`. Attacks were run in a scratch `git archive` copy of
HEAD with extra tests added to `local_backend.rs`'s test module (source:
`evidence/e5-t43b/verifier/attack_tests.rs`, output: `attacks.log`). The live tree was not
changed. The backend under attack has the browser's shape: a connector plus a DNS service, a
clock the test controls.

- **P3 half-open file-transfer handshake — FAILED (contract).** Predicted `idle()` true while the
  file-transfer slot socket is in `SynReceived` and a later `poll()` emitting a frame. Observed:
  guest SYN to `file_transfer::PORT`, SYN-ACK drained → `idle()=true`, state `SynReceived`; at
  clock +1000 ms `poll()` retransmits the SYN-ACK (`rx_ready()` flips true)
  (`attacks.log`, `verifier_p3_half_open_file_transfer_syn`). The condition list checks that the
  DNS-over-TCP socket is back to `Listen`, but not the two file-transfer slot sockets, so the
  claim "the remaining sockets are listeners, which carry no timers" is false. Demand: require
  every file-transfer slot socket to be in `Listen` (as for DNS-over-TCP), or report the stack's
  next timer as a deadline, and pin it with a test.
- **P4 LastAck after the guest closes an agent slot — FAILED (contract).** Predicted the same for
  the CloseWait→LastAck path. Observed: established slot, guest FIN → the CloseWait path takes
  `file_connections[0]` and closes; host FIN drained → `idle()=true`, state `LastAck`,
  `file_connections[0]=None`; at +1000 ms `poll()` retransmits the FIN
  (`verifier_p4_last_ack_after_guest_fin`). Impact while the device pass is skipped: the
  retransmission waits for the next run call or guest kick (`lib.rs:7484` clears the marker at
  each run entry), i.e. up to one run call plus one paced idle wait. That matters when a frame was
  dropped on a full receive ring (`net.rs` `rx_dropped`). It breaks the `NetBackend::idle`
  contract (`net.rs:99-105`) and this task's boundary ("no timer of the stack is due before the
  wait would end"). Same fix as P3.
- **P2 condition pinning — FAILED (sufficiency).** The new test only fails when
  `egress.is_empty()` is removed. Each of the other 11 conditions can be removed alone and both the
  new test and the whole slirp lib suite (277) still pass (`mutants.log`, script `mutate.py`). The
  flow conditions overlap with `external_io_pending` (so some overlap is fine), but nothing pins
  `pending_dns`, `dns_tcp_rx/tx`, `dns_tcp_state()==Listen`, `file_connections`, `file_tcp_tx` or
  `local_http`. Acceptance also asks for "not reported with … a due DHCP/ARP/TCP timer" and "a
  reported wait never passes a stack deadline". No test covers either: the claimed test has no
  TCP state at all. Demand: a test per condition that is not redundant (at least DNS-over-TCP
  mid-connection, a file-transfer slot in each non-Listen state, and local HTTP), each failing
  when its condition is removed.
- **P4b / P5 clean closes return to idle — HELD.** After the guest ACKs the host FIN, the slot is
  back to `Listen` and `idle()` is true, with no frame over 60 s of polls. DNS-over-TCP mid-
  connection is not idle; after a guest RST it is back to `Listen` and idle.
- **P6 quiet established agent slot — NEEDS EVIDENCE (for E5-T43d, not a refutation here).**
  An established slot with no HELLO or transfer produces 0 frames over 600 s of polls, yet `idle()`
  stays false. The wvft agent (`crates/file-agent/src/main.rs` `run_service`) keeps both slots
  connected all the time and sends a heartbeat every 5 s. If the Replay desktop image runs it
  (`releases/rootfs/FILE-MANIFEST.txt` lists `/etc/init.d/wasm-vm-file-agent`; I did not check
  which image the desktop boots), the fabric is never quiet with networking on, and E5-T43d's
  "within 2 points of generation 2" figure is out of reach. The claim does not mention this
  exclusion.
- **P7 UDP flow / NAT expiry — HELD** (the claimed test; with a flow open, `external_io_pending`
  keeps it not idle). **P9 relay data while the worker sleeps — HELD by reading:** with no flow,
  `SyncConnector` cannot deliver anything (it has no inbound accept), and in-flight DNS is caught
  by `pending_dns` / `dns.pending()` (`BrowserDnsService::pending` includes completions).
- **P1 / P8 — HELD.** `cargo test -p wasm-vm-slirp --lib`: 280 passed. `cargo test -p
  wasm-vm-core --lib paced`: 25 passed. `cargo test -p wasm-vm-core --lib idle`: 30 passed.
  `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown` is clean. The forward in
  `SharedSlirpBackend::idle` is correct; `SwitchableNetBackend` and `PcapBackend` already forward.
- **Browser bullet moved to E5-T43d — accepted.** E5-T43d's acceptance carries the figure, and no
  page here boots the desktop with networking on. See P6 for the risk it inherits.
- **Not checked:** a machine-level run (core run loop or wasm) showing that idle waits are
  actually taken with a slirp backend attached, and DHCP renewal under a long wait (the DHCP
  server is stateless, `dhcp.rs` `handle(&self)`; renewal is driven by guest `tx`).
- SUITE: n/a until the refutations clear. The attack tests in `attack_tests.rs` are ready to be
  promoted once the fix lands.

Commands: `cargo test -p wasm-vm-slirp --lib`; `cargo test -p wasm-vm-core --lib paced|idle`;
`cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`; scratch copy:
`cargo test -p wasm-vm-slirp --lib local_backend::tests::verifier_ -- --nocapture`; the mutant
loop in `mutants.log`.
