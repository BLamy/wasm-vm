# Prepared real-player browser experiment

Frozen source: `7da050620031145b6e76cf150a894ed2710bd5b2`.
These are diagnostic records, not acceptance. F's 2000-ms limit remains unmet.

## Cold preparation

`resident-cold-7da05062.log` begins with the exact command and scrubbed F environment;
the runner exited 0 after sealing the paused checkpoint. The retained profile is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-resident-FUBCo4`,
origin `http://127.0.0.1:61631`. Never overwrite it or the recorded evidence names.
For reproduction choose new empty profile/output paths and a free stable port.

The image and chunks are reproduced by the commands in `resident-image/README.md`,
then `python3 tools/chunk_image.py split IMAGE --out FRESH_CHUNKS` and
`python3 tools/chunk_image.py verify FRESH_CHUNKS/manifest.json --image IMAGE`.

- Image: `27c2e8f2789b18efac214837c295dbfb22559beea350fb5788f71edfdc0f0a8e`.
- Manifest: `2245a4d8b8b804bb200079c1ce00dee868762324f18627fa5d2b11fe032639ef`.
- Runtime binding: `42aced7a2dfc4d0a69e1ea5a15685f5d9a605f797f8df1c5db89f95051ba0425`.
- Snapshot: `b2e057ccf0150eb892ed4ae53c0642e5757d8d52293306776d52dd4bf94b86b9`,
  2818926 bytes, CRC `940993e9`, generation 626.
- Closed profile: `59f3f2483c95331fad64c5cf6014a60f42b3b9fb89a50ec7b2d1c8853d9c70b5`.

`resident-cold-7da05062/diagnostic-checkpoint.json` retains actual observations.
The independently viewed `resident-prepared.png` shows matching pre-1/pre-2 values:
PID 999, starttime 27744, executable inode matching `/usr/bin/aplay`, `pipe_read`,
child FIFO FD3 read-only (0100000), parent FIFO FD3 read/write (0100002), no child
writer, PCM FD4 owned by PID999, PREPARED with hw_ptr/appl_ptr both zero.
The authenticated sound section independently reports Prepared, stereo S16/48kHz,
3840-byte buffer, 1920-byte period, zero pending transfers/bytes/events/kicks.
The first, already completed playback remains a separate window: 1440 PCM frames,
960 non-silent, attached host output. Its screenshot retains a recovered 0.324-ms
ALSA underrun; this is not a zero-underrun claim.

## Negative timed reuse and complete functional diagnostic

`resident-reuse-7da05062.log` begins with the exact reuse invocation (COMPLETE=1,
same fixture and runtime, no profiler/tuning flags). It exits 1 at the original cap.
`resident-reuse-7da05062/diagnostic-completion.json` SHA256:
`8178ca2126a17ecbc1360b5c7adf3acd30c635558150d57b9283dfd1691f2e4a`.

Actual T0 `1215.4900000095367`, end `5947.375`: **4731.884999990463 ms**.
The two post-restore pre-gesture samples have locked/suspended audio and exactly
zero ring indices, fill and non-silent frames. Actual physical `play` has ten
matching DOM/guest transitions. The independently viewed completion PNG shows
the same PID/starttime/FIFO/PCM values after restore, followed by the conditional
green completion and the shell's notification that the original child exited.
Fresh attached audio produced 1440 non-silent frames, maximum amplitude 0.99996948.

Both CRC-matching restores, actual window displacement and the guest no-stuck
hover proof complete; browser/HTTP error arrays are empty. The timing failure
is retained and rethrown, not converted to acceptance by later successful checks.
This does not establish a material speedup over the older process-launch fixture.

Next: one explicitly nonacceptance, read-only latency/CPU diagnostic of the same
sealed image. No new image, cold boot, clock policy, guest helper or cap change
is justified before that localization. Profiling remains forbidden in normal
acceptance, cold preparation and COMPLETE functional records.
