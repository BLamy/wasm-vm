---
id: E3-T21b2
epic: 3
title: Static guest file agent and rootfs integration
priority: 321.22
status: cancelled
depends_on: [E3-T21b1]
estimate: S
risk: high
capstone: false
decomposed_into: [E3-T21b2a, E3-T21b2b, E3-T21b2c]
---

## Goal
Implement the riscv64 guest filesystem peer for the verified WVFT endpoint and ship it in Alpine.

## Deliverables
- One reproducibly built static riscv64 binary providing the upload agent and `vm-download`.
- Fixed inbox/outbox descriptors, filename/link checks, `.part`/commit records, hash validation,
  atomic no-replace rename, fsync, recovery, quota, concurrency, and timeout enforcement.
- Reproducible rootfs installation and service lifecycle.

## Acceptance criteria
- [ ] A focused native filesystem-model test covers empty, 100 MiB, hostile name/link, quota,
  interruption at every state, recovery, and two concurrent transfers.
- [ ] The static binary is verified as riscv64 and installed at deterministic image paths.
- [ ] A boot test reaches the real agent through `10.0.2.2:10021` and proves one upload/download
  hash round trip without adding a general proxy or listener.

## Adversarial verification
Traverse names, race links, mutate source during download, exhaust disk/concurrency, kill at every
commit transition, and inspect reboot recovery. Any incomplete final name, host capability, dynamic
runtime dependency, or nondeterministic image change refutes.

## Verification log

### 2026-07-27 — seam audit — decomposed

The original task combined three independently falsifiable high-risk boundaries: crash-safe
filesystem semantics, a reproducible static riscv64 executable, and rootfs/real-boot integration.
They are now E3-T21b2a/b/c so a filesystem refutation does not rerun cross-compilation and boot, and
a packaging-only repair does not rerun the 100 MiB/interruption matrix.
