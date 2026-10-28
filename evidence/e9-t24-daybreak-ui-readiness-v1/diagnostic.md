# E9-T24 bounded UI harness diagnostic

READINESS: needs-evidence

This is a readiness/diagnostic result only, explicitly **not final acceptance**. No task is marked verified. I did not modify source, task/queue state, evidence inputs, or the running v4 gate, and I did not restart any boot or browser workload.

## Finding: the shipped-UI seek/step proof is self-referential at the non-final positions

Prediction P3/P4 **FAILED / NEEDS EVIDENCE**. I predicted that the fresh-profile proof must drive the shipped UI and compare restored state at the sought/stepped positions with recording-side expected state. The harness does create separate empty persistent Chrome profiles, imports through the file input, reloads, opens through the visible button, and captures final native state. However, its non-final state checks do not establish the claimed equality:

- `tools/verify/e9-capstone-session-ui.mjs:30-38` creates a new persistent profile and proves its store and caches empty. Lines 51-54 import into a second profile and reload it. This part is appropriately fresh-profile scoped.
- `tools/verify/e9-capstone-session-ui.mjs:42` implements `seek()` by directly calling `t.owner.controller.seekPosition(target)`, bypassing the shipped seek/keyframe controls. It then checks `visible === active.digest`, but both values come from the same replay publication (`web/session-timeline.js:127-135`). A replay that publishes the wrong state and the wrong digest consistently passes this assertion.
- `tools/verify/e9-capstone-session-ui.mjs:55-58` applies that helper at the middle checkpoint. The forward-button check asserts only that the transition became `middle.transition + 1`; it does not compare digest or native CPU/RAM/device/disk bytes with the source recording. The back-button check only proves that returning restores the prior self-reported digest.
- `tools/verify/e9-capstone-session-ui.mjs:59-61` does finally compare all native bytes, but only at the terminal position. Thus the full-byte final check does not close the middle-seek or forward-step gap.

This is concrete rather than hypothetical because immutable recording-side expectations already exist and are not used by the UI harness. In the preserved software report, checkpoint transition `250000000` has digest `c9f1445320191845ad1707d4f73ddd11b5f88b9bb9de5ba013afb7f89f9ae718`; the harness selects that exact middle checkpoint but never asserts the digest. In the preserved GPU report, middle checkpoint `point-1` at transition `20000` has digest `5dc014f4a8c02e0dd4d3cd095c16be3664b6f134ad278fc3ea08286ec12bec12`; the paged low-level proof asserts it, while the later shipped-UI proof does not.

Narrow demand: reuse the immutable v2 recordings and rerun only `e9-capstone-session-ui.mjs` (or the harness portion that invokes it). For both software and GPU, drive the visible keyframe/exact-seek control, assert the complete published position and digest against the recording-side expected checkpoint, then step forward/back through the visible buttons and compare the stepped imported state with a source-profile capture at the same exact position. Retain the existing final native-byte comparison. This requires no original-cold boot, no new recording, no world restart, and no performance campaign.

## Preserved failures and bounded-memory diagnosis

Prediction P1 **HELD**. v2 failed at the UI export waiter, not in replay semantics: `target/evidence/e9-t24-exact-capstone-v2/session-ui/report.json` SHA-256 `3d1fa052e1b8a49d01623dceee49d72db4591e8c71afb1235e33bf811f08cd2c` records the default 30,000 ms `page.waitForEvent("download")` timeout. The parent failed report is SHA-256 `af1dea5c82ca518eade6e91e31f91316fe344ceda63273c618bb948ee6c48c39`.

v3 demonstrates that the adjusted export path completed far beyond 30 seconds: `software.wvsession` is 153,218,100 bytes, SHA-256 `d6c11e29b9dcd3c345a8f9d481fb5629ba6de7603577811ea7a7fcec906ac446`; its source trace is SHA-256 `9a6ad396fbbbaa060538f4c53330851853918decef0d22db2e6bd1a828093cd2`. The child then aborted with V8 at approximately 4,087-4,090 MiB; log SHA-256 `fd772de2a46cc1c57569a36fedfff83b2dd74282725ef5f89a94deb6e902ddff`.

The old source at commit `de0ced2015527e16b2fcb1719f72c2152c6e8e4d` returned `[...bytes]` from `page.evaluate` (old lines 59-60). The software native state is 27,892,012 bytes, SHA-256 `1a46f5bdad9e8416bd2f2c2a6638dc2dfd60c785e340bc965803c04403bc7304`. Playwright recursively expands every array element into protocol serialization objects (`web/node_modules/playwright-core/lib/server/isomorphic/utilityScriptSerializers.js:173-181`), explaining how a 27.9 MiB byte array can exceed Node's 4 GiB heap. The OOM stack's `ArrayMap` frame and heap plateau agree with this actual path; the export archive itself is not the demonstrated heap cause.

Prediction P2 **HELD for the changed handoff, pending completion evidence**. Current source `tools/verify/e9-capstone-session-ui.mjs` SHA-256 `fde003bf8a3cf9ff884fd7fcfc0b06d2ce8efd7632d32cf7ee5a0cfb250e7f56` replaces the numeric array with 16 KiB browser-side chunks, one base64 string, and an exposed retainer (`:60-61`). The Node callback bounds encoded input to 48 MiB, canonicalizes base64, decodes to one buffer, compares every byte with the 27,892,012-byte expected native image, writes it, and returns only small metadata. A 27,892,012-byte input encodes to about 37.2 MiB, inside that explicit ceiling. This removes the per-byte protocol-object explosion on the actual failing route; no runtime guard changed.

At inspection time v4 remained `status: running`, `active: capstone-session-UI`, head `9496b8e645eccf5c1a0104bc5dd19a505c429478`. Its log was still empty and only the 153,218,100-byte software archive/source artifacts existed; there was no child `report.json` or imported/native artifact yet. Therefore the fix was source-sound but not yet evidenced as completed, and I did not disturb the healthy live process.

## Preserved component evidence

- Recorded-input index SHA-256: `21bcc364569dff873f66ae3747c503742087f8429d4b621bcca19f1a9a7c3931`.
- Software report SHA-256: `f49d25dd91bb2dd1563674bae90930d17272d187f56c000d0d2cd0c20d70d5c8`; literal-files oracle SHA-256: `df0f4f037861f4d9e20719b802db20027139e41e070a04745f019250151c0454`. It records 10 owned HTTP exchanges, zero replay fetch/socket egress, and equal final/replay native bytes.
- Bounded physical-GPU report SHA-256: `7ed436d2e4f86dda09cf9f53c14fdf00bff9f1fcb34d536fabf86265f377334a`; independent paged/raw-RAM oracle SHA-256: `559a6a463e2c60cb56c79131f8eb1f56a26aa4a66514087e6d084d0791c54691`. It identifies `ANGLE Metal Renderer: Apple M4 Max`, two incremental-start windows, raw native equality, a literal owned green readback, and zero replay egress. This remains correctly labelled bounded and not Omarchy qualification.

The preserved component evidence is substantial and the base64 repair covers the observed OOM mechanism. Readiness remains `needs-evidence` because v4 had not completed and, even if it completes unchanged, the non-final shipped-UI seek/step assertions remain insufficient as written.
