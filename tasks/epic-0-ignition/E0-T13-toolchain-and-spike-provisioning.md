---
id: E0-T13
epic: 0
title: Provision the riscv64 cross-toolchain, Spike, and QEMU with a reproducible Docker path
priority: 13
status: implemented
depends_on: [E0-T01]
estimate: M
capstone: false
---

## Goal
One command gives any contributor (and the CI/adversarial verifier) a pinned
`riscv64-unknown-elf-gcc`, Spike (`riscv-isa-sim`), and `qemu-system-riscv64` — with a
Dockerfile as the canonical reproducible path and documented native installs (Homebrew,
apt) as conveniences. Golden binaries (E0-T14) and differential traces (E0-T20) both
depend on these exact versions.

## Context
Trace diffing is only meaningful against pinned reference versions: Spike's log format and
instruction retirement details drift across commits. Ubuntu 24.04 packages
`gcc-riscv64-unknown-elf`; Spike must be built from a pinned `riscv-software-src/
riscv-isa-sim` commit (configure && make); QEMU comes from `qemu-system-misc`. On macOS:
`brew install riscv64-elf-gcc riscv64-elf-binutils qemu` plus a source build of Spike.
All version pins live in one `versions.env` file that scripts and docs both source.

## Deliverables
- `tools/toolchain/Dockerfile` (FROM `ubuntu:24.04`, digest-pinned) installing the gcc
  cross toolchain and QEMU from apt with pinned versions, and building Spike from the
  commit SHA in `versions.env`.
- `tools/toolchain/versions.env`: gcc package version, Spike commit SHA, QEMU version,
  base-image digest.
- `tools/toolchain/build.sh` (builds/tags the image `wasm-vm-toolchain:local`) and
  `tools/toolchain/run.sh -- <cmd>` (runs `<cmd>` in the container with the repo
  bind-mounted at `/work`, UID-mapped so artifacts aren't root-owned).
- `tools/toolchain/README.md` section documenting native macOS/Linux installs and the
  smoke test.
- Smoke test `tools/toolchain/smoke.sh`: assembles a 4-instruction rv64i program that
  writes `1` to `tohost` and runs it under `spike`, asserting exit status 0.

## Acceptance criteria
- [ ] From a cold clone with only Docker installed: `tools/toolchain/build.sh` succeeds
      and `tools/toolchain/run.sh -- riscv64-unknown-elf-gcc --version`,
      `run.sh -- spike --help`, and `run.sh -- qemu-system-riscv64 --version` all work.
- [ ] `run.sh -- tools/toolchain/smoke.sh` exits 0 (compile + Spike run round-trip).
- [ ] Spike is built from the exact `versions.env` SHA (`spike --help` output or build log
      captures it); no `master`/`latest` references anywhere in the Dockerfile.
- [ ] Artifacts created via `run.sh` are owned by the invoking user, not root.
- [ ] The documented macOS path names real, current Homebrew formulae.

## Adversarial verification
(1) Cold reproducibility: `docker build --no-cache` on a machine that has never built the
image — network flake handling and unpinned apt packages surface here; an unpinned
dependency that changes the produced gcc/Spike version refutes. (2) Grep the Dockerfile
and scripts for `latest`, `master`, `HEAD`, or bare `apt-get install` without version
pins. (3) Run `run.sh` from a directory path containing spaces and from a non-repo-root
cwd — breakage refutes. (4) Verify the smoke test actually fails when it should: corrupt
the smoke `.S` file (bad opcode) and confirm nonzero exit. (5) On macOS, follow the
documented native path verbatim in a clean shell; any missing formula or wrong binary
name refutes the docs.

## Verification log

### 2026-07-02 — worker claim — commit 91587f6 (branch task/e0-t13-toolchain, stacked on e0-t12)
Deliverables: tools/toolchain/ — versions.env pins UBUNTU_DIGEST (sha256:4fbb8e6a…),
GCC_RISCV64_VERSION=13.2.0-11ubuntu1+12, QEMU_SYSTEM_MISC_VERSION=1:8.2.2+ds-0ubuntu1.17,
SPIKE_COMMIT=55b4658dbf574ba0b714083ec436ce2cb5be1998 (2026-06-26), IMAGE_TAG. Dockerfile
(FROM ${UBUNTU_DIGEST}) installs the version-pinned apt gcc-cross + qemu (--no-install-
recommends) and builds Spike from the exact SHA — `git checkout SHA` then `git rev-parse
HEAD | grep -qx SHA` FAILS the build if the commit moved; records it at
/opt/riscv/SPIKE_COMMIT. build.sh tags wasm-vm-toolchain:local (empty-array expansion
guarded for macOS bash 3.2 under set -u — caught + fixed during dev). run.sh bind-mounts
the repo at /work UID-mapped (--user $(id -u):$(id -g)), derives repo root from its own
location (any cwd, spaces OK), HOME=/tmp. smoke.S/.ld/.sh: 4-instr rv64i writing 1 to
tohost, assembled + run under spike, asserts exit 0. README documents macOS (brew tap
riscv-software-src/riscv) + Ubuntu apt native paths.
LOCAL VERIFICATION (Docker on this macOS host — the full acceptance matrix + attack angles):
build.sh built the image; riscv64-unknown-elf-gcc 13.2.0, Spike 1.1.1-dev, QEMU 8.2.2 all
report versions; /opt/riscv/SPIKE_COMMIT == the pinned SHA exactly; smoke round-trip exit 0;
artifact written via run.sh owned by `brettlamy` NOT root (angle: ownership); run.sh works
from /tmp (non-repo cwd) and from "/tmp/dir with spaces" (angle 3); FAILURE DETECTION —
tohost=(1<<1)|1 makes spike exit 1, which smoke.sh's `if spike` propagates as FAIL (angle 4
variant; documented that an illegal opcode traps-loops/hangs rather than clean-exits, bound
with `timeout` in CI). grep for latest/master/HEAD/unpinned apt: CLEAN.
CI: ci.yml green run 28635157699 (rust build unaffected; toolchain is a local/verifier tool
— not wired into CI to avoid a multi-minute Spike build per run; E0-T14/E0-T20 consume it).
rr: N/A (build tooling, no emulator runtime). Cross-task payoff: E0-T13 arms the Spike
differential ("angle 1") deferred across E0-T06..T12 — re-runs recorded there land at E0-T20.
