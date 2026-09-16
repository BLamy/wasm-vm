# E5.5-T03ar — fresh critic predictions

Recorded 2026-09-16 before inspecting AR worker evidence or output artifacts.
Source baseline during orientation: `fe446fb5` (AQ worker submission). AR is
still pending; no AR implementation diff exists at this point. This record will
be supplemented after the worker freezes the AR diff, before examining its run.

## Scope

Prepare a new coherent desktop RAM/disk pair using AQ's verified larger-input-
buffer kernel. This is not physical keyboard responsiveness acceptance, and it
cannot release Q. Carry unchanged serializer proofs; do not re-run them merely
because this task prepares another pair.

## Falsifiable predictions

- **P1 — kernel provenance.** The native cold-boot invocation uses a regular
  candidate Image with SHA-256
  `3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d`,
  size 24208896, and no old snapshot argument. A successful read of
  `/sys/kernel/notes` inside the running guest has SHA-256
  `7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f`.
  Independently extracting `__start_notes..__stop_notes` from the supplied
  Image/System.map will reproduce that digest. Merely serving the Image or
  observing `uname` is insufficient evidence about the executing kernel.
- **P2 — continued kernel identity.** The browser restores the newly captured
  native pair and its read-only guest `/sys/kernel/notes` query returns the same
  candidate digest before desktop properties or final export. The old AJ pair
  is not an accepted input. A substituted original-kernel notes digest must fail
  the identity guard before export, even when candidate file metadata is intact.
- **P3 — paired disk/base identity.** Native and browser input manifest hashes
  resolve to the existing R3 256 KiB/4 GiB chunk base. The final RAM header and
  delta header share the exact canonical base digest and generation, and output
  file byte counts/digests agree with the recorder. Native RAM capture follows
  guest sync; browser capture pauses execution and drains persistence, chooses
  the overlay namespace seeded by the exact native pair, and exports RAM and
  disk without a intervening resume or generation change.
- **P4 — preserved settings.** AO wasm runtime remains
  `36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`.
  Actual observations preserve ICount64, cap256, recycling, LP1, mapped Foot,
  package-owned Omarchy shell, 1280×800 canvas/GPU and 1280×832 backing resource.
  A partial damage rectangle is not a smaller scanout. Direct opaque/force_rgbx
  properties are true, all opacity values are one and their overrides true.
- **P5 — fresh visible pixels.** After property confirmation, frame and successful
  present counters advance, and the saved real screenshot visibly contains the
  original-resolution desktop and a mapped Foot prompt. Pixel counters alone
  do not establish this prediction; I must inspect the image itself.
- **P6 — preparation stays input-free.** CDP input suppression is acknowledged
  before navigation; report contains no physical keyboard test, nonce writer,
  keyboard/mouse/tablet/agent injection or synthetic guest-input path. Serial
  commands are limited to explicit preparation/provenance reads, approved
  direct properties, and sync.
- **P7 — bounded owned processes.** Native cold boot and browser preparation
  use fixed host deadlines and terminate/reap their own emulator/recorder/browser
  processes. Successful export is within its bound, all recorder processes close
  normally, and no watchdog or unfinished capture is described as a usable pair.

## Bounded novel attack

At the actual final identity helper boundary, substitute the original kernel's
notes digest (`a3f7f2a76799a72bbba6af0b4ad7fa6eee9313fa64f3e53f85105f399dfe5e0e`)
while retaining candidate Image metadata. Require deterministic rejection before
capture; also reject malformed or ambiguous notes output. This checks execution
identity rather than only the downloaded file identity. No extra guest boot is
required for this bounded parser/guard attack.

## Initial source observations (not verdicts)

The inherited `prepareLocalCandidate` only serves the release kernel and the
inherited input source guard pins the old pair. AR must make the new provenance
explicit. Existing native capture sends `sync` before the snapshot trigger;
existing browser capture pauses, persists, checks two idle samples, binds the
exact warm overlay seed, and preserves generation. Coverage review will identify
AR-specific changed hunks separately from these unchanged boundaries.

## Native freeze supplement — `c2cbcfd0`

Before inspecting the native run, read its frozen diff and the activation scope
clarification at `6d8b4fa9`. **P4** preparation uses existing AJ recycling-off
options; AS must turn already-accepted AO recycling on after restoring the pair.
No claim that a JIT cache/counter setting persists inside RAM is made by AR.
All other P4 conditions remain unchanged.

The native wrapper starts one new process session, waits 7380 seconds for the
full pipeline, and on timeout signals its process group. **P7a:** after the owned
pipeline leader exits on SIGTERM, no living descendant may remain in that group.
This must hold even if a descendant ignores SIGTERM. A bounded synthetic process
tree can falsify cleanup without touching or delaying the actual guest run.

## Browser freeze supplement — `a5c6ae36`, corrected `6d2db87b`

Read the complete browser preparation diff before inspecting any browser run.
P2a below was recorded first as the executable cases in
`source-provenance-attack.mjs`, written before that fixture was executed; this
supplement catalogs the case and does not claim an earlier prose timestamp.
The source validator must bind exact served bytes to the native pair record and
retain the fixed AQ kernel and R3 chunk-manifest pins. **P2a:** neither ordinary
served-file digest mismatches nor extra keys in `record.artifacts` may override
those fixed identities. **P2b:** in the actual `runLive` route, candidate notes
must be read before direct property writes; old notes abort the route before
properties, sync, or export. **P3a:** a successful route orders direct properties,
fresh image, export budget start, acknowledged guest sync, pause/persist and pair
capture, with exactly one notes read and one sync in the serial stream.
