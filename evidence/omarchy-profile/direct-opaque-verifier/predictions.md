# E5.5-T03ai independent predictions

Written before implementation or trial evidence inspection on 2026-09-16.
Task activation: `2625b175`; task base: `028a5540`.

The claim under test is one direct-property physical-input diagnostic from
the pinned R3 guest at its original presentation, with no runtime change.
Synthetic checks establish harness behavior only. A negative guest result
does not establish desktop responsiveness and cannot admit T03q.

## Predictions

- **P1 — bounded guest operation.** The trial emits exactly one fixed
  pre-input configuration batch. It writes the eight stated properties,
  then reads all eight values and the active window in that batch. The
  command contains neither `-r` nor an evaluation/rule/monitor reload.
  The pinned Hyprland dispatcher source implements these direct property
  writes synchronously. Every other guest serial command belongs to the
  existing startup inspection or independent post-Enter nonce read.
- **P2 — complete property receipt.** A configuration receipt becomes
  successful only after the actual matching raw serial response completes
  within the original startup deadline, has exit status zero, contains all
  eight successful write acknowledgments, all eight expected true/unit
  values, and one well-formed mapped, non-hidden active Foot window.
  Missing, reordered, duplicate, malformed, error, or partial output is
  rejected even if the shell reports exit zero. The independently parsed
  raw response agrees with the worker's recorded receipt.
- **P3 — failure cannot become input success.** If configuration or active
  Foot validation fails or times out, no trusted typing sequence follows.
  In all cases, report success/verification flags require the complete
  physical sequence and independent timely nonce. A bounded synthetic
  partial-property/false-success attack must be rejected; a fully valid
  synthetic control may establish only parser/auditor correctness.
- **P4 — unchanged source and runtime.** Frozen source closure, actually
  served resource hashes, R3 snapshot/delta/kernel/chunk hashes, WASM hash,
  and runtime options match the exact recorded head and fixed prior pins.
  Runtime remains cap256, recycling OFF, ICount64, original 1280×800
  presentation (1280×832 actual resource, original display rectangle).
  Changed harness hunks have direct evidence or a justified waiver;
  unchanged runtime/fence/input-audit/cold/deploy proof is carried by
  byte/source identity, not replayed as a new desktop claim.
- **P5 — original time budgets.** Startup remains 300 seconds, typing 60
  seconds, independent readback 120 seconds after the recorded Enter,
  capture 20 seconds, and cleanup 30 seconds. No property delay rebases
  startup. No late nonce or extended screenshot time repairs a failed
  response. Input fencing after Enter occurs inside the readback window.
- **P6 — physical path.** Any positive run has trusted focused-canvas DOM
  key events for the complete command, the expected ordered key down/up
  and modifier sequence, one corresponding ordered keyboard/sync worker
  transaction per DOM event, unique positive matching acknowledgments,
  and zero dropped/rejected input. The serial channel never writes the
  nonce or executes the typed command.
- **P7 — guest effect and display.** A positive run's independently chosen
  nonce is returned by the actual raw guest read response no later than
  Enter plus 120 seconds. Presentation counters advance after typing.
  Personal inspection of the final screenshot shows the actual typed
  terminal command and a returned prompt, with the original presentation
  intact. A stale prompt, opaque rectangle, or successful synthetic image
  cannot substitute for this evidence.
- **P8 — owned cleanup and honest outcome.** All owned guest/browser
  processes terminate within the cleanup allowance, with process/log
  evidence and no hidden watchdog success. Any observed failure remains
  negative in the trial outcome and task claim, leaving release ineligible.

## Planned bounded attack and coverage

Before the guest result, run one small matrix against the changed parser:
valid full response as control, then one missing/misordered property or
false-success receipt while retaining shell exit zero. Record exact inputs,
outputs, source hashes, and the rejection points. Inspect every changed
hunk; use affected deterministic tests for harness success/failure paths
that the single real run cannot execute. Do not start a second guest,
browser, or broad build. Full actual input and screenshot claims remain
conditional on the single frozen guest recording.
