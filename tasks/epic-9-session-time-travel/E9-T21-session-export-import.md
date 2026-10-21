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

`make verify-E9-T21` runs the clean-head local build, strict affected-crate checks,
format/witness tests, built demo, real Linux file and physical-GPU recordings,
fresh-profile file export/import, independent archive/native byte readers, and
the prescribed local wall. Evidence is written beneath
`E9_BUNDLE_EVIDENCE_DIR` (or the target's default directory).

The final portability command is
`python3 -B tools/verify/e9-bundles.py --output OUTPUT --cold-clone CLONE_DIRECTORY`.
It checks the same frozen revision with fresh native/wasm/npm build directories;
the broad wall runs once in the primary submission. These commands are proof
requirements, not a verification claim until their final reports pass.

## Portability policy

Archive v1 admits finished exact software (256 MiB ICount/10) and exact GPU
(1 GiB pure ICount/64) recordings matching the installed app/VM/renderer build.
It retains the complete selected manifest closure, including recorded I/O,
kernel, Wasm, renderer identity, base metadata, native owned device/COW state,
full keyframes and RAM-delta ancestors/pages. The current exact profiles require
an empty separate historical base-binding root; foreign legacy overlays are
rejected. Matching installed host JavaScript remains required; this file is not
a standalone website or a migration between runtime builds. Replay does not
re-fetch the original guest asset URLs. GPU import separately qualifies the
actual host against the saved profile.

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

### 2026-10-21 — worker — implementation and development repair ledger

Added the bounded uncompressed `WVBUND01` format and visible local export,
file import, cancellation and delete controls. Every object is authenticated,
the exact transitive closure is checked, and every full/reconstructed native
keyframe is decoded in a private non-running candidate before obtaining a
destination writer. One authorized final manifest transaction publishes a
playable row. Duplicate IDs are conflicts; storage/cancellation failures cannot
replace another row. Conservative GC now understands only the two existing
reference-free exact witness extensions and refuses unknown/malformed metadata.

Fresh actual Daybreak preaudit
`target/evidence/e9-t21-daybreak-preaudit/final-message.md` identified two gaps:
later native/RAM states needed real decoder admission, and the transfer token
had to survive its asynchronous post-commit refresh. Both were repaired. Its
bounded static follow-up
`target/evidence/e9-t21-daybreak-repair-review/final-message.md` found those
repairs sound, retaining unchanged boundary results; it explicitly did not
issue the final task verdict or inspect development recordings.

Development recordings and failed harness attempts remain beneath
`target/evidence/e9-t21-development/`. The four-case `bundles-6` run passed
fresh-profile software parent/child, incremental Linux and hardware-GPU imports,
raw native-byte equality, fresh-ID malformed input refusals with zero writer
calls, no guest run/step/resume during transfer, real quota failure after a
unique object became durable, orphan GC, final-publication cancellation and
post-commit list/close barriers. A genuine mixed full/incremental Linux fixture
and the proposed deeper GPU preview-close barrier strengthen the frozen proof.
No desktop performance or full desktop integration claim follows from the
bounded physical-GPU fixture. Final exact-head high-risk, pristine-clone,
adversarial Daybreak and production-publication evidence remain outstanding.

The strengthened `bundles-7` development run passed all four cases, 57 malformed
imports with fresh IDs/zero destination-writer calls, genuine full/incremental
Linux state, staged-data quota cleanup, the deeper GPU `openSession` close
barrier, and a 390px layout screenshot with no horizontal overflow. Its browser
report SHA-256 is `9018d30b425c31450c8b2d1475c6ff80a01b74738a3edca87906c0022e8dae26`;
independent closure/native reader SHA-256 is
`50f96b055458dbba7082ef51fa452728b90ffb8c225bb27d7c8794c5880062d5`.
All imported native snapshots equal the independently retained originals. These
are development results; the following frozen submission remains authoritative.
