---
id: E5-T18d
epic: 5
title: Harden compositor restart and tty1 getty fallback
priority: 518.4
status: implemented
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

- [ ] Killing the compositor with the local serial test hook causes an automatic restart and a
      timestamped log entry without an init hang.
- [ ] Three bounded crashes stop retrying and leave tty1 at getty with a visible error banner.
- [ ] A broken-config boot exercises the fallback path, preserves the diagnostic log, and does
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
