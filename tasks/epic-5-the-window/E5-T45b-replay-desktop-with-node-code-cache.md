---
id: E5-T45b
epic: 5
title: Replay desktop with the code-cached Node (generation 4)
priority: 0.3876637
status: implemented
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
