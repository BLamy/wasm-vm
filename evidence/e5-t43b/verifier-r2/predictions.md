# E5-T43b round 2 — verifier predictions (written before any command was run)

Head under attack: `7ccf608b8` (change `8a7bb4881`, build id `9ef09b030`). Contract:
`NetBackend::idle` doc, `crates/core/src/dev/virtio/net.rs:99-105`. Read so far: the diff
`39fd614c7..HEAD -- crates web/gpu-checkpoint-build.js`, `local_backend.rs` (struct, service,
pump*, teardown, expire, external_io_pending, poll/tx/rx/idle), `stack.rs` relisten /
register_http, `local_http.rs` pending/pump, `manager.rs` removal paths, `crates/wasm/src/lib.rs`
slirp construction, Replay desktop boot options in `web/main.js` and its rootfs overlay.

Carried forward from round 1 (code/boundary unchanged except `idle`): P1/P8 suites, P4b/P5 clean
closes, P7 UDP/NAT expiry, P9 relay data by reading. They are re-run only as part of the lib suite.

- R1 (suite) `cargo test -p wasm-vm-slirp --lib` passes at HEAD with 287 tests; core `paced` and
  `idle` filters pass; wasm32 check of `wasm-vm-wasm` is clean; clippy -D warnings on slirp clean.
- R2 (P3/P4 fixed) the promoted P3/P4 tests now hold their contract assertion: idle() false while
  a file-transfer socket is in SynReceived / LastAck.
- R3 (dropped: flows/udp_flows/manager) `flows` and `udp_flows` are inserted only when a
  connector is Some and only after the manager admitted the key; the manager loses a key only in
  `teardown` (which removes all three). So `flows ∪ udp_flows non-empty ⇒ connector.is_some() &&
  flow_count() > 0 ⇒ external_io_pending`. No reachable state isolates them. HELD predicted.
- R4 (dropped: pending_dns) `!pending_dns.is_empty()` is a literal term of external_io_pending.
  HELD predicted (trivially).
- R5 (dropped: dns_tcp_rx/tx) both are filled only in Established/CloseWait and cleared by
  `reset_dns_tcp_connection` on Closed→relisten; the only Listen transition that bypasses Closed is
  smoltcp's SynReceived+RST→Listen, in which no bytes were received. A stale-generation answer is
  dropped by `deliver_dns`. Predicted: no reachable state has the DNS socket in Listen with
  non-empty dns_tcp_rx/tx. Attack: partial message + FIN; query in flight + RST then late answer.
- R6 (dropped: file_connections/file_tcp_tx) bound only in Established/CloseWait; cleared on
  Closed→relisten or the CloseWait path. Predicted none survive into Listen. Attack: host-initiated
  close (protocol error → close_after_write) through FinWait/TimeWait back to Listen, checking the
  buffers and that idle() then holds over 120 s of polls.
- R7 (dropped: local_http.is_none()) PREDICTION: the claim "an attached local HTTP service is
  reported pending by external_io_pending" is FALSE. `LocalHttpService::pending()` is
  `!closed && any slot.connected`, so with no HTTP connection external_io_pending is false.
  idle() is nevertheless false because `register_http` aborts the DNS-over-TCP and file-transfer
  sockets (Closed) and the HTTP-mode service never relistens them; i.e. the test
  `idle_condition_local_http` passes via the Listen conditions, not via external_io_pending, and a
  backend with local HTTP is never idle. Also: idle() never inspects the HTTP slot sockets
  (their LastAck/FinWait timers) — currently masked by the same Closed sockets. Predict: no contract
  violation today; a false rationale in the code comment and the claim.
- R8 (contract fuzz) across scripted scenarios (ARP, DHCP, UDP DNS answered, DNS-over-TCP cycles,
  file-transfer handshakes/closes/RST in SynReceived, NAT TCP/UDP with a connector incl. remote
  close/teardown), at every point where idle() is true, 120 s of 500 ms polls produce no frame and
  idle() stays true. Predicted HELD.
- R9 (idle false forever, Replay desktop) the browser always attaches a DNS service
  (`crates/wasm/src/lib.rs:3495`), so poll() runs `service` and TimeWait/LastAck timers drain back
  to Listen; with no guest file agent and no local HTTP, a quiet guest with no open connection
  reaches idle. Predicted HELD; the by-design exclusion (open outbound flow) remains.
- R10 (mutants) removing each of the five conditions alone makes the slirp lib suite fail.
  Predicted HELD for all five.
- R11 (desktop file agent) `tools/replay-desktop/rootfs/etc/init.d/rcS` starts no file agent and
  `assemble.py` installs only the overlay + selected debs; the desktop boot options set
  `fileTransfer: false`. Note: `fileTransfer:false` only detaches the host UI — the browser still
  builds the backend with file-transfer listeners (`BrowserFileTransfers::new`), so the absence of
  the agent in the image is what matters. Predicted HELD.
