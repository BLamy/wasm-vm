---
id: E5-T18d
epic: 5
title: Harden compositor restart and tty1 getty fallback
priority: 518.4
status: verified
depends_on: [E5-T18c]
estimate: S
risk: high
capstone: false
---

## Goal

Make compositor failure bounded, observable, and recoverable without hanging init.

## Boundary

This slice owns start-desktop logging, the at-most-three compositor restart policy, serial
kill/config-failure hooks, and the visible tty1 getty fallback. The final symptom playbook and
rebuilt-artifact gauntlet belong to E5-T18e.

## Deliverables

- Hardened start-desktop/init configuration that logs each attempt and crash reason.
- A bounded restart harness for one compositor crash and the three-crash getty fallback.
- A visible tty1 error banner and serial evidence for both recovery outcomes.

## Acceptance criteria

- [x] Killing the compositor with the local serial test hook causes an automatic restart and a
      timestamped log entry without an init hang.
- [x] Three bounded crashes stop retrying and leave tty1 at getty with a visible error banner.
- [x] A broken-config boot exercises the fallback path, preserves the diagnostic log, and does
      not silently claim desktop readiness.

## Verification command

make verify-E5-T18d

## Adversarial verification

Inject the 500 ms seatd delay, remove the video device, delete XDG_RUNTIME_DIR initialization,
and force WLR_RENDERER=gles2 in separate local fixtures. Each case must terminate with its
predicted bounded symptom/log path; no new hang or unbounded restart loop is acceptable.
WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates process supervision and the failure boundary needed by the final bring-up
playbook.

### 2026-09-05 — worker — STARTED

Implement bounded compositor supervision, a boot-latched tty1 getty fallback, and local-only
serial failure drills. Reuse the verified desktop package profile; no Omarchy or Epic 6 work
starts in this slice. Final evidence will distinguish a successful restart from stale readiness
and prove repeated failure cannot re-enter an unbounded init/autologin loop.

### 2026-09-06 — worker — IMPLEMENTED

Frozen runtime/image inputs: `c01edca99d3e6a227f51fbca882312b1ed802913`.
Frozen observer: `5ff7f85727352781f297fff70ba10263ff8646ae`. The latter changes only
the visual observer, three observer unit tests, and their Makefile invocation; no
runtime, guest image, or source/dist behavior changed after the cold-clone build.

The final browser command ran in the initially pristine shared-folder clone
`/Users/blamy/Documents/Codex/e5-t18d-final.YlijDe/repo`, with `RUSTFLAGS`, `RUST_LOG`,
and all `CARGO_*` variables removed:

```sh
E5_T18D_REQUIRE_HEAD=5ff7f85727352781f297fff70ba10263ff8646ae \
  E5_T18D_IMAGE_DIR=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t18d/desktop-image-v5 \
  E5_T18D_DESKTOP_ASSET_DIR=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t18d/chunks/desktop-v5 \
  E5_T18D_EVIDENCE_DIR=target/e5-t18d-final-proof \
  node tools/verify/e5-t18d-desktop-recovery.mjs
```

Result: exit 0, `E5T18D_PASS=2`, Chromium `152.0.7977.76`. Two separate fresh
cache-disabled contexts used nonpersistent overlays over the same hash-checked image.
The normal guest rendered three successive desktops with PIDs `968`, `1111`, and
`1236`. Each fixed serial crash produced exit status `137`, a timestamped log, and
fresh readiness; only the first two crashes restarted. The third latched
`restart-budget-exhausted`, cleared readiness/PID, and left real tty1 getty PID `1361`
with the visible error banner and login prompt. After at least ten million further
retired instructions, the log still contains exactly three attempts. The separate
broken-config boot reached tty1 getty PID `992`, preserved its log, and never emitted
`event=started` or `event=ready`. Both fallback screenshots are visibly rendered
text consoles; all three ready screenshots show the patterned wallpaper and panel.
There were no unexpected browser console errors. The harness verified every served
chunk and reconstructed the complete image digest before boot, then checked that its
HEAD and all source hashes were unchanged at completion.

Evidence (copied byte-for-byte from the clone):

- `evidence/e5-t18d/desktop-recovery.json`, SHA-256
  `6e84713050debf24782dd042795d87dea9747fc638a59cf5f1d82e13669bd00a`;
  per-case JSON, serial logs, five PNG captures, and `browser-final.log` are adjacent.
- Guest fallback state digests: broken config
  `da907371852e4c761700380a5047df5cd89765be2a65a72e1602431b121c49a9`, three crashes
  `73e5abd08a72d492b244a64deb5de128a7d51e3a339533561aee11b0abe7fc85`.
