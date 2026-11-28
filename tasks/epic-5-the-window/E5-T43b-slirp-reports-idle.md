---
id: E5-T43b
epic: 5
title: Paced idle with networking on — the slirp backend reports when it is idle
priority: 0.387661
status: evidence-needed
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

### 2026-11-27 — worker — round 2 claim (head `9ef09b030`)

The refutation is right: a file-transfer socket mid-handshake (SynReceived) or mid-close
(LastAck) has a retransmit timer with no connection bound to it, and `idle()` did not look at it.
Commits `8a7bb4881` and `9ef09b030` (build id matching `web/dist`).

**`idle()` is now five conditions**, each pinned by a test:

| condition | a test that fails without it |
|---|---|
| nothing waits for the guest (`egress` empty) | `idle_only_with_nothing_queued_…` (ARP reply waiting) |
| nothing in flight outside the stack (`external_io_pending`: NAT flows with a connector, pending DNS, file transfers, local HTTP) | `idle_conditions_pending_dns_and_dns_tcp_connection` (a DNS query that is never answered, by a service that never says it is busy), the UDP-flow test, `idle_condition_local_http` |
| the DNS-over-TCP socket is listening | the same test (an established, quiet DNS-over-TCP connection) and `verifier_p5_dns_tcp_cycle` |
| both file-transfer sockets are listening | `verifier_p3_half_open_file_transfer_syn`, `verifier_p4_last_ack_after_guest_fin` |

Removing any one makes `cargo test -p wasm-vm-slirp --lib` fail (each removed and restored in
turn). The seven round-1 conditions that no reachable state could isolate are gone: flows, UDP
flows and the flow manager, and pending DNS, are what `external_io_pending` already reports; the
DNS-over-TCP buffers and the file-transfer connections and buffers exist only while their socket
is out of `Listen`; an attached local HTTP service is reported pending by `external_io_pending`.

**Promoted from the verifier** (with assertions where it printed): P3 and P4 (the contract —
idle() is false while a later poll would emit a frame), P4b (a cleanly closed slot is idle again),
P5 (DNS over TCP: not idle in the handshake, idle after reset), P6 (a quiet established slot sends
nothing and is not idle).

`cargo test -p wasm-vm-slirp --lib` 287 passed; clippy (lib, tests) clean; wasm32 build clean.

**The file agent risk**: the Replay desktop's image has no file agent (nothing under
`tools/replay-desktop` mentions it) and its page boots with `fileTransfer: false`, so E5-T43d's
idle figure does not depend on agent connections. Still not claimed: idle while the guest holds
an open outbound connection (by design not idle).

### 2026-11-27 — verifier (round 2) — VERDICT: evidence-needed

VERDICT: evidence-needed

Head `7ccf608b8` (change `8a7bb4881`, build id `9ef09b030`). I wrote the predictions first:
`evidence/e5-t43b/verifier-r2/predictions.md`. I ran the attacks and mutants in a scratch
`git archive` copy of HEAD (attack source: `attack_tests.rs`, output: `attacks.log`; mutants:
`mutate.py`, `mutants.log`). The live tree was not changed. I found no reachable state where
`idle()` is true and a later `poll()` changes anything, so the product claim stands. Two parts of
the claim are not proven: one half of the file-transfer condition has no test, and the stated
reason the local-HTTP case is not idle is wrong.

- **R10 condition pinning: file-transfer slot 1 — FAILED (sufficiency).** Prediction: removing
  any part of the five conditions makes the slirp lib suite fail. Observed: mutant
  `I5-file_tcp_slot0_only` (`(0..FILE_TRANSFER_SLOTS)` → `(0..1)`) passes all 287 tests
  (`mutants.log`). The isolating state can be reached: slot 0 established, a second SYN lands on
  slot 1, then slot 0 closes cleanly. That leaves the sockets in `(Listen, SynReceived)`. Real code:
  `idle()=false`. Under the mutant: `idle()=true`, and polls over 5 s retransmit 2 frames, which
  breaks the contract (`attacks.log`, `r2_slot1_isolated_half_open`). The claim's sentence
  "removing any one makes `cargo test -p wasm-vm-slirp --lib` fail" is false for slot 1. The other
  mutants hold: I1, I2, I3, I4, I6 and E1/E2 (the `pending_dns` and flow terms of
  `external_io_pending`) each fail the suite. Demand: promote a test that puts slot 1 out of
  `Listen` while slot 0 is listening (for example `r2_slot1_isolated_half_open`) and fails under
  `I5`.
