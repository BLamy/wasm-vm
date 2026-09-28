VERDICT: verified

# E5.5-T03ax — verified negative decoded-cache experiment

The requested cap-1024 / 16384-entry decoded cache ran, but the original
visible-response gate still failed. **Desktop responsiveness remains unsolved.**
This verdict verifies the negative experiment only; it does not promote Q or
the tested settings to deployment defaults.

Frozen implementation: `9c63ad84b442d62f15ace9b90475552e6b6c0c92`.
Worker submission: `9e6107927d0ef14690e727bb83380a355a044466`.
The later submission changes only task/queue metadata. I read the full task
and six-file implementation diff, then wrote `PREDICTIONS.md` before opening
AX runtime evidence. I did not implement AX or change implementation code.

## Predictions and observations

- **P1 settings — HELD.** Both actual runtime samples show cap-1024, cap 1024,
  recycling enabled and 16384 decoded entries. JIT, icount divider 64, 1280×800
  presentation, and disabled timing/admission probes remain unchanged. Comparing
  the normalized URL with AW leaves exactly one difference:
  `decodedCacheEntries=16384`. See `audit.json` `actualRuntime`, `url`, `priorUrl`;
  worker `response/desktop/report.json:1416` and `:24614`.
- **P2 identities — HELD.** Independently hashed all 47 helper sources, 96 served
  rows / 73 distinct resources / 67 Git-backed dist resources and the actual
  AR RAM/delta, AQ kernel and R3 chunk manifest. Every prior prediction matches.
  AT WASM remains 1602266 bytes with SHA-256
  `7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf`;
  AT core files also match the carried frozen runtime. `audit.json` records the
  exact source/artifact hashes and seals all eight worker evidence files.
- **P3 physical nonce — HELD.** The 128 trusted DOM events reconstruct exactly
  `printf 'cfbffea436913f37' > /tmp/desktop-keys-84d4e3b0880fb74f`.
  Keyboard/sync calls have 256 true acknowledgements. Raw fence `mu4wk2yt27`
  closes at `2026-09-17T02:20:31.869Z`, traffic index 1140, **64.348s after
  Enter**; the recorder acknowledges it at 64.349s. Raw serial input contains
  no nonce and only authorized read-only commands. There is one worker, no
  post-Enter physical input, agent-input route or extra readiness/profiling
  path. The raw reply is at `report.json:23844` and `:23853`; `audit.json`
  `physical` retains the reconstructed command, fence, timestamps and hashes.
  The visible `serial.log` omits quiet RPC replies; `workerTraffic` is the
  complete raw witness used here.
- **P4 deadlines/defaults — HELD.** Startup 41.602s, typing 2.696s, readback
  64.349s, capture 14.563s after nonce, cleanup 0.166s all satisfy the original
  300/60/120/20/30-second budgets. No continuation or second worker ran.
  AW's sealed original report still passes the current auditor at its original
  4096-entry setting, and its generated URL/options remain unchanged.
  See `audit.json` `timing`, `unchangedAw4096Audit`; `report.json:25499`, `:25522`.
- **P5 visible result — HELD (negative).** I personally inspected the actual
  `response/desktop/desktop-keyboard.png`: the terminal shows the old empty
  prompt, without the typed command or a returned prompt. The image was taken
  at `2026-09-17T02:20:46.433Z`, **78.912s after Enter** (`report.json:25001`).
  It is byte-identical to AW's stale image: 10908 bytes, SHA-256
  `431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24`.
  A post-nonce frame increment from 4 to 5 does not establish a visible response.
- **P6 bounded forgery attack — HELD.** Thirteen cases reject: both runtime
  samples reverting to 4096 despite 16384 metadata; final-sample cache drift;
  wrong cap/policy; final cap drift; recycling/divider drift; untrusted input;
  forged nonce metadata; changed raw nonce; late nonce/image; unexpected
  diagnostic route; and promotion of the machine pass to visible success.
  The first twelve fail the shared machine auditor. The stale-image promotion
  fails the independent visual gate, since that auditor intentionally requires
  separate image inspection. Exact exceptions are in `audit.json` `attacks`.
- **P7 coverage — HELD.** All 55 affected tests pass, with no skips or failures,
  using localhost access (`focused-tests-localhost.log:56`). No additional
  browser boot, runtime rebuild or cold clone was needed for this medium-risk
  local harness experiment. AT/AR and AW's unchanged boundaries carry forward.

## Changed-hunk coverage

| File | Evidence / disposition |
| --- | --- |
| Makefile | Its 55-test command was rerun; the frozen physical run exercises the declared flag. Declarative target/output naming waived. |
| omarchy-input-trial.mjs | Real 16384 selection, URL and both runtime samples; new deterministic test and independent cache/cap/drift attacks. AW's 4096 path still passes. |
| omarchy-input-trial.test.mjs | New candidate-only, fixed settings and rejection assertions execute in the 55-test gate. Permanent test retained. |
| omarchy-desktop-live.mjs | Actual frozen browser run exercises the three added candidate/isolation membership branches; existing prepared-route fixtures still pass. |
| omarchy-input-audit.mjs | Explicit new experiment is exercised by the actual report audit and twelve rejected machine-evidence mutations. |
| omarchy-input-kernel-response.mjs | Actual optional CLI selection, experiment receipt/environment and audit forwarding are bound by helper hashes, URL, runtime and receipt. Default/AW expressions preserve behavior; prior AW audit passes. |

No changed product behavior remains unexercised. Types/text/config bookkeeping
is waived as declarative. The new permanent test plus independent `audit.mjs`
forgery corpus are retained; no implementation edits were necessary.

## Limits and reproduction

The final runtime records 6,410,377,466 guest retirements, 9,233,356 decoded
block builds, 6,227 JIT evictions, 24,513 retranslations and 13,667 compile-queue
backpressure drops. These counters do not prove responsive interaction.
This negative image does not locate an upstream cause or establish whether
this particular run would have rendered later.

Report: 613616 bytes, SHA-256
`baa3b655acdf55180d3a19a079d312e3d2a408b4f3e4182032ec78c5548ff03e`.
Receipt: 19548 bytes, SHA-256
`3f7fcd751ada65aacc6c4f4abdc32d41d4beeb025a359e0898def4ea95131ddc`.

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node evidence/omarchy-profile/residency-decoded-cache16384-verifier/audit.mjs
DEVELOPER_DIR=/Library/Developer/CommandLineTools /Users/blamy/.nvm/versions/node/v24.20.0/bin/node --test tools/verify/omarchy-input-trial.test.mjs tools/verify/omarchy-input-kernel-response.test.mjs tools/verify/omarchy-user-input.test.mjs tools/verify/omarchy-desktop-live.test.mjs tools/verify/omarchy-owned-trial.test.mjs
```
