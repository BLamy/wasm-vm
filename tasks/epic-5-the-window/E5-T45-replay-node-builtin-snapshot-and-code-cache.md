---
id: E5-T45
epic: 5
title: Replay Node 26 with its built-in snapshot and code cache (first fetch, TLS and other built-ins load fast)
priority: 0.3876635
status: pending
depends_on: [E5-T43h]
estimate: M
risk: medium
capstone: false
---

## Why

Measured on the online Replay desktop (2026-11-28, `evidence/e5-t43i/`, `tools/perf/desktop-latency.mjs
--scenarios node --node-setup="f() { … }" --node-command=f`, prompt back after Enter, guest instructions):

| typed command | prompt back | instructions |
|---|---|---|
| `node -e 'console.log(6*7)'` | 1.65 s | 225 M |
| `node -e 'void fetch;console.log(1)'` | 1.66 s | 224 M |
| `require("dns").lookup(…)` | 1.7 s | 230 M |
| `require("http").get("http://example.com", …)` | 3.3 s | 287 M |
| `fetch("http://127.0.0.1:9")` (no network: loads undici only) | 3.8 s | 470 M |
| `require("https").get("https://example.com", …)` | 6.2 s | 442 M |
| `fetch("https://example.com")` | 9.3 s | 650 M |

The network itself costs about a second; loading undici costs about 245 M guest instructions (2.1 s) and
TLS about 155 M. The cause: the guest's Node is cross-built, and `configure` turns off both the built-in
startup snapshot and the built-in code cache when cross-compiling
(`process.config.variables.node_use_node_code_cache === false`, `node_use_node_snapshot === false`), so
every built-in module is parsed and compiled from source on first use. A user-land startup snapshot
(E5-T41a) cannot carry them: `node --build-snapshot` aborts on `http`, `https`, `tls` and on a loaded undici
("global handle not serialized … HTTPParser", "Unknown external reference";
`evidence/e5-t43i/snapshot-probe2/probe.json`).

## Boundary (to split before start)

Build Replay Node `v26.13.1-replay` for riscv64 with `node_use_node_snapshot` and `node_use_node_code_cache`
on: patch `configure` for the cross build and run the target `node_mksnapshot` under qemu-user riscv64 (or
in the emulator) to produce the snapshot and code cache; package as E5-T33 did (no recording driver,
privacy check). Then a new Replay desktop generation with it (E5-T43e/f capture), and decide whether the
E5-T41a boot-time snapshot is still needed.

## Deterministic acceptance (draft)

- `tools/node/verify-node26.sh` passes; `process.config.variables.node_use_node_code_cache` true.
- Online desktop: the typed `fetch("https://example.com")` prompt back under 5 s (9.3 s), the no-network
  `fetch` under 2.5 s (3.8 s), `node -e` not slower (1.65 s); E5-T41a/E5-T43c acceptances pass.

## Verification log