- **R7 local HTTP rationale — FAILED (claim and code comment).** Prediction: the claim "an
  attached local HTTP service is reported pending by `external_io_pending`" is false. Observed:
  with the service attached and no connection, `external_io_pending=false`. `idle()` is false only
  because `register_http` (`stack.rs:405-408`) aborts the DNS-over-TCP and both file-transfer
  sockets, and HTTP-mode `service` never relistens them. They stay `Closed`, and after 120 s of
  quiet polls 0 frames have been sent and `idle()` is still false (`r2_local_http_why_not_idle`).
  So `idle_condition_local_http` passes because of the `Listen` conditions, and a backend with
  local HTTP is never idle. That is conservative: it breaks no contract, and the Replay desktop
  does not use local HTTP. But the reason given in the `idle` doc comment
  (`local_backend.rs:1096-1097`) and in the round-2 claim is wrong. Also, `idle()` never looks at
  the four HTTP slot sockets (they have LastAck/FinWait/timeout timers). Only the same `Closed`
  sockets hide this. Demand: correct the comment and the claim to the real reason. Either keep
  the reasoning on record ("local HTTP mode closes the internal listeners, so it is never idle"),
  or restore an explicit `local_http.is_none()` term. Then point the test at that reason, for
  example by asserting `external_io_pending()==false` and `idle()==false` together.
- **R3/R4 dropped flow and DNS conditions are redundant — HELD.** `flows` and `udp_flows` are
  inserted only with a connector and after the manager admits the key. The manager drops a key
  only in `teardown`, which removes all three. `pending_dns` is a literal term of
  `external_io_pending`. Scripted NAT TCP lifecycle (connecting → remote data → remote close → host
  FIN → guest FIN → TimeWait teardown): not idle while a flow exists; after teardown it is idle,
  and that holds over 120 s of polls (`r2_contract_nat_tcp_lifecycle`).
- **R5/R6 dropped DNS-over-TCP and file buffers are redundant — HELD.** DNS-over-TCP partial
  message (5 bytes) then guest FIN: `dns_tcp_rx=5` in `LastAck` with `idle()=false`. After the
  final ACK the buffer is cleared and the backend is idle, which holds. File slot: an RST in
  `SynReceived` returns it to `Listen`, and idle holds. Garbage input → error frame and host close
  → `FinWait1` → guest FIN → `TimeWait`: not idle throughout. The 2MSL timer drains it to `Listen`
  within 30 s of polls, with `file_connections` empty, `file_tcp_tx` empty, and idle holding
  (`r2_contract_dns_tcp_and_file_lifecycles`). At each of the 9 idle points (ARP, UDP DNS answered,
  the closes above, NAT teardown), 240 polls over 120 s produced no frame and `idle()` stayed true.
- **R2 round-1 P3/P4 — HELD.** The promoted tests assert the contract and pass. Mutant I4 fails
  them.
- **R9 idle false forever on the Replay desktop — HELD, by reading.** The browser always
  attaches a DNS service (`crates/wasm/src/lib.rs:3495`), so `poll()` always runs `service`, and
  TimeWait/LastAck timers drain back to `Listen`. The only state that is quiet and never idle is
  the one the claim already excludes (an open outbound flow, or a bound file/DNS connection).
- **R11 no file agent on the Replay desktop — HELD.** `tools/replay-desktop/rootfs/etc/init.d/rcS`
  starts no file agent, and the desktop boot options (`web/main.js` replay-desktop and accelerated
  paths) set `fileTransfer: false` (and today `slirpNet: false`). Note: `fileTransfer:false` only
  detaches the host UI. The browser still builds the backend with file-transfer listeners
  (`BrowserFileTransfers::new`), so the agent's absence from the image is what keeps the slots in
  `Listen`.
- **R1 suites — HELD.** `cargo test -p wasm-vm-slirp --lib`: 287 passed, 1 ignored (the diff adds
  no `#[ignore]`). Core `paced`: 25 passed. Core `idle`: 30 passed. `cargo clippy -p wasm-vm-slirp
  --lib --tests -D warnings` and `cargo fmt --check` are clean, and so is `cargo check -p
  wasm-vm-wasm --target wasm32-unknown-unknown`. `web/gpu-checkpoint-build.js` equals the dist copy,
  and its SHA-256 and byte count match `web/dist/pkg/wasm_vm_wasm_bg.wasm` (`suites.log`).
- **Informational, no demand (pre-existing code, not in this diff).** Mutants E3 (`dns.pending()`)
  and E4 (`active_transfers()`) survive. E4 is redundant with the file `Listen` condition. E3 is
  reachable without `pending_dns` only for a query whose TCP generation was reset, and its
  completion is then dropped without a frame.
- **Not checked:** a machine-level run (core loop or wasm) showing that idle waits are taken with a
  slirp backend attached (carried from round 1); a late DNS completion for a reset DNS-over-TCP
  generation under a service whose `pending()` is false; DHCP renewal under a long wait.
- SUITE: none promoted (the task is not verified). `attack_tests.rs` (`r2_contract`, the
  lifecycle, NAT and slot-1 tests) is ready to promote once the two gaps close.

The response needs only a test, a comment and the claim text, with no runtime semantics, so only
the slirp lib suite and the I5 mutant need rerunning. Carry R1–R6, R8, R9 and R11 forward.

Commands: `cargo test -p wasm-vm-slirp --lib`; `cargo test -p wasm-vm-core --lib paced|idle`;
`cargo clippy -p wasm-vm-slirp --lib --tests -- -D warnings`; `cargo check -p wasm-vm-wasm --target
wasm32-unknown-unknown`; in the scratch copy: `cargo test -p wasm-vm-slirp --lib r2_ -- --nocapture
--test-threads=1` and the mutant loop over `mutate.py` ids.
