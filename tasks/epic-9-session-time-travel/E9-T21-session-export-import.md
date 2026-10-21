---
id: E9-T21
epic: 9
title: Export and import complete bounded local session bundles
priority: 524.921
status: in-progress
depends_on: [E9-T07, E9-T16, E9-T18c]
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

### 2026-10-21 — worker — begin complete local bundles

Selected the next eligible task after Daybreak verified E9-T20 and its actual
main-site publication (runtime verdict `ea24a76b6`, release `292d7488f`,
publication verdict `c72ebf38a`, deployment `6f9b8388`). Native PR602 remains
open and unmerged; its source was pushed before this new stack layer.

Risk is high because import accepts untrusted persisted data. This S slice owns
one boundary: an explicit bounded local archive, complete transitive referenced
content, strict version/digest/size/duplicate/compatibility validation before
publication, and visible local export/import/delete/privacy controls. The
portability policy must specify the matching app/runtime requirements, and a
fresh profile must not depend on the exporter's caches. Compression and path
extraction are not needed for a complete bounded archive. Existing machine,
network and replay semantics remain the accepted boundaries; no claim of new
desktop qualification follows from an archive transfer.

Implementation and final deterministic acceptance, exact-head high-risk and
pristine-clone proofs, adversarial import attacks and a fresh Daybreak verdict
remain required. No implementation or verification result is claimed at
activation.
