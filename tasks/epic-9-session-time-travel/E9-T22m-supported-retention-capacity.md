---
id: E9-T22m
epic: 9
title: Qualify a supported 16 GiB local retention profile
priority: 524.9220295
status: in-progress
depends_on: [E9-T22l]
estimate: S
risk: high
capstone: false
---

## Goal

Allow the unchanged full Omarchy workload to retain its complete local session
history beyond the configured 8 GiB physical payload budget.

## Boundary

Declare and prove the existing production `SessionStore.setRetention` 16 GiB
setting as an explicit local qualification profile, with a browser-quota and
host-free-space preflight. Do not change the storage format, portable archive
bounds, guest image, COW boot overrides, ICount/64 clock, 50M checkpoint
cadence, GPU probe, workload amounts, or original performance budgets. E9-T22c
owns the next complete original workload and replay; this prerequisite does
not pass it with a saved prefix or synthetic desktop.

## Acceptance criteria

- [ ] Independently rehash and account for the retained failed C prefix:
      8,589,076,999 physical bytes at checkpoint 350, 857,593 bytes short of
      8 GiB, with every saved object reachable. Preserve the original failure.
- [ ] Prove a supported 16 GiB setting through the production IndexedDB store,
      including durable reopen, append admission above the old 8 GiB budget,
      graph readability and cleanup, and atomic refusal beyond the new limit.
- [ ] Preflight real persistent Chrome quota and host free space with explicit
      headroom before the long run; fail closed when either is insufficient.
      Keep the 2 GiB production default and 4 GiB portable archive bound.
- [ ] Record scoped high-risk browser and cold-clone evidence at an exact head,
      with a fresh Daybreak adversarial verdict. Update the live demo for any
      user-visible new capacity and deploy it to the main Pages project.

## Deterministic acceptance

`make verify-E9-T22m` checks the retained original prefix, production browser
retention behavior and negative bounds, the built demo, and a clean exact-head
cold clone. It is distinct from `make verify-E9-T22c`.

## Adversarial verification

Attack an absent or corrupt chunk in the saved prefix, false reachability,
insufficient browser quota, inadequate host reserve, metadata arithmetic near
16 GiB, and publication/cleanup after a rejected append. Check that the
test actually exercises the production store and cannot pass by merely raising
a harness constant. Preserve portable refusal above 4 GiB.

## Verification log

### 2026-10-25 — planning — exact 8 GiB boundary

The unchanged cold C run at `45beaadaa7b4561b127e77796ea3849f981deedb`
failed at its next 50M checkpoint with `RetentionLimit: saved data byte budget`.
The retained `target/evidence/e9-t22c-submission-45beaadaa/desktop/saved/storage.json`
indexes 8,589,076,999 physical bytes, 10,268 chunks and 2,816 reachable
objects; its separate closure report authenticated all of them. Chrome's
origin quota was 19,331,787,395 bytes. The complete failed-run report and
Daybreak's guest-state diagnostic remain under that evidence directory and
`target/evidence/e9-t22c-daybreak-capacity-45beaadaa/` respectively. No
full-desktop acceptance is inferred from this prefix.
