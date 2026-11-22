---
id: E5-T32a
epic: 5
title: Sync Replay Chromium 157 source and toolchains for a riscv64 cross build
priority: 0.3851
status: verified
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Fetch `replayio/chromium` `157.0.8103.0-replay` without history into the existing
`replay-chromium` Colima build VM, run `gclient sync --no-history` for
`target_os=linux` / `target_cpu=riscv64`, and provide the clang, lld and Rust
(`riscv64gc-unknown-linux-gnu` std) versions this revision pins, for an arm64 Linux
host. Refresh the RISC-V sysroot. Record every repository revision in a
`tools/chromium/workspace-157.json` manifest. No source patches in this task.

## Deterministic acceptance

Inside the x64 build container:
`python3 /opt/check-workspace-157.py /opt/workspace-157.json /opt/args-riscv64-157.gn`
(source `tools/chromium/157/check-workspace-157.py`). It checks that every revision
matches the manifest, along with src HEAD and the pinned clang/rustc/gn versions,
and that the driver stub is empty. It then runs `gn gen` with the recorded args
into a scratch out dir and confirms `ninja -n chrome` resolves to the `chrome` link.

## Adversarial verification

Medium risk: verify the manifest against the checkout and attempt one toolchain
mismatch (wrong Rust std/target) to show it is detected.

## Verification log

### 2026-11-22 — worker — submission

Claim: Replay Chromium `157.0.8103.0-replay` at
`93a038b117568051f1697caba2f334ced9329d51` is synced with no history, along with all
253 gclient dependencies for linux/riscv64. The build configuration it pins resolves
the full `chrome` graph on this machine.

Host choice: Chromium 157 pins x86-64-only prebuilt toolchains, and the arm64
colima VM already has Rosetta. Building in a `linux/amd64` container is therefore
upstream's supported x64-host to riscv64-target cross configuration, using the
pinned clang (`24.0.0git`, llvm `86922d51`), Rust (`1.100.0-nightly 1edd55dcf`),
GN `2595` and the `debian_trixie_riscv64` sysroot from Chromium's own hooks,
unmodified. The checkout lives in the arm64 sync container's layer and is
bind-mounted, not copied, because disk is constrained.

Steps: `tools/chromium/157/sync-157.sh` (arm64 container),
`tools/chromium/157/setup-x64.sh` (hooks and sysroot; vpython bypassed because its
CIPD Python cannot run there), and a CIPD re-sync from the x64 container to replace
the arm64 `gn`/`ninja` with x64 builds. `gen-157.sh` writes the empty
unbundled-driver stub with the 108 generator
(`base/record_replay_driver.cc` `5d7531016aa29d4ec2116dc5c9a1fbe6614ae58513363536ddc2ae53249f51b1`,
build ID `linux-riscv64-chromium-93a038b11756-unbundled-driver`) and generates
`out/RISCV64` from `tools/chromium/157/args-riscv64-157.gn`, which imports Replay's
`replay_build_scripts/linux_args.gn`.

Acceptance run: `check-workspace-157.py` printed `graph: [94084/94084] LINK ./chrome`
and `E5-T32a workspace check: OK (253 repositories)`. Sabotage: one manifest
revision replaced with zeros gives `FAIL: revision mismatch` and exit 1. The manifest
is `tools/chromium/workspace-157.json`. `tools/privacy/check-no-replay-backend.py`
passes on every file added here. No source patches (E5-T32b), no emulator or web
change. Only GN's `enable_nacl` unused-argument warning comes from Replay's own args.

### 2026-11-22 — fresh verifier — VERDICT: verified

Head `187e8fba9`. Inputs were copied from this commit (`git show HEAD:<file>`) to
`/opt/verify-*` in `replay-chromium-157-x64`; I did not use the worker's `/opt` copies.
The live `out/RISCV64` ninja build was left alone: scratch dirs only, all deleted.

- P1 acceptance — HELD. Predicted `OK (253 repositories)`, exit 0. Observed
  `graph: [94084/94084] LINK ./chrome`, `E5-T32a workspace check: OK (253 repositories)`,
  rc=0 (69 s).
