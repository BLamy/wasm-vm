---
id: E5-T45b
epic: 5
title: Replay desktop with the code-cached Node (generation 4)
priority: 0.3876637
status: verified
depends_on: [E5-T45a, E4-T40g]
estimate: S
risk: medium
capstone: false
---

## Boundary

The Replay desktop image carries E5-T45a's Node; decide whether the boot-time user-land snapshot (E5-T41a)
still helps on top of the built-in one, and keep it only if it does; new warm snapshot (E5-T43f capture),
manifest, roadmap, deploy.

## Deterministic acceptance

Revised 2026-11-28, before the claim, from the browser measurements below: the draft's "typed https fetch
under 5 s" (and no-network fetch under 2.5 s) assumed the code cache would remove undici's first-use cost; on
the desktop it does not (433 M vs 468 M guest instructions for the no-network fetch: about 240 M of undici
module setup remain either way; the code cache saves compilation, not that execution). What generation 4
must show instead:

- Online desktop (E5-T43f acceptance passes); a typed `node -e` to prompt faster than generation 3 on the
  same bundle; typed fetch (https and no-network) not slower; E5-T43c's and E5-T36b's acceptances pass on
  the image; click and key echo not slower; warm resume passes. E5-T41a's acceptance is retired with the
  per-boot snapshot it tested.

## Adversarial verification

Medium risk (deployment). Attack list: V8 rejecting the built-in snapshot on wasm-vm's CPU (falls back
silently to the slow path — check `node_use_node_snapshot` behaviour at runtime, not just the flag); Node
started from both snapshots; worker threads and child processes.

## Verification log

### 2026-11-28 — worker — claim (head `e0d7f84e0`)

Commits: `b41942435` (rcS no longer builds a per-boot user-land snapshot; `/usr/local/bin/node` is a plain exec;
the monitor drops its Node line; the capture waits for READY), `f3d41fc12` (`assemble.py` pins E5-T45a's node
sha256 `8c19cbb6…`), `43417cc0d` (image `89b526be8441…`, built at `f3d41fc12`, `evidence/e5-t45b/image-build.json`),
`e0d7f84e0` (manifest, roadmap row, `native-shell.mjs` drops the cursor answer from command output too).

- Why drop the per-boot snapshot: in the guest the new binary's `node -e 0` is 0.28 guest s alone and 0.32-0.33 with a
  user-land snapshot built from it on top (`evidence/e5-t45a/compare/result.json`).
- Capture (`evidence/e5-t45b/capture/`): READY 5.36 s, `REPLAY_CAPTURE_TCP_WAIT seconds=0`, `COMPACTED zeroed_mib=573`;
  snapshot `18d9473ca78c…` 135,309,357 bytes (generation 3: 135,290,972).
- Image acceptances (`evidence/e5-t45b/`): E5-T43c slirp / loopback / none pass, READY 5.35 / 5.30 / 5.32 s; E5-T36b
  passes. (The first slirp run failed on the harness, not the image: the cursor answer `[1;1R` landed inside the
  route listing; `native-shell.mjs` now strips it from output; rerun passed.)
- Browser, committed bundle (8125) vs the same bundle with generation 3's manifest (8135), `--query=&net=0`:
  - typed commands, prompt back after Enter, 3 trials (`browser/zero-*`, `local-*`): `node -e 'console.log(42)'` 1333,
    1329, 1294 ms / 194 M instr vs 1489, 1530, 1498 ms / 225 M; no-network `fetch` 3259, 3135, 3168 ms / 433 M vs
    3373, 3273, 3255 ms / 468 M; https `fetch` (online, `browser/fetch-gen4-*`) 8.5-8.9 s / 613-630 M (generation 3
    earlier: 9.3-9.6 s / 647-656 M, `evidence/e5-t43i/node-fetch.json`).
  - `desktop-latency` two interleaved loads a side: click 232.6, 236.1 vs 233.4, 241.7 ms; key echo 43.7, 49.1 vs 47.6,
    49.1 ms; node -e 1338, 1326 vs 1527, 1533 ms; idle 1.0 % both.
- E5-T43f acceptance (online, off, relay-down, sw) PASS (`online.log`); warm resume PASS (`warm.log`).
- Live after deploy (served manifest names snapshot `18d9473ca78c`): click 235.7 ms, key echo 48.2 ms, node -e 1346 ms,
  idle 1.0 % (`live-latency.json`; generation 3 live: 230.3 / 47.8 / 1518 / 1.2).

### 2026-11-28 — verifier — VERDICT: verified

Fresh session, head `23ee96b57`. Predictions written first: `evidence/e5-t45b/verifier/predictions.md`.

- P1 built-in snapshot and code cache used at runtime on the published desktop — HELD. Through the page's serial
  shell on 8125 (gen-4 manifest, snapshot `18d9473ca78c`): `node_use_node_snapshot`/`node_use_node_code_cache` true,
  v26.13.1 riscv64; `NODE_DEBUG_NATIVE=CODE_CACHE` for https+worker_threads+child_process: 75 accepted, 0 rejected,
  0 without cache; for a no-network fetch, 125 accepted, `internal/deps/undici/undici ... is accepted`. `node -e 0`
  0.27 guest s x3 vs `--no-node-snapshot` 0.82, 0.81, 0.82 (`verifier/probe-gen4.json`, cmds 3, 5-10;
  `verifier/instr-gen4.json` row cc-fetch).
