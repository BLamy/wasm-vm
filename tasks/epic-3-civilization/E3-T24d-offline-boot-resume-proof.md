---
id: E3-T24d
epic: 3
title: Frozen offline boot and resume proof
priority: 324.4
status: pending
depends_on: [E3-T24b, E3-T24c]
estimate: S
risk: high
capstone: false
---

## Goal
Prove a previously visited VM reaches a usable shell with the network and dev server absent, using
only coherent local shell, snapshot/overlay, and cached-image state.

## Deliverables
- One fresh-profile online-prime then airplane-mode browser acceptance target.
- A stage-boundary offline/failure matrix covering wasm, manifest, chunks, and snapshot restore.
- Evidence for usable guest state, explicit degraded networking, and security-header preservation.

## Acceptance criteria
- [ ] `make verify-E3-T24d` primes once, removes all network/dev-server access, reloads, and reaches
  a usable shell from coherent local state.
- [ ] Every uncacheable stage fails with a specific recovery surface; no case spins forever.
- [ ] Offline cached responses preserve cross-origin-isolation headers for E3-T26 verification.

## Adversarial verification
Go offline at every phase percentage, independently clear each storage layer, kill mid-restore, and
repeat across a service-worker upgrade. Any false offline success, corrupt state, missing failure
reason, zombie VM, or header regression refutes.

## Verification log
(empty)
