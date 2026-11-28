---
id: E5-T43b
epic: 5
title: Paced idle with networking on — the slirp backend reports when it is idle
priority: 0.387661
status: implemented
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
