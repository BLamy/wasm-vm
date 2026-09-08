# Frozen resident-fixture predictions

Source: `7da050620031145b6e76cf150a894ed2710bd5b2`, compared with `00cad42c`.
Recorded before opening the new browser output or build/gate records in this review.
The earlier read-only preflight and queued-XRUN correction are known prior checks,
not fresh predictions. No browser capture has been inspected for this candidate.

1. **P1 — image provenance.** Both isolated image builds have the same full-image
   digest; each actual helper readback equals the frozen source, has root-owned
   mode 0444/fixed timestamps, passes read-only fsck, and preserves the exact base
   image and package lock. Reassembled served chunks equal that same image. A
   successful mock build alone is insufficient.
2. **P2 — guest identity and completion.** The real cold terminal must show two
   matching pre-observations of one executed aplay (PID/starttime/executable,
   pipe_read, read-only FIFO FD, single parent writer, owned PREPARED PCM with
   zero pointers). After physical `play`, actual post values must match, and
   success must follow finite feed, writer close and that same child's exit 0.
   Removing the exit-status dependency must make a focused shell test fail.
3. **P3 — no old playback.** Authenticated prepared snapshot bytes contain the
   exact stereo/48-kHz parameters, no pending playback transfers/bytes/release,
   TX-index-2 kick, reset, scheduled or queued playback XRUN. Two fresh locked,
   suspended, zero-PCM observations precede the delayed gesture. Novel attack:
   256 valid capture events may pass, 257 must fail, and a playback event in the
   last slot of an otherwise valid rehashed mixed/reordered envelope must fail.
   Removing the playback-event rejection must break the regression.
4. **P4 — original timing and guest activity.** Restore's original T0 is retained;
   physical `play` uses 5-ms edges after the delayed gesture, with actual visible
   typed text, cursor/focus, positive fresh non-silent PCM and successful guest
   completion before frozen end. All-success end minus T0 must be <=2000 ms for
   F acceptance. Pre-executing a player does not waive any of these observations;
   first PCM or a host-only keyboard ledger cannot replace guest completion.
5. **P5 — composed restore.** Normal and moving first-present CRCs match their
   own saved buffers, receipts admit the saved generations, fresh HELLO occurs
   without boot/reprobe, all drag-phase saves are recorded, and post-second-restore
   move-only guest cursor acknowledgment plus stationary-window samples prove
   no stuck guest button. Prior unchanged functional predicates remain HELD;
   the new fixture must still complete the composed run.
6. **P6 — isolation and refusal.** Omission leaves the legacy command unchanged;
   resident opt-in refuses every runtime/profiler/command/pacing override, binds
   helper/image/seal/screenshot bytes, and refuses occupied output. Bad identity,
   queued audio, failed feed or failed child cannot print success. Default
   acceptance remains fail-fast; diagnostic create/reuse is never acceptance.

Coverage plan: inspect all changed source/test hunks; mechanically authenticate
build artifacts and scoped worker log; run only three new resident Node modules,
one bounded novel parser attack and isolated guard sabotages. No native/J/held
runtime gates or browser boot. Defer the single pristine affected-harness clone
until final exact-head acceptance is established; do not cold-clone iterations.
Carry H/T19a/I/J and prior F functionality without resampling. The known unrelated
dirty dist manifests and E6/rootfs files are excluded and will not be touched.
