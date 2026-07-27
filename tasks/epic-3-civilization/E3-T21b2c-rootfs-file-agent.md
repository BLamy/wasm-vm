---
id: E3-T21b2c
epic: 3
title: Rootfs integration and boot proof for WVFT agent
priority: 321.223
status: implemented
depends_on: [E3-T21b2b]
estimate: S
risk: high
capstone: false
---

## Goal
Install and lifecycle the static agent reproducibly in Alpine, then prove the real guest reaches
the verified synthetic endpoint.

## Deliverables
- Deterministic rootfs installation paths, fixed inbox/outbox directories, OpenRC lifecycle, and
  `vm-download` command exposure.
- Image manifest/digest coverage for the binary, configuration, service, and directories.
- A real boot acceptance path through `10.0.2.2:10021`.

## Acceptance criteria
- [ ] Two rootfs builds install identical agent/config/service bytes at deterministic paths and
  produce the expected manifest/digest.
- [ ] A boot test proves service startup, one upload and download hash round trip, timeout cleanup,
  and restart recovery through the real slirp endpoint.
- [ ] The guest exposes no host/public listener and the agent restart leaves no complete-looking
  partial file.

## Adversarial verification
Boot with stale/corrupt partials and commit records, kill/restart the service mid-transfer, inspect
listeners/routes, and compare clean image builds. Any nondeterministic image, public ingress,
incomplete final name, or missing restart recovery refutes.

## Verification log

### 2026-07-27 — worker — implemented
- Exact implementation head: `f7ad63b` (`5a5a6d8` runtime/rootfs integration plus
  `f7ad63b` roadmap and browser evidence).
- Static-agent reproducibility: two independent musl builds produced
  `3df4809320d8fbab3b7d8b68378828e7cd5bb6711b0198cb08d3a598a322e025`; both were
  stripped RISC-V ELF64 static PIE executables.
- Rootfs reproducibility: two clean `tools/build-rootfs.sh` runs produced
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`; both passed
  `fsck`, package-lock, `FILE-MANIFEST.txt`, ELF-architecture, path, mode, and digest
  checks through `tools/verify/e3-t21b2c-rootfs.sh`.
- Real boot acceptance:
  `cargo test --release -p wasm-vm-cli --test boot_file_agent -- --ignored --nocapture`
  passed (1/1, 178.16s). The installed command booted against the real Alpine
  kernel/rootfs and proved host-to-guest SHA-256 upload, guest-to-host byte-exact
  download, no listener on port 10021, the bounded 30-second host timeout while the
  guest agent was frozen, recovery after a corrupt partial/commit record and service
  restart, a post-restart transfer, and a forced clean poweroff.
- Submission gates passed: `cargo fmt --all --check`; strict clippy for
  `wasm-vm-file-agent`, `wasm-vm-slirp`, and `wasm-vm-cli`; 8 file-agent tests; native
  fixture round trip; 13 slirp file-transfer tests including 100 MiB and real TCP;
  wasm32 build; the E3-T21b2b capability checker; the E3-T21b2c rootfs verifier;
  `cargo check --workspace --all-targets`; task policy; and scoped diff checks.
- Browser proof: `make web-build`, then one local-page load ran the 126-binary suite
  to 126 passed / 0 failed / 126 done with zero console errors. The
  `Bounded host/guest file-transfer agent` roadmap capability was present and visible
  as verified. Screenshot:
  `tasks/epic-3-civilization/e3-t21b2c-browser-roadmap.png`.

Claim: the frozen head reproducibly installs the bounded static WVFT agent, configuration,
OpenRC lifecycle, and guest download wrapper into Alpine; the real guest exchanges
byte-verified files only through the host-selected slirp endpoint, times out boundedly,
exposes no inbound listener, and recovers without promoting a stale partial after service
interruption. The focused boot intentionally uses `init=/bin/sh` to avoid unrelated
OpenRC/getty boot cost; production OpenRC paths and enablement are covered by the
rootfs manifest verifier.
