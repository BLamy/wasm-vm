---
id: E6-T10c
epic: 6
title: Freeze browser renderer capabilities against the captured guest corpus
priority: 525.0269
status: implemented
depends_on: [E6-T10b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Use the pinned guest corpus and shader bridge to select the browser renderer
backend and write docs/gpu-3d-decision.md. Map every observed opcode/shader/API
feature to supported, implementable or rejected browser behavior. Define exact
capsets, context isolation, resource/scanout lifetime, asynchronous fences and
snapshot/device-loss behavior. Preserve the original E6-T10 coverage requirement;
no observed family may be left TBD or falsely advertised.

## Deterministic acceptance

`make verify-E6-T10c` cross-checks the decision matrix against corpus histograms
and exercises three representative translated shader patterns with pixel oracles
on the supported browser matrix. Unsupported browsers are explicitly gated.

## Adversarial verification

Attack the three hardest claimed mappings, verify exact guest version/driver
claims and browser limits, and reject any capability not implementable by the
chosen API. No Mesa initialization or Hyprland compatibility claim until proven.

## Verification log

### 2026-10-03 — worker — activated (UTC)

Parent `0abd0745` independently verified E6-T10b; its complete reference corpus
is published in PR #404. This task is prioritized ahead of the independent
desktop-release lane to continue the user's explicit guest-graphics offload
request. No other task remains active. The current corpus contains 33 command
families and 19 distinct VERT/FRAG TGSI bodies; Xwayland contributes the most
complex shader operations. The existing shader bridge remains a bounded
prototype, not support for all recorded shaders or a guest renderer. This slice
will freeze the backend/feature contract and prove representative browser
mappings without advertising unimplemented guest capabilities.

### 2026-10-03 — worker — implemented (UTC)

Frozen implementation `6cf7981877fc4dab83cd902cd69d56a8795f051b` selects WebGL2 /
ESSL300 and records every observed family in `docs/gpu-3d-contract.json`, with
`docs/gpu-3d-decision.md` defining lifetime, capset, failure, snapshot and activation
rules. Exact active advertisement remains VIRGL=false / zero capsets / empty
payload list. A native C oracle checks every pinned capset field and boolean mask;
no speculative positive capset profile is presented as implemented. All 19 real
shader bodies remain rejected (15 unsupported-feature, four parse-error), and
strict PRECISE and Z32_UNORM are explicitly rejected. This is a contract/prototype
claim, not a working guest GPU, Mesa initialization, Hyprland compatibility or
performance claim.

Recorded command:
`EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc VIRGL_CONTRACT_EVIDENCE_DIR=evidence/virgl-contract/worker make verify-E6-T10c`.
Evidence: `evidence/virgl-contract/worker/acceptance.log`, `receipt.json` (SHA256
`50b671b094c04d6b1d95eea802ada0c4e1f69689ef9e1acb18c0e800723d4daf`), and
`browser/report.json` (`555ddecbf28bdf693a593247df26ff94678b583ecd28b012f96e818d7a0715b1`),
plus its hash-bound `browser.png`. The receipt binds the complete contract/harness
sources, four validated capture manifests, all shader rejections and the ABI
layout (`ee3daa5d82dc8402aa3b1350be2d4b0e4c032cb0c9ca0341a2549f1535f1e76f`).

The gate passed Python/Node syntax, four negative-gate tests (multiple attacks per
test), unchanged native/Wasm bridge builds, raw capture validation and matrix
coverage (33 commands, eight objects, 37 shader instructions, 17 APIs, two stages,
nine resource formats plus vertex formats29/30). Headed Chrome154.0.8037.93 on
Darwin25.6.0 arm64 / ANGLE Metal AppleM4Max passed nine literal translated draws /
4336 exact pixels with zero console/page/request errors. Four distinct GLSL probes
checked negative precise compilation, BGRA/BGRX/RGBX sampling patches, manual
A/B/A state replay and event-loop fence progress. Twenty-one format allocation/FBO
probes and actual host limits are recorded. These narrow probes do not prove
complete virtual-context isolation or guest execution. Browser qualification is
default-deny and restricted to the measured prototype host; production3D remains
disabled everywhere.

Risk-tier scope: isolated docs/contract/tooling only, no Rust crate, production
web, guest image or deployment changes. The affected native/Wasm build and browser
paths ran once at the frozen head. No portability/deployment claim requires a
cold clone for this medium-risk slice; no broad workspace gauntlet or live deploy
is substituted for the named acceptance.
