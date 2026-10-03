---
id: E6-T11c
epic: 6
title: Present retained 3D resources through the existing virtio scanout path
priority: 525.02698
status: verified
depends_on: [E6-T11b2]
estimate: S
risk: high
capstone: false
---

## Boundary

Support SET_SCANOUT and flush/presentation for renderer-backed resources through
the existing Epic5 canvas path. Preserve ownership across resize, rebinding,
public unref and asynchronous presentation; define orientation and scanout
format conversion. Avoid an extra copy where the measured WebGL2/browser path
allows it, and document necessary copies honestly. Preserve ordinary 2D scanout
and explicit failure behavior; production negotiation is still disabled.

## Presentation completion and bounded profile

The initial compatible path uses scanout 0 and existing single-level RGBA8 2D
renderer textures. Renderer SET_SCANOUT accepts a whole-resource rectangle; unsupported
formats, cropped bindings and invalid dimensions fail before changing the
previous binding. Ordinary 2D scanout keeps its existing contract.

A guest FLUSH completes after its retained GPU snapshot is ready and its owned
pixels have been accepted by the bounded presenter. A separate frame ticket
remains until actual canvas draw, explicit supersession, cancellation or failure.
The device response does not claim physical presentation. Acceptance separately
requires a frame-correlated canvas draw, including guest unref/rebind before rAF.
A successful enqueue alone is not evidence that pixels reached the canvas.

The scanout binding retains the accepted resource generation independently of its
public ID and context membership. Rendering membership checks stay unchanged.
New renderer-backed FLUSH requests after public unref are rejected. Reusing the numeric ID
requires a new successful SET_SCANOUT; it cannot redirect an accepted capture or
frame to the replacement resource.
The presenter keeps at most one pending frame, routes 2D and 3D through the same
display owner, and rejects stale generations after rebinding or reset. Captures
use bounded PBO/fence staging; already issued snapshots have explicit lifetime
semantics independent of later content revisions. Canonical top-down BGRA words
feed the existing built presentation controller, with channel and Y conversion
performed exactly once before that contract. The evidence reports readback,
conversion, ownership copies and presentation upload bytes; no zero-copy claim.

## Deterministic acceptance

`make verify-E6-T11c` records a test-negotiated guest 3D resource reaching the
actual built browser canvas with independent corner/alpha/orientation pixels,
then switches between 3D and ordinary 2D scanout. Exercise resize/rebind/unref
and prove retained frames survive until their presentation completes. Boot the
Epic5 desktop and record unchanged two-dimensional behavior, zero console errors,
screenshots and resource-lifetime counters. Run affected native/wasm/browser
gates and the high-risk final pristine-clone proof.

## Adversarial verification

Alternate scanouts and dimensions while submissions are pending; delete public
handles before display and reuse their IDs. Reject unsupported formats/regions
without stale-frame or cross-context exposure. Sabotage Y orientation and require
the corner oracle to fail. A fixture presentation is not live Mesa bring-up.

## Verification log

### 2026-10-03 — worker — implemented

Runtime and deployable build: `f1aeb2538d1fda62eef7c127925ac043973f8f4a`.
Receipt-only compatibility repair: `fbceeb4d07f1afe24e9e99a01db8b19e181cdd3e`.
Final harness/source head: `85962c4956bad75c7703767650b49763fb0e5945`.
The latter two commits change no emulator, renderer, presentation, or release bytes.
The final fresh clone executes the whole acceptance command at the last head.

Commands (from the repository root):

```sh
EMCC=/tmp/wasm-vm-emsdk/wasm-vm-emcc \
VIRGL_SCANOUT_DESKTOP_IMAGE=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t17c/repro-b/alpine-rootfs.ext4 \
VIRGL_SCANOUT_DESKTOP_ASSETS=/Users/blamy/Documents/Codex/wasm-vm/target/e5-t17c/chunks/desktop-b \
VIRGL_SCANOUT_EVIDENCE_DIR=evidence/virgl-scanout/worker make verify-E6-T11c
# At the receipt-only head above:
python3 tools/virgl-command/scanout-receipt.py evidence/virgl-scanout/worker \
  --recording-head f1aeb2538d1fda62eef7c127925ac043973f8f4a
python3 tools/virgl-command/scanout-cold.py \
  --output evidence/virgl-scanout/cold-clone-final \
  --desktop-image /Users/blamy/Documents/Codex/wasm-vm/target/e5-t17c/repro-b/alpine-rootfs.ext4 \
  --desktop-assets /Users/blamy/Documents/Codex/wasm-vm/target/e5-t17c/chunks/desktop-b
bash tools/deploy-cloudflare.sh
node evidence/virgl-scanout/worker/verify-live.mjs
```

