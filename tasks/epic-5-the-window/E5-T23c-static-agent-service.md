---
id: E5-T23c
epic: 5
title: Static riscv64 guest agent and OpenRC service
priority: 523.3
status: verified
depends_on: [E5-T23b]
estimate: S
risk: high
capstone: false
---

## Goal

Build the poll-driven Rust guest agent for `riscv64gc-unknown-linux-musl`, install it in the T17
image, and keep it alive as an OpenRC service with no dynamic runtime dependencies.

## Boundary

This slice owns the guest agent binary, its bounded poll loop and protocol handlers, the cross-build
and stripped-size gate, rootfs installation, and service lifecycle. It does not own host Channel
APIs, clipboard messages, or the final reconnect/fuzz/browser proof.

## Deliverables

- `guest/agent/` binary using the shared protocol, handling HELLO/PING/NAK over the named port.
- Reproducible static musl build recipe and a stripped binary check at ≤1 MiB with `ldd` reporting
  no dynamic executable.
- T17 image-builder installation and `wasmvm-agent` OpenRC service with bounded restart behavior.
- Guest-side unit/integration fixture for agent restart and in-flight frame termination.

## Acceptance criteria

- [x] The cross-built stripped agent is ≤1 MiB and `file`/`ldd` prove it is a static riscv64
      executable with no shared-library dependency.
- [x] The service opens `/dev/virtio-ports/org.wasmvm.agent`, answers HELLO/PING, and exits or
      retries cleanly when the port disappears; it never spins without a poll bound.
- [x] Rebuilding the T17 image installs the exact agent digest and service links without changing
      the existing serial getty path.

## Verification command

`bash tools/verify/e5-t23c-static-agent.sh`

## Adversarial verification

Kill the agent repeatedly, remove/recreate the port, feed byte-dribbled and oversized frames, and
hold the peer write queue full. Assert no zombie pile-up, no unbounded allocations, bounded restart
latency, and unchanged serial-console output.

## Verification log

### 2026-09-04 — worker — implemented

- Implementation heads: `ac1abee84b7644e2070b6003473506e65da1716` (agent, build recipe, rootfs
  wiring, manifest, and acceptance gate) and `d1bb52a9a615f987a5c9af5115f16c32effe0029` (native
  poll/FD coverage fixture).
- The final worker run is retained at
  `evidence/e5-t23c/static-agent-2026-09-04.txt`. It records the static cross-builds, exact
  `file`/RISC-V `ldd` result, five missing-port service launches, the T17 image rebuild and
  read-only ext4 inspection, plus the complete-image double-build artifacts under
  `target/e5-t23c-rootfs-repro/`.

Claim: the guest agent is a fixed-path, poll-driven, bounded protocol peer. It emits HELLO,
negotiates the shared protocol, answers PING with PONG, returns NAK for unknown types, drops a
connection on malformed framing, and bounds queued output and retry delay. The pinned Zig 0.16
  cross-build is reproducible and static. The T17 builder installs the exact ELF and OpenRC
  service into the default runlevel while retaining the existing ttyS0 getty. Booted host Channel
  reconnect behavior remains owned by E5-T23d/e.

### 2026-09-04 — verifier — VERDICT: verified

- **P1 static executable — HELD.** Predicted two clean target directories would yield identical,
  stripped RISC-V static ELFs under 1 MiB with no dynamic loader. Observed SHA-256
  `c5feb0c04db680d1ae813d0fd85bd599ee29adb51fdc64dc329f66793d1f6851`, size `378536`, `file`
  reporting `static-pie linked, stripped`, and RISC-V Alpine `ldd` reporting `statically linked`.
  Evidence: `evidence/e5-t23c/static-agent-2026-09-04.txt`.
- **P2 protocol, bounds, and lifecycle — HELD.** Predicted HELLO/PING/NAK behavior, byte-dribble
  completion, malformed/oversized rejection, bounded unknown-frame output, in-flight reset, and
  bounded retry. The seven unit tests pass; the FD fixture executes writable flush, poll-bounded
  EOF, malformed-port termination, and retry assertions. Five real service-entrypoint launches
  against the absent fixed port were terminated and reaped cleanly. The production path is fixed
  to `/dev/virtio-ports/org.wasmvm.agent` and uses `poll(..., 1000)` plus 100–800 ms retry sleep.
  Evidence: `guest/agent/src/lib.rs:22-35,155-207,363-505,548-724` and the retained evidence file.
- **P3 T17 installation and serial isolation — HELD.** Predicted a complete image rebuild would
  contain the exact agent bytes, an OpenRC default-runlevel symlink to `wasmvm-agent`, bounded
  supervisor settings, and the unchanged ttyS0 getty. The builder passed package/custom manifest
  drift checks and foreign-ELF scanning; read-only debugfs inspection found the expected symlink,
  378536-byte ELF, exact SHA, service configuration, and original inittab line. Two complete image
  builds were byte-identical at SHA-256
  `ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`. Evidence: `tools/build-rootfs.sh`,
  `tools/rootfs-inner.sh`, `releases/rootfs/FILE-MANIFEST.txt`, and
  `target/e5-t23c-rootfs-repro/{build-a.log,build-b.log,result.txt}`.
- **COVERAGE — SUFFICIENT.** Every runtime hunk is exercised by the protocol/FD tests or the
  native service launch; every rootfs/build hunk is exercised by the exact acceptance command and
  the complete image builds. Manifest compatibility filtering in the prior WVFT verifier is
  declarative harness maintenance and the existing WVFT static verifier remains responsible for
  clean-target WVFT coverage. No browser or host-rr proof is required for this slice under the
  current policy; E5-T23d/e owns the booted host-channel proof.
- **SUITE:** retained `tools/verify/e5-t23c-static-agent.sh`, the seven guest-agent tests, the
  rootfs manifest, and the complete-image reproducibility artifacts.

Commands:

- `bash tools/verify/e5-t23c-static-agent.sh`
- `bash tools/verify/e3-t21b2c-repro.sh target/e5-t23c-rootfs-repro`
- `cargo fmt --all -- --check`
- `cargo clippy -p wasm-vm-agent-protocol -p wasm-vm-guest-agent --all-targets -- -D warnings`
- `cargo test -p wasm-vm-agent-protocol -- --nocapture`
- `cargo test -p wasm-vm-guest-agent -- --nocapture`
- `python3 tools/check_task_policy.py`
