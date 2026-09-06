---
id: E5-T18e
epic: 5
title: Publish the desktop bring-up playbook and final boot proof
priority: 518.5
status: implemented
depends_on: [E5-T18d]
estimate: S
risk: high
capstone: false
---

## Goal

Turn the completed local bring-up work into a reproducible, reviewed operating playbook and
final rebuilt-artifact proof.

## Boundary

This slice owns only the cross-slice failure inventory, docs/desktop-bringup.md, boot timing
reporting, and final clean rebuild plus cold-boot sign-off. It does not add new compositor,
input, or pointer behavior.

## Deliverables

- docs/desktop-bringup.md with the debug-channel cheat sheet and every encountered symptom,
  diagnosis command, fix, and expected recovery outcome.
- A cold/warm boot-to-desktop timing report tied to the exact committed image/profile.
- A deterministic final verifier that rebuilds the image from the committed manifest and runs
  the local cold-boot gauntlet without dirty-image or cache shortcuts.

## Acceptance criteria

- [ ] The playbook covers every failure recorded by E5-T18a-d, including seatd/udev/permissions,
      runtime-directory, renderer, input/XKB, restart, and getty-fallback symptoms.
- [ ] The exact rebuilt artifact is hash-bound in the report, and the local cache-disabled
      25-boot gauntlet has no hang, black screen, missing cursor, or missing menu.
- [ ] The report records cold and warm boot-to-desktop timings and the final verifier passes
      from the committed manifest with no undeclared hand edits to the image.

## Verification command

make verify-E5-T18e

## Adversarial verification

Have the fresh verifier run the documented failure drills using only the playbook: remove the
video device, delete runtime-directory initialization, force gles2, and trigger three crashes.
Each diagnosis must complete in five minutes and match a documented symptom/fix. Mutate the
published image or manifest after the rebuild; the verifier must reject the stale hash rather
than accepting dirty-image evidence. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This final S slice makes the debugging knowledge and exact rebuilt-boot proof durable before
downstream resize, performance, and capstone work can depend on T18.

### 2026-09-06 — worker — STARTED

Consolidate the verified T18a-d failure inventory without changing compositor/input
semantics. Freeze the complete existing package/custom-file manifests, rebuild the
T18d recovery-enabled interactive image from those committed inputs in a fresh
shared-folder clone, and bind 25 cache-disabled browser boots plus a cache-enabled
prime/reload timing pair to that artifact. Independent machines, WebKit, and rr
remain out of scope. Continue stacking; merge all PRs only at the Epic 5 milestone,
then reuse the prepared Omarchy filesystem, deploy production, and stop before E6.

### 2026-09-06 — worker — IMPLEMENTED

The committed manifest rebuilt the selected interactive/recovery image from scratch
in `/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo` at
`9ed9e0d1c57daf64f6362193bc30b79482dd3258`. `make verify-E5-T18e` built the
image, native chunk tool, and browser WASM with inherited Rust/Cargo overrides
scrubbed. The ext4 is SHA-256
`e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`;
both full manifests and all 8192 chunk positions match the committed locks.
Original rebuild/functional evidence is preserved in `evidence/e5-t18e/initial/`.
Its page-only cache counter did not prove dedicated-worker cache disabling, so
that first run is explicitly not the final cold-cache verdict.

The corrected observer ran in the separate clean clone
`/Users/blamy/Documents/Codex/e5-t18e-cache-final.BHmnqG/repo`, frozen at
`5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b`, with:

```sh
E5_T18E_REQUIRE_HEAD=5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b \
  E5_T18E_REUSE_BUILD=/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo \
  make verify-E5-T18e
```

Exit 0: `E5T18E_PASS=25_COLD_2_WARM`. All 25 cold contexts and both warm
cases rendered the desktop, the independently specified 94-pixel cursor, and a
Terminal opened by a real launcher click, with zero browser errors. The 9478
observed cold worker chunk fetches all used the network, with no missing or cached
responses. Warm reload recorded 313 cached and 66 network responses. Each case has
desktop/Terminal PNGs and framebuffer hashes, guest architectural digests,
scheduler/fetch state, raw UART, and complete worker ResourceTiming entries.
Cold times were 871.458–905.866 s (mean 884.350 s); warm prime/reload were
870.966/898.055 s under 13-cold-plus-warm concurrent load. This is repeatability
evidence, not an isolated performance or cache-speedup claim.

Final record: `evidence/e5-t18e/desktop-bringup.json`, SHA-256
`e056f3ef0f3e0a4c682eb6e40138f8f2c4e30cceb56bcd19fc0a6d6ad9aacd31`.
Source/runtime/publication binding:
`d6ad7a2abba368bea58142ad8cb0d6f8881916dd048e4fdd4136c5dcb84dd290`.
`publication.json`, `acceptance.log`, `cache-calibration.json`, `build.log`, and
`browser-console.log` are copied byte-identically from that clone alongside all
27 case recordings. The original rebuild's binding is
`0e41e0d9f9fa9ccc3277867fc0146d5c4d856959e92b5de947bd52ded7a149c2`.

The fresh critic found and reproduced reuse-preflight gaps, not runtime failures.
Proof-only guard head `0d966c1fb8ef31e05c2bca52e1a191d9de235af3` binds the
reference to Git and checks transitive build inputs, non-proof Makefile changes,
and tracked/untracked/ignored Cargo/toolchain inputs in both checkouts. The critic
confirmed the actual frozen run met these stronger conditions; no image/runtime
change or repeat guest run was needed. See its `reuse-final-guard-review.md` and
preceding preserved findings under `evidence/e5-t18e/verifier/`.

At that guard head, the following recorded 30 passing tests in
`evidence/e5-t18e/guard-unit-tests.log` (SHA-256
`ed56a3fba670db08b609c1961ae42b687308457772436d60bd8a982033977040`):

```sh
node --check tools/verify/e5-t18e-desktop-bringup.mjs
node --test tools/verify/e5-t18e-publication.test.mjs tools/verify/e5-t18e-verifier.test.mjs tools/verify/e5-t18e-cache.test.mjs tools/verify/e5-t18e-cache-verifier.test.mjs tools/verify/e5-t18d-surface.test.mjs
```

The playbook inventories T18a-d failures and distinguishes cold configuration
faults from post-readiness removal. Existing runtime/recovery verification carries
forward unchanged. Await the fresh critic's final aggregate/PNG/cache audit;
the worker does not set `verified`. Production deployment and all merges remain
held until the requested Epic 5 completion milestone.
