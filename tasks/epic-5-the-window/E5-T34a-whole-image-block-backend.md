---
id: E5-T34a
epic: 5
title: Whole-image single-fetch block backend for the browser runtime
priority: 0.3871
status: pending
depends_on: [E5-T31]
estimate: S
risk: medium
capstone: false
---

## Boundary

Add a disk mode that fetches one compressed image in a single streamed request, checks its SHA-256, decompresses it into host-side memory (OPFS when available) and serves virtio-blk reads locally with a tmpfs-backed write overlay in the guest. Existing chunked profiles stay unchanged.

## Deterministic acceptance

A Playwright run of the built page boots a fixture image in this mode and records exactly one network request for the disk, zero chunk requests after it, matching digest, and the unchanged live ISA suite total.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

(empty)