- Image SHA-256 `e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`;
  chunk manifest `4ee9976955d30915ba2ed154c14475303070db9b6902491cae9d16ae25241b55`;
  custom-file manifest `ab73efab8eac885690def228e3d2080d4ed9f57801e642037f12fd0186e7e2d5`;
  package manifest `ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908`.
- `runtime-artifacts.json` records byte-identical workspace/cold-clone artifacts,
  including the freshly built WASM SHA-256
  `f661a1f50299db159eee89fe92981da1749d23f2aff815210efb53e06b3aa239`.
- `demo-in-progress.json`/PNG: one built-demo load, 126 passed, zero failed, zero
  unexpected console/HTTP errors, visible T18d task panel (correctly still in progress
  before submission). The deployment-time Alpine manifest was staged as the normal
  Cloudflare script does. Production publication is held for the user's explicit
  completed-Omarchy delivery milestone, before which Epic 5's open PRs must be merged.

Risk-tier prechecks: scoped fmt/clippy passed with `-D warnings`; 267 core library
tests with `gpu-trace` passed. The cold-clone `make verify-E5-T18d` run passed shell
syntax, four recovery-policy tests, 25 worker-protocol tests, ten Linux supervisor
fixtures, nine promoted state-boundary tests, and the from-source WASM/dist build.
Its original colorful-wallpaper observer was wrong and is preserved as a failed
observation in `cold-clone-prechecks-and-superseded-observer.log`, not counted as an
overall pass. After the observer-only correction, its three new tests and the full
two-guest browser recording above passed. Unchanged runtime gates carry forward
under incremental re-verification; `README.md` documents the complete provenance.

The fresh critic's earlier FIFO/symlink findings were fixed before runtime freeze:
root-owned diagnostics drop to the desktop UID before bounded reads, and BusyBox's
watchdog directly owns the reader instead of orphaning it behind `runuser`. The
browser proof also exposed a dropped XRGB format field in the worker protocol;
the two message directions now preserve it and the protocol test asserts it. These
are real fixes, not waived failures. Existing Linux-only `wvseccomp` macOS build
limitations and unrelated E6 dirt remain outside this diff. No rr, independent
machine, WebKit, Omarchy, or Epic 6 implementation is claimed here.

### 2026-09-06 — fresh verifier — VERDICT: verified

Reviewed worker submission `73a6b010af3e9fd445d3ebb0102c9d0e26c5513a` against runtime
freeze `c01edca99d3e6a227f51fbca882312b1ed802913` and observer freeze
`5ff7f85727352781f297fff70ba10263ff8646ae`. This is the same adversarial sidecar
session that made the predictions before the recordings, found the FIFO/UID
boundary failures, and rechecked their fixes; it did not implement runtime code.
No remaining refutation or acceptance evidence gap was found. Earlier unchanged
T18a/b/c and T18d HELD results carry forward; no guest boot was rerun for this verdict.

- **P1 restart identity and rendering — HELD.** Predicted fresh readiness and a new
  compositor PID after each of the first two serial kills. The raw serial recording
  contains kill commands at lines 275, 331, and 407, with ready PIDs `968`, `1111`,
  `1236` at lines 267, 318, and 389. Timestamped exits/restarts appear at lines
  285–286 and 346–347. Independently viewed `ready-1.png`, `ready-2.png`, and
  `ready-3.png`: each shows the neutral patterned desktop and dark panel. Their
  hashes and capture checkpoints match `desktop-recovery.json:170–553`.
- **P2 bounded fallback — HELD.** Predicted exactly three status-137 exits, absent
  readiness/PID, a visible tty1 login, and no fourth attempt while execution continues.
  `three-crashes-serial.log:408–469` records the three exits, latched
  `restart-budget-exhausted`, getty PID `1361`, actual console contents, and the final
  still-three-attempt status. SHA-256 of that raw log:
  `42cb3af4a6033efc6597cacff03f97463632f3c5b27f583a5cd15c4b74146833`.
  The frozen observer's mandatory >=10,000,000-retired-instruction wait
  (`tools/verify/e5-t18d-desktop-recovery.mjs:205–211`) precedes the final status in
  `desktop-recovery.json:685`; `browser-final.log:45–46` records completion.
  The readable fallback PNG hashes to
  `f58d7ae02a3aaf1b0b592e668ad8b203f72ee794b90b4d0e2fa8cae252ff0742`;
  its guest checkpoint is `73e5abd08a72d492b244a64deb5de128a7d51e3a339533561aee11b0abe7fc85`.
- **P3 broken-config cold boot — HELD, carried forward.** The separate kernel
  command line enables the config fault (`broken-config-serial.log:24`); lines
  239–254 show zero attempts, no readiness/PID, preserved timestamped diagnostics,
  and tty1 getty PID `992`. No compositor started/ready event occurs in the raw log.
  Log SHA-256 `2e6cf3273fb00e60c2af525166baa63ef6455b99861fea92d2641a427d60a832`;
  the independently viewed banner/login PNG hashes to
  `6e980aa3f96f910881bf2ccd34b5e962e2c9668a4d3bed3758e3f972dd7e0781`.
