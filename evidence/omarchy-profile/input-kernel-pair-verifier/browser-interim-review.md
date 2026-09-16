# Browser preparation review (interim; no task verdict)

Reviewed `a5c6ae36` and corrected route at `6d2db87b`, before any AR browser run.

- **P2b ordering — initially FAILED, fix HELD.** At `a5c6ae36`, the notes read
  was inserted in `capturePair` after RAM export, not before property writes in
  `runLive`. The new actual-route test independently failed with events
  `fence → navigate → properties → sync → capture` and no notes read. See
  `browser-ordering-original-r1.log`. At `6d2db87b`, the same test passes the
  positive order and rejects old running-kernel notes before property writes;
  see `browser-ordering-fixed-r1.log`.
- **P2a fixed source identities — OPEN.** Source guard SHA-256
  `006152b5bd7f84c9caa0afee16f38b039d48276cb5058613d75ba0e65e60e737`
  rejects 12 ordinary source/provenance mutations, but accepts unexpected
  `record.artifacts.kernel` and `record.artifacts.chunkManifest` keys overriding
  the fixed pins through the spread in `assertInputKernelSource`. The source
  can then claim old-kernel bytes or another chunk manifest while the record's
  input metadata still names the fixed candidate. See
  `source-provenance-original-r1.json` and its executable fixture. This is a
  source-guard gap, not a demonstrated bypass of the later live notes check.
  Restrict artifact roles to the exact snapshot/delta identities or ensure
  record data cannot override fixed pins. The actual native wrapper emits only
  the two expected artifact roles, so its guest run remains usable.

Other reviewed ordering: the new export callback acknowledges one guest `sync`
inside the existing export budget before calling inherited pause/persist/export.
The wrapper checks actual serial wire responses and output pair hashes, rejects
physical input, and keeps personal image inspection explicitly outstanding.
Default routes retain their previous source guards and geometry assertion;
only AR selects the already verified bounded-damage geometry check.

Actual native success, restored notes, byte-bound pair, final sync ordering,
properties, image and cleanup evidence remain pending. No task status changed.

## Fixed source guard — `21b77bb0`

**P2a — HELD.** The worker now rejects every artifact key except the exact
`bootSnapshot` and `overlayDelta` roles and explicitly constructs those two
bindings. Re-running the preserved independent fixture rejects all 14 cases,
including the two formerly accepted overrides; valid source metadata still
passes. See `source-provenance-fixed-r1.json`; helper SHA-256
`1f0f304867d30583e227201b30b78a94b14803ca7499d36b6330f4d0ef52144c`.
No current source-binding finding remains. The actual native record uses exactly
the two accepted artifact roles, so its prior happy run carries unchanged.
