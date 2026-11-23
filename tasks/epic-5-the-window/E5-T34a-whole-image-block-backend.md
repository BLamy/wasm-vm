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

Design (2026-11-22 survey of `web/loader.js`): the existing `disk` mode already
fetches a whole image, but the desktop paths (worker mode, virgl) require the
chunked boot. So instead of a new block device, add a **prefill** to chunked mode.
One streamed request fetches a single content-addressed pack holding every chunk
of the image manifest, verifies each chunk's SHA-256 against the manifest, and
writes it into the existing chunk cache before boot. During boot `fetchPending`
then resolves every chunk locally. Worker/GPU machinery, overlays and integrity
checks are unchanged, and other chunked profiles keep lazy loading unless their
profile opts in.

## Deterministic acceptance

A Playwright run of the built page boots a fixture image in this mode and records exactly one network request for the disk, zero chunk requests after it, matching digest, and the unchanged live ISA suite total.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence and run one
bounded novel attack.

## Verification log

(empty)
