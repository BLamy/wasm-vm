---
id: E5-T37c
epic: 5
title: Paced idle — measure the devices that keep a wait from being reported, and file the fixes
priority: 0.387646
status: pending
depends_on: [E5-T37b]
estimate: S
risk: medium
capstone: false
---

## Why this exists

E5-T37a reports an idle wait only while every device says it is idle. Its verifiers found four
cases where that never or rarely happens, and E5-T37b's verifier added a fifth about what the
loader admits; none is exercised by the Replay desktop's default browser boot, and none was
measured there:

1. A network backend that does not answer `NetBackend::idle` keeps the quiescence marker unset
   for good: no wait is ever reported and the turbo loop never engages. The slirp stack is such
   a backend (`SlirpLocalBackend`, `SharedSlirpBackend`, the CLI's `SlirpBackend`), so a session
   with networking on gets no idle sleep (round-3 verifier, `r3_c4_*`: 0 of 50 calls).
2. An armed RTC alarm suppresses every wait however far away it is; its deadline is known and
   could bound the wait instead.
3. A held key stops idle jumps altogether (the guard predates the task), so a guest with a key
   held spins instead of sleeping.
4. virtio-snd playback with the idle yield on is unmeasured.
5. (E5-T37b verifier.) The loader admits the paced policy for any whole-image, non-persistent
   boot, including ones with accelerated graphics, `slirpNet` or the microphone, although only
   the Replay desktop's boot (none of the three) was measured. With accelerated graphics
   `productionGpu?.pump()` runs right after the wait is taken (`web/loader.js`) without voiding
   the ticket. No caller selects such a boot today; either refuse them at the gate or measure
   them here.

## Boundary

Measurement first, on the committed browser bundle with the paced policy on (E5-T37b): for each
of the cases, the share of wall time inside run slices and the number of idle sleeps over
30 s, against the idle desktop. Then one S task per case that is worth fixing, each with its
own boundary and acceptance. This task changes no runtime code.

## Deterministic acceptance

A table in the Verification log with the four measurements and the command for each
(`tools/perf/desktop-latency.mjs --scenarios idle` with the condition set up through the page),
and the follow-up task files it justifies.

## Verification log
