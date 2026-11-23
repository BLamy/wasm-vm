---
id: E5-T33
epic: 5
title: Build Replay Node 26 for riscv64 with the unbundled driver
priority: 0.386
status: verified
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

### 2026-11-23 — fresh verifier — VERDICT: verified

Head `2b206d69c`, medium risk: acceptance criteria plus one bounded novel attack.
Each prediction was written down before looking.
- P1 acceptance — HELD. Predicted `E5-T33 acceptance: OK`. `bash tools/node/verify-node26.sh`
  printed it (8 s): interfaces `lo`, `v26.13.1`, smoke digest `4beac423…882fa` (same as the
  claim), no-env run `v26.13.1 riscv64` with the dlopen "file too short" degrade, privacy OK on
  the binary and package. `node` SHA-256 `0a1942ad…4956` matches the claim, and so does the
  package `e5c6c904…873d`. The package's `bin/node`, extracted, hashes to the same `0a1942ad…`.
  The package holds only LICENSE, README and `bin/node`.
- P2 source — HELD. `gh api repos/replayio/node/branches/v26.13.1-replay` gives
  `333e17dfafb5890231f51926f335e1314c53ce6e`, which equals `git rev-parse HEAD` in
  `/opt/replay-node-26` (there is no tag of that name; it is a branch). `git status` shows
  exactly two modified files. Their `git diff` lines are identical to
  `tools/node/patches/*.patch`, and both patches pass `git apply --reverse --check`. The other
  untracked files are build logs; the ignored ones are generated configure output. The
  `src/node_record_replay_driver.cc` stub is gitignored (`.gitignore:187`). It holds exactly the
  `prepare-unbundled-driver.py` text: a `""` array, `gRecordReplayDriverSize = 0`, and build ID
  `linux-riscv64-node-333e17dfafb5-unbundled-driver`. Not a finding: the floatminmax patch file
  starts with 11 stray context lines before `diff --git`. `git apply` ignores them as a preamble.
- P3 arch/ABI — HELD. Predicted e_flags 0x5, no V, lp64d interpreter. readelf shows: ELF64 DYN
  (PIE), Machine RISC-V, Flags `0x5, RVC, double-float ABI`. `Tag_RISCV_arch` is
  `rv64i2p1_m2p0_a2p1_f2p2_d2p2_c2p0_zicsr2p0_zifencei2p0_zmmul1p0`, which is RV64GC with no V
  and no Zb*. Interpreter is `/lib/ld-linux-riscv64-lp64d.so.1`. NEEDED is libstdc++/libm/
  libgcc_s/libc/ld. The highest GLIBC symbol version is 2.38.
- P4 no driver bytes — HELD. The privacy guard passes on `local/node-26/node` (exit 0; 12
  markers, 11 digests). Positive control: a scratch concatenation of that node and the private
  driver FAILED the guard (private markers #2–#7 plus the driver name). The scratch file was
  then deleted.
- P5 no fetch at startup — HELD. Predicted zero network syscalls. In a `--network none`
  container, `QEMU_STRACE=1` traces were taken of the smoke (4413 lines, exit 0, same digest)
  and of the no-env `-e` run (2006 lines). Both show zero `socket`/`connect`/`bind`/`sendto`/
  `sendmsg`/`socketpair` calls. The no-env driver path creates a temp `recordreplay.so-*`,
  makes a single `write(3,…,0) = 0` (0 bytes), and dlopen rejects the file. The grep was
  shown to work by the attack below, which caught `socket`×2, `bind` and `connect`.
- P6 novel attacks — HELD. (a) A loopback `http.createServer` plus `fetch` run, with
  `RECORD_REPLAY_DRIVER=/nonexistent/driver.so`, printed `http 200 pong:riscv64` and exited 0.
  The trace shows the ENOENT open and the "Loading Record Replay driver failed" warning, so the
  driver failure degrades. (b) The smoke ran under an RV64GC-only QEMU CPU model
  (`QEMU_CPU=rv64,v=false,zba=false,zbb=false,zbc=false,zbs=false,zfh=false,zvfh=false`). It
  passed with the same digest `4beac423…882fa`, so no V/Zb instruction runs on these paths
  (this matters for wasm-vm's RV64GC guest).
- COVERAGE: every tracked file in the diff ran. The build script and stub generator produced the
  source tree checked in P2. Waived: the GCC 14 runtime-library packaging is left to E5-T34b, as
  the claim states.
- SUITE: `verify-node26.sh` is already the recurring acceptance command. Discarded: the strace
  and QEMU_CPU checks, which are one-off attacks.
