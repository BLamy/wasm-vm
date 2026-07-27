---
id: E3-T21b2c
epic: 3
title: Rootfs integration and boot proof for WVFT agent
priority: 321.223
status: pending
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
(empty)
