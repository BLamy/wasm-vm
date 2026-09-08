# Resident COMPLETE — functional HELD, timing FAILED

Execution source `7da050620031145b6e76cf150a894ed2710bd5b2`; closed records
committed in `33a65efb90d1656be45931ea5aacb9b670c0c35f`. This is a bounded
incremental critic result, **not F verification or an acceptance run**.
The active `resident-profile-33a65efb` record was not opened or polled.

## Prediction dispositions

- **P1 build/provenance — HELD.** Carry the independently authenticated A/B
  images, installed helper, chunk reassembly and cold profile/runtime/snapshot
  bindings from `results.md`, `build-audit.json` and `cold-results.md`.
  The closed reuse has the identical cold binding, prepared sound proof and
  profile digest. No runtime/helper/image/default change is inferred from the
  later evidence-and-profiler-admission commit.
- **P2 same actual child and successful playback — HELD.** Both independently
  viewed timing/final PNGs show physically typed `play`, post PID 999/starttime
  27744, executable inode match, `pipe_read`, read-only FIFO FD3 flags 0100000,
  parent FD3 flags 0100002, PCM FD4 owner999 PREPARED with hw/app pointers zero.
  These match the cold pre-observations. Green aplay follows, then the original
  background job's `Done` notification and shell prompt. The held source guards
  and effective child-exit sabotage establish that green depends on feeding
  finite PCM, closing the writer and waiting for that same child to exit zero;
  the job notification alone is not the exit-status oracle.
- **P3 no old playback / fresh output — HELD.** Canonical JSON
  `milestones.residentBeforeGesture` (line 277) contains two locked/suspended
  zero-ring observations at T0+281.455 and T0+649.945 ms. The delayed gesture
  precedes physical input. `postRestoreAplay` (line 351) records ten matching
  physical DOM/guest transitions, no red marker, and 8420 changed guest pixels.
  Immediate completion PCM (line 370) has 1440 new frames, all non-silent,
  maxAbs 0.999969482421875, attached running output and advancing rendered frames.
  This is not a claim of a bit-exact 1440-frame native payload or zero XRUNs.
  The first-playback terminal still visibly retains its recovered 0.324-ms
  underrun; no new underrun is displayed in the resident post block.
- **P4 original all-success deadline — FAILED.** Canonical lines 276/409 and
  `deferredInteractionCap` at line 426 agree: T0 **1215.4900000095367**, end
  **5947.375**, difference **4731.884999990463 ms**, exceeding **2000 ms**.
  The later interaction telemetry is 4732.264999985695 ms and is not the cap.
  PCM is sampled at T0+4686.005 ms; this record does **not** establish its first
  arrival time or divide elapsed time among proc checks, metadata rendering,
  aplay and scheduling. The earlier approximately 4.47-s update is superseded
  by this exact canonical measurement. No dominant-cost or speedup claim follows.
- **P5 full composed functional sequence — HELD.** Both saved/first-present
  CRCs agree: normal `940993e9`, moving `27b1022b`. Both actual admission receipts
  report `resume`/626, negotiate fresh HELLO generation 2 and contain no `booting`
  state. All four drag-phase saves are retained. Actual window left changes
  557→637 (+80 px), with the bounded panel clamp 13→32; paused publication and
  before-reload audits stay generation626. After second restore, move-only
  tablet frame0→1 maps to guest669/55 and 94 cursor pixels acknowledge it.
  All seven finite, nonregressing samples have empty held buttons and identical
  titlebar637..1280 / 32..58, including **1016.740 ms after guest acknowledgment**
  (`dragGuestRelease`, line 719). This is actual guest no-stuck evidence, not
  inference from the host button ledger alone.
- **P6 honest diagnostic isolation — HELD for this unprofiled record.**
  `acceptance:false`, `functionalChecksPassed:true`, `timingPassed:false`,
  `checksPassed:false`; CPU/LATENCY are both false. The transcript rethrows the
  original cap assertion after functional evidence, without converting it to
  acceptance. Filtered browser/HTTP errors are empty. The two generic console
  404s correspond exactly to `/favicon.ico` in the retained server log.

The subsequent 33a65efb diff permits only exact CPU/LATENCY=1 diagnostic reuse,
with COMPLETE absent; cold and normal acceptance remain refused. Source review
finds no effect on this already-recorded unprofiled run, T0, deadline, helper or
runtime bytes. The earlier blanket prohibition in P6 of `results.md` describes
7da05062, not this new observer-only exception. No profiling result or fresh
test/gate claim is added here.

## Evidence and next boundary

`audit-reuse.mjs` independently recalculates the interval and validates the
recorded bindings, scalar state, CRCs, receipt generations, real motion and all
stationary samples. `reuse-audit.json` retains exact values and hashes of all six
canonical completion/timing artifacts, the transcript and record index.
The two PNGs were viewed directly, not inferred from their names or summaries.

Canonical artifact SHA-256:

- `resident-reuse-7da05062/diagnostic-completion.json`:
  `8178ca2126a17ecbc1360b5c7adf3acd30c635558150d57b9283dfd1691f2e4a`.
- `resident-reuse-7da05062/diagnostic-completion-timing.png`:
  `d4537508f5cb7f9be48b0819bf90eea066d5bf4a699d670fcdf004554cec8bd6`.
- `resident-reuse-7da05062/diagnostic-completion.png`:
  `fb60ef4f294157cbfeeda146893507bbb7ba4e2c59a7393504b3ef84c55cdb88`.

Remaining F requirement: all required successful interactions within the original
two-second interval, followed by full normal acceptance at a final frozen head.
Retain this negative result and localize cost before choosing a change. No
additional acceptance cold boot, clean clone, native/J gate or status change is
justified by this failed timing diagnostic. H/T19a/I/J and unchanged prior F
results carry HELD. Only critic evidence was written; no commit or task edit.
