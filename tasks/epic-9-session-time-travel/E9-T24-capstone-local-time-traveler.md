---
id: E9-T24
epic: 9
title: CAPSTONE locally saved replayable VM sessions with a time-travel UI
priority: 524.924
status: verified
depends_on: [E9-T08, E9-T13, E9-T18c, E9-T19, E9-T20, E9-T21, E9-T23]
estimate: S
risk: high
capstone: true
---

## User scope amendment — 2026-10-28

The user waived the long original-cold boot/replay campaign. Full Omarchy
qualification, a new cold first-frame/browser-profile allowance and the complete
two-profile performance campaign are outside this capstone's accepted scope.
They remain unproven, with original criteria/failures preserved in cancelled
E9-T22u/T22p/T22c/T22d. Remove T22d as an integration prerequisite; do not
advertise its numeric budgets or full-desktop qualification as verified.

Keep the software Linux user flow and bounded accelerated-guest integration,
including actual recorded input, files, network witnesses, exact functional
seeking, branching, export/import, recovery, independent Daybreak review and
production verification. A bounded GPU guest must be labelled as such; it is
not the full frozen Omarchy workload. Neither the long original cold boot nor
its whole-history replay may be relaunched by this task without a new user
request.

## Goal

Ship a user-visible local time traveler that records, reopens, rewinds and branches real VM sessions.

## Boundary

Final integration, unified Docstream documentation and production publication of the accepted boundaries. No new replay semantics or hidden fixture substitutions belong in this capstone.

## Acceptance criteria

- [x] From a fresh browser profile, record a software Linux session with real input, file edits and a local witnessed network exchange; separately demonstrate a bounded accelerated-guest session with actual physical GPU result witnesses, explicitly labelled as bounded rather than full Omarchy qualification.
- [x] Reload, choose each saved session, seek backward/forward and step at exact positions; match CPU/RAM/device/disk state and applicable GPU result witnesses against the recording, with zero replay egress.
- [x] Branch from the past, edit a file and prove parent/sibling history unchanged; export/import one session into another fresh profile and replay it.
- [x] Exercise visible timeline, compatibility, storage and recovery states, verify the existing guest/fast-boot regressions, record bounded final clean-head evidence and obtain fresh actual Daybreak independent verification. The existing exact-head independent-clone build checks may be carried forward when their source boundary is unchanged; no new long cold boot is required.
- [x] Update the unified docs and roadmap capability, build locally, deploy through the existing Cloudflare process and directly verify the public path with original sources and zero unexpected errors.

## Deterministic acceptance

`make verify-E9-T24`. This target records the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Select independent seek positions, remove caches/network, and replay on the declared supported host profile. Reject canned footage, a software frame labelled GPU, hidden live requests, changed fixtures or an unverified implementation claim.

## Verification log



### 2026-10-28 — worker — bounded capstone implemented; final critic pending

Code head: `86e694f0a25c0026dc02f8ec10e1cc6383192f6e`. This is an implementation claim, not independent verification.
The human-waived T22u/T22p/T22c/T22d criteria remain cancelled and unproven. No long
original Omarchy cold boot/replay or full performance campaign was restarted.

- `make verify-E9-T24 E9_OUT=target/evidence/e9-t24-exact-capstone-v4 E9_RECORDED_INPUTS=evidence/e9-t24-inputs-0e47542da/recorded-inputs.json`
  passed at `9496b8e645eccf5c1a0104bc5dd19a505c429478`; top SHA
  `22dafc2e322e67aaaa0fd0c4d3ab2fb7b31783adde9d76d2d0c15a5e3c9039df`.
  Includes authenticated unchanged component inventories, task/fmt/docs/source+dist,
  guest/fast-boot regressions, 127/0 demo, actual accessible timeline, full software
  Linux file/input/ten owned HTTP exchanges and exact zero-egress replay with independent
  wire/literal-file oracles, paged full/delta physical GPU replay with independent
  CAS/RAM/native/literal readback oracle, real four-recording fresh-profile transfer,
  archive mutation/quota/cancel/closed-refresh/host-profile refusals and independent
  archive/native oracle. T23 recovery/native and actual clone build findings carry
  only across the identical runtime/package boundary; partial/failed clone receipts
  keep their original status and limitations.
