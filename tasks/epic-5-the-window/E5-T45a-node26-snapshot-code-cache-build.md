---
id: E5-T45a
epic: 5
title: Replay Node 26 for riscv64 built with its built-in startup snapshot and code cache
priority: 0.3876636
status: verified
depends_on: [E5-T33]
estimate: S
risk: medium
capstone: false
---

## Boundary

The E5-T33 cross build (`tools/node/build-node26.sh`) with one more patch,
`tools/node/patches/configure-cross-snapshot-emulator.patch`: with `--cross-compiling --emulator=…`, Node's
`configure.py` passes the emulator to gyp and turns `node_use_node_snapshot` and `node_use_node_code_cache`
on, so the target `node_mksnapshot` runs under qemu-user riscv64 (as an RV64GC CPU,
`QEMU_CPU=rv64,v=false,zba=false,zbb=false,zbc=false,zbs=false`) during the build. Same source
(`replayio/node` `v26.13.1-replay` `333e17df`), same unbundled driver stub, same packaging.

## Deterministic acceptance

`bash tools/node/verify-node26.sh` passes on the new package (version, smoke digest, no driver, no network,
privacy). Under the same QEMU: `process.config.variables.node_use_node_snapshot` and
`node_use_node_code_cache` are true; the smoke passes with the RV64GC-only CPU model; a first
`fetch('data:,x')` / `require('https')` takes fewer guest instructions than with the E5-T33 binary (qemu
`-d` instruction counts or `QEMU_STRACE`-free timing, same container).

## Adversarial verification

