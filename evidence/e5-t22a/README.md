# E5-T22a host display hotplug evidence

The final acceptance is at `179b8fd04e716a24a7b15091b3f7b0de0a356dfb`,
in pristine clone `/Users/blamy/Documents/Codex/e5-t22a-portable.JBfGod/repo`.
The command ran with a scrubbed environment (only original HOME/PATH/TMPDIR
retained): `npm --prefix web ci --no-audit --no-fund && make verify-E5-T22a`.

- `acceptance.log`: complete successful command output, including four WasmLinux
  tests, the two-instruction MMIO event trace at lines 814–817, existing native
  config-event checks and 25 worker protocol tests.
- `browser-proof.json`: actual direct and module-worker observations for
  1,003 valid updates and 32 invalid requests each, actual resource/scanout
  stats, EDID bytes for every requested mode, bound sources/wasm and zero-error
  126/0 built-demo result.
- `host-hotplug.png` and `demo-suite.png`: raw final browser screenshots.
- `regression.log`: unchanged-runtime regression at predecessor `0fe393ed`;
  267 core tests, scoped wasm tests and feature builds, 127/127 native ISA
  cases and 55.4 MIPS performance smoke passed.

The runtime was frozen at `8c3f4e14`; subsequent commits change only the
verification recipe, server deployment staging and docs. Final wasm SHA-256:
`563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc`.
Browser JSON SHA-256:
`8596d057ec660e689d4d7ba5e8423a7e8e520e6ec46703052edcac7fc2a329d1`.
Acceptance log SHA-256:
`410f8b337c5f2ddf76cd40da7e5318565a0ddf3b3fd2c4bc200ecebf243a4fae`.

## Preserved failures, not green claims

`initial-portability.log` records the first cold-clone browser's missing
deploy-staged Alpine manifest. The corrected evidence server uses the exact
committed staging input from deploy-cloudflare.sh:76 and binds its digest;
the final proof was rerun from a **new** pristine clone.

The broad gauntlet is not wholly green. `broad-all-features-lint.log` records
unchanged dead-code warnings under the historical zicsr-stub/all-features
combination. `broad-workspace-mac.log` records Linux-only wvseccomp/prctl
compilation on macOS and the existing core test's unguarded gpu-trace getter.
The task recipe selects the established gpu-trace test feature. The scoped core
and wasm library strict lint checks passed in `initial-portability.log`.
`regression.log` also preserves the unchanged normal-wasm input-queue fixture
failure at input_queues.rs:91 (SYN event versus expected KEY), the old quarantined zicsr-stub cursor test
failure (0 versus 8) and the static determinism script rejecting test-only
Instant/Duration references in unchanged GPU resource tests. No unrelated
implementation or tests were edited to suppress these failures.

This evidence claims only the host hotplug API, not Linux compositor mode
adoption, two-second resizing, or deployment. T22b-d own those remaining claims.