- Actual Daybreak readiness identified a non-final seek/step proof gap. The complete
  software case in `target/evidence/e9-t24-ui-witness-v5` passed visible controls,
  immutable middle witness and full 20,181,054-byte middle/forward source/import
  parity; that overall run stays **failed** on a GPU frontier-only diagnostic call.
  A second actual Daybreak root classified this as `harness-api`, with no product
  change or guard weakening required. `target/evidence/e9-t24-gpu-ui-witness-v6`
  then passed the GPU-only missing proof using the existing guarded continuation
  capture for interior steps, while retaining inspection at final frontier.
  Both readiness roots are preserved under `evidence/e9-t24-daybreak-*-readiness-v1`;
  neither is final acceptance. Earlier v1/v2/v3 failures and all original bytes remain.
- `python3 /private/tmp/e9-t24-publish.py --output target/evidence/e9-t24-production-v1`
  ran the existing Cloudflare deployer with production branch `main`; exited zero,
  preserved exact staged manifests and restored only their known URL transforms.
  The source remained clean at this code head. Public root, guide/catalog, original
  runtime, case studies and all staged manifests matched all 14 expected SHA-256s.
- Direct main-site browser suite passed **127/0**, zero console/HTTP errors. The final
  current two-profile harness then passed at `https://wasm-vm.pages.dev/` with fresh
  persistent source/import profiles, reload, visible keyframe/forward/back controls,
  immutable checkpoint witness checks, complete source/import stepped bytes,
  final software 27,892,012 bytes and GPU 8,047 bytes equal to the recording,
  physical green GPU pixel `[0,255,0,255]`, guide desktop/phone captures, zero
  unexpected errors/blocked network. It does not depend on the exporter's cache.
  Raw reports, native states, archives, saved IDB, traces and screenshots remain
  in the indexed roots. Unified Docstream guide and honest roadmap are built/published.

Portable claim: `evidence/e9-t24-capstone-86e694f0a/worker-report.json`, SHA
`e1a927ca9e5eb66928cfaa071ea57d96f97ea7f4f37b545a4809a2173aabd2ce`; index SHA `172cd600457f001a9d8fa5b25c51d6978103523f2a4913c14bf1824ee433b22c`.
The complete final public-path proof exercises the current exact harness head and
closes the readiness demand without repeating unrelated passed gates or boots.
A different fresh actual Daybreak FINAL critic must audit coverage, concrete state,
novel attacks and the live release before this task may become `verified`.

### 2026-10-28 — fresh actual Daybreak Blue FINAL verifier — VERDICT: verified

- **P1 identity/inventory — HELD.** Predicted both portable claim digests and every
  indexed original would authenticate at code head `86e694f0a25c0026dc02f8ec10e1cc6383192f6e`.
  Independently hashed all **529** indexed files (**3,711,194,150 bytes**) with no
  missing, extra, size-mismatched, hash-mismatched or symlink entries. Worker report
  SHA is `e1a927ca9e5eb66928cfaa071ea57d96f97ea7f4f37b545a4809a2173aabd2ce`;
  index SHA is `172cd600457f001a9d8fa5b25c51d6978103523f2a4913c14bf1824ee433b22c`.
- **P2 software Linux — HELD.** Predicted 100 scheduled UART offers, ten independent
  owned HTTP exchanges, exact final replay and zero replay egress. Original
  `target/evidence/e9-t24-exact-capstone-v2/software-network/report.json` and raw
  `receipts.json` contain 113 network events across ten one-request/one-response
  connections, ten distinct 1,024-byte bodies, `scheduledOffers: 100`, and
  `replayEgress: {fetch: 0, sockets: 0}`. Final and replay are both
  `(516777216,516731181,853,before,2)`, 27,892,012 native bytes, SHA-256
  `1a46f5bdad9e8416bd2f2c2a6638dc2dfd60c785e340bc965803c04403bc7304`.
  The independent literal-files oracle binds the same real file, entropy and final
  HTTP body bytes; the independent wire verifier accepted all ten exchanges.
