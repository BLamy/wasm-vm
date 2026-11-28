---
id: E5-T45b
epic: 5
title: Replay desktop with the code-cached Node (generation 4)
priority: 0.3876637
status: pending
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

Online desktop (E5-T43f acceptance passes): typed `fetch("https://example.com")` prompt back under 5 s (was
9.3 s), no-network `fetch` under 2.5 s (3.8 s), `node -e` not slower (about 1.5 s); E5-T41a/E5-T43c acceptances
pass; click and key echo not slower; warm resume passes.

## Adversarial verification

Medium risk (deployment). Attack list: V8 rejecting the built-in snapshot on wasm-vm's CPU (falls back
silently to the slow path — check `node_use_node_snapshot` behaviour at runtime, not just the flag); Node
started from both snapshots; worker threads and child processes.

## Verification log
