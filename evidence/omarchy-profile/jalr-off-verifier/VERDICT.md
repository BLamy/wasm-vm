VERDICT: verified

# E5.5-T03az — verified negative JALR-off trial

Disabling dynamic JALR chaining selected the intended runtime path, but the
bounded physical trial still failed visible responsiveness. The actual PNG
shows the empty prompt. **Desktop responsiveness remains unsolved; T03q is not
promoted.** This verdict verifies the negative experiment only.

Implementation: `5fe078326662f22ece9451123cb54387b1ff2b05`.
Worker submission: `901f917e28f08420e7d1a2359100dab8a2a252fa`.
The latter changes only task/queue metadata. Predictions were written before
opening AZ runtime/image evidence. I did not implement or edit runtime code.

## Predictions and observations

- **P1 settings — HELD.** After normalizing only the ephemeral localhost origin,
  the complete URL differs from AX by exactly `jalr=0`. Both actual runtime
  samples report dynamic chaining false, region chaining true, cap-1024/cap
  1024, recycling enabled, 16384 decoded entries, icount divider 64 and quantum
  500000. Admission/timing probes stay off and presentation remains 1280×800.
  Dynamic-link attempts and hits are zero. Citations: worker
  `desktop/report.json:126`, `:1393`, `:26047`; verifier `audit.json` `actualRuntime`.
- **P2 identity — HELD.** Independently hashed all 47 helpers, 96 served rows /
  73 distinct resources / 67 Git-backed dist resources and actual AR RAM/delta,
  AQ kernel and R3 chunk manifest. Every predicted identity matches. AT WASM
  remains 1602266 bytes, SHA-256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`;
  both AT core files also match the held runtime. See `audit.json` `provenance`,
  `sources`, `resources` and its ten-file worker evidence seal.
- **P3 physical provenance — HELD.** The 128 trusted key events reconstruct
  `printf '7dd0ac2ffe349859' > /tmp/desktop-keys-876f07ecae836bde`.
  All 256 ordered keyboard/sync acknowledgements are true. Raw successful
  fence `mu4xvow229` closes at `2026-09-17T02:57:33.464Z`, traffic index 1230,
  **76.840s after Enter**; recorder acknowledgement follows at 76.843s.
  The nonce is absent from serial input, whose file check is read-only.
  There is one worker and no post-Enter physical input, agent-input route,
  diagnostic continuation or extra readiness/profiling path.
  Raw point: `report.json:25252`; reconstruction: `audit.json` `physical`.
- **P4 bounds/default — HELD.** Startup 44.240s, typing 2.665s, readback
  76.843s, image 15.034s after nonce and cleanup 0.195s all fit the unchanged
  300/60/120/20/30-second budgets. The original AX report still passes the
  current auditor and its generated options/URL retain the dynamic-on default.
  Sources: `report.json:26435`, `:26933`, `:26956`; `audit.json` `timing`.
- **P5 visual failure — HELD.** I personally inspected
  `desktop/desktop-keyboard.png`: it contains the old empty shell prompt,
  without the typed command or returned prompt. Capture time is
  `2026-09-17T02:57:48.501Z`, **91.877s after Enter**. Its 10908 bytes are
  identical to AX's stale baseline, SHA-256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  Frames advancing from 4 to 5 after nonce cannot turn this into visual success.
  `machineAcceptance:true`, `desktopAcceptance:false` and mandatory visual
  inspection remain explicit in the receipt.
- **P6 attacks — HELD.** Seventeen bounded cases reject. The independent full
  URL gate rejects `jalr=1` and `region=0`. The shared machine auditor rejects
  restored dynamic chaining, disabled region chaining, cache/cap/recycling/
  divider drift, untrusted keys, forged nonce metadata or raw reply, late nonce,
  late screenshot, and an unexpected diagnostic route. The independent image
  gate rejects promoting machine success with the same stale PNG; the shared
  auditor deliberately requires separate image inspection. Exact exceptions
  are recorded in `audit.json` `attacks`. All **56 focused tests pass**, with
  no skips (`focused-tests-localhost.log:57`).
- **P7 scope — HELD.** The experiment is negative. No runtime build, cold clone,
  additional browser boot, deployment or Q promotion is needed or claimed for
  this medium-risk harness-only change. AT/AR/AX boundaries carry forward.

## Changed-hunk coverage

| File | Evidence / disposition |
| --- | --- |
| omarchy-input-trial.mjs | Actual candidate options, URL and both runtime samples execute the new experiment, cache, dynamic-off/region-on guards. Dynamic/region/URL/cache/cap attacks reject; existing AX/default tests pass. |
| omarchy-input-trial.test.mjs | New candidate-only/URL-delta/runtime-negative assertions execute in the 56-test gate. Permanent test retained. |
| omarchy-desktop-live.mjs | Frozen physical run exercises all three added candidate/isolation membership branches; existing prepared-route fixtures pass. |
| omarchy-input-audit.mjs | Actual explicit experiment audit plus fourteen rejected machine-evidence mutations exercise the new allowed value. |
| omarchy-input-kernel-response.mjs | Frozen actual flag selection, experiment/environment and receipt bind the new route. Default expressions are preserved; AX's original report/options still pass. |

All changed behavior is exercised. Help text and task/config bookkeeping are
waived as declarative. No unproven implementation hunk remains.

## Limits and reproduction

The final sample records 6,504,369,872 guest retirements, 10,175,549 decoded
builds, 6,630 evictions, 26,445 retranslations and 14,665 compile-queue drops.
Dynamic-link attempts/hits are zero, but installs still reach 15,037,005;
this trial does not prove that every dynamic-link maintenance cost vanished.
Counters remain diagnostic and cannot override the stale image. No claim is
made about whether this particular run would have rendered later.

Report: 649875 bytes, SHA-256
`4abcfd8abd5537cff214089b77e6bbe81932987edc4d6315f0bea2e7f5b2c2a4`.
Receipt: 20262 bytes, SHA-256
`6fc27ec7b9e8c066f3d3efc9264326ae673939e7fe9382f3dc8dd8e6a0947531`.
SUITE: retain the permanent JALR-off test and independent `audit.mjs` forgery
corpus. No acceptance budget or runtime implementation was changed.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node evidence/omarchy-profile/jalr-off-verifier/audit.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node --test tools/verify/omarchy-input-trial.test.mjs tools/verify/omarchy-input-kernel-response.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-desktop-live.test.mjs tools/verify/omarchy-owned-trial.test.mjs
```
