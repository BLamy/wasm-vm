# LP0 attempt: unproven, not a desktop fix

The fresh native attempt exited 1 after the 300-second observation timeout on
`capture_52` (Hyprland layers), before the separately declared 90-minute startup
budget. `native-capture.log:1007` contains BEGIN, but no END; line 1008 records
the host timeout. The previous clients probe completed with guest status 6.
The last completed instances probe identifies Hyprland PID 407. Foot PID 490
and Quickshell PID 495 had started, but a mapped desktop was never proven.

There is no LP0 RAM/disk pair, built physical-input run, or screenshot. This
cannot establish a crash, renderer incompatibility, an input-performance
result, or the need for a new GPU architecture. The old baseline remains HELD;
its full report digest is bound in `baseline.json`, not rewritten with new
observer fields.

`native-result.json` indexes the raw logs. The launch is recorded in `launch.log`;
`runtime-identities.json` binds the executable/kernel/WASM and the actual
frozen native/built/preparation scripts. The source image is unchanged; only
the prepared copy's two LP setting bytes differ. The disposable working image
was retained by the existing diagnostic cleanup policy in the local temporary
directory `omarchy-snapshot.Enr1He`. The native VM process has exited.

## Evidence gate development

The new `omarchy-thread-{measurement,wire,pair,runtime}` helpers are **not a
verified acceptance submission**. Focused tests check the real preparation
receipt and frozen LP1 report, reject this actual incomplete native run, and
exercise synthetic protocol/header cases. No synthetic fixture is guest or
desktop evidence. The positive native/pair/built sealing path has not been
exercised end to end and must not be marked verified from those unit tests.

Commands:

```sh
node --test tools/verify/omarchy-thread-measurement.test.mjs tools/verify/omarchy-thread-wire.test.mjs tools/verify/omarchy-thread-runtime.test.mjs tools/verify/omarchy-thread-pair.test.mjs
# After a future complete bound pair + actual built run ONLY:
node tools/verify/omarchy-thread-measurement.mjs seal evidence/omarchy-profile/thread-r1 NEW_OUTPUT_DIR
node tools/verify/omarchy-thread-measurement.mjs verify NEW_OUTPUT_DIR/seal.json
```

The actual built harness remains frozen at `91a45c23`; its pass-through observer
has a real Chromium smoke test in `observer-tests-91a45c23.log`. That smoke test
does not boot Omarchy. The last actual built-desktop screenshot inspected is
`../softpipe-r1/baseline-built-r2/failure.png`: visible desktop bar and Foot,
without the command appearing after the physical input test. It is **LP1
baseline evidence**, not an LP0 screenshot.

## Remaining work / review access

The latest Daybreak Blue critic request failed with HTTP 401 (“not authorized
to access this model”). No fresh verdict was issued on these gate changes or
this inconclusive run. T03g stays in progress; no production files, R2 objects,
PRs, or Epic 6 work were changed in this continuation.

Before another run, resolve the observation strategy: the native helper's
five-minute individual probe timer can terminate a startup before the stated
outer budget. Any revised helper must get a new frozen identity and preserve
the 90-minute outer limit and separate 120-second physical-input limit. An
actual built-browser cold-start alternative also needs its exact recording
plan and artifact bindings established first. Do not reuse this timeout as a
negative compatibility result, extend input acceptance, or publish LP0.