- **P3 bounded physical GPU — HELD.** Predicted a genuine physical renderer, paged
  ancestry, independent RAM/native/readback binding and preserved failure guards.
  `target/evidence/e9-t24-exact-capstone-v2/paged-gpu/report.json` identifies
  `ANGLE Metal Renderer: Apple M4 Max` and records one `WVGPUB01` base plus three
  `WVKEYF01` checkpoints, two incremental-start windows and the final tail at
  `(690000,689834,38,before,1)`. Independent CAS reconstruction in
  `independent-paged-files.json` matches every RAM/state digest and literal green
  readback `[0,255,0,255]`. The deliberate `SESSION_EXPECTED_GPU_ERROR_1205` remains;
  final inspection succeeds while production continuation/frontier guards remain
  unchanged in `web/session-gpu-replay.js` and `web/session-gpu-replay-worker.js`.
- **P4 archive, cancellation and retention paths — HELD.** Predicted four real
  fresh-profile archive round trips and fail-closed malformed/quota/cancel/closed/
  underreported-host behavior. `target/evidence/e9-t24-exact-capstone-v4/bundles/report.json`
  has four source/import native-byte matches and **80** preserved mutation/refusal
  results with zero writer calls. Pre-authorize cancellation is not retained;
  commit-durable cancellation is retained; quota reports `RetentionLimit`; closed
  refresh/preview leave the DOM and original unchanged; unsupported GPU host limit
  is refused. `independent-files.json` independently proves complete closure and
  exact source bytes.
- **P5 Daybreak readiness repair — HELD incrementally.** Predicted v5 would remain
  failed only at the wrong GPU interior diagnostic while its completed software
  result stayed valid. `target/evidence/e9-t24-ui-witness-v5/report.json` preserves
  20,181,054-byte source/import middle and +1 parity and 27,892,012-byte final parity,
  then fails only because `inspectSelected()` requires an exact complete frontier at
  valid interior 20001. The independent Daybreak diagnostic in
  `evidence/e9-t24-daybreak-interior-readiness-v1/diagnostic.md` permits only guarded
  `captureSelectedBranch().capture.native`; v6 SHA
  `0f047809a544e54ff05b2582d71e16205899ece36fe802ec955a097296377625`
  passes that exact GPU-only repair. No private/frontier/failed-job guard or heap
  assertion was relaxed; earlier v1/v2/v3 failures stay failures.
- **P6 final main-production proof — HELD.** Predicted the complete current harness
  would prove both profiles on the actual public URL. Production report SHA
  `b8ae94bd0ed03bee63820684b45bab34c2e0edc7741589dcbce608af98842ec9`
  records empty persistent source/import profiles, import+reload, visible keyframe/
  forward/back, immutable recording-side witnesses and exact source/import native
  parity: software middle/+1 20,181,054 bytes and final 27,892,012 bytes; GPU middle
  7,756 bytes, guarded +1 15,950 bytes, final 8,047 bytes and pixel `[0,255,0,255]`.
  Errors and blocked network are empty. Deployment/public/demo report SHAs are
  `6fb67f8aa31d7fef9fc6dab7fffd05a017f6cdeb0f93f39eb43d2c6d7091f508`,
  `88b8dc7da6884e77c5682a34fcec015ba39f9ca14433a2447d8d50f4f94afd29`,
  and `59b44e20b8a029f2336bdb33a86db30956542ed7ae5bdebdce3d0588bee918c7`.
  I freshly fetched all 14 cache-busted public assets read-only and matched their
  expected sizes/hashes; the native demo report is 127 passed/0 failed/zero errors.
- **P7 unchanged carried boundary — HELD.** `git diff` confirms no runtime/package
  change across the carried T23 boundary. Browser-shipped Wasm SHA
  `00159a8cb8f880b0dc88412c5a7009e8a74dfa546c47c36dd0d6859125873a87`,
  stamp SHA `ac678419d5d27f56488c71940286d32901a55aa750bdf6c4508c9075c5eb3e1e`
  and build `8a6b47429414270020b818211614666d446233de92fcb1515830ea6cbb1991b6`
  match. T23 verdict `dffece65667d1d7e239f93d0a1387bed42d1b60b13baa2bd3784e5a499ea73ae`
  carries its 31 storage/58 GPU traces and other stated suites. The frozen clone
  capacity gate remains **FAILED** and the T23 critic clone remains **PARTIAL**;
  neither was relabelled. The human waiver leaves original Omarchy cold/performance
  qualification unproven and no cancelled workload was restarted.
