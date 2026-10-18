---
id: E9-T08
epic: 9
title: Prove the saved-checkpoint experience across reload
priority: 524.908
status: verified
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

- [x] Create two sessions, make different guest file changes, checkpoint each, reload the tab and restore the correct session/files/input state.
- [x] Exercise rename, quota feedback and deletion through visible controls; preserve another session during deletion.
- [x] Record original browser sources, guest state/disk witnesses, screenshots and zero unexpected errors; document the checkpoint-only capability in the unified docs.

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


### 2026-10-18 — verifier — VERDICT: verified

- **P0 provenance — HELD.** Predictions preceded evidence inspection in
  `evidence/e9-t08/verifier-final/predictions.md`. Independently authenticated all 474
  original worker and 681 original public payloads, both compact packets/aliases and
  frozen source maps. Original JS text is retained in coverage, original Wasm/docs
  bodies in the trace, and each trace retains its original driver verbatim. Both
  nondevelopment recordings identify frozen implementation `1b3c68c0`; original
  reports and profiles remain untouched. Citation: `packet-authentication.json`,
  `source-points.jsonl`, `public-source-points.jsonl` in the verifier packet.
- **P1/P2 fresh guests and exact restores — HELD.** Recorded fresh-guest commands
  prove the shared filename and shell variable absent before the different writes
  (`trace.trace:378/call@43`, `:612/call@81` in the original local trace). Independent
  parsing authenticates every component, all sixteen native sections, expanded
  256 MiB RAM, pending UART input, held keys and canonical disk root. Beta after
  reload and Alpha in a fresh tab are byte-identical to their own original tuples,
  initially paused with zero scheduler slices; resumed guest commands return each
  original file and RAM/consumed queued-input value. Production independently agrees:
  original/restored Alpha `df780f05a35317c48dced9fefd6354686a03ccb915d630bc20f270abb2f0cc2e`,
  Beta `ffc5918032ed197f67c3bc0679bec8d047ce80b712074e60fefabbfe58b19808`.
  Citation: `raw-tuples.json:16,194`, `raw-tuples-public.json:16`, and original local
  guest read calls `189/191`, `231/233`, `295/297` retained in `trace-points.jsonl`.
- **P3/P4 quota, rename and durable sibling deletion — HELD.** Visible point-limit
  failure pauses the guest and exposes Retry while preserving Beta's original
  manifest/tuple; the unsaved tuple and RAM digest differ. Names survive reload.
  Confirmed visible Alpha deletion removes its option, then Beta reopens after
  another reload with its original tuple and guest observations. Independently
  reconstructed four new ext4 copies for each local/public run: actual read-only
  debugfs reads return `alpha-file\n`, `beta-file\n`, `beta-unsaved\n`, `beta-file\n`;
  the pinned base remains unchanged. Citation: `raw-tuples{,-public}.json:372,384`,
  eight verifier `local-*.file`/`public-*.file` witnesses and corresponding logs.
- **P5 browser/document result — HELD.** Local and production each finish 127/0
  with no unexpected console/page/HTTP errors; production's one favicon 404 is the
  explicit allowed exception. Tab reaches Rename, the 390px view has width/scroll
  388/388, and screenshots visibly retain usable controls. The rendered unified
  guide explains checkpoint-only restores, prefix/quota/retry/deletion and same-origin
  limits; it makes no continuous replay or arbitrary-time seeking claim. Citation:
  `raw-tuples.json:428`, `recorded-errors.json`, `public-recorded-errors.json`,
  original local/public screenshots and the authenticated storage guide.
- **N1/N2 independent adversarial order and metadata — HELD.** In a disposable
  profile clone only, rehydrated original Alpha through the existing checkpoint save
  API using its authenticated original raw frame and shared admitted configuration.
  Before/after Alpha frame and canonical disk root remain exact. Independently chose
  Alpha→Beta, checked each actual paused tuple/held keys/queued input, then resumed
  real guest file/RAM/queued-input reads for both. A literal markup/Unicode session
  name survives rename, reload and another fresh tab without injected DOM or errors;
  Beta's final fresh-tab tuple is still byte-identical to its original. Citation:
  `promoted-report.json:16,23,104,115,196,217`, `promoted-trace-points.jsonl` and
  `promoted-literal-name.png`. Original worker/public profiles were not modified.
- **COVERAGE — sufficient.** `coverage-and-hunks.md` accounts for every changed
  harness/document/generated hunk, including the production-byte branch. Failure-only
  diagnostics and declarative revision/inventory plumbing are explicitly waived.
  Independently authenticated the complete 733-file deployed payload: 728 tracked
  identities, exactly five normalized URL manifests, eleven R2 references and five
  exact release extras. Runtime/native/store/library/loader and pinned 47-file factory
  bytes match accepted T07; its unchanged results carry forward. No uncovered product
  acceptance hunk remains and no unrelated gate was added.
- **SUITE — promoted.** `tools/verify/e9-checkpoint-metadata-critic.mjs` is now the
  post-browser N1/N2 regression in `make verify-E9-T08`, with syntax/source receipt
  and report admission. Its actual narrow command passed all eight checks/errors[];
  report SHA-256 `076281aa2ca3d88b882db278136ba9150ae5586c4522f128606551cfeb9f8555`,
  source `d372c329048d513b9d8ec3ebf3476ed3474450c826269b56112efc922b0a3e17`.
  Updated driver compile and critic syntax pass. All three added admission assertions
  executed directly from the actual wrapper source against these reports; source
  digests and exact affected command are in `incremental-gates.json`. Frozen native,
  built-browser and production results carry forward over test/evidence/status-only
  promotion under the incremental policy.

Verifier packet: `evidence/e9-t08/verifier-final/`, provenance SHA-256
`163679b58d4d8af37f2864de8cf040673bf16ed61b46ce2475f8190fe27bcde8`.
All original full recordings remain at their cited paths; the promoted trace/profile/raw
frames remain in `target/evidence/e9-t08-verifier-promoted/`. No remaining acceptance
or coverage finding.
