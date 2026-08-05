---
id: E3-T12e
epic: 3
title: Docker-tab instant resume and frozen coherence proof
priority: 321.95
status: pending
depends_on: [E3-T12d, E3.5-T05a]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the visible Docker-tab state resumes into a usable guest in seconds and remains disk-coherent
after reload.

## Deliverables
- Save/resume controls and automatic restore wiring for the E3.5-T05a Docker-tab guest state.
- One browser acceptance path running a command, snapshotting, reloading, and running a second
  command without cold boot.
- Exact timing, state digest, overlay generation, and post-resume filesystem evidence.

## Acceptance criteria
- [ ] `make verify-E3-T12e` passes in a fresh browser profile and pristine clone.
- [ ] Reload-to-usable is under 3 seconds on the recorded dev machine and the second real guest
  command continues from the saved state.
- [ ] Post-resume disk inspection is clean and a stale snapshot demonstrably takes the cold path.

## Adversarial verification
Snapshot mid-command and mid-write, reload repeatedly, mutate the overlay between save and reload,
and compare two sequential restores. Any false fast-path label, stale-disk resume, lost/duplicated
guest work, or undocumented manual step refutes.

## Verification log
(empty)
