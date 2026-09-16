VERDICT: verified

Scope: **negative configuration/preparation diagnostic only**. No confirmed
opaque desktop, usable checkpoint, physical keyboard response, T03ah/T03q
eligibility, publication or release follows. The worker submission
`03655c48` states that boundary accurately. Desktop responsiveness remains
unresolved.

This independent session wrote `predictions.md` before the frozen recording and
did not implement the task. The audited implementation is
`e841c3a19934ebe4144f6920849b918eb9bcc566`; task diff base is `5f623add`.
All report line numbers below refer to
`../prepared-opaque-r1/desktop/report.json`, SHA-256
`fc9ca57469a5d8a1b1c4215512a8752eb064c1e2a39d8a04ba9053930d8ec166`.

- **P1 — HELD.** Independent byte checks bind all 24 recorded helpers to the
  frozen Git blobs and current files, 93 served resource receipts to actual
  bytes, the four R3 source pins, and release WASM
  `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Actual runtime remains cap256/recyclingOFF/threshold512/cold65536/decoded4096
  and ICount64, with observer/timing disabled. No crates/web/Cargo change exists
  since verified runtime parent `53103e76`. The single startup `setDisplay`
  request is exactly 1280×800 and receives `true`; the actual allocation is
  1280×832 with a 1280×800 rect. There is no mode sweep
  (`run-audit.json`, `source-audit.json`; raw worker events 1 and 5, zero-based).
  Carry the unchanged runtime proof.
- **P2 — HELD.** The recorded CDP input-fence acknowledgment at04:24:28.368Z
  precedes the first navigation request at04:24:28.372Z
  (lines21486–21489 and1141). The unchanged actual Chrome fixture executes
  this same source block, attempts trusted keys/pointer/wheel across two
  navigations, and records no delivered events. The real recording contains
  zero physical input events and no keyboard/tablet/mouse/agent send/sync RPC;
  the `keyboardLedState` calls are reads. Only layers and the fixed opaque
  command appear on the independently reconstructed serial wire. No nonce or
  active-window command appears (`run-audit.json`). Preserve the no-input claim.
- **P3 — actual properties FAILED/UNPROVEN; rejection HELD.** The exact
  update-then-readback command is sent once at04:25:00.703Z, worker event134.
  Event1598 completes it at04:32:46.633Z, 465930ms later, with exit0 and actual
  stdout `ok`, `Hyprland IPC didn't respond in time`, and `Couldn't read (6)`
  separated by the retained newlines (lines21798–21810; raw timeout text at
  line21274). These are three nonempty lines, not three property values plus
  the acknowledgment. The unchanged strict parser rejects before any active
  query or export. Exit0 and `ok` are correctly insufficient. Preserve this
  negative configuration result; do not infer opacity adoption or a cause for
  the guest IPC timeout.
- **P4/P5 — NEEDS EVIDENCE for any positive prepared-desktop claim; negative
  suppression HELD.** No active-window query, post-property baseline, terminal
  ROI observation, accepted fresh frame or prepared screenshot is reached.
  I personally viewed the actual initial and failure PNGs: both show the same
  empty Foot shell prompt and original bar/border, with no typed command.
  Independent PNG decoding checks all CRCs/filters and confirms both files are
  byte-identical 1280×800 images, SHA-256
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`,
  raw-pixel SHA-256
  `50c62bb0e9bcbaba0efa00008caebf795a859fa4d03ddbcd54ac6786c8210597`.
  These old visible pixels prove startup readiness only. An active Foot ROI
  cannot be claimed without the missing window response
  (`initial-image.json`, `failure-image.json`, `final-audit.json`).
- **P6 — HELD for the negative run.** The single900000-ms preparation deadline
  is04:39:28.366Z, anchored at04:24:28.366Z (lines21481–21484). The guest's IPC
  error ends preparation at04:32:46.635Z, before that cutoff; no timer is
  renewed. Cleanup starts04:32:46.669Z and completes04:32:46.869Z, within30s
  (lines21814–21819,21870). The parent closes at04:32:46.878Z with exit1,
  no signal and no watchdog (`run.json:14`). The separate180000-ms export
  phase is not entered; its fixed duration and fail-closed behavior execute
  only in labeled synthetic controls. No change to the physical-input
  acceptance deadlines follows.