- P2 source identity — HELD. `gh api repos/replayio/chromium/branches/157.0.8103.0-replay`
  gives `93a038b117568051f1697caba2f334ced9329d51`, which equals src `HEAD` and
  manifest `source_revision`. The repo is shallow (`rev-list --count` = 1).
  `chrome/VERSION` is 157/0/8103/0.
- P3 pinned toolchains and empty driver — HELD. `tools/clang/scripts/update.py`
  `llvmorg-24-init-7747-g62397f8b` sub 67 equals `llvm-build/.../cr_build_revision`.
  `tools/rust/update_rust.py` `1edd55dcfcd5…` sub 1125 equals
  `rust-toolchain/VERSION`. GN `2595 (0035961837fb)` matches DEPS `gn_version`, and the
  gn and ninja binaries are x86-64 ELF. The prebuilt rustlib ships only the x86_64 std.
  The riscv64gc std is built from `rust-src` by Chromium's `build/rust/std` rules
  (`--target=riscv64gc-unknown-linux-gnu` in `obj/build/rust/std/rules/*.ninja`) into
  `out/RISCV64/local_rustc_sysroot/lib/rustlib/riscv64gc-unknown-linux-gnu`. This is the
  pinned toolchain's supported path. `base/record_replay_driver.cc` is 234 bytes,
  `gRecordReplayDriver[] = ""`, size 0, sha256 `5d7531016aa2…49f51b1`, matching the
  claim. The `debian_trixie_riscv64-sysroot` is present. On the Mac,
  `tools/privacy/check-no-replay-backend.py tools/chromium/157 tools/chromium/workspace-157.json`
  gives `OK: 7 file(s)`. `out/RISCV64/args.gn` is byte-identical to the committed args.
- P4 toolchain mismatch (wrong Rust std/target) — HELD (detected, three ways).
  (a) The scratch `out/RISCV64-verify` used the committed args plus
  `rust_sysroot_absolute` pointing at a fake sysroot with no riscv64gc std and
  `rustc_version="rustc 1.99.0 fake"`. `gn gen` failed with
  `ERROR Unresolved dependencies … //build/rust/std/rules:{core,alloc,std}_bindings`, so
  the checker's `gn gen` step would fail. (b) The pinned rustc with
  `--target riscv64gc-unknown-linux-gnu` against its prebuilt sysroot gives
  `E0463 can't find crate for std`. (c) A manifest mutated to `rustc 1.99.0-nightly`
  gives `FAIL: rustc '…1.100.0…' != '…1.99.0…'`, checker rc=1.
- P5 novel attack: unrecorded dependency plus actual-vs-DEPS drift — HELD. In the same
  mutated manifest I removed `src/third_party/skia`. The checker printed
  `FAIL: unrecorded dependency: src/third_party/skia`. Separately: the checker compares
  against `gclient revinfo`, which reports DEPS-declared revisions, not checked-out HEADs,
  and it never checks for dirty dependency trees. That is a checker blind spot. I closed
  it independently (`/opt/verify-actual.py`): all 169 git dependencies have
  `git rev-parse HEAD` equal to the manifest revision. None is dirty
  (`status --porcelain --untracked-files=no`). The other 84 entries are CIPD/GCS objects
  or null-revision entries. src shows ` M` on the `v8`, `third_party/skia`,
  `third_party/webrtc` and `third_party/boringssl/src` gitlinks. This is expected: Replay's
  DEPS pins its `replayio/*` forks (`v8_revision 0155a906…`, `skia_revision b21a1f4b…`,
  `boringssl_revision fe2fc5ec…`, webrtc `e632cf8d…`) over the stale gitlinks. Those
  checkouts are clean and match the manifest, so they are not source patches. This does
  not contradict the claim. Follow-up hardening, out of this task's scope: add
  `--actual` and dirty-tree checks to the checker.
- COVERAGE: the acceptance run exercised every branch of `check-workspace-157.py` (the
  OK path plus the revision, unrecorded and toolchain FAIL paths). The shell scripts are
  provenance, waived. `build-157.sh` belongs to E5-T32b.
- SUITE: discard. The checker itself is the recurring acceptance command, and it needs
  the 100+ GB container.
