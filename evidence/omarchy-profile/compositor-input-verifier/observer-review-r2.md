# AP observer review R2 — signal correction held

Carry the byte-capture, identity and demonstrated detach results from R1.
The original failed group-stop recording remains unchanged.

## P10 correction — HELD for bounded attacks

Fixed ARM64 observer SHA256:
`73eaacf5195789bf45bf9ed61a21088acf03d94fee3b2603c1b72bbe7262e525`.

- `group-stop-fixed-r1`: rerunning the same independent driver produces zero
  target iterations during the 350 ms stopped window. The observer reports
  `external-group-stop`, exits 1, and leaves the target in `T (stopped)` with
  TracerPid 0. Only after the driver sends SIGCONT does the target make two
  further recorded iterations. The result is limited coverage with clean
  detach, not a falsely successful observation.
- `group-stop-multithread-fixed-r1`: the three-thread variant records the
  external group-stop for TIDs 7/9/10, then detaches all three. Independent
  `/proc` samples show all three in T with TracerPid 0 before SIGCONT and S
  with TracerPid 0 afterward. Zero progress occurs in the stopped window;
  nine iterations follow SIGCONT. This exercises cleanup continuing after
  more than one stopped-thread error.
- Source review confirms the initial restart now passes each TID's recorded
  `pending_signal`. That direct control-flow correction is carried by review;
  the initial signal/interrupt race itself has not been dynamically reproduced.

## New-thread coverage fixture, written before its result

`clone-fixture.c` SHA256:
`149b0231fe6f16e0789b989516dea288fad08f1d12a99ecca6f0c15f570edc22`.
It retains the original seven literal read cases and creates a third pthread
only after GO, which the runner sends after observer READY. Prediction: the
observer emits a CLONE ownership record and the new TID's 24-byte literal
read, then detaches all three TIDs. The fixture keeps the third thread alive
through READY_TO_DETACH, checks its TracerPid is zero after DONE, and emits
`clone-post-detach-progress` and `CLONE_DETACHED`. No build or result for this
variant was inspected before recording this prediction. The original fixture
SHA256 remains
`bb645c536f09d02fbb896074b88b45d0510c1a4d1afc718f8d51ac773d08721c`.

## Guest observation interval still required

The real guest result must name the observation window and stop cause. An
observer that exhausts its stop budget or receives its own alarm before the
physical deadline cannot imply no reads throughout Enter+120 s. The worker was
asked to distinguish SIGTERM, SIGALRM, stop-budget, error and target-exit causes
and bind ready/finished times, or provide equivalent evidence. No per-read host
timestamp is required. Host key acknowledgment, actual process consumption,
and uninstrumented responsiveness remain separate conclusions.