Medium risk: the snapshot was generated on qemu's CPU model and runs on wasm-vm's (V8 flag-hash or
CPU-feature mismatch must not reject or corrupt it: shown in E5-T45b's guest); no driver bytes.

## Verification log

### 2026-11-28 — worker — claim

Files: `tools/node/patches/configure-cross-snapshot-emulator.patch` (configure: `--emulator` honoured when
cross-compiling; snapshot and code cache on when it is given), `tools/node/node-snapshot-emulator.sh` (the
gyp "emulator": runs host generators as is; for `node_mksnapshot` copies the output generated on the
target), `tools/node/build-node26-snapshot.sh` (the three phases as run), `tools/replay-desktop/native-shell.mjs`
(`extraDrives`, `browserTopology` options; defaults unchanged), `evidence/e5-t45a/*.mjs`.

Revised before the claim: qemu-user could not run the generator. Under Rosetta, Ubuntu's qemu 8.2 faulted on V8's
address reservations (`QEMU internal SIGSEGV`, address `0xeca4baac03c0`, then hung) and with `-R 0x8000000000`
failed `page_find_range_empty: Assertion min <= max`. So `node_mksnapshot` ran inside wasm-vm itself (native boot
of the E5-T43f image, the generator on a second drive): a first run with the E5-T33 `node_mksnapshot` produced the
snapshot but an EMPTY code cache (that generator was compiled without code-cache support); after reconfiguring and
rebuilding the `node_mksnapshot` target, the guest run (`evidence/e5-t45a/guest-run2/`, 7.35 guest s) wrote a
21,951,716-byte `node_snapshot.cc` (sha256 `5b25a051…`) whose code cache holds 529 built-in modules, among them
`internal/deps/undici/undici`, `https`, `tls`, `_tls_wrap`, `http`, `child_process`. The full `make` then embedded it.

Package `local/node-26/replay-node-26-riscv64.tar.xz` (gitignored, 31,474,576 bytes, sha256 `6d504bc5…`;
`bin/node` sha256 `8c19cbb6…`, stripped, 117,445,304 bytes; the E5-T33 package kept as
`replay-node-26-riscv64-e5t33.tar.xz`).

Acceptance:
- `tools/node/verify-node26.sh` (`verify-node26.log`): the binary is riscv64 LP64D; the QEMU step could not run —
  the colima VM's riscv64 binfmt handler is gone since its restart (`Exec format error`), and re-registering it is a
  privileged change to a VM other projects share, so I did not. Substituted on the real target
  (`evidence/e5-t45a/smoke/result.json`, native wasm-vm boot, loopback NIC only, the package's node from a drive,
  sha256 `8c19cbb6…`): `v26.13.1`; the E5-T33 smoke passes with the SAME digest `4beac4236dda…` (wasm, crypto.subtle,
  worker_threads, fs, arch); without `RECORD_REPLAY_DONT_RECORD` node runs (`v26.13.1 riscv64 true`). Note: that
  no-env run printed no "file too short" driver warning this time (count 0), where E5-T33's binary did.
- Privacy (`privacy.log`): OK on the binary and the package.
- `process.config.variables.node_use_node_snapshot` and `node_use_node_code_cache`: true (old: false, false).
- Guest seconds (`compare/result.json`; native boot, slirp NIC; the shipped binary run directly, without the
  E5-T41a wrapper), new vs old, two runs each: `node -e 0` 0.29, 0.28 vs 0.83, 0.82; `fetch` to a closed local port
  0.70, 0.68 vs 1.73, 1.73; `https.get` example.com 0.67, 0.66 vs 1.33, 1.33; `fetch` https example.com 0.99, 0.98 vs
  2.05, 2.06; requiring 8 common built-ins 0.38, 0.38 vs 1.20, 1.18. A user-land snapshot built from the new binary
  on top (what the E5-T41a wrapper would do) gives `node -e 0` 0.32, 0.33 and the local fetch 0.74, 0.72 — no
  better than the built-in snapshot alone (E5-T45b decides).

### 2026-11-28 — verifier — VERDICT: verified

Fresh session, head `318c051bf`, medium risk: the acceptance criteria plus one bounded novel attack. The
predictions (`evidence/e5-t45a/verifier/predictions.md`) were written before any run. Boots: native wasm-vm,
E5-T43f image, loopback NIC, a second drive holding the new `node` (sha256 `8c19cbb6…`) and the E5-T33 `node`
(`0a1942ad…`, extracted from the kept `-e5t33` package), scripts `evidence/e5-t45a/verifier/verify-in-guest.mjs`
(results `verifier/guest/result.json`) and `verifier/noenv-in-guest.mjs` (`verifier/guest-noenv/result.json`).
- P1 package identity — HELD. `local/node-26/node`, the package's extracted `bin/node`, the container's
  `out/Release/node.stripped` and `out/pkg/.../bin/node` all hash `8c19cbb6…`; package `6d504bc5…`. The snapshot
  embedded by the build (`out/Release/obj/gen/node_snapshot.cc`), `/opt/node-snapshot/node_snapshot.cc` and
  `target/e5-t45a/node_snapshot.cc` all hash `5b25a051…`. The generator that ran in the guest
  (`target/e5-t45a/node_mksnapshot`, `84f83b5d…`) equals the one phase 3 relinked (same hash), so the snapshot's
  external-reference layout matches the shipped binary.
- P2 privacy — HELD. `check-no-replay-backend.py` OK on the binary, the package, `node_snapshot.cc` and
  `node_mksnapshot` (`verifier/privacy.log`, 4 files, 12 markers, 11 digests). The snapshot's code cache lists
  six `internal/recordreplay/*` modules; they come from `lib/internal/recordreplay/` of the public fork at
  `333e17df`, which `git status` in `/opt/replay-node-26` shows unmodified (only `configure.py`, the V8 riscv
  masm and `highway.gyp` are changed — the three tools/node patches).
- P3 config — HELD. New `["v26.13.1",true,true]`, old `[...,false,false]` (`guest/result.json` `node.config`,
  `oldnode.config`); `config.gypi` in the container agrees.
- P4 snapshot and code cache accepted on wasm-vm's CPU — HELD. With `NODE_DEBUG_NATIVE=CODE_CACHE`, requiring
  `https`, `child_process` and starting a Worker: new binary "snapshot contains 449 code cache", 104 builtins
  compiled with cache, 104 "is accepted", 0 rejected, 0 compiled without cache, no "EmbedderBuiltinCodeCache
  rejected"; `https` "is accepted". Old binary: 161 compiled without cache (`node.codeCache` /
  `oldnode.codeCache`). Guest seconds for `node -e 'require("https")'`: new 0.41, 0.39; new with
  `--no-node-snapshot` 1.03; old 1.03, 1.03 (`node.time`, `oldnode.time`). The guest CPU reports
  `isa rv64imafdc_zicntr_zicsr_zifencei_zihpm` (`mount`), so both generation and use were on an RV64GC-only CPU,
  which covers the "RV64GC-only CPU model" criterion on the real target.
