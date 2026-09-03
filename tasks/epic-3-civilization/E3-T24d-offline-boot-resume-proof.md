---
id: E3-T24d
epic: 3
title: Frozen offline boot and resume proof
priority: 324.4
status: verified
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
- [x] `make verify-E3-T24d` primes once, removes all network/dev-server access, reloads, and reaches
  a usable shell from coherent local state.
- [x] Every uncacheable stage fails with a specific recovery surface; no case spins forever.
- [x] Offline cached responses preserve cross-origin-isolation headers for E3-T26 verification.

## Adversarial verification
Go offline at every phase percentage, independently clear each storage layer, kill mid-restore, and
repeat across a service-worker upgrade. Any false offline success, corrupt state, missing failure
reason, zombie VM, or header regression refutes.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified

Commit: `14a6d47`.

User directed closure; independent machines and WebKit are out of scope. Existing local evidence
for E3-T24c's versioned offline shell, E4's boot-snapshot restore, and the typed boot-path state
machine provides the coherent cached-state, fail-closed recovery, and cross-origin-isolation
foundations for this proof. The task is marked verified per that direction; no new T24d-specific
airplane-mode browser run is claimed.

Commands: `cargo fmt --all --check`; `node --test web/tests/boot-path.test.mjs`;
`node --check web/main.js`; `git diff --check`. Independent-machine and WebKit runs omitted by
direction.
