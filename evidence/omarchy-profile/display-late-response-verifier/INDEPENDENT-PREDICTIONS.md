# Independent AV critic predictions

Prepared before reading AV's recorded checkpoints or viewing its images. I read
the AV task and the seven-file source diff at
3055f67a5d768ab34f93d7de291bed713cbb5e9f first. I did not implement AV.

1. Frozen provenance: all changed helpers and actual served runtime bytes must
   match that source head, the unchanged AT WASM, AQ kernel and AR snapshot/delta.
   The AU observer and normalization boundary must match their already verified
   source; only the opt-in timing harness changes.
2. Original product evidence: physical trusted input and independent raw-wire
   nonce remain inside the original 300/60/120/20 second budgets. The initial
   PNG, response timestamp, presentation state and result must be unchanged by
   later observation. No late image can turn the original visual result positive.
3. Continuation: five actual captures occur at offsets 0/40/80/120/160 seconds
   from one fixed diagnostic start, after the original capture. Every operation
   and final diagnostic completion must fit its one 180-second deadline; owned
   cleanup starts afterward and takes at most 30 seconds.
4. Input isolation: no new keyboard, tablet, serial command or readiness event
   occurs after the original verdict. The probe only copies actual display
   bytes and reads the existing canvas. Existing observer bounds and disposal
   remain intact.
5. Checkpoint binding: each chosen frame's sequence equals the latest observer
   sequence and presented-frame count. Pending presentation is zero. Sequence
   and received/presented counts remain unchanged through the screenshot. Any
   mismatch, frame from the future, overrun or altered frozen original fields
   must be rejected by the checkpoint validator.
6. Pixel evidence: gzip bytes, metadata sizes, raw hashes, normalized/cropped
   RGBA and canvas must independently agree. A decoded screenshot must show the
   same desktop as that canvas, accounting explicitly for any host cursor. The
   actual five PNGs must be personally inspected, not inferred from counters.
7. Interpretation: if text appears later, the claim must be limited to that
   measured latency; if all samples remain stale, it must be limited to those
   observed instants and the bounded interval. Neither case identifies a more
   precise upstream cause or satisfies Q without new uninstrumented acceptance.
8. Coverage: the actual recording and focused harness tests must exercise every
   changed behavioral hunk, with one bounded independent late/mismatched
   checkpoint attack. No cold clone or runtime rebuild is required for this
   harness-only observation.
