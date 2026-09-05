---
id: E5-T18a
epic: 5
title: Prove the local cold-boot desktop contract
priority: 518.1
status: implemented
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