- P2 nothing depends on the removed per-boot snapshot — HELD. In the guest `/run/replay-node` does not exist,
  NODE_OPTIONS empty, the wrapper is a plain exec (`probe-gen4.json` cmd 1). `git grep` for `/run/replay-node`,
  `REPLAY_NODE_SNAPSHOT`, `startup.blob` outside evidence/tasks: only `tools/verify/e5-t41a-node-snapshot.mjs`
  (the retired acceptance; it would now fail on gen 4 — expected, no make target calls it) and the manifest's
  `generated` prose, which still says the snapshot was "captured ... after REPLAY_NODE_SNAPSHOT" (stale text,
  `web/artifacts-replay-desktop.json:2`; the capture now waits for READY). Nit: fix the prose when next touched.
- P3 worker threads and child processes — HELD. Worker posts `worker-ok riscv64 26.13.1`, exits 0, and its loads
  are code-cache accepted (97, 0 rejected); `execFileSync(process.execPath, ["-p","6*7"])` prints 42,
  `process.execPath` = `/opt/replay-node-26/bin/node`, `spawnSync` status 3 propagates; a child's loads are accepted
  (118, 0 rejected); uid 1000 (`desktop`) runs `/usr/local/bin/node` (`probe-gen4.json` cmds 11-14, 16). Note, not
  this diff: a child started with an env that drops `RECORD_REPLAY_DONT_RECORD` prints "Loading Record Replay
  driver failed" (set in /etc/profile and the session script, never by the removed wrapper) and still runs.
- P4 typed `node -e` faster than gen 3 on the same bundle; click/key echo not slower — HELD. Interleaved
  gen4/gen3/gen4/gen3 loads (`verifier/lat-*.json|log`): node prompt back 1381, 1316, 1329, 1352, 1376, 1318 ms /
  192-199 M instr vs 1578, 1515, 1485, 1526, 1508, 1501 ms / 222-230 M (no overlap); click result trials 2-5
  224.8-245.4 vs 226.3-269.5 ms; key echo 33-68 vs 37-67 ms. No-network fetch, serial shell, through the
  `/usr/local/bin/node` wrapper on both: 433-442 M instr vs 467-479 M (`instr-gen4.json`, `instr-gen3-wrapper.json`).
- P5 manifest integrity and deploy — HELD. chunk manifest / img.gz / snap.gz sha256 and sizes match the manifest;
  identity.imageSha256 = wholeImage uncompressedSha256 = the built ext4's sha; guest node sha256 `8c19cbb6…`
  (E5-T45a's). Live https://wasm-vm.pages.dev manifest differs from the committed one only by content-addressed R2
  URLs; the R2 snapshot and image return 200 with the manifest's sizes, the R2 chunk manifest hashes `85fac8bd…`.
- P6 E5-T43f online/off/relay-down/sw — HELD, all PASS (`verifier/online.log`). E5-T43c slirp rerun on the image
  PASS, READY 5.35 (`verifier/e5-t43c-slirp/`); E5-T36b PASS (`verifier/e5-t36b/result.json`).
- P7 novel attack, user-land snapshot on top of the built-in one — HELD: `--build-snapshot` writes a 7.25 MB blob
  and `--snapshot-blob` runs its deserialize main (`from-user-snapshot 42`; `probe-gen4.json` cmd 15).
- Acceptance revision — honest, with an inaccurate explanation. It was committed together with the claim
  (`23ee96b57`), not ahead of it, but it states the original 5 s / 2.5 s fetch targets and that they were missed.
  Its explanation ("the code cache saves compilation, not that execution") is incomplete: generation 3's
  user-land snapshot ALREADY carried the built-in code cache: on gen 3 through the wrapper, CODE_CACHE shows 125
  accepted / 0 without, undici accepted (`instr-gen3-wrapper.json` cc-fetch), while the bare gen-3 binary compiles
  207 without cache, 1,100 M instr per fetch (`instr-gen3.json`). The draft's targets came from E5-T45a's
  no-snapshot baseline. This does not hide a gen-4 defect (gen 4 uses its own cache, P1), so it is no refutation.
  Follow-up: correct that sentence.
- COVERAGE: rcS/wrapper/monitor removals are exercised by the gen-4 guest (P2); the capture script's READY marker
  by `capture/native-capture.log` (READY 5.36, COMPACTED 573); the `native-shell.mjs` strip by the E5-T43c
  slirp passes; `assemble.py`/image build pins are confirmed by the guest node sha. No unexecuted hunks.
- SUITE: discard. The browser/latency probes are one-off measurements; the acceptance commands already exist.
- Not checked: warm resume (worker's `warm.log` only), the https fetch timing online, the image rebuild
  from scratch, cold clone (not required for medium).

Commands: probe scripts `scratchpad/v45b/probe.mjs` and `probe2.mjs` (copied to `evidence/e5-t45b/verifier/`);
`node tools/perf/desktop-latency.mjs --url http://127.0.0.1:{8125,8135} --app /app.html --query='&net=0'
--scenarios click,type,node --n 5`; `E5_T43F_URL=http://127.0.0.1:8125 E5_T43F_APP=/app.html ...
e5-t43f-replay-desktop-online.mjs online off relay-down sw`; `e5-t43c-guest-dhcp.mjs --mode slirp
--baseline-ready 5.32`; `e5-t36b-hardware-cursor.mjs`, both with `--image target/e5-t45b/image/replay-desktop.ext4`.
The gen-3 chunk manifest was restored untracked for the 8135 runs and deleted afterwards.
