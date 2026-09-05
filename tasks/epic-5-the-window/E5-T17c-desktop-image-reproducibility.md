---
id: E5-T17c
epic: 5
title: Prove desktop image reproducibility, size budget, and chunk deduplication
priority: 517.3
status: in-progress
depends_on: [E5-T17b]
estimate: S
risk: high
capstone: false
---

## Goal

Prove that the T17 desktop builder is reproducible from its committed profile and that the real
uncompressed image delta and streamed chunks stay within the E3 budget.

## Boundary

This slice owns normalized build comparison, byte accounting, and E3 chunk reuse. It does not
change startup configuration or perform the repeated runtime boot/persistence proof.

## Deliverables

- A two-build verifier comparing timestamp-normalized `apk info -v` and `find` file manifests.
- Real ext4 delta accounting using allocated/content bytes, with a loud failure above 350 MiB.
- A chunk manifest/diff showing unchanged E3 chunks are reused and only desktop delta chunks are
  fetched, plus a deterministic `make verify-E5-T17c` target.

## Acceptance criteria

- [ ] Two consecutive builds from the same profile have identical normalized package versions and
      file listings; the verifier reports any content divergence with the first differing entry.
- [ ] The builder fails when the real uncompressed ext4 delta exceeds 350 MiB, and the passing
      build records the current delta in machine-readable evidence.
- [ ] The chunk manifest deduplicates unchanged E3 base chunks and identifies every new desktop
      chunk; a sparse-file size or full-base re-upload cannot satisfy the check.
- [ ] `make verify-E5-T17c` passes from a scrubbed environment without relying on timestamps,
      host paths, or an undeclared package cache.

## Adversarial verification

Touch files without changing content, vary build timestamps and output directories, and compare
again; normalized manifests must remain equal. Replace one byte in a package/config file, remove a
base chunk from the dedupe index, and feed a sparse image to the size check; each mutation must be
detected or rejected.

## Verification log

(empty)
