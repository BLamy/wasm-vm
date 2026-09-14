# Direct user-path input attempt — negative

Frozen recorder: `81cab94ea874e2f177d1005887e2adf2435e3777`.
Runtime/dist remains T03l's `ed550aa8`; WASM SHA-256
`9405d6c38be9a170ef5a2e5e0bacdcbec6deace7de48c8e002bc3caea76dfb2b`.

Command (one actual attempt):

```
node tools/verify/omarchy-desktop-services.mjs evidence/omarchy-profile/user-path-input-r1
```

The actual page emitted desktop-ready at211.499 seconds. After the recorder's
readiness poll/capture, physical typing began at231.458 seconds (19.959 seconds
after that event), within the unchanged300-second startup limit. No recorder
`clients` or `activewindow` command preceded it. The only guest command before
typing was the application's real `hyprctl layers` readiness query, plus its
bootstrap carriage return.

The128 trusted DOM key transitions represent the complete nonce-writing command
and Enter, including Shift for `>`. They yielded128 `sendKeyboardEvent` and128
`syncKeyboard` calls. Typing took3.537 seconds. RPC acknowledgements alone do not
establish guest consumption: these wrappers return success when the call does
not throw, even though the core's injection result is not returned to JavaScript.

Before input and at the final failure, actual keyboard queue observations show
budget256 (the restored image's value), pending events/frames0, dropped
events/frames0, and rejected events0. Fresh-device source defaults must not
replace the actual restored budget. This rules out observed host queue loss;
it does not prove Linux or the compositor consumed and acted on the keys.

Independent readback returned file-missing exit75 seven times. An eighth request
had not completed by Enter+120 seconds. The recorder failed at09:23:38.834UTC,
two milliseconds after that deadline. The nonce contents were never sent over
serial input. Parent and recorder exited1; owned cleanup closed normally without
watchdog intervention.

Coordinator personally inspected `desktop/desktop.png` and
`desktop/failure.png`: both show the same real bar and Foot prompt, with no typed
command or application response. Received/presented frame counts remain2→2,
with no host presentation backlog. The VM retired657,973,737 additional guest
instructions between the two runtime observations, and reported no fetch waits.
Neither instruction progress nor a rendered restored desktop is usability proof.

Conclusion: the corrected harness reaches the physical-input path and retains
an actual failure. Omitting recorder-only probes does not fix responsiveness.
Guest driver/interrupt handling, compositor input handling and rendering remain
distinct possibilities; this recording alone does not identify their cause.
No runtime, image, R2 or production change is justified by this negative result.
T03d remains unresolved. Fresh Daybreak review is required for the harness claim.
