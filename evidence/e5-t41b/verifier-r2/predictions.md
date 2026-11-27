# E5-T41b round-2 verifier predictions (written before any run)

Head under test: 975f693ee (change dfc5da39b). Fresh session; not the implementer, not round 1's
verifier. Carried forward from round 1 as HELD with unchanged code/artifacts: image, chunk
manifest, whole image (same digests in the manifest diff), 25 MiB rule for those, Node-line-never-
comes path (script hunk unchanged apart from the COMPACT_COMMAND string and the `exec sleep`).

Q1 Round-1 demand, native (`/sys/block/vda/stat` around the session's first command, fresh resume
   of the published f729cee9838e snapshot each time). Reads/sectors delta:
   a. `node -e "console.log(6*7)"` (latency script's command)            → 0
   b. `node --version`                                                    → 0
   c. `node -p process.version`                                           → 0
   d. shebang script `#!/usr/bin/env node` run as ./x (npx-style)         → 0 (env is busybox/cached)
   e. `echo '1+1' | node` (script from stdin)                             → 0
   f. REPL: `printf '1+1\n.exit\n' | node -i` (loads repl/readline)       → NONZERO (repl modules' source
      pages in the binary were never touched by the warm-ups)
   g. `node -e "console.log(typeof fetch)"` (lazy undici)                 → NONZERO
   h. `node -e "require('crypto').createHash('sha256').update('x').digest('hex')"` → NONZERO
   i. `node -e "require('zlib').gzipSync('x')"`                           → small NONZERO or 0
   j. `node -e "new Intl.DateTimeFormat('de',{month:'long'}).format(0)"`  → NONZERO (ICU data)
   k. `node -e "new (require('worker_threads').Worker)('1',{eval:true})"` → NONZERO
   Judgement rule fixed now: the acceptance's subject is "the first `node` of a session" in the
   latency run, i.e. an ordinary start (a–e). a–e nonzero ⇒ FAILED. f–k nonzero ⇒ an observation
   about the wording ("reads nothing" is unqualified in the script comment and roadmap row), not a
   refutation of the acceptance, unless a–e also read.
Q2 Browser, the latency script's first `node` typed in foot (DOM keyboard) on 8125: guest
   /sys/block/vda/stat (read via wvmDemo.exec before and after) unchanged across it, and the page's
   __chunkedStats localHits does not increase across the Enter → 0 reads.
Q3 Size: published snap.gz is 130,233,796 B ≤ 135,000,000. An independent capture rerun into scratch
   dirs gives 128–135 MB, prints NODE then COMPACTED (zeroed_mib > 400), "disk unchanged" with
   20f03da7c51d…, privacy OK on raw and gz, and leaves NO `sleep 86400` behind.
Q4 Local artifact: the releases/ file's size and SHA-256 equal the manifest (f729cee9…), gunzip →
   347,353,922 B, sha a6995528…. snapshot.json in capture evidence agrees.
Q5 R2: the live manifest at https://wasm-vm.pages.dev names f729cee9838e with the committed digests;
   the object at its public URL has the same size/SHA-256, gunzipped the same. Chunk manifest and
   whole image unchanged (spot-check SHA-256 of both from R2).
Q6 Warm/cold harness on 8125 (hashes equal web/dist): both PASS; warm requests name f729cee9838e
   and no 2d4d38924d83 / dfcf85c2c260 / 2af6100e9b37.
Q7 Latency, my own runs, interleaved, 8128 gen 1 vs 8125 gen 2, two loads a side: node -e median
   gen2 ≤ 0.7×gen1 (expect ~1.6 vs ~4.5 s). Click: gen2 pooled median within the gen1 run-to-run
   spread (my 4 gen-1 runs + the worker's); "not slower" FAILS only if gen2 pooled median exceeds the
   gen1 pooled median by more than the largest gen-1 run-to-run difference of medians. Key echo
   likewise.
Q8 Live, fresh profile: warm resume, Node answers v26.x; only console error the favicon 404.
Q9 Leftover process: `pgrep -f "sleep 86400"` empty after my capture rerun (exec fix).
Q10 8128 clone: manifest names replay-desktop-ready-dfcf85c2c260; every other file equal to web/dist
   except roadmap/sw VERSION/tasks.json (round 1's accepted diff set).
Q11 Novel attack (bounded): the warm-ups leave nothing in the guest that a user sees — /tmp/warm.js
   and /tmp/warm.mjs absent after resume, no stray node process, root's shell history (if any) not
   carrying the compaction line into the foot user's session. Prediction: all clean.
Q12 Mock hunt: claim numbers equal the committed JSONs; first-node.sh measures the real published
   snapshot (gunzips releases/ file named by the manifest? — it takes SNAPSHOT.gz as an arg, so check
   which file the log was made from); the "before" counts identical across the five runs are
   consistent with fresh resumes of one snapshot (expected, not a mock).
