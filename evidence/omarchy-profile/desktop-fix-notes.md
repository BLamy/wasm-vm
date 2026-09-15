# Omarchy black desktop — worker checkpoint

This is work in progress. Immediate GUI repaint has recorded proof; complete
interaction and production verification are still required below.

## Cause and repair boundary

- The Omarchy manifest at baseline `6655d8ba3a5006ddcaa26e4debf0221cdd2efe3d`
  names a kernel but no desktop RAM/disk pair. A serial login is not a graphical
  readiness signal; the real desktop takes much longer to initialize.
- The desktop now remains behind a visible loading/error surface until the real
  compositor reports mapped Omarchy bar/background layers and the real framebuffer
  contains nonuniform visible pixels. It does not treat terminal output as GUI proof.
- Default Omarchy launches use a fresh, independently owned memory overlay seeded
  from a content-verified desktop RAM/disk pair. No prior browser disk or writer
  lock is needed. Missing/corrupt/incoherent warm artifacts fail visibly.
- The 16:10 guest display is bounded at 1280×800 independently of host DPR;
  larger browser windows scale that surface without repeatedly clearing it.
- The serial RPC parser now requires full-line nonce BEGIN and END fences and
  removes split OSC/DCS metadata. Delayed prompts and echoed commands cannot
  contaminate JSON. The streaming channel suppresses its new BEGIN marker.
- The native capture uses the browser device layout, divider 64 and the existing
  accelerated interpreter/JIT flags, then waits for actual desktop surfaces.

## Completed local checks (2026-09-09/10)

- `cargo fmt --all --check`: pass.
- `cargo clippy -p wasm-vm-wasm --all-targets -- -D warnings`: pass.
- `cargo test -p wasm-vm-wasm --lib`: 31 passed after adding duplicate/overflow cases.
- `cargo test -p wasm-vm-cli --bin wasm-vm`: 55 passed with localhost sockets
  permitted. The earlier sandboxed run passed 51 and rejected four socket tests
  with EPERM; this was an environment permission failure, not accepted evidence.
- `cargo test -p wasm-vm-core --features gpu-trace --lib`: 338 passed.
- `cargo test -p wasm-vm-core --test desktop_machine_resume --test
  desktop_machine_resume_verifier --test desktop_machine_audio_resume --features
  gpu-trace`: 25 passed.
- `wasm-pack test --node crates/wasm --lib --
  seeded_linux_wrapper_uses_raw_resume_identity_without_snapshot_store --nocapture`:
  one actual-WASM test passed.
- `node --test web/tests/guest-rpc.test.mjs web/tests/e5-t22b-viewport.test.mjs
  web/tests/omarchy-desktop-readiness.test.mjs
  web/tests/omarchy-seeded-loader.test.mjs`: 31 passed after the final RPC repair.
- `node --test web/tests/omarchy-seeded-loader.test.mjs`: six passed. These use
  deterministic loader stubs for failure branches, not a guest/GUI substitute.
- `node tools/verify/omarchy-seeded-wasm.mjs`: actual Chrome/WASM constructor,
  raw restore, generation coherence, invalid delta, and no-IDB checks passed.
- `node tools/verify/omarchy-desktop-ui.mjs`: synthetic lifecycle-only UI tests
  passed; explicitly not GUI evidence.
- `python3 -m unittest discover -s tools/image -p 'test_*.py'`: 105 tests,
  16 platform/tool skips, no failures. Earlier accepted image-building evidence
  remains separate; this invocation does not claim the skipped Linux checks.
- `make web-dist`: optimized local build passed.
- `E5_DEMO_TASK=E5.5-T03a E5_DEMO_OUT=evidence/omarchy-profile/desktop-fix-demo
  node tools/verify/e5-t18e-demo-smoke.mjs`: 126 passed, zero failed, empty
  browser/HTTP error arrays, screenshot and JSON recorded in that directory.
- `python3 tools/check_task_policy.py`: active task remains E5.5-T03a.

