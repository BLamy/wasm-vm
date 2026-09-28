# AS: physical input repaired; visible desktop response remains failed

Initial recorder3d9520ba; final recorderab7bc0bc. Both use unchanged AO WASM
36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916 and AR's exact
prepared RAM265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8
plus delta1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c.
Each full source head, kernel/chunk identity and served byte digest is recorded.
No syscall tracer, CPU profiler or guest observer is enabled.

With DEVELOPER_DIR=/Library/Developer/CommandLineTools and Node24 on PATH:

```
make verify-E5_5-T03as INPUT_KERNEL_RESPONSE_OUT=evidence/omarchy-profile/input-kernel-response-r1 INPUT_KERNEL_PREPARED_PAIR=target/omarchy-input-kernel-prepared-pair-r1
make verify-E5_5-T03as INPUT_KERNEL_RESPONSE_OUT=evidence/omarchy-profile/input-kernel-response-r2 INPUT_KERNEL_PREPARED_PAIR=target/omarchy-input-kernel-prepared-pair-r1
```

Both actual runs confirm loaded AQ kernel notes before the read-only saved
property batch, exact Foot473/address0x55558518d650, original1280x800 geometry,
AO recycling enabled/cap256/ICount64, and fixed300/60/120/20/30-second budgets.
Each128 trusted physical event sequence matches128 keyboard calls plus128 sync
acknowledgments. The nonce never appears in serial input, and its lookup filename
is independently random. R1 completes26 reads and r2 completes27, no pending
reads; each has one exact timely nonce response. Zero unexpected browser errors
and normal owned browser closure in both runs.

| Run | Enter to exact nonce acknowledgment | Presentation | Personally inspected image |
|---|---:|---|---|
| r1 |84.792s|3→4 from pre-input baseline|Old empty prompt; visible response failed|
| r2 |89.104s|4→5 AFTER nonce; captured15.671s later|Same old empty prompt; visible response failed|

R2 raw report SHA97252137eed0cc5a4eae2e477e733a5d3f42dd0ad3e911358d8afd6b51afb174.
Both actual desktop-keyboard.png files have
SHA431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24.
I viewed both real final screenshots and their prepared-direct.png baselines.
Neither final screenshot contains the typed command or returned prompt.
R2's new frame damages the terminal rectangle10,36,1260,754 within the actual
1280x800 viewport/resource1280x832; this is a real later frame with stale visible
content. Frame counts do not override the personal image finding.

The corrected recorder starts its freshness baseline after the nonce and binds
capture timestamps to the original20-second budget. It reserves2 seconds inside
that budget for a failure screenshot; it does not extend the clock.38 affected
tests pass, including existing AJ defaults, exact AR source/Foot controls,
wrong kernel before keys, wrong nonce, late readback and stale presentation.
The preserved initial test failure was an assertion inserted into the AJ fixture
instead of the new AR fixture; corrected before the r2 browser run.

Task AS submits its explicitly permitted negative-measurement branch, with
desktopAcceptance=false. Physical retention/execution now holds. Q remains
gated on visible response. Successor AT addresses a concrete source-offset
mismatch found in the existing GPU copy path against Linux6.6.63 and QEMU9.2.0;
it must prove its pixel semantics and then the real original-deadline response.
