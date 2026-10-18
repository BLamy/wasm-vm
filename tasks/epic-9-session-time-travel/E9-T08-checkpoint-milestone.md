---
id: E9-T08
epic: 9
title: Prove the saved-checkpoint experience across reload
priority: 524.908
status: implemented
depends_on: [E9-T06, E9-T07]
estimate: S
risk: medium
capstone: false
---

## Goal

Deliver the first usable milestone: a local session library with real restore points.

## Boundary

Recorded built-browser integration of accepted checkpoint/store/library boundaries. This milestone does not claim continuous replay or arbitrary-time seeking.

## Acceptance criteria

- [ ] Create two sessions, make different guest file changes, checkpoint each, reload the tab and restore the correct session/files/input state.
- [ ] Exercise rename, quota feedback and deletion through visible controls; preserve another session during deletion.
- [ ] Record original browser sources, guest state/disk witnesses, screenshots and zero unexpected errors; document the checkpoint-only capability in the unified docs.

## Deterministic acceptance

`make verify-E9-T08` records the two-guest built-browser integration, independent machine/input/disk witnesses, affected target build and documentation checks.

## Adversarial verification

Choose restore order independently, reuse the same guest filenames and reopen a fresh tab. A thumbnail or unchanged terminal screenshot cannot substitute for the guest file/state checks.

## Verification log

### 2026-10-18 — worker — started

Dependencies T06/T07 are independently verified. This S/medium milestone adds a recorded
built-browser integration and unified documentation over their unchanged runtime.
Two genuinely fresh guests will write different bytes to the same filename, retain
separate shell RAM and queued input/held keys, then restore through visible controls
after reload and in a fresh tab. Rename, quota-prefix feedback and deletion must preserve
the other session. The proof includes exact raw tuples, independently reconstructed
filesystem witnesses, original sources, responsive screenshots and 127/0 with no errors.
Continuous replay and arbitrary-time seeking remain later task boundaries.


### 2026-10-18 — worker — ready for recorded submission

Added the deterministic integration driver, independent raw/native16/sparse-RAM/input
and ext4 oracle, `make verify-E9-T08`, and the unified storage guide's checkpoint-only
workflow/retention limits. Runtime, native/Wasm behavior, existing storage/library APIs
and the pinned GPU factory are unchanged from independently verified T07.
Development run `target/evidence/e9-t08-browser-inner-2/report.json` passed: genuinely
fresh Alpha/Beta guests used the same filename with different file bytes, shell RAM,
queued UART and held keys; exact paused tuples restored Beta after reload and Alpha in
a fresh tab. Visible rename and point-limit quota feedback preserved Beta's prefix;
deleting Alpha and reloading preserved Beta's original tuple and guest observations.
The independent oracle authenticated every component/section and read the four actual
reconstructed ext4 witnesses (Alpha, Beta, unsaved Beta, reopened Beta). Browser 127/0,
zero unexpected errors, keyboard focus, 390px controls and rendered unified docs passed.
The first development failure is retained: the RPC wrapper appends a framing newline,
so the corrected harness compares base64-encoded file bytes; no VM change was required.
Final clean-head recording, production proof and fresh independent verdict are pending.


### 2026-10-18 — worker — recorded submission

Frozen implementation `1b3c68c0def3fb98c8803ed6f95089f90ed7dfe7`.
`GIT_OPTIONAL_LOCKS=0 E9_MILESTONE_EVIDENCE_DIR=target/evidence/e9-t08-worker-final make verify-E9-T08`
passed all nine affected gates: task policy, driver/oracle syntax, worker protocol,
actual Wasm/browser build, unified documentation validation, execution contract,
retained factory integrity and recorded built-browser integration. Report SHA-256
`172eb74455cc91151d7d55d5112a97af6daeed45e543e6a897fe186cd418b2f4`;
browser report `80f77ee25c7c9e5773009c4f47a5aad44701ce54929f8b8d6d5b49409fc0a325`.
Compact packet `evidence/e9-t08/worker/` authenticates 474 original payloads and nineteen
source inputs; full original trace/profile, eight compressed tuples, detailed coverage
and reconstructed images remain in `target/evidence/e9-t08-worker-final/`.

Two genuinely fresh guests first proved the shared filename and shell variable absent,
then wrote Alpha/Beta file bytes and distinct RAM variables. Their saved queues contain
`e9_queue=queued-alpha\n` / `e9_queue=queued-beta\n`; held keyboard states are 30 / 48.
Alpha's original frame is
`7b8d3d522a7041d796265d4793a23f73e3fa6edcbd21f678cee80eec4514aea1`,
Beta's `a7368525958f378a505077777dd46f4ee995b6ca5af313124d4d373cb59d80e0`.
Beta restored after reload and Alpha in a fresh tab, both initially paused with zero
scheduler slices and exact original tuples, then observed their own file/RAM/queued
input through the real guest. Visible rename persisted; point-limit failure kept Beta's
committed manifest while its different unsaved state remained paused. Confirmed Alpha
deletion preserved Beta's manifest, and another reload/open reproduced Beta's original
frame and observations. The independent oracle authenticated all five tuple components,
all sixteen native sections, sparse RAM and disk-root bindings, then reconstructed/read
Alpha, Beta, unsaved Beta and reopened Beta ext4 file bytes. Oracle SHA-256
`5d962f11eede86420489e26c4e276da27d635906cfbc4b0a5ef01938f4106279`.
Browser: 127 passed/0 failed, no unexpected errors, keyboard focus, no 390px overflow,
and rendered checkpoint-only guide; screenshots and original sources are retained.

`GIT_OPTIONAL_LOCKS=0 bash tools/deploy-cloudflare.sh` published the unchanged frozen
dist to <https://782e7395.wasm-vm.pages.dev> and <https://wasm-vm.pages.dev/>. The script
retried stalled unchanged R2 objects, authenticated them and completed successfully;
its full log is in the public packet. The exact 733-file published payload was captured
and independently authenticated, including 728 tracked source files, precisely five
normalized URL manifests and five exact source release extras. Capture receipt
`target/e9-t08-full-deploy/receipt.json`, SHA-256
`a307898a9edc4a2727abfec2f6b55f72d2e606b4377393436131ab299da9c4dc`.

`GIT_OPTIONAL_LOCKS=0 node tools/verify/e9-checkpoint-milestone-browser.mjs --url https://wasm-vm.pages.dev/ --output target/evidence/e9-t08-public-final`
passed the same two-fresh-guest workflow and independent filesystem oracle on production,
with eighteen exact public source/asset identities, 127/0 and no unexpected errors.
Public report SHA-256 `8beb9711992dca26e0c741787951e218e4609d04dbbd1e7b4a78d2f4b240dc79`;
compact packet `evidence/e9-t08/public/`; originals remain in
`target/evidence/e9-t08-public-final/`. No runtime/native/storage/library/loader or
pinned 47-file GPU implementation changed; their T07 verdict and runtime/clean-source/
actual GPU evidence remain HELD. This medium-risk integration adds no portability or
deployment mechanism claim. Fresh independent final verdict/promotion remains pending.
