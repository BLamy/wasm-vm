# Incremental cold-checkpoint audit — 7da05062

**Cold preparation HELD; restore/playback timing and final F acceptance remain pending.**
Only the closed `resident-cold-7da05062` record, screenshot, immutable checkpoint
and profile were inspected. The active COMPLETE reuse was not opened or polled.

The independently viewed PNG shows two actual terminals and the custom cursor.
Both readable `pre-1`/`pre-2` observations agree: PID 999, starttime 27744,
`/usr/bin/aplay` inode match, `pipe_read`, child FIFO FD 3 with flags 0100000,
parent FD 3 with flags 0100002, zero child writers, PCM FD 4 owned by PID 999,
PREPARED with hw_ptr/appl_ptr both zero. Green preparation and the shell prompt
follow. This closes the actual cold hardware/process-preparation portion of P2;
it does not yet prove that same child's post-restore completion.

The other terminal visibly retains a **0.324-ms recovered underrun** before the
initial aplay's green marker and prompt. Its record reports 1440 producer frames,
960 non-silent, maxAbs 0.082000732421875 and attached output. This is successful
initial playback, not a zero-XRUN claim.

`audit-cold.mjs` independently rehashes the 812-file closed profile and 149-file
served-runtime tree against the owner binding, then decodes the actual saved
desktop envelope from `normal-checkpoint.json`, rather than trusting the printed
sound summary. The 2,818,926-byte snapshot and authenticated sound section agree
with the record: PREPARED state 2; stereo S16/48-kHz parameters, buffer/period
3840/1920; zero pending transfers/bytes, scheduled/queued events, release/reset
and all four kicks. The recorded normal save and before-reload audit remain
paused, generation 626, decision `resume`, CRC `940993e9`.

One initial critic-script assertion incorrectly treated desktop header byte 12
as disk generation. Source inspection (`crates/core/src/lib.rs:2021`) establishes
that it is the retired-instruction boundary (9388156017). The audit correction
and initial exit 1 are explicitly retained in `cold-audit.json`; this was not a
worker finding. Generation 626 is checked in the frozen metadata/audit, not
misattributed to that desktop-header field.

Mechanically authenticated canonical artifact SHA-256:

- `resident-cold-7da05062/diagnostic-checkpoint.json`:
  `c9d5c5b19587f8f92a98257b98cfbe593a5b5235704102f677c5b49cc60e6fff`.
- `resident-cold-7da05062/resident-prepared.png`:
  `4364d8fc74137f098cc633c33bd829a011637ff130a5b2b9115d01b47eb8758f`.
- Adjacent closed transcript:
  `6334ac81c69e502697c7a185d561372d5511ef341106c73510b443874243c58e`.

`cold-audit.json` retains exact checkpoint/owner/profile/runtime/envelope/sound
digests and the direct PNG transcription. P1 and the cold portion of P3 now have
actual guest-image execution evidence in addition to their held deterministic
guards. P3's restored zero-ring observations, P4 timing and P5 new full composed
sequence still await the closed reuse record. The reported approximately 4.47-s
reuse cap miss is retained as an update, not independently measured here. No
normal acceptance cold run is warranted while that timing failure remains.

No implementation, task status, queue, browser or shared runtime changes.
