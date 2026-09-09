VERDICT: refuted — NO-GO for this launcher revision; one concrete integration blocker.

Scope: read-only review of the frozen factory, launcher, tests, generated diff and actual
generated driver. Read Main's recorded 6/6 tests; did not execute tests, factory, shell setup,
browser, profile operations or old proofs. HEAD remains
`76eca30b248268e130395c53cb09da62637388a7`.

## Blocking finding

The child must receive an empty output directory. `run.mjs:60` sets `E5_T26F_OUT` to
`output`; line72 writes `output/invocation.json`, then line74 spawns the generated runner
with that same output. The generated `probe.mjs:312` requires an empty directory, and
line320 calls that guard for the mandatory resident fixture, before server/profile/browser
startup and outside failure capture. Therefore this launch deterministically refuses with
“diagnostic completion refuses nonempty output directory; use a fresh run subdirectory”.
There will be no browser measurement or interaction failure JSON; the launcher's subsequent
raw-file read at line84 will also fail. This is not a 2-second cap failure.

Concrete fix: retain invocation/log/exit/validation metadata in the fresh run root, pass a
separate fresh empty `run-root/record` as `E5_T26F_OUT` consistently to generation and child,
and resolve both success/failure raw paths under `record`. Keep the resident empty-output
guard unchanged. Add one focused no-browser output-layout check with launcher metadata
already present; the existing six tests never exercise `main()`'s handoff.

## Other reviewed boundaries — HELD at source level

The factory's unique deletion removes only the156-byte post-observer guard/print block:
691→535 bytes, body SHA256
`50fa3e0e8264ebdb6f31d2816c06a5275e8ba4c9ddb892a8cc989ef068f83c58`.
Armed/PID check, finite PCM, SIGPIPE handling, FD3 close, same-child wait and conditional
green completion remain. No forged `e5_seen`, synthetic observer success or installed-helper
edit. Printable base64 setup and awaited `e5t26f-audit-elided-ready` agree; recorded native
tests decode/define the function and byte-check clear/home/readiness without calling play.
Guest base64 availability remains the supplied read-only image observation, not native-test proof.

Launcher import is inert. It scrubs E5/Cargo/Rust flags, pins current HEAD, carries the17
original source bindings plus direct imports/template, and records/checks launcher/factory/test
digests before/after. Current seal pins and inherited copy/hash/browser checks prevent launching
the baseline directly or rebinding an old seal. Query defaults are jit1 and loader repack-off;
CPU/latency/clock/residency/command overrides are refused.

Generated order is baseline restore/CRC/coherence → physical untimed installation/clear/home
and cursor settle → paused derived snapshot/sound/coherence → derived reload → original
completedAt T0 → cursor/gesture/physical play5ms/exact72×13 raster/fresh PCM → frozen end≤2000.
Empty raster baseline, exactly one token, actual key edges and fixed titlebar/region remain.
Timing metadata correctly distinguishes2000 success from2001 cap failure and rejects missing
or non-cap proof. Labels deny acceptance/F verification/fresh postidentity. This remains a
combined validation/reporting-path counterfactual, not isolated proc-read causation.

## Independently read SHA256 bindings

- Factory: `651a75c95d6cf0d016c192b9b5ae7487a1e78085fffec6784577b37f901f366f`
- Launcher: `78093de4724cd1ad0466cc1f78f9c06b5229bc2523252b985a8b8f08600d255b`
- Generated driver: `6679ef040cdce8d4a3a67a4ce02f08c87188ed049fb8f1e0835292020ffae133`
- Generated diff: `29b7c39023000eff483e49efa6c423f5ae5558c0cf9464da7ac71bc39a8be86a`
- Tests: `b63284ee2b5808c29ea76562f61045ed7bce8391684e234506de03b7825d677f`
- Recorded test log: `1c48c0d84ef18187a7aff8fc8ef717590052fea1e96ef49a5014c7698d01ce74`

## R2 delta — GO for ONE Main-owned audit-elided counterfactual

This supersedes the initial NO-GO for the corrected launcher only. `run.mjs:17` creates
fresh root/record directories; lines68–82 pass the same record-targeted environment to
generation and spawn while invocation metadata stays in the root. Raw lookup at line92
uses record. The unchanged generated empty-output guard is now compatible with this layout.

The added test at `factory.test.mjs:96` checks record remains empty with root metadata
present, existing-root refusal, and source-level environment/raw-path consistency.
`main-tests-r2.log` records7/7 passes. This is a focused no-browser regression, not a
browser execution proof. No rerun performed.

Independent SHA256:

- Launcher: `cbe55bafb7ba5132664795c92afa28a1dbc0260bbb4667f5d06e6abb6af5a60b`
- Tests: `f438f342761e550ec9f1a3994b845a88cee0edaf4b7cecb3096391d914d89b00`
- R2 log: `1070c65db6fcd585266e4b3c80683d6390f3fd13bd4cb554b2ec7f27b3895a2b`

Factory/generated-driver hashes and HEAD match above. All prior HELD boundaries and
counterfactual limitations carry forward. No remaining blocker found in this delta;
no runtime, profile, browser, task or HEAD mutation by this review. F remains unverified.