- **COVERAGE — HELD.** `1d3976142..86e694f0a` was mapped hunk-by-hunk. v2 exercises
  original software/GPU recording; v4 exercises inventory/controller cleanup,
  policy/fmt/docs, guest/fast-boot, shipped UI, bundle import and refusal/retention
  paths; v5 exercises the failure arm; v6 exercises the selector and guarded interior
  capture; production exercises both complete current UI branches and URL handling.
  The upstream `dc0264326` paged proof exercises incremental ancestry/full-RAM seeding
  in `web/session-gpu-replay-worker.js`; exact source/dist equality, Rust candidate
  admission in `crates/wasm/src/session_gpu.rs`, and the 82-file build closure were
  checked. Pure declarations/generated docs plus exception-only path-containment,
  404 and trace-stop diagnostics are narrowly waived as fail-closed verifier code,
  not runtime behavior. No ignored test, disabled assertion, hidden fixture fallback
  or weakened production guard was found. `86e694f0a..93ca7695` contains only task,
  queue and portable evidence. PR 625 is still OPEN+DRAFT at `93ca7695`; all 47 native
  PRs remain open/unmerged.
- **NOVEL ATTACK — HELD.** Before inspection, predicted an independently selected
  GPU point/input would remain cryptographically bound. At point-0
  `(10000,9980,3,before,1)`, independently recomputed witness
  `b94f031f167363382cfce1d886c24ce06616fcc34bf9060ce203c5a32679c6b0`;
  flipping native byte 137 produced undeclared witness
  `bab6e2d666b7531776cdf4e104a1acc5eff4ad7059078fed46469e834113c371`.
  Two optional scratch browser attempts are not counted: local Chrome exited before
  navigation. The deterministic independent mutation attack supplies the required
  novel falsification without touching original evidence.
- **SABOTAGE — HELD.** Predicted the independent paged oracle would reject a changed
  physical result. In a scratch copy only, changing replay pixel to `[1,255,0,255]`
  made `tools/verify/e9-capstone-paged-files.py` exit 1 at line 148; indexed originals
  remained byte-identical. Scratch record:
  `target/evidence/e9-t24-final-verifier/sabotage-oracle.log`.
- **SUITE:** retain `make verify-E9-T24`, the checked-in loader/build-closure tests and
  the authenticated worker evidence as the recurring suite. The one-off mutated
  scratch corpus is discarded after preserving its verifier log: the permanent
  independent oracle already asserts the exact stable green pixel and all RAM/state
  bindings.

Final verifier gates: `cargo fmt --all --check`; JS syntax checks for the three changed
harness/oracle modules; Python AST checks for capstone/bundle controllers; build-closure
`--check`; five build-closure unit tests; and 13 loader fail-closed tests — all passed.
The accepted result is software Linux plus bounded physical-GPU functional integration,
not full Linux/Mesa/Omarchy GPU qualification and not the waived cold/performance campaign.

### 2026-10-28 — worker — mechanical verifier receipt preservation

The fresh actual Daybreak root `01a18490-e730-7530-9cf4-b92b59bef28f` / turn
`01a18490-e9f1-70e3-beac-6504e166cb56` completed with `VERDICT: verified` and
set this task's status itself. The parent only preserves/commits those edits.
Portable final report: `evidence/e9-t24-capstone-86e694f0a/daybreak-final-v1/report.md`,
SHA `28cc4f7dd68e68ceb48ffca3a95ffe60433d8ebed000bd9d148ccc81f0e24b53`; routing SHA
`668dc89855a31398c83b48e879382018e164ae70908a547db705f80c93e88af3`. Original verifier artifacts remain indexed locally;
two pre-navigation Chrome startup failures were never labelled passing browser proof.
Verified roadmap/status publication follows with the unchanged runtime identity.
