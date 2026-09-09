# E5-T26f diagnostic-completion preregistration

Frozen before inspecting any `E5_T26F_DIAGNOSTIC_COMPLETE=1` output. This is a bounded
inner-loop coverage check, not F acceptance, verification, a new requirement, or a replacement
for normal full `make verify-E5-T26f` and fresh review. The existing browser and CPU adjudications
remain unchanged (review-file SHA-256s `2044899d4945ea5cd79c5c61c5f08f308b17aa85b9ee2ef932fa34d6c86170b1`
and `c4b11a5069181492c14c7cf633a37cef2523d0b3d25c7a49e4074728a2876352`).

Fixed inputs are HEAD `415db223733214b6c6e7b69b0ad331150969be56`, production WASM
`a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`, the already closed
checkpoint copied afresh, image `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`, and helper
`5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9`. No CPU, JIT,
residency, guest-clock, latency, command, or ICount selector is admitted.

## Falsifiable predictions

1. **Binding and classification — expected HELD.** The immutable invocation and completion record
   will bind the exact fixed inputs and an unmodified fresh copy of the sealed checkpoint. It will
   identify reuse/completion diagnostic mode and retain `acceptance:false`; nothing in this screen
   will assert `fVerified:true` or constitute F acceptance.

2. **Normal restore coherence — expected HELD.** The formerly deferred normal audit will finish
   `passed`: the frozen restore receipt will say attempted/resume, the restored overlay generation
   will equal the normal snapshot's saved generation, the current generation will not predate it,
   and `normalRestore.functionalChecksPassed` will be true. Any earlier functional assertion or
   browser/HTTP error fails this prediction; it may not be excused by timing.

3. **Original cap retained, then rethrown — expected HELD as a cap failure.** I predict the exact
   original `postRestoreEnd - postRestoreStart` will again exceed 2,000 ms. The completion record
   will retain those unaltered boundaries in `deferredInteractionCap`, with `acceptance:false`,
   `functionalChecksPassed:true`, `timingPassed:false`, and `checksPassed:false`; after later
   evidence is written, the identical `ERR_ASSERTION` (`post-restore interaction exceeded 2
   seconds`) will be rethrown and the child will exit 1 without a signal. A value at or below the
   cap makes this prediction FAILED rather than proving F, and no speedup or cause will be inferred.

4. **Drag checkpoint chain — expected HELD.** Before/held/moving/released saves will each be
   recorded; the moving snapshot will be persisted while paused and pass both frozen-checkpoint
   audits. The observed titlebar translation will be within the existing 64–96 px bound. These are
   functional observations outside the original timing interval, not additions to that interval.

5. **Second reload and restored release — expected HELD.** The second reload will restore the
   moving snapshot SHA and saved frame CRC, report a full repair frame and no cold `booting` state,
   pass drag coherence, and expose no held pointer button. A stationary hover without injected
   down/up will advance guest pointer frames, reach the requested rendered coordinate, and leave
   the restored titlebar stationary through the existing one-second observation.

6. **Closed completion evidence — expected HELD.** `diagnostic-completion.json`, its server log,
   and completion PNG will close immutably with complete empty browser and HTTP error arrays.
   Functional success may discharge only the phases marked NEEDS EVIDENCE in the prior browser
   review; the two-second failure and both prior adjudications remain unchanged.
