---
id: E5-T45a
epic: 5
title: Replay Node 26 for riscv64 built with its built-in startup snapshot and code cache
priority: 0.3876636
status: implemented
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