The worker recording proves strict native/Wasm request and canonical state parity
for 12 portable transitions (final scanout digest
`52dc6136cdf7dc062e49df5a7fe054b4ef3ca396171b93d5eb4ffed34e881170`),
6 scanout tests, the existing control/submission/protocol regression gates,
scoped format/clippy/target builds, and 5 existing presentation tests. The hardware
recording has 20,695 assertions and 30 attacks: six independent corner/alpha
pixels, the unchanged captured event161 drawing 256 literal canvas pixels,
resource unref and numeric-ID reuse, context removal, issued immutable snapshots,
rebind/disable/reset/dispose, delayed GPU completion, one queued frame, stale rAF,
2D/3D switching, borrowed 2D copies across Wasm growth, and explicit host failures.
The orientation omission fails the literal top-left pixel oracle. Copy counters
separately report GPU readback, conversion, ownership and presentation copies.
Guest FLUSH acknowledgment means GPU-ready pixels accepted by the presenter;
actual draw or cancellation is a separate frame ticket. This is not zero-copy.

The worker desktop boot reaches the unchanged Epic5 wallpaper/panel/terminal in
203,601ms, with 25 frames and zero browser/application/network errors. Image,
kernel, manifest and all served chunks are hash-bound and unchanged; independent
serial observation matches the proof digest. The public default suite is 127/127,
all three proof-only exports remain absent, and the GPU roadmap says partial with
production acceleration disabled. The committed release was deployed to
https://b5863307.wasm-vm.pages.dev and https://wasm-vm.pages.dev; the fresh live
browser repeats 127/127 with the exact Wasm SHA
`1fbb3fa9b673bb9e6718ee787d25a75e3ed30ec0fdd8a8de1b5952f475e1aeea`.
Only the explicitly allowed favicon404 was excluded. Deployment rewrites of
local artifact manifests were restored to their committed bytes afterward.

Preserved failures and incremental repairs:

- The initial complete worker gate passed all runtime/browser checks but its
  final receipt hit the system Python's missing `hashlib.file_digest`. The
  receipt-only commit replaces that API with streaming SHA and explicitly binds
  the historical recording head; it refuses any non-validator source drift.
  The repaired receipt passed at `fbceeb4d`, retaining the original failed log.
- The first cold clone at `fbceeb4d` is retained as **failed** in
  `evidence/virgl-scanout/cold-clone/`: its actual desktop was ready (27 frames,
  211,576ms), but one kernel download reported Chromium `net::ERR_ABORTED`.
  The loader reads the stream through EOF without cancellation. A separate
  committed 12-request page/worker diagnostic using that exact loader/kernel
  obtained the complete correct SHA in all 12 cases: 4/6 no-store requests
  reported false aborts, and 0/6 no-cache controls failed. Correlated request IDs,
  CDP events and server finish records are retained. The final repair changes
  only the immutable kernel test response to no-cache and adds request metadata;
  cache-disable, fresh context, blocked service workers and fatal treatment of
  **every** failed request remain. The independent critic audited the diagnosis
  before the final fresh-clone repetition. Runtime evidence stays held under
  the incremental policy; this additional clone addresses the observed browser
  environment/harness failure.

Scope: this proves a retained GPU-backed scanout fixture through the real canvas
and preserves ordinary two-dimensional desktop boot. Guest Mesa still lacks
required shader/format/state support; production 3D negotiation stays disabled.
No compositor acceleration, FPS improvement, or 300-MIPS desktop claim is made.

Evidence roots: `evidence/virgl-scanout/worker/`,
`evidence/virgl-scanout/cold-clone/` (failed),
`evidence/virgl-scanout/cold-clone-final/` (final). SHA-256 anchors:

The final full acceptance passed in a pristine clone at `85962c49`, with
empty Git status before/after and all external inputs unchanged. Its desktop
reached readiness in 215,521ms with 28 actually drawn frames; console, page,
HTTP, failed-request and server error arrays are all empty. The screenshot was
visually inspected. The immutable guest image retains its pre-existing foot
configuration warning, visible in the terminal; no guest image edit was made.

