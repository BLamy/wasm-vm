---
id: E9-T21
epic: 9
title: Export and import complete bounded local session bundles
priority: 524.921
status: pending
depends_on: [E9-T07, E9-T16, E9-T18]
estimate: S
risk: high
capstone: false
---

## Goal

Let users back up and move a recorded session with its required content and compatibility identity.

## Boundary

An explicit user-invoked local bundle format; include manifest, log, reachable keyframes, historical disk references and pinned runtime/assets needed by the declared portability policy. Cloud sync is not included.

## Acceptance criteria

- [ ] Export/import into a fresh browser profile and replay using declared bundled or retained assets, without relying on the exporter's caches.
- [ ] Verify digests, section limits, duplicate entries, required versions and total decompressed size before publishing imported state; reject incompatible sessions non-destructively.
- [ ] Document that recordings contain guest data and input/network payloads; provide explicit export/delete controls and no automatic upload.

## Deterministic acceptance

`make verify-E9-T21`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Import truncated, foreign-build, path-traversal, duplicate and decompression-bomb bundles. An import failure must not alter another local session or write outside its store.

## Verification log

(pending; no implementation or verification claim)
