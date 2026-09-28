VERDICT: verified

# E5.5-T03aw — verified negative cap-1024 result

The existing cap-1024 policy ran correctly, but it did not produce a timely
visible terminal response. **Desktop responsiveness remains unsolved.** This
verdict verifies the bounded negative experiment, not desktop acceptance or a
general performance remedy. T03q remains gated.

Worker implementation: `96a4c890e5d01b4110f2ea65ff28f3012a93056e`.
Worker submission: `fc9f242e86a1a7f45a17612baf2a9ab52a76343d`.
The submission changes only task/queue metadata after the frozen implementation.
Predictions were written in `PREDICTIONS.md` before opening AW's runtime evidence.
All commands below ran independently; no implementation was edited.

## Prediction results

- **P1 policy/isolation — HELD.** Both actual runtime observations report
  `cap-1024`, cap 1024, recycling enabled, decoded cache 4096, icount divider 64,
  no admission/timing probe, and 1280×800 Canvas2D presentation. The normalized
  URL differs from AV's cap-256 URL only in `jitResidency`. There is one worker;
  no late/pixel observer, profiling, render-budget or compositor-mode route.
  Evidence: worker `response/desktop/report.json:136`, `:1404`, `:26098`;
  verifier `audit.json` fields `actualRuntime`, `url`, `priorUrl`.
- **P2 identity — HELD.** Independently hashed all 47 recorded helper sources,
  96 served rows /73 distinct resources /67 Git-backed dist resources, and the
  actual kernel, RAM, delta and chunk manifest. Sources match the frozen Git
  head and current disk. AT core files and WASM remain identical to AV's frozen
  runtime. WASM is 1602266 bytes, SHA-256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`.
  All four AR/AQ/R3 pins match the prior predictions exactly. See `audit.json`
  `provenance`, `sources`, `resources` and the eight-file worker evidence seal.
- **P3 physical nonce — HELD.** Independently reconstructing the 128 trusted
  DOM events yields `printf 'f8530c0500d5c5c5' > /tmp/desktop-keys-bb8b7b7f881ac8aa`.
  The128 keyboard calls and128 ordered syncs have 256 true acknowledgements.
  Raw successful fence `mu4vt9ew29` closes at `2026-09-17T01:59:40.645Z`,
  traffic index 1230, **73.922s after Enter**; the recorder acknowledges one
  millisecond later, at 73.923s. The nonce never appears in serial input;
  the file lookup is read-only; there is no agent input or post-Enter physical
  input. Sources: `report.json:25216`, `:25249`, `:25254`, `:26984` and
  `audit.json` `physical`. `serial.log` is the visible guest-output stream and
  omits quiet RPC replies; the complete raw nonce witness is `workerTraffic`.
- **P4 bounds/single candidate — HELD.** Startup 47.779s, typing 2.702s,
  readback 73.923s, image 16.182s after nonce, cleanup 0.177s all fit the unchanged
  300/60/120/20/30-second budgets. Capture occurred at
  `2026-09-17T01:59:56.828Z`, **90.105s after Enter**. No diagnostic continuation
  ran. The earlier r1 folder records only a dirty-source preflight rejection
  at source line 524, before browser launch at 576; it was not a physical trial.
  Sources: `report.json:26361`, `:26486`, `:26984`, `:27007`; `audit.json`
  `timing`, `earlierPreflight`.
- **P5 visible response — HELD (negative).** I personally viewed the actual
  `response/desktop/desktop-keyboard.png`: it shows the old empty shell prompt,
  with neither the typed command nor a returned prompt. Its 10908 bytes are
  identical to AV's independently inspected stale baseline, SHA-256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  Frames increasing from 4 to 5 after nonce do not change that visual result.
  The wrapper correctly retains `machineAcceptance:true`,
  `desktopAcceptance:false`, `visualInspectionRequired:true`.
- **P6 forged success — HELD.** Eleven bounded mutations are rejected:
  cap-1024 metadata over cap-256 runtime; final cap drift; disabled recycling;
  changed divider; untrusted key; forged receipt nonce; replaced raw nonce;
  late nonce; late image; unexpected late-probe route; and promotion of the
  machine pass to visible success with the unchanged stale PNG. The first ten
  are rejected by the shared machine auditor. The final one is rejected by
  the independent image check; the machine auditor deliberately does not
  claim to read images. Exact exceptions: `audit.json` `attacks`.
- **P7 coverage — HELD.** The affected deterministic gate passes 54/54, with
  no skips. The first sandbox attempt passed 53 and hit localhost `EPERM` in
  the HTTP selftest; allowing that bounded local listener yielded 54/54.
  Logs: `focused-tests.log`; `focused-tests-localhost.log:55`.

## Changed-diff coverage

| Changed file/hunk | Evidence / disposition |
| --- | --- |
| Makefile AW target | Its 54-test command rerun independently; its cap-1024 physical command is bound by the recorded run/head/URL/helper hashes. Declarative target name/output path waived. |
| omarchy-input-trial.mjs policy selection, URL, runtime guards | Actual before/after cap-1024 observations; new deterministic cap test, existing cap-256/control tests, forged-cap/recycling/divider attacks. All changed behavior exercised. |
| omarchy-input-trial.test.mjs | New candidate-only/cap/URL assertions execute in 54/54 gate; existing default paths pass. Permanent deterministic artifact retained. |
| omarchy-desktop-live.mjs three cap-1024 route guards | Actual frozen cap-1024 browser run exercises each new selection and isolation condition. Existing prepared route fixtures remain green. |
| omarchy-input-audit.mjs explicit experiment parameter | Actual report audited with explicit cap-1024; wrong runtime/cap/recycling/nonce mutations reject. Existing default value is mechanically preserved. |
| omarchy-input-kernel-response-audit.mjs experiment forwarding | Actual report plus ten rejected machine-evidence mutations exercise the parameter through the shared auditor. |
| omarchy-input-kernel-response.mjs optional CLI, receipt, environment, audit forwarding | One frozen actual run selects the flag, AT bytes, cap-1024 metadata/environment and matching auditor; no pixel/late route enabled. Default cap-256 expressions remain unchanged, supported by default-option tests. |

No unexecuted changed product behavior remains. Text/config bookkeeping is
waived as declarative. Medium-risk harness-only scope requires no cold clone,
Rust rebuild, deployment or repeated browser boot. AT/AR runtime verification
and AV's separately measured late-rendering finding carry forward unchanged.

## Interpretation and reproducibility

At the final observation the guest had retired 6,502,869,868 instructions;
evictions rose 850→5510, retranslations 1634→14551 and compile-queue drops
5791→26662. These are diagnostics, not proof of responsive interaction.
AV's late rendering remains established for AV; AW's bounded image proves only
that cap-1024 failed this original visual gate. It does not identify an upstream
cause or establish whether this particular run would have rendered later.

Authoritative report: 646781 bytes, SHA-256
`da00d983b75d6e7f83c04ba3b38d743a01a24f7bc65c8602ce5d28b5af656a19`.
Receipt: 20263 bytes, SHA-256
`42772e41aaea9346f4be2d72324d60be5b2df9faf86028375d41e867d339382e`.
Full worker-file sizes/hashes and all independent checks are in `audit.json`.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node evidence/omarchy-profile/residency-cap1024-verifier/audit.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node --test tools/verify/omarchy-input-trial.test.mjs tools/verify/omarchy-input-kernel-response.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-desktop-live.test.mjs tools/verify/omarchy-owned-trial.test.mjs
```

SUITE: retain the cap-1024 permanent option test and independent `audit.mjs`
forgery fixtures. No acceptance budget or runtime setting was relaxed.
