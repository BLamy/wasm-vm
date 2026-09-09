# E5-T19a recovery contract — pre-run predictions

These predictions were recorded after reading the task, runtime lifecycle code, OASIS VirtIO 1.3 section 5.14.6.6.1, and the bundled Linux 6.6.63 sources, but before running Hooke's native reproduction.

Reviewed identity:

- workspace HEAD: `c8bcff64c6cc0e6d03fe36bc5157e8d83a924b0e`
- task SHA-256: `e07a5659223c5ae15ed155f7cf8b60e36d9780100f2d80147f14e84d35e5310f`
- runtime SHA-256: `b4665f3c335e1d0806981236338a5507bc8712112051dc530318220dca16fa23`
- original T19a oracle-test SHA-256: `cb835fedea01b5f5cb366ead93d82122966b1eb6f8417ad653a17f6d41c2d587`
- Hooke fixture SHA-256: `a4db06d7951787c0facf0c3c1baae7ba69f211f95fad697200de6a46bb6eed6f`
- Linux archive SHA-256: `d1054ab4803413efe2850f50f1a84349c091631ec50a1cf9e891d1b1f9061835`

Predictions:

1. **Linux ordering is genuine.** For a non-suspended XRUN recovery, Linux 6.6.63 sends STOP from `trigger`, RELEASE from `sync_stop`, then PREPARE without an intervening SET_PARAMS. A device BAD_MSG response maps to `-EINVAL` and causes the observed prepare failure.
2. **Wire reproduction reaches the disputed boundary.** Hooke's fixture first proves successful configured playback and an XRUN event, then receives OK for STOP and RELEASE with no pending TX, and finally receives `VIRTIO_SND_S_BAD_MSG` (`0x8001`) for PREPARE. The stream remains Released and `params` is `None`.
3. **This is a T19a contract refutation, not an H queue-order regression.** OASIS section 5.14.6.6.1 names PREPARE as valid after RELEASE. T19a's acceptance criterion requires the exhaustive oracle to match that documented table exactly, while the current oracle marks Released/PREPARE BAD_MSG and RELEASE clears the parameters required for recovery.
4. **The checked-in oracle is self-confirming.** The original test duplicates the runtime's wrong cells rather than independently encoding the OASIS table. It should also expose at least these additional mismatches: SET_PARAMS after SET_PARAMS, and SET_PARAMS or PREPARE after PREPARE, all of which the specification calls valid but the current oracle rejects.
5. **Smallest legitimate remedy boundary.** Correct only the PCM control-state contract and its independent exhaustive oracle: preserve enough negotiated parameter state across RELEASE for a subsequent PREPARE, accept the specification's repeated SET_PARAMS/PREPARE cells with atomic validation, and retain existing pending-I/O release requirements. Do not alter queue numbering, checkpoint queue restoration, browser timing, or unrelated playback scheduling.
6. **Fixture sufficiency.** The appended native test is a legitimate promoted regression if its real virtqueue responses, PCM bytes, XRUN event, pending-count assertions, and Linux source ordering all hold. A direct logical-state-only test would be insufficient by itself for the observed wire failure.
