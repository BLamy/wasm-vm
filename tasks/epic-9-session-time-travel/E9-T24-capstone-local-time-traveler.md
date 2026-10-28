---
id: E9-T24
epic: 9
title: CAPSTONE locally saved replayable VM sessions with a time-travel UI
priority: 524.924
status: implemented
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

- [ ] From a fresh browser profile, record a software Linux session with real input, file edits and a local witnessed network exchange; separately demonstrate a bounded accelerated-guest session with actual physical GPU result witnesses, explicitly labelled as bounded rather than full Omarchy qualification.
- [ ] Reload, choose each saved session, seek backward/forward and step at exact positions; match CPU/RAM/device/disk state and applicable GPU result witnesses against the recording, with zero replay egress.
- [ ] Branch from the past, edit a file and prove parent/sibling history unchanged; export/import one session into another fresh profile and replay it.
- [ ] Exercise visible timeline, compatibility, storage and recovery states, verify the existing guest/fast-boot regressions, record bounded final clean-head evidence and obtain fresh actual Daybreak independent verification. The existing exact-head independent-clone build checks may be carried forward when their source boundary is unchanged; no new long cold boot is required.
- [ ] Update the unified docs and roadmap capability, build locally, deploy through the existing Cloudflare process and directly verify the public path with original sources and zero unexpected errors.

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
