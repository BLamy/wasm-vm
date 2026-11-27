# E5-T41b round-3 verifier predictions (written before any run)

Head under test 2b128510d (change 10c312e6a). Fresh session: not the implementer, not round 1's or
round 2's verifier. Round 2's verifier found (its `browser/first-node-idle60.json`) that on a resumed
browser session something reads ~38 requests / 220 KiB from the root disk 10-20 s (wall) after
desktop-ready with nobody touching the desktop; in its idle-0 run the first typed `node` window
caught 55 requests / 220 KiB. I expect that to persist (the compaction does not change what the
desktop does after resume).

Carried forward HELD from round 1 (code and digests unchanged): kernel, chunk manifest, whole image
(manifest diff touches only bootSnapshot), 25 MiB rule for those, the Node-line-never-comes path
(the feeder change sits after the Node wait), stale-gen-1 SW behaviour (predates the diff).

P1 Native, fresh resume of the published 39f10258e690 snapshot per command (round-2 verifier's
   first-cmd.sh, output on the serial tty), read-request delta across the first command:
   a `node -e "console.log(6*7)"` 0;  b `node -p process.version` 0;  c shebang script 0;
   d `printf '1+1\n.exit\n' | node -i` (tty) >0 (~3 req);  e Intl `ja` >0;  f worker thread >0
   (tens of requests, MBs);  g crypto 0;  h Intl `de` 0.
   I.e. the worker's 12-of-15 table reproduces on the rows I rerun.
P2 Native idle attribution: with setup `sleep 45` (guest idle, nothing typed) the setup window
   itself reads >0 (the same background read the browser shows), and the following first
   `node -e "console.log(6*7)"` reads 0. If the setup window reads 0 natively, the browser's
   background read depends on the browser session (paced clock / DOM input), not on the guest
   alone.
P3 Browser, 8125 (hashes equal web/dist), browser-first-node.mjs (latency script's first node:
   click foot, `clear`, DOM-typed `node -e 'console.log(6*7)'`):
   IDLE_S=0 → the window "typed → 15 s after Enter" reads >0 (the background read lands in it,
   expected 30-60 requests, ~220 KiB);  IDLE_S=60 → the background read lands in the idle window
   and the first-node window reads 0 requests.
   Judgement fixed now: if the IDLE_S=60 first-node window is 0 and the IDLE_S=0 reads are the
   same size as the idle-window reads, the acceptance's "first node reads nothing" HOLDS for the
   latency script's first node (the reads are not the node's), with an observation that a session
   still reads ~220 KiB in its first half minute. If the IDLE_S=60 first-node window reads >0,
   FAILED for the browser's first node.
P4 The 3 of 15 still reading: not a refutation by itself if the browser's actual first node (P3)
   reads 0 — the acceptance line sits in the latency bullet, whose first node is
   `node -e 'console.log(6*7)'`. Worker threads / REPL-on-tty / unwarmed locales are a wording
   limit the claim states honestly; the roadmap row already qualifies it. Classified a planner
   limit, not needs-evidence, provided the size budget really excludes them (worker-thread
   capture 135.28 MB is the worker's number; I do not re-measure it).
P5 Size: releases/ file 134,069,642 B ≤ 135,000,000; sha 39f10258e690…; gunzip 357,412,069 B,
   sha 7e740013…. A capture rerun into scratch dirs gives 133.5-135.0 MB (margin to the limit is
   only 0.93 MB, so a rerun over 135 MB is possible: I predict ≤ 135 MB), "disk unchanged"
   20f03da7c51d…, privacy OK on raw and gz, NODE then COMPACTED with zeroed_mib > 400, no OOM line,
   no `sleep 86400` left after it.
P6 R2: live manifest names 39f10258e690 with the committed digests; the R2 object's size/SHA-256
   equal, gunzipped equal. Chunk manifest / whole image unchanged (HELD from round 1/2 r2 check;
   one SHA spot-check of the chunk manifest).
P7 16 MiB margin: in a resumed guest /proc/vmstat oom_kill = 0, dmesg has no "Out of memory" /
   "oom-killer" / "page allocation failure"; the same process set as round 2's leftovers probe
   (sway, foot, chrome renderer 192, network/storage utilities) is alive; MemFree ≥ 550 MB.
P8 Failing step: REPLAY_DESKTOP_SETTLE_SECONDS=x makes `sleep x` fail under `set -e`, the script
   exits non-zero, `|| poweroff -f` ends the boot, the capture prints "no snapshot was written" and
   exits non-zero, OUT_DIR (scratch) stays empty, no feeder left.
P9 Warm/cold harness on 8125: both PASS, warm requests name 39f10258e690 and no
   2d4d38924d83/f729cee9838e/dfcf85c2c260.
P10 Latency, my own 4 loads interleaved ABAB (8128 gen 1, 8125 gen 2): node -e gen2 ≤ 0.7×gen1
   (~1.65 vs ~4.8 s). Click and key echo: pooled gen-2 median within the gen-1 run-to-run spread
   (rule: FAILED only if gen-2 pooled median exceeds gen-1 pooled median by more than the largest
   difference between two gen-1 run medians across my runs and the worker's).
P11 Live, fresh profile: warm resume, Node answers v26.x, only console error the favicon 404,
   requests name 39f10258e690.
P12 Novel attack: the capture leaves /tmp/compact.sh (the script is never removed) in the
   snapshot's tmpfs; a desktop user sees a root-owned file in /tmp. Prediction: present. Not a
   correctness failure; a nit (privacy: it holds only the warm-up text).
P13 Mock hunt: the claim's numbers equal the committed JSONs; first-node.log is consistent with
   fresh resumes of the 39f10258e690 snapshot (identical "before" counts, different from round 2's
   8943 because the snapshot differs); 8128's manifest names dfcf85c2c260 and every other file
   equals web/dist except the accepted set (roadmap/sw VERSION/tasks.json).
