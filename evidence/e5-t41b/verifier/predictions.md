# E5-T41b verifier predictions (written before any run)

Head under test: e1b3aafd6 (code 6b16fe055 + 2528fecd4). Verifier: fresh session, 2026-11-26.

P1 Artifacts (local). `releases/rootfs/replay-desktop-20f03da7c51d.{chunks.json,img.gz}` and
   `releases/boot-snapshot/replay-desktop-ready-2d4d38924d83.snap.gz` have exactly the sizes and
   SHA-256 the manifest names (chunks 128555 / 4a4b014c…; img.gz 189683821 / a28de82e…, gunzips to
   467664896 B with sha 20f03da7c51d…; snap.gz 129712599 / 2d4d3892…, gunzips to 346123023 B with
   sha 5020fb05…). The chunk manifest's chunk hashes match the decompressed image.
P2 Artifacts (public R2). The same three objects at the R2 public base used by the deploy
   (`pub-c7188e…r2.dev/<key>`) return the same bytes (size + SHA-256), and the LIVE manifest
   served by https://wasm-vm.pages.dev names those R2 URLs with those digests.
P3 Size ≤ 135 MB: published snapshot 129,712,599 B. An independent capture rerun (scratch dirs)
   writes a snapshot ≤ 135,000,000 B (expected 125–135 MB; not byte-identical is acceptable),
   prints REPLAY_NODE_SNAPSHOT before REPLAY_DESKTOP_COMPACTED, says "disk unchanged", and the
   privacy check prints OK on raw and gz.
P4 Memory pressure. Neither the worker's capture log nor my rerun contains an OOM-killer line,
   "page allocation failure", or a crashed Chrome/sway after the dd; zeroed_mib is > 400.
P5 Node line never comes. A capture whose boot ends (MAX_INSTRS) before REPLAY_NODE_SNAPSHOT exits
   non-zero with "never reported its Node startup snapshot", writes no file to its OUT_DIR, and
   leaves no feeder process behind.
P6 Prompt. In the capture log the serial root prompt `root@replay-desktop#` appears before the
   typed command; the typed command's echo does not fire the trigger (only the real
   REPLAY_DESKTOP_COMPACTED line does).
P7 Warm/cold harness on 8125 (committed bundle, which hashes equal to web/dist): both pass; the
   warm run's requests include the 2d4d38924d83 snapshot and no 2af6100e9b37 / dfcf85c2c260 URL.
P8 Latency (two interleaved fresh loads a side, 8125 gen 2 vs 8128 gen 1): gen-2 node -e median
   ≤ 0.7 × gen-1 (expect ~1.7 s vs ~4.8 s); click median gen2 ≤ gen1 + 5% noise; key echo gen2 ≤
   gen1 + 5 ms.
P9 "First node reads nothing from disk" — natively resuming the published snapshot and running
   the first `/usr/local/bin/node -e 0` from the serial shell, /sys/block/vda/stat's read-sectors
   field changes by 0 across it. (Prediction: it is NOT 0 — some pages, e.g. ICU/shared libs not
   touched by `node -e 0` during capture or evicted by the dd, are read; I predict a small
   nonzero count. If it is 0 the claim holds natively.)
P10 Stale gen-1: no tracked file under web/ or web/dist other than history names 2af6100e9b37 or
   dfcf85c2c260 in a URL the page would fetch; sw.js VERSION changed, and sw.js does not
   cache-first the releases/ boot artifacts by a non-content-hashed key.
P11 25 MiB: every file in web/dist is < 25 MiB; the three large artifacts go to R2 (not Pages).
P12 Live site: a fresh Chromium profile on https://wasm-vm.pages.dev/app resumes warm and
   `node -p process.version` (Node nonce) answers; console errors only the favicon 404.
P13 Mock hunt: the latency/warm evidence numbers in the claim are copied from the committed
   JSONs (no hand-edited values); the 8128 clone differs from web/dist only in its manifest.
