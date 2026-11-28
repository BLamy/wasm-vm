# E5-T43e verifier predictions (written before running anything or opening the worker's result files)

Fresh verifier session, 2026-11-28. Head under test: f33a9f9e4 (claim at 7808a5173).

P1 Capture order. evidence/e5-t43e/capture/native-capture.log shows `REPLAY_NETWORK bound` on an
   earlier line than `REPLAY_CAPTURE_TCP_WAIT` and both before `REPLAY_DESKTOP_COMPACTED`; snapshot.json
   records nic `--net-slirp`, sha256 87a0cde821f8..., size 136,668,204 <= 137,000,000.
P2 Artifact identity. releases/boot-snapshot/replay-desktop-ready-87a0cde821f8.snap.gz hashes to the
   manifest's sha256/size; the gunzipped bytes hash to uncompressedSha256; releases/rootfs/
   replay-desktop-3165a13b8d07.chunks.json hashes to the manifest's chunkManifest sha256;
   target/e5-t43e/image2/replay-desktop.ext4 hashes to 3165a13b8d07...; web/dist's manifest equals
   web/artifacts-replay-desktop.json; 127.0.0.1:8125 and https://wasm-vm.pages.dev serve that same manifest.
P3 Shipped image content. The ext4 contains replay-chromium with the new flags and NOT --gaia-url, and
   /etc/chromium/policies/managed/replay-desktop.json byte-equal to the source.
P4 Novel attack: TCP state inside the snapshot. The capture's wait loop counts only state 01
   (ESTABLISHED). Prediction: a native resume of the gen 3 snapshot shows, in /proc/net/tcp and tcp6,
   no socket in any state other than 0A (LISTEN) and possibly 06 (TIME_WAIT); no SYN_SENT/CLOSE_WAIT/
   FIN_WAIT/ESTABLISHED. (If one is there the "guest holds no TCP connection at capture" criterion fails.)
P5 Stale lease on resume. Source: the wasm build uses the same crates/slirp DHCP constants as the CLI
   (guest 10.0.2.15, router 10.0.2.2, DNS 10.0.2.3); resumed natively with --net-slirp the guest keeps
   10.0.2.15 and a node http fetch answers 200 without re-leasing.
P6 Offline resume with the lease. Resumed on the loopback NIC the guest's load average stays ~0 and
   eth0 tx packet count grows by fewer than 20 packets over 30 guest seconds (no storm).
P7 Click not slower (my own interleaved A/B, 3 loads a side, n 8, gen3 on 8125 vs gen2 on 8129).
   Prediction (stated as the worker's claim would require): mean of gen3 per-load click medians minus
   mean of gen2's is < +5 ms and the ranges overlap. If gen3 is slower in every pairing by > 5 ms
   I treat "not slower" as FAILED for click. Key echo and node -e: gen3 within +5 % of gen2.
P8 Retry harness. In the worker's passing E5-T41a/E5-T43c/E5-T36b console logs no `Rprintf: not found`
   appears (the retry branch never ran) -> the retry branch is unexecuted in the evidence. Prediction
   about the code: on a begin-marker miss the first attempt's command still executed (only the printf
   was mangled), so non-idempotent commands (e.g. e5-t41a `mv ${BLOB} ${BLOB}.away`) run twice; the
   second run's failure is swallowed because sh() never checks exit status.
P9 Coverage. Every changed hunk of build-replay-desktop-snapshot.sh executed in the recorded capture
   except the `else LEASE_STEP=":"` (loopback) branch.