The broad `make ci` wall is not green on this Mac: it includes Linux-only
`wvseccomp` libc APIs and pre-existing all-features dead-code lint failures.
Unfeatured core unit tests also require the existing `gpu-trace` feature for a
`cursorq_commands` test. The feature-correct core suite above passes. No unrelated
implementation was changed to hide these failures, and GitHub Actions remains off.

## Captured pair and immediate GUI proof

- Native cold capture completed with a real mapped, input-accepting Foot window
  (PID 524, 1256×750) and package-owned Quickshell (PID 525) exposing the
  `omarchy-bar` and `omarchy-background` layers. Its complete serial observation
  is in `native-desktop-capture.log`.
- The running capture driver predated the final `sync && printf` hardening and
  actually emitted `sync; printf`; the exact command is retained in that log.
  No sync failure was reported. The accepted bytes are the captured pair below,
  not a claim that the later capture-harness edit ran retroactively.
- RAM gzip: 201816185 bytes, SHA256
  `db34afb6f4e0e40b9e8e932cc934847bc254935c374487d521cb2e5a1d704e72`.
  Raw RAM snapshot: 892194253 bytes.
- Disk delta gzip: 1207113 bytes, SHA256
  `d9ac25c5caa8887773f6d8484c85b5c3662c5dd009971522f60cd733ab8e05ed`.
  Raw delta: 10867453 bytes, 2648 dirty 4 KiB blocks, generation zero.
- `node tools/verify/omarchy-restore-repaint.mjs
  evidence/omarchy-profile/immediate-repaint`: passed. Actual native-to-WASM
  restore accepted the pair and emitted one full 1280×832 repair frame before
  any guest execution. Restore took 1431.54 ms; 96.15% of pixels were visible,
  with 427 RGB colors. The PNG visibly contains the real Omarchy bar and Foot.
  `report.json` pins all input/WASM/PNG hashes. Daybreak independently inspected
  and held this prediction in `desktop-fix-critic.md`.
- The RAM gzip exceeds GitHub's 100 MiB file limit, so it is ignored and fetched
  by `node tools/fetch-omarchy-snapshot.mjs`, with size/SHA verification. The
  existing `wasm-vm` R2 bucket now holds the content-addressed object. A complete
  public download matched 201816185 bytes and the SHA above, with CORS `*`.

## Complete-page evidence and release gate

- Native log: `evidence/omarchy-profile/native-desktop-capture.log`.
- Superseded cold browser recording: `evidence/omarchy-profile/browser-desktop-pair-r2/`.
  This run predates the final RPC/parser and ephemeral-loader edits; its role is
  producing a clean guest state, not proving the final UI. A temporary loopback
  debugger was closed after the native pair completed. Later chunk requests in
  this local capture are served from the exact locally verified immutable R2
  chunk bytes; it is not production-network evidence.
- `built-desktop-warm/` reached actual desktop readiness at about 64 seconds,
  restored at 4.6 seconds, and had no console errors. It then failed because a
  delayed serial prompt contaminated `hyprctl activewindow` JSON. This is a
  retained failed run, not accepted keyboard evidence. The BEGIN/END parser
  repair and unobstructed desktop header are being exercised in
  `built-desktop-warm-r2/` against rebuilt SW version `e7cf625191e1`.
- Canonical clean image SHA256:
  `47584cba39876ee958ea8fa39d3432488277d230abb2997b5999e54b8defe13e`.
- Canonical split-manifest/base SHA256:
  `ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391`.
- Kernel SHA256:
  `af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.

Before release: capture the genuine mapped desktop; restore that exact pair in
actual WASM and screenshot its repair frame before guest execution; verify the
actual built page's GUI, physical keyboard, resize, reload and same-context
second tab; obtain the fresh critic verdict; deploy the exact assets to existing
Cloudflare Pages/R2; repeat the real production screenshot/input check. Until
those finish, neither the desktop nor deployment is claimed verified.