- `worker/receipt.json`: `ad5f1dcc3fa2b9cd606277c9ca29d0a47dd169acc64223e64a49293d4cdfaca3`.
- `worker/receipt-repair.log`: `f9fd6c0b4ceda75d1d8263bd639d644e25e856415960171b1a06cd7c5c80b1ac`.
- `worker/native-browser-parity.json`: `4df7433c765c44828e0da6f34a6e16e246a74ff3b025b6161fd21c6d8fac9990`.
- `worker/hardware/report.json`: `86820681b1fc2f9360765758af5c9fe606212705f19a3aaf3445ba868f56be2b`.
- `worker/desktop/report.json`: `69c83ee61aa13ce79604d6d52d62f4ec9426936c055bdc0f677379f112b3de06`.
- `worker/desktop/desktop.png`: `132c6ddd4eb7eaed09b2e03786cc6e95e38afaece3ee138e01ffe08a5d0f46ff`.
- `worker/kernel-network-diagnostic/report.json`: `7bde36afbb82aeee8946800eb5b104700f9c841be01ddc3880bf27302e469f52`.
- `worker/live-report.json`: `35852bc6e7ef5c9d1f46a343454b4a69887152e14a08a2362d61524b77c48942`.
- `worker/deploy.log`: `fa93ac2a611e612dcb3335f0c3e9fc4372695e31726f0e93ad65c06afc6982f4`.
- `cold-clone/report.json`: `d5fc461b9ad597b5bc7745b3beacf7ddc31a67324a363d16e16323be7758e794`.
- `cold-clone-final/report.json`: `d99c7d98cd1dee7e34b70c38b7ff480c8718806f5787c98ec96b76bb32f0da3e`.
- `cold-clone-final/acceptance/receipt.json`: `84c6d8af8e691fc82f0d0778ab6e9a3e73b98750ef74c1d004c8075747552352`.
- `cold-clone-final/acceptance/hardware/report.json`: `a774880b7bf7908d89d14589da3ce9d599e2efb60995067f785984028fb2d04c`.
- `cold-clone-final/acceptance/desktop/report.json`: `04c04d4ac2335cbac2592542e493ab6526ecdfccdf8cfa15966a12a769b2cada`.
- `cold-clone-final/acceptance/desktop/desktop.png`: `ef137887dc641e5856f31b444f012601d125bdf6dc1ffe5489de50a6307bf7a7`.

### 2026-10-03 — independent verifier — VERDICT: verified

VERDICT: verified

- S01–S22 — HELD. The immutable predictions preceded implementation. Own actual
  GPU/canvas attacks record 3,118 assertions, 303 records and 93 browser turns;
  17 instrumented native tests pass. Captured A survives real GPU write B,
  context deletion and public-ID reuse; only a new binding paints the replacement.
  Stale callbacks cannot consume pending 2D frames. Strict queue/authority,
  full-u64 fences, ownership across Wasm growth and failure/reset paths hold.
- S22 sensitivity — HELD. Independent served-source omissions of Y conversion,
  GPU signal readiness and scheduler-token validation each fail their intended
  exact oracle. Actual live pixels were visually inspected before teardown.
- COVERAGE — HELD with exact narrow private-invariant, host-diagnostic and type
  waivers listed in `evidence/virgl-scanout/verifier/coverage-review.md`.
  LLVM/V8 exports bind changed hunks to recordings; unchanged B2/dependency
  findings carry forward by source hash and final same-source regression.
- S20/S21 portability and ordinary desktop — HELD. Independent audit passes
  3,524 binding/assertion checks. Final clone at `85962c49` passes the full gate,
  clean before/after with unchanged explicit fixtures; its desktop has 28 drawn
  frames and empty error arrays. Default local/live demo remains 127/127 with
  exact default Wasm and all three proof exports absent. The first cold remains
  failed; the independently audited bounded network diagnosis and harness-only
  header/metadata correction justify the final fresh-clone repetition. No
  failed-request filter was added. Both initial harness failures are preserved.
- SUITE: retain own literal wire/GL/pixel oracles, replayable attacks, three
  sabotage controls, two independent native cases, and binding/coverage audits.
  No runtime file was changed by this verifier. Production 3D stays disabled;
  live Mesa, FPS, compositor acceleration and zero-copy remain unclaimed.

Detailed predictions, points, commands, calibration disclosures, provenance and
verdict: `evidence/virgl-scanout/verifier/review.md` and `observations.md`.
Commands: `node evidence/virgl-scanout/verifier/run-attacks.mjs` for `baseline`,
`orientation`, `early-readback`, `stale-delivery`; instrumented
`cargo test --locked --manifest-path evidence/virgl-scanout/verifier/native/Cargo.toml -- --nocapture`;
`python3 evidence/virgl-scanout/verifier/coverage-audit.py`, `audit-network.py`,
`audit-evidence.py`. Build objects/profiles are excluded under `target/`.
The reviewed runtime is `f1aeb253`, receipt repair `fbceeb4d`, final harness
`85962c49`, and formal worker submission `ad88508e`. SHA-256 anchors:

- Predictions: `274196136e3bf17fa5c8a3f9e190dc29b99ede19d39c276fd4d2f2c6afd7d982`.
- Verifier manifest: `7808e4a2b968017570ddb87c3814760cca22c652dc934e38a78ed738c6fabcf5`.
- Verifier review: `8ce9853d0041dab19f7cf6a79e2bf43a2e902ef54fffb0adbb33cbccaa007126`.
- Independent attacks: `e48f659aaa8b45ab5c50272caa11fb66153c4ffd3fbcf2783728dbebe5995284`.
- Final audit: `9b2ede7897732dd12e3475fc00d216bc7aa80d63b593f956e872176b4a6deee9`.
- Final cold receipt: `84c6d8af8e691fc82f0d0778ab6e9a3e73b98750ef74c1d004c8075747552352`.
