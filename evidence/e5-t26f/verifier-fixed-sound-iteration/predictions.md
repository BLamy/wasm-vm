# E5-T26f fixed-sound iteration — pre-evidence predictions

Recorded before inspecting the `28bf565e` reuse result. This iteration is not a final acceptance record and cannot produce a final task verdict.

Frozen scope:

- harness commit: `28bf565e15fbe457a3beabac2b17c990f300e237`
- scoped commit diff SHA-256 (runner and Node test only): `efece627099687bfcea17397ae5dd41bdc7471ca3f8ad2cfb2a1862d6e2c830c`
- runner SHA-256: `b50946c12382968d7dfd84a5e0a85388cb88ae83387d3b4adafff8ccbe844b48`
- Node test SHA-256: `dd8f29775cb16c7aac4a17819713626e6fa45f09dd29f16cb469d0abd7e9ca4e`

Predictions:

1. **Gesture ordering — HELD if tested.** Pointer motion begins before the complete 350 ms delay. No mouse-down/up, command injection, physical key, or audio unlock occurs during that delay. Audio policy is `locked` both before pointer motion and immediately after the delay, before the click.
2. **Deadline — unchanged.** The interaction clock begins at `firstRestore.completedAt`; overlapping cursor progress with the 350 ms gesture delay neither resets nor deducts that delay. Completion at 2,000 ms is accepted and 2,000.01 ms is rejected.
3. **Fresh restored PCM — required.** After restore, the harness must physically type the new `sh /tmp/a` command and observe, in the same two-second interval, a positive fresh-ring `writtenFrames` delta, positive `nonSilentFrames`, positive `maxAbs`, a positive rendered-frame delta, and `guestAttached === true`.
4. **No substitute signal.** A terminal marker, successful `aplay` exit, `audioOutputReady`, or advancing render clock without fresh non-silent ring writes does not satisfy actual PCM restoration.
5. **Carried prior F boundaries.** The earlier candidate evidence remains HELD where unchanged: no reboot, generation-2 fresh HELLO, matching first-present normal framebuffer CRC, and genuine post-restore focus/cursor/typed-input observations. It did not establish fresh PCM, drag/coherence completion, or the final second reload, so it cannot verify F.
6. **Diagnostic provenance.** The creator run from `bd2ca267` at `/private/tmp/e5-t26f-fixed-pcm.QrhhBP` is cold setup plus normal-state sealing with `acceptance:false`. Reuse at `28bf565e` may diagnose actual PCM but is not final acceptance evidence.
7. **Harness tests and sabotage.** All 28 bounded Node tests should pass. Moving pointer motion back after the delay must fail the new ordering regression; removing the second locked-policy check must fail the premature-unlock regression.
8. **Verdict boundary.** No browser, build, runtime, task-status, or final-verdict conclusion follows from this pre-evidence review. Final judgment waits for the new accepted browser record while retaining the unchanged two-second cap.