- **P4 evidence and artifact identity — HELD.** Independently checked aggregate
  SHA-256 `6e84713050debf24782dd042795d87dea9747fc638a59cf5f1d82e13669bd00a`;
  both per-case objects equal their aggregate entries, and their status/tty strings
  occur in the raw UART logs after CRLF normalization. All five PNG hashes match.
  Eleven aggregate/per-case/serial/PNG/console files match the clone originals
  byte-for-byte. All 15 recorded source hashes match the observer commit, submission
  commit, main workspace, and clone. Independently rehashed all four image-lock
  inputs and 823 unique chunks across 8192 positions; the reconstructed image is
  `e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`.
  Read-only Docker/debugfs extraction of all four installed recovery scripts
  matches frozen source, not merely FILE-MANIFEST assertions. Nine runtime artifact
  hashes/sizes match main, clone, and clone dist. Guest checkpoint hashes and PNG
  hashes are separate observations, not an assertion of an atomic screenshot/snapshot.
- **P5 fault and security boundaries — HELD, carried forward.** The four prescribed
  drills are present in `local-fixtures.json:10–24` and the cold-clone recording;
  seatd's 500 ms delay reaches readiness, while missing video/runtime and gles2
  produce their specific bounded fallback reasons. The ten fixtures also cover
  reentry, config removal, early exit, startup timeout, and forced shutdown.
  `cold-clone-prechecks-and-superseded-observer.log:99–260` records all nine promoted
  state-boundary tests passing against the frozen init/reader hashes. Earlier
  focused Alpine BusyBox and Debian FIFO-swap/last-16-KiB probes remain HELD
  (2.089 s and 2.051 s respectively, caller exits and no blocked pipe holder).
  UID-confined reads/signals and the 30-second init bound retain their earlier
  HELD results. Original unsafe FIFO-init and root-readable-state negative controls
  failed the promoted tests in this verifier session; the tests are not vacuous.
- **P6 browser observation and cold build — HELD.** Reviewed the actual clean clone
  compile transcript at `cold-clone-prechecks-and-superseded-observer.log:261–361`;
  its later colorful-wallpaper failure remains explicitly superseded, not a pass.
  The observer-only replacement's three unit tests passed in this verifier session;
  four recovery-policy and 25 protocol tests are recorded at log lines 3–49.
  `native-tests.log:271` records 267 passed, zero failed/ignored. The previously
  reviewed built-demo JSON/PNG show 126 passed, zero failed, and the correctly
  in-progress task before submission. Browser console errors are limited to the
  permitted favicon 404s; optional boot-profile misses are not compositor failures.

**COVERAGE disposition.** All 34 source/build/test/generated/metadata files through
the observer freeze were reviewed, followed by the evidence-only submission delta.
Supervisor startup, ready/crash/retry/latch/fallback and cleanup hunks are exercised
by the two real boots plus ten Linux fixtures. Init and serial state/identity hunks
are covered by those boots and the nine promoted boundary tests. Worker format
transport is covered by its protocol test and visible XRGB tty1 frames. Recovery
page/policy, the shared visual observer, capture/source-binding/per-case persistence,
and asset-serving hunks are exercised by the focused tests and recorded browser run.
Build installation is bound to the extracted image scripts and clean WASM/dist build.

Waivers are explicit, not claims of complete branch coverage: alternate malformed/
pre-exhausted budget, wrong-runtime-permission, and never-arriving-seatd guard outcomes
remain source-reviewed; the bounded shared fallback/cleanup behavior is exercised.
The unused serial `config-fail` dispatcher composes the separately exercised config
removal and fixed crash operations; legacy non-opt-in getty, unknown-command output,
button-event wiring, and harness error-reporting alternatives are source-only under
the user's bounded/no-new-scenarios review. These diagnostic/defensive alternatives
add no additional acceptance claim. Declarative mounts/defaults/banner/lock data,
six matching source/dist copies, generated service-worker token, roadmap/task data,
comments, and evidence packaging are waived from separate execution proof after
content/hash review. No dead implementation or unclassified acceptance hunk remains.

**SUITE.** Retain the nine promoted `e5-t18d-state-boundaries.py` regressions, ten
process/socket fixtures, fixed-policy/protocol/surface tests, recorded guest captures
and digests, and `make verify-E5-T18d`. No further scenario or runtime gate was added.
Raw UART CRLF and trailing console padding are preserved and exempted only from
whitespace checks; source/JSON and verifier metadata checks remain required.
Production publication is explicitly held for the user's Omarchy milestone. This
verdict authorizes neither deployment nor merging and changes no unrelated E6 work.
