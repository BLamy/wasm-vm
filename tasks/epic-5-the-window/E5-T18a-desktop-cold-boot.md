---
id: E5-T18a
epic: 5
title: Prove the local cold-boot desktop contract
priority: 518.1
status: verified
depends_on: [E5-T08, E5-T15d, E5-T17e]
estimate: S
risk: high
capstone: false
---

## Goal

Make the T17 desktop artifact reach a visible, ready desktop from a clean local browser load.

## Boundary

This slice owns only the cold-load assembly and desktop-readiness contract: wallpaper, panel,
and WM menu must become visible without serial intervention. Terminal semantics, pointer/DPR
hit-testing, crash recovery, and the final playbook belong to dependent slices.

## Deliverables

- A deterministic local Chromium cold-boot harness using the committed T17 artifact.
- Explicit desktop-ready markers and a measured cold/warm boot-to-desktop statistic.
- A recorded screenshot and console/error transcript for the successful path.

## Acceptance criteria

- [ ] In a fresh local Chromium context with cache disabled, ten consecutive loads reach the
      wallpaper, panel, and WM menu with no manual serial intervention.
- [ ] The harness records cold and warm boot-to-desktop timings and fails on a timeout, black
      screen, missing panel/menu, unexpected console error, or hidden readiness marker.
- [ ] The run exercises the committed image publication path and leaves the read-only source
      artifact unchanged.

## Verification command

make verify-E5-T18a

## Adversarial verification

Run 25 local Chromium cold boots with cache disabled and independent fresh contexts. Add the
500 ms seatd-start test delay; the boot must still reach the same readiness contract or produce
the documented bounded failure marker. A hang, black screen, missing cursor/menu readiness, or
manual intervention refutes this slice. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This S slice isolates the first user-visible desktop boundary so later input and recovery work
cannot hide a cold-boot regression.

### 2026-09-05 — worker — IMPLEMENTED

- Implementation/evidence commit: `8067a8a135fec13196e7c20b97805b283eb55208`.
- Exact acceptance command: `make verify-E5-T18a` (passed). Supporting checks were `node --check
  web/desktop.js`, `node --check tools/verify/e5-t18a-desktop-cold-boot.mjs`, `bash -n
  tools/serve-dev.sh`, and `node tools/verify/e5-t18a-desktop-cold-boot.mjs --self-test`.
- Evidence: [desktop-cold-boot.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18a/desktop-cold-boot.json)
  (SHA-256 `080613756b41bdae02a34f7f0d9a48ebb5fd2c3b544425e4ef8bf2f7dd6cc624`),
  [desktop-browser-console.log](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18a/desktop-browser-console.log)
  (SHA-256 `eab300085f57a275e76776d526e44807ec95d2b580797849e19478e0de5bcfd5`), and
  [desktop-cold-boot.png](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t18a/desktop-cold-boot.png)
  (SHA-256 `a6d864d255ba8aea89889311b4c2e5d2b795f4ba8eb6a4723bfdda9e5ef71114`). The exact T17
  source image is bound as SHA-256 `467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e`,
  and its split chunk manifest as `1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827`.
- Claim: the local Chromium route ran ten consecutive fresh contexts with cache disabled and no
  serial/input bridge; every run reached wallpaper, panel, and WM-menu readiness. Cold boot-to-
  desktop timings were 505.829–513.291 s (mean 508.946 s), and the cache-enabled warm prime/
  reload measured 514.956/515.739 s. The browser transcript contains no non-favicon console,
  page, or request errors; the report binds the published image/chunk metadata, records positive
  fetches and paused proof state, confirms source-image immutability, and confirms source/dist
  parity. Independent machines, WebKit, and host rr are intentionally outside this slice.

### 2026-09-05 — verifier — VERDICT: verified

- P1 exact-head schema and run contract — HELD. Predicted the committed report would parse as the
  E5-T18a evidence schema and identify exactly ten fresh cache-disabled Chromium contexts plus a
  warm prime/reload. At exact `HEAD` `9976654bbdb91f5521ac0a9a8e88077e1fdada79`,
  `evidence/e5-t18a/desktop-cold-boot.json:2-10,20-29,31-59` records that schema, local
  Chromium scope, ten cold runs, and both warm timings; `:61-151` has ten distinct cold labels,
  positive timings/fetches, and state digests.
- P2 visible readiness — HELD. Predicted every recorded browser label would have a final
  wallpaper/panel/menu inspection with frames presented. The transcript’s final all-ready
  inspections occur for cold-01..10 at lines `391,782,1173,1561,1952,2341,2729,3120,3506,3894`
  and warm prime/reload at `4285,4318`; the screenshot visibly shows all three green markers.
  The committed report’s cold timing vector/count is independently recomputed from
  `desktop-cold-boot.json:31-49`.
- P3 T17 binding and integrity — HELD. Predicted the image and split manifest bindings would
  resolve to the exact T17 artifacts. Report lines `11-18` match the recomputed image SHA-256
  `467306a5…5a5c1e`, manifest SHA-256 `1be3c299…fb4827`, 1 GiB image, 128 KiB chunks, and 8192
  positions. `target/release/wasm-vm chunk-verify target/e5-t17c/chunks/desktop-b` passed; an
  independent check verified all 822 unique object hashes, all 8192 image-chunk hashes, and the
  full image digest.
- P4 errors, immutability, parity, and artifact hashes — HELD. Predicted the report’s JSON,
  transcript, and screenshot hashes would recompute exactly; they do. The transcript contains no
  non-favicon `console.error`, `pageerror`, or `requestfailed` records. Report lines `153-173`
  bind the screenshot/transcript digests, while `:157-169` records source immutability and
  source/dist parity; direct `cmp` of both desktop source/dist files also passed.
- P5 bounded novel attack — HELD. Predicted a readiness-marker mutation would be rejected. The
  existing bounded mutant sets `panel.ready=false`; `node tools/verify/e5-t18a-desktop-cold-boot.mjs
  --self-test` exited 0 with `E5T18A_SELF_TEST=missing-panel-rejected` (`tools/verify/e5-t18a-desktop-cold-boot.mjs:380-402`).
- COVERAGE — HELD. The recorded browser route exercises the added desktop page/readiness logic,
  T17 chunk route, wasm artifact, server mapping, and verifier assertions. Makefile wiring and
  generated dist/roadmap/tasks/service-worker metadata are orchestration/parity artifacts; the
  index discovery link is navigation metadata outside this slice’s acceptance behavior. No
  acceptance-bearing changed hunk remains unexecuted or unexplained. WebKit, independent machines,
  host rr, and the multi-hour 25-boot matrix were not run per explicit scope.

Commands: `git rev-parse HEAD`; `git diff --name-status 3fde7ba..8067a8a`; report JSON/schema and
timing recomputation; `sha256sum` for report/transcript/screenshot/image/manifest; `target/release/wasm-vm
chunk-verify target/e5-t17c/chunks/desktop-b`; independent full image/manifest/object audit;
source/dist `cmp`; transcript error sweep; `node tools/verify/e5-t18a-desktop-cold-boot.mjs --self-test`;
`node --check`/`bash -n`; and `git diff --check`. No implementation, web, harness, or evidence
files were modified by verification.
