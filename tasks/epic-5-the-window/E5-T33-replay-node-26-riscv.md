---
id: E5-T33
epic: 5
title: Build Replay Node 26 for riscv64 with the unbundled driver
priority: 0.386
status: implemented
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Cross-compile `replayio/node` `v26.13.1-replay` for riscv64 Linux (glibc, LP64D),
optimized (`-O2`/`-O3`, LTO if it fits), with no recording driver embedded or
fetched. Package `bin/node` plus its runtime files for the shared desktop image.

## Deterministic acceptance

`bash tools/node/verify-node26.sh`. Under QEMU riscv64, in a container with
`--network none`, `node --version` must print `v26.13.1`, and
`tools/node/smoke-node26.mjs` (`WebAssembly`, `crypto.subtle`, `worker_threads`,
`fs`) must exit 0. The empty driver slot must degrade rather than fail, and
`tools/privacy/check-no-replay-backend.py` must pass on the binary and the package.

## Adversarial verification

Medium risk: confirm the binary's architecture and ABI, and prove no driver bytes
are present or fetched at startup (no network access during the smoke).

## Verification log

### 2026-11-23 — worker — submission

Claim: Replay Node `v26.13.1-replay` (`333e17dfafb5890231f51926f335e1314c53ce6e`)
is built for linux/riscv64 (rv64gc, LP64D, glibc), with no recording driver
embedded or fetched, and runs correctly offline.

Build (`tools/node/build-node26.sh`, linux/amd64 container under Rosetta) is
upstream's cross configuration: `--dest-cpu=riscv64 --cross-compiling`, with the
host tools and mksnapshot on V8's riscv64 simulator, and the target built with
Ubuntu 24.04 `riscv64-linux-gnu-gcc-14`. Release build at the default `-O3`; LTO
is a measured exclusion, not attempted here (GCC LTO for V8 roughly doubles link
RAM and time in a VM shared with the Chrome build). The port needed three fixes,
each from a recorded failure:
1. GCC 13 lacks `target("arch=+v")` and `__riscv_vlenb`, so the target uses GCC 14
   (log `build-gcc13.log`).
2. `tools/node/patches/highway-riscv64-emu128.patch`: Node's highway gyp gave
   s390x, AIX and armv7 `HWY_BROKEN_EMU128=0` but not riscv64, so V8's 16-lane
   JSON stringifier hit the 1-lane SCALAR target.
3. `tools/node/patches/v8-riscv-floatminmax-instantiation.patch`: explicit
   instantiation of `MacroAssembler::FloatMinMaxHelper<float|double>`, which Maglev
   calls across translation units and GCC never emitted out of line.

Driver: Replay's `build.js` downloads `linux-recordreplay` from static.replay.io
and embeds it in `src/node_record_replay_driver.cc`. It is replaced by the empty
stub from `tools/node/prepare-unbundled-driver.py` (build ID
`linux-riscv64-node-333e17dfafb5-unbundled-driver`). Node still contains Replay's
fork code (24 `internal/recordreplay` modules in the binary). With
`RECORD_REPLAY_DONT_RECORD=1` it skips the driver; without it, `dlopen` rejects the
0-byte slot ("file too short") and Node continues.

Acceptance (`bash tools/node/verify-node26.sh`): the binary is a riscv64 LP64D PIE,
`node` SHA-256 `0a1942ad5f7c2e751fa619568809c7b5d9b9b84e6b504d326f814efdc4ad4956`
(110,768,384 bytes, stripped). The container's only interface was `lo`. Results:
`v26.13.1`; wasm `add(40,2)=42`; `crypto.subtle` SHA-256 equal to `createHash`;
`worker_threads` sum 5000050000; `fs` round trip; `linux/riscv64`; smoke digest
`4beac4236dda444e1c42992ddf0c8c64f8a553def1975a79fc85c79e580882fa` (2.3 s under QEMU).
The no-env run printed `v26.13.1 riscv64` with the expected driver warning. Privacy
passed on the binary and on the package `replay-node-26-riscv64.tar.xz` (30,311,968
bytes, SHA-256 `e5c6c904abbf9a6cead65be2f81f0c1b601ca2ac3544c5175623f80261b8873d`,
under gitignored `local/node-26/`).

Runtime dependency for the desktop image (E5-T34b): glibc 2.39 and GCC 14's
`libstdc++.so.6.0.33`. No emulator, web or Chrome change.
