# T03m direct-user-path proof

Runtime/dist remains the independently reviewed T03l `ed550aa8`; no rebuild,
native gauntlet or repeated CLI boot is needed for recorder-only changes.
Preserve T03l's actual startup-qualification failure and all unchanged HELDs.

Freeze the two initial probe guards and source-driven recorder tests. Run
`node --test tools/verify/omarchy-user-input.test.mjs` and the affected existing
live/input/owned-recorder fixtures. Check syntax and scoped diff, then commit.

One actual command, reusing the bounded service/input runner:

```
node tools/verify/omarchy-desktop-services.mjs evidence/omarchy-profile/user-path-input-r1
```

The unchanged actual page must clear its own overlay through its real
layers-plus-pixels readiness check. Then the driver captures/clicks the visible
desktop and types; it must not insert clients/activewindow RPCs beforehand.
No builds or other guest boots overlap this attempt.

Keep300s startup,60s physical typing, Enter+120s independent nonce readback,
20s final capture and30s owned cleanup. Pin the same R3/kernel/pair and normal
non-recycling JIT/divider64/LP1. Record ready-to-first-key time from actual
page-clock events, trusted key sequence, Worker calls/acknowledgements and all
serial bytes. The nonce contents must never be in serial input.

Success requires independent nonce readback and a new presentation whose
actual PNG shows the application responding. Merely advancing a counter,
moving the cursor, changing the clock or displaying an unchanged Foot prompt
does not establish a responsive desktop. Main and the fresh Daybreak critic
inspect the actual PNGs. Preserve negative outcomes without changing timeouts
or inventing a renderer/GPU cause.

## Frozen harness gates

2026-09-14: `node --check tools/verify/omarchy-desktop-live.mjs` and scoped
`git diff --check` passed. The five recorder test files listed in `recorder.log`
passed 39/39. The first sandboxed attempt was 38/39: only the local HTTP
self-test failed `listen EPERM 127.0.0.1`; the permitted listener run passed.
No runtime change or guest boot occurred between these test attempts.

Fresh Daybreak inspected the diff and independently ran the six new focused
tests before the actual run. No material pre-run blocker: capture/verify keep
their checks, the timing metric is passive, and physical causality/visible
response remain obligations of the actual recording, not the synthetic fixtures.
