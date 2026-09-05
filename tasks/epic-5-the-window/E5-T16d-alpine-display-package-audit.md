---
id: E5-T16d
epic: 5
title: Audit Alpine riscv64 display-stack packages and installability
priority: 516.4
status: implemented
depends_on: [E5-T16c]
estimate: S
risk: medium
capstone: false
---

## Goal

Prove the real Alpine riscv64 repository and install surface for the measured finalist stacks and
their terminal, clipboard, seat, and XKB support before the decision is written.

## Boundary

This slice owns package discovery/install evidence and the candidate package manifests. It does
not choose the winner, rebuild the final desktop image, or hand-edit a running image as a fix.

## Deliverables

- Clean E3-derived riscv64 scratch-image runs of `apk search` and `apk add` for labwc/pixman and
  weston/pixman stacks, with terminal, clipboard, seat/udev, and XKB packages tested as applicable.
- Captured repository URLs, package versions, signatures, dependencies, failures, and the exact
  package manifests/config inputs handed to E5-T16e.
- A check that the package audit uses the real riscv64 Alpine main/community repositories and no
  `--allow-untrusted` or host-architecture substitute.

## Acceptance criteria

- Every package proposed for the eventual server + WM + terminal + clipboard stack has a successful
  riscv64 `apk search` and clean signed `apk add` result, or the evidence names the missing package
  and removes that stack from consideration.
- The two measured finalists' package availability is represented separately from their runtime
  measurements; package presence is never inferred from a host package database.
- A fresh E3-derived image reproduces the captured package/version manifest and leaves a replayable
  log suitable for the final decision document.
- The audit exits nonzero on signature failure, wrong architecture, missing repository metadata, or
  an untrusted install flag.

## Verification command

`make verify-E5-T16d`

## Adversarial verification

Clear the package cache and rerun against the configured riscv64 mirrors. Attempt each proposed
`apk add` on a clean image, including the clipboard and terminal packages; a package that only
exists on x86 or only succeeds with `--allow-untrusted` refutes the candidate's availability claim.
Compare package versions and repository labels against the captured architecture metadata.

## Verification log

### 2026-09-04 — worker — IMPLEMENTED (commit `835b780`)

- Fast gates: `cargo fmt --check -p wasm-vm-cli`; `cargo clippy -p wasm-vm-cli --bin wasm-vm --features gpu-trace -- -D warnings`; `cargo test -p wasm-vm-cli --bin wasm-vm --features gpu-trace` (54 passed); `cargo build --release -p wasm-vm-cli --features gpu-trace`; and Node syntax checks for both audit scripts.
- Final guest recording: `node tools/run-e5-t16d-package-audit.mjs` ran two fresh copies of the E3-derived `releases/rootfs/alpine-rootfs.ext4` through the native riscv64 emulator with `--net-slirp`, `--virtio-rng`, `--jit --jit-threshold 100`, and `--interrupt-batching`. Each guest recorded `apk --print-arch`, the v3.20 main/community repository file, `apk update`, one combined `apk search -v`, a successful full dependency `apk add --simulate`, the signed `apk add --no-scripts --no-progress` transaction, `apk info -a`, and the installed manifest before `poweroff -f`.
- The labwc/pixman candidate installed all 10 requested packages (the resolver selected 93 packages; final installed manifest has 177 entries) and the weston/pixman candidate installed all 11 requested packages (resolver selected 106 packages; final installed manifest has 190 entries). Both guests reported `riscv64`, repository update `rc=0`, install `rc=0` with `OK:`, and emulator `outcome=Exited(0)`; no `--allow-untrusted` or host package database was used.
- Evidence: `evidence/e5-t16d/package-audit.json` and `package-audit-verification.json`; guest traces `labwc-pixman-guest-evidence.txt` and `weston-pixman-guest-evidence.txt`; complete console/stderr logs for both candidates. Base image SHA-256 is `ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`; guest retired counts are `22769225470` and `25121966141`. The final `835b780` parser-only fix decodes interleaved serial echoes without changing the recorded guest run; the verifier and four negative self-tests pass against the resulting audit artifact.
