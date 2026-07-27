---
id: E3-T21b2b
epic: 3
title: Static riscv64 WVFT guest agent
priority: 321.222
status: pending
depends_on: [E3-T21b2a]
estimate: S
risk: high
capstone: false
---

## Goal
Bind the verified WVFT protocol to the verified guest storage engine in one reproducibly built
static riscv64 agent providing the service and `vm-download`.

## Deliverables
- A bounded socket/framing adapter for uploads and downloads over `10.0.2.2:10021`.
- One reproducible static riscv64 executable with service and `vm-download` entry modes.
- Build metadata and checks proving architecture, static linkage, and byte reproducibility.

## Acceptance criteria
- [ ] Native adapter tests round-trip upload/download hashes and exercise cancellation, timeout,
  malformed framing, peer disconnect, and two transfers without a destination-dial capability.
- [ ] Two clean builds produce identical SHA-256 and the artifact is identified as static riscv64.
- [ ] `vm-download` accepts only a normalized outbox basename and cannot select an arbitrary path.

## Adversarial verification
Mutate framing/state between endpoint and storage, disconnect at every boundary, inspect the binary
for dynamic dependencies and forbidden capability strings, and rebuild from a scrubbed environment.
Any architecture/linkage drift, path escape, general proxy, or nondeterminism refutes.

## Verification log
(empty)
