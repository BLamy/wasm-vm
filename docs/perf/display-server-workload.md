# Display-server workload contract (E5-T16a)

E5-T16a freezes the workload that the two T16 finalists must run inside the riscv64 emulator.
It is a capture contract, not a finalist measurement and does not treat a host-native run as a
substitute for guest evidence.

The plan is available with:

```text
node tools/display-server-workload.mjs plan
```

The phases are fixed and ordered:

1. `cold-start` — boot the supplied scratch image and wait for the candidate to report ready.
2. `idle` — leave the desktop untouched for 1,000 ms (900 ms is the accepted timing floor).
3. `open-terminal` — open the candidate's configured terminal window.
4. `type-100` — type the exact 100-character string in the plan.
5. `drag-300` — drag the terminal window 300 px on the x axis in 30 steps.
6. `close` — close the terminal and prove that its process exits.

Each phase returns cumulative `{ wallMs, guestInstructions, uploadedBytes, idleWakeups }`
start/end points and a positive `peakRssBytes`. The harness computes deltas, idle wakeups/s, total
guest instructions, total upload bytes, and typing upload bytes itself. The driver must also return
the phase markers in order and its cursorq event count; missing or failed observations are errors,
not zero-valued measurements. The capture carries an exact source contract: E4 `minstret`, T09
`vm.stats.gpu.bytesUploaded`, guest `/proc` `VmHWM`, guest `/proc/interrupts` idle deltas, and the
guest virtio-gpu cursorq trace. This prevents a host-side substitute from passing the schema.

## Driver protocol

The harness invokes a driver without a shell:

```text
node tools/display-server-workload.mjs run \
  --image /path/to/scratch-riscv64.img \
  --output evidence/e5-t16b/labwc.json \
  -- node tools/run-display-server-driver.mjs
```

The driver receives the canonical plan as one JSON document on stdin and receives these environment
variables:

- `E5_T16A_SCHEMA`
- `E5_T16A_PLAN_SHA256`
- `E5_T16A_IMAGE`

It must execute the plan against the emulator and write exactly one complete
`wasm-vm.e5-t16a.display-server-workload.v1` document to stdout. Diagnostics belong on stderr.
The harness computes the supplied image's SHA-256 and replaces any driver-provided digest, so the
driver cannot self-report a convenient image identity. The JSON shape is also checked in as
[`tools/display-server-workload.schema.json`](../../tools/display-server-workload.schema.json).
Drivers are bounded to 15 minutes by default; a timeout, non-zero exit, extra stdout, missing
marker, or counter/source failure is a typed harness error.

The contract self-test is the deterministic acceptance gate for this slice:

```text
make verify-E5-T16a
```

It validates a complete fixture, proves normalization is byte-stable, and mutates the marker,
counter, typing, idle-exit, and phase-outcome paths to ensure each failure is surfaced. The fixture
numbers are contract test data only; E5-T16b and E5-T16c provide the real finalist captures.