- **P7/P8 — negative boundary HELD.** No pair, capture-persistence or seeded
  export receipt exists. The actual private directory
  `target/omarchy-opaque-r1` is mode0700, not a symlink, and empty. Final parent
  result is `preparation-failed-input-untested` with `usablePair:false`
  (`run.json:57–58`). All16 worker-sealed artifacts match index SHA-256
  `8dd0ae4003172dd0c7cfaf11a3473ebf0eff83207f819aaa6d3aef5859ea76f0`;
  all69 carried runtime-evidence files still match their unchanged index
  (`final-audit.json`). The entire capture function is byte-identical to AD
  `545f22ad`; its unchanged exact-seed/full-delta fixtures pass. Actual full
  pair bytes remain unproven because none were exported. Keep T03ah/T03q gated.
- **P9 — HELD for the scoped negative claim.** `coverage.md` accounts for
  every new behavioral hunk, inherited proof and declarative waiver. Worker
  checks pass53 affected tests, one real Chrome fence/manifest test and two
  syntax checks. The independent focused run passes4/4. The bounded stale
  attack executes the actual native-pixel callback: 192 bright pixels/16 colors
  in old frame5 cannot pass post-query baseline5, and no screenshot/export
  occurs. Fresh frame6 passes as an explicitly synthetic control
  (`stale-pixel-attack.log`). The exact parent postprocessor body keeps a
  synthetically valid pair unusable pending personal images and rejects a
  foreign generation8 versus7 even after compressed metadata is recomputed
  (`postprocessor-fixture.json`). Seven exact CLI-body fixtures cover normal
  negative and ownership/path/argument failures (`wrapper-fixture.json`).
  None is guest or responsiveness evidence.

Two source issues identified before freezing were corrected before any real
recording: the fixed active-query allowlist and a fresh-frame baseline taken
after properties/window completion. Both corrected paths have direct coverage.
There is no outstanding refutation of the worker's narrow negative claim.
The independent raw-audit parser's two bookkeeping corrections are recorded in
`audit-adjustments.md`; neither changes the task prediction or a product result.

## Durable evidence and commands

Keep the four worker tests, the bounded stale-pixel regression, and the clearly
labeled postprocessor/CLI controls. Retain the real negative run and both real
images. No full gauntlet, cold clone, guest/browser launch, heavy build,
deployment, publication or merge was performed by this verifier. Implementation,
task status, queue and Git were not edited; the parent owns lifecycle updates.

Commands run from the repository root, with
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` for Python/Git:

```sh
node evidence/omarchy-profile/prepared-opaque-verifier/stale-pixel-attack.mjs
NODE_V8_COVERAGE=evidence/omarchy-profile/prepared-opaque-verifier/v8-coverage node --test tools/verify/omarchy-opaque-preparation.test.mjs
python3 evidence/omarchy-profile/prepared-opaque-verifier/audit-source.py
NODE_V8_COVERAGE=evidence/omarchy-profile/prepared-opaque-verifier/v8-coverage node evidence/omarchy-profile/prepared-opaque-verifier/postprocessor-fixture.mjs
NODE_V8_COVERAGE=evidence/omarchy-profile/prepared-opaque-verifier/v8-coverage node evidence/omarchy-profile/prepared-opaque-verifier/wrapper-fixture.mjs
python3 evidence/omarchy-profile/prepared-opaque-verifier/audit-run.py evidence/omarchy-profile/prepared-opaque-r1 e841c3a19934ebe4144f6920849b918eb9bcc566
python3 evidence/omarchy-profile/prepared-opaque-verifier/audit-image.py evidence/omarchy-profile/prepared-opaque-r1/desktop/desktop.png
python3 evidence/omarchy-profile/prepared-opaque-verifier/audit-image.py evidence/omarchy-profile/prepared-opaque-r1/desktop/failure.png evidence/omarchy-profile/prepared-opaque-r1/desktop/report.json
python3 evidence/omarchy-profile/prepared-opaque-verifier/audit-final.py
```

Each final command completed with exit0. Outputs and source are retained in this
directory and sealed by `sha256.txt`.
