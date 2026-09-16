# E5.5-T03af independent verifier predictions

Written before examining the T03af recording. The task is a medium-risk, one-batch
diagnostic. A valid negative diagnostic does not demonstrate responsiveness and
does not make T03q eligible. No guest/browser launches are part of this review.

## Predictions

- **P1 — exact provenance and fixed boundary.** At recording start, the receipt
  will identify the frozen source head and the unchanged R3 snapshot/backing pair
  and runtime artifacts. Original 1280×800 dimensions, cache cap 256 and recycling
  OFF will be present in the actual run state. No alternate mode, renderer,
  persistence, runtime or cache candidate will appear. The task diff will contain
  no changes to `crates/` or `web/`; prior unchanged runtime/cold-clone evidence is
  carried forward only after confirming that identity.
- **P2 — configuration really executes.** The actual serial outbound wire will
  contain exactly the fixed Foot configuration/readback batch and no alternate
  attempts. The returned active-window property values, parsed from the guest
  response independently of the sent command, will establish full opacity,
  opaque and force_rgbx before typing can count as a successful configured trial.
  Echoes, missing properties, duplicate/ambiguous records and forged values must
  not satisfy the property gate.
- **P3 — trusted physical input.** After successful startup/configuration, the
  captured browser keyboard events will form the exact trusted physical sequence
  for the command under test, with ordered acknowledgments. Its random nonce and
  filename will be independent. No serial command will create the nonce or type
  the shell command; serial writes are restricted to the fixed configuration,
  allowed layer queries and independent nonce readback.
- **P4 — fixed timing is authoritative.** Startup including configuration and
  property readback will finish within 300 seconds, physical typing within 60
  seconds, and independent nonce readback within 120 seconds measured from Enter.
  Image capture is bounded by 20 seconds and owned cleanup by 30 seconds. A late
  response, partial capture or stage timeout remains a negative diagnostic even
  if output or counters later become available.
- **P5 — actual visible response.** A responsive result requires both the real
  nonce readback and actual initial/final image evidence showing the entered
  command and a prompt after execution. Frame-generation counters alone cannot
  establish visible progress. Personally inspecting the images must confirm the
  claim; a frozen, black or unchanged frame is not responsiveness.
- **P6 — owned lifecycle and honest disposition.** The receipt will document one
  fresh owned browser, observed runtime/page errors, and bounded cleanup of that
  browser and any recorder-owned server. A failed stage is explicitly recorded
  with its timing and reason. No negative diagnostic is represented as a
  responsive pass, release eligibility, deployed capability or publish action.
- **P7 — changed-hunk sufficiency.** Every changed executable hunk will have a
  deterministic unit-test or recorded-run citation exercising it. Types,
  declarative configuration, task bookkeeping and logging-only hunks may receive
  an explicit waiver. Unexercised acceptance behavior remains NEEDS EVIDENCE.

## Bounded novel attack (predicted before execution)

Create an offline forged-property or late-readback fixture against the exported
acceptance helper used by the actual runner. Preserve the apparent successful
outer receipt but substitute a false/missing guest property or a nonce readback
after the Enter-relative 120-second deadline. The helper must reject the forged
candidate. This attack must not launch a browser/guest or modify implementation
code. Record the exact fixture, command, observed result and artifact digests.

## Verdict discipline

Each prediction will be recorded as HELD, FAILED or NEEDS EVIDENCE with file/line
and digest citations. Product responsiveness is judged separately from the
integrity of a negative diagnostic. No result is assumed before the worker
supplies the final source head, evidence paths and claim.