- P5 driver slot — HELD, with a correction to the claim. The worker's "no-env" run was not one: the E5-T43f image
  exports `RECORD_REPLAY_DONT_RECORD=1` from `/etc/profile` (`tools/replay-desktop/rootfs/etc/profile:4`), and the
  root shell has it (`guest/result.json` `mount`: `RECORD_REPLAY_DONT_RECORD=1`). That, not the binary, is why the
  warning count was 0; the driver load is C++ (`src/node.cc:1199` `InitializeRecordReplay`, before V8), which the
  snapshot cannot change. Re-run with `env -u RECORD_REPLAY_DONT_RECORD` (`guest-noenv/result.json`): new and old
  both print "Loading Record Replay driver failed (/tmp/recordreplay.so-…: file too short)", exit 0, leave no temp
  file; with `RECORD_REPLAY_DRIVER=/nonexistent/driver.so` both warn and `fetch('data:,x')` prints `ran x`; the
  smoke without the variable passes with digest `4beac423…`. The empty slot still degrades.
- P6 reproducibility — HELD with a note. `build-node26-snapshot.sh` matches the container state (configure.py
  patched, `--emulator=/opt/emu-copy.sh`, emu script present, the guest-generated file embedded), and phase 1's
  configure line equals `build-node26.sh`'s plus `--emulator`; `build-node26.sh` applying the new patch without
  `--emulator` leaves snapshot/code cache off, so the E5-T33 path is unchanged. Not scripted (as in E5-T33): the
  copy of `node.stripped` into `out/pkg/replay-node-26-riscv64/bin/` and the `tar -cJ` of the package. Not a
  refutation (pre-existing gap); follow-up: script the packaging step.
- P7 novel attack — HELD. On new and old: ESM import of a sibling `.mjs`, `node:sqlite` in-memory query, `Intl`
  (de-DE date, ja-JP currency, Thai segmenter) and `process.execArgv`/`argv` give the same output and digest
  `d8789f5677040792` (`node.esm` / `oldnode.esm`); the REPL evaluates `1+2` → 3; `--build-snapshot` of a user
  entry builds (7,268,310-byte blob) and `--snapshot-blob` runs its deserialize main (`from-snapshot 2000 17389`);
  `--no-node-snapshot` works; startup RSS 49.4 MB new vs 52.8 MB old.
- Acceptance substitution: `verify-node26.sh`'s QEMU step cannot run (binfmt gone; re-registering it is a change
  to the shared VM, correctly not done). The target runs above cover version, smoke digest, no-driver degrade
  and privacy, and are stronger evidence for the CPU-match risk than QEMU would be. The task's Boundary and
  acceptance text still describe qemu-user generation; the claim documents the change.
- COVERAGE: patch (both hunks: variables true, `-Demulator` passed) shown by `config.gypi` and the embedded
  file; emu script's copy branch shown by the embedded file's hash, its exec branch by a completed build;
  `native-shell.mjs` `extraDrives`/`browserTopology: false` exercised by both verifier boots; defaults unchanged
  by diff inspection.
- SUITE: `evidence/e5-t45a/verifier/verify-in-guest.mjs` and `noenv-in-guest.mjs` kept as repeatable checks
  (they need the gitignored binaries); no unit test applies.
Commands: `node evidence/e5-t45a/verifier/verify-in-guest.mjs target/e5-t43f/image/replay-desktop.ext4 <drive>
evidence/e5-t45a/verifier/guest`; same for `noenv-in-guest.mjs` → `verifier/guest-noenv`;
`python3 tools/privacy/check-no-replay-backend.py local/node-26/node local/node-26/replay-node-26-riscv64.tar.xz
target/e5-t45a/node_snapshot.cc target/e5-t45a/node_mksnapshot`.
