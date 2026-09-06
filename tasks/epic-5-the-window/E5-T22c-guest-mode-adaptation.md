---
id: E5-T22c
epic: 5
title: Apply guest desktop hotplug modes without restarting the compositor
priority: 522.3
status: in-progress
depends_on: [E5-T22b, E5-T22e]
estimate: S
risk: high
capstone: false
---

## Goal

Make the selected, pinned Weston DRM/pixman desktop adopt host hotplug modes
in place, with live clients, and record the complete guest round trip.

## Boundary

Own only the selected compositor's mode-adaptation boundary and its reproducible
guest image integration. Keep Weston/pixman and the existing desktop identity.
Do not substitute a CSS resize or compositor restart for a real output mode.

## Deliverables

- Bounded guest adaptation only if the recorded baseline proves it necessary.
- Committed source/package/custom-file manifests for the resulting image.
- Before/after real Wayland current-mode and DRM EDID observations.
- Recorded browser output/frame sizes, timing, live-client and error checks.

## Acceptance criteria

- [ ] Requests across 640x480 through 2560x1600, including odd dimensions, yield
      the requested real guest output mode and scanout within two seconds after
      release in the stated local configuration.
- [ ] The current Wayland output mode, preferred DRM EDID dimensions and canvas
      backing dimensions agree. Use a query supported by the selected Weston
      guest; do not claim that the wlroots-only wlr-randr tool is present.
- [ ] Open foot clients survive the mode transition, retaining their content.
      The compositor PID remains unchanged; no renderer switch or manual image
      edit substitutes for the in-place output change.
- [ ] Initial boot uses the current requested mode. A repeat request or one-pixel
      change is safe; final image and browser/guest evidence are hash-bound.

## Verification command

make verify-E5-T22c

## Adversarial verification

Change modes again while the previous output transition is pending. Probe odd
one-pixel changes that preserve EDID physical-size rounding, minimum/maximum
modes, and output replacement with live clients. Independently decode the guest
mode/EDID and compare timestamps to host request and matching-frame delivery.
A retained old-size frame or killed client cannot count as successful resize.
Add one bounded independent mode sequence; sabotage the adaptation proof once.
Carry the established host and stale-resource boundaries forward.

## Verification log

### 2026-09-06 — coordinator — planned

Third ordered S replacement for E5-T22. Read-only inspection of pinned Weston
12.0.4 found that its default compositor logs and ignores enabled-head monitor
changes. First reproduce the selected guest's behavior, then choose the smallest
bounded adapter or pinned patch that satisfies the real mode-change contract.

### 2026-09-06 — worker — in-progress

T22b independently verified at `f62fec0d`, with the built demo handoff at
`99cfa600`. Start by recording the unchanged T18e desktop image's real browser
hotplug baseline. Only then choose the bounded Weston/pixman integration; keep
the compositor process and live clients, and preserve the original image.

### 2026-09-06 — worker — baseline reproduced

`node tools/verify/e5-t22c-baseline.mjs` at `7808d8d0` boots the unchanged
T18e image (SHA256 `e75b04caadd9616915b323497c92df1d5a9d11d55c877afcc95d208dde302416`)
in the real browser worker. After an 803x603 request, the guest consumes the
display event (`pendingEvents=0`) but keeps resource 3 at 1280x800 / 12,288,000
resource bytes through the 8,479 ms final sample. Weston PID 961 is unchanged;
its log explicitly reports ignoring the monitor change. Zero browser errors.
Evidence: `evidence/e5-t22c/baseline/baseline.json` SHA256
`84050d0097cd794267da3fa2aa70766261c65f55002a9930deeffb5c53105cfd`, raw serial
and screenshot alongside it. The initial `before.edid` serialization was empty;
all post-request samples preserve the full 128-byte EDID, and the harness has
been corrected for future runs without rewriting this original record.

Choose a small pinned in-process Weston module using its public DRM output API:
wait for deferred disable completion before reconfiguring, re-enable the output,
and preserve the compositor/client processes. A bounded EDID watcher also sees
one-pixel updates which do not change rounded physical monitor dimensions.
The independent read-only Wayland observer will compare actual output events
and guest DRM EDID; neither the adapter nor browser target dimensions supply its
current-mode result. This is implementation direction, not a verified claim.

### 2026-09-06 — worker — rejected disable/re-enable iteration

The first adapted image (`66ba6844ff324fb306447c1e7988f2973b50c91d7c0fa67f831704c34d66430e`)
applied some sizes but repeatedly lost the stock desktop-shell client, triggering
the existing bounded compositor restart policy. Preserve this failure in
`evidence/e5-t22c/rejected-disable-v1/`; it is not acceptance evidence. Independent
provisional review also found an attached-but-disabled frontend assertion race.
The public disable/reconfigure/enable design is rejected, not waived.

Replace it with a deliberately pinned backend-ABI integration against the actual
upstream 12.0.4 headers. Keep the output/global enabled, wait for in-flight DRM
work and a matching connector cache, then call the existing exported native-mode
switch. Own at most two added mode entries and destroy unused KMS blobs on their
owning backend descriptor. The build checks source/header/ELF digests explicitly.

The second image (`9a221e3e4eb24712d464d080ae187de25a7614359fec6c29ea4e82a18e3f2bfd`)
keeps wl_output ID 16 and foot PID 1018 through six real requested modes; resource
count returns to three. This is still an iteration: the client has not yet been
visually proven and observed resize time is 3,749–20,897 ms, **not** the required
2,000 ms. The next image tests a 10 ms guest poll and pixman-shadow=false, retaining
the same DRM/pixman renderer. No performance or task-verification claim is made.

Native ASan/UBSan currently passes 204,314 checks: 10,000 seeded transitions,
3,000 pending polls, 100,000 parser seeds, bounded failure/recovery and reentrant
output destruction. The browser recorder now checks rendered terminal text,
actual post-paint timestamps, unchanging compositor/client identities, and an
independent Wayland/DRM/scanout/canvas comparison before it can claim acceptance.

### 2026-09-06 — worker — blocked on initial-mode reset prerequisite

Exact repro: build the documented v3 image and chunks, `make web-dist`, then run
`E5_T22C_ITERATION=1 E5_T22C_OUT=target/e5-t22c/iteration-v3 node tools/verify/e5-t22c-guest-mode.mjs`.
The recorder requests 901x701 before the first guest instruction. Its preserved
`evidence/e5-t22c/initial-mode-reset-v3/progress.json` shows that request accepted,
but the actual resource remains 1280x800 after desktop startup; no matching paint
exists. Source `crates/core/src/dev/virtio/gpu/mod.rs:523-532` resets physical host
monitor dimensions and EDID to defaults when Linux resets its guest device. The
existing lifecycle test explicitly expects that behavior. Stop this non-progressing
iteration after saving its state and raw serial; it is not acceptance evidence.

E5-T22e isolates the device-reset correction from this compositor/guest-image
boundary. Resume this task only after that prerequisite is independently verified.
No guest/browser proof already held is re-litigated merely because reset failed.

Separately, independent source review found that a negative native mode-switch
return can follow partial renderer teardown. The adapter now fail-stops with
status 70 and a fixed fatal diagnostic, without retrying or unsafe cleanup. Such
a fault is never counted as a successful resize. The native sanitizer test
reproduces mutation-before-error in a child and requires that exact exit; all
202,456 checks pass. This latest fault fix requires a newly recorded final image.

### 2026-09-06 — worker — resume above verified reset prerequisite

E5-T22e independently verified at `ef9dea06`, with its verified built-demo handoff
at `6e736124`. Resume this same task in a new layer above the reset fix, preserving
the earlier C branch and its failed iterations. Boot immutable v4 image SHA256
`4739da5d080d7ebbec70c907a3ca27e4da9e4236d0c84dff1bced5caf5e7ad2f`
with the reset-corrected Wasm. This image includes the fail-stop fix and terminal
startup diagnostics. Measure visible client content and real mode adoption; do
not waive or claim the still-unproven two-second performance criterion.

### 2026-09-06 — worker — real initial mode held; repair antialias oracle

Iteration at `f5a5d66f` boots the immutable v4 image with the reset-corrected
Wasm. Real Wayland, all 128 DRM EDID bytes, GPU scanout and canvas agree on
901x701; Weston PID 961 and foot PID 1018 are live. The terminal visibly prints
WV_RESIZE_CONTENT_2026, but the recorder times out because its glyph detector
requires 50 *exact* foreground-color pixels. The saved screenshot contains four
fully covered pixels and 477 antialiased foreground/background mixtures. Preserve
this non-acceptance recording in `evidence/e5-t22c/rejected-oracle-v4/`.

Fix the pixel oracle to count the expected antialiased mixtures inside the exact
marker-background bounds. Keep solid-background, unrelated outside text and
wrong-color negative tests, plus an offline replay of the unchanged real PNG;
the replay is not live-client or resize proof. Also disable the unrelated optional
headless-Alpine prefetch-profile request, whose 404 was captured as an error.
No guest image, renderer or emulator semantics change for these harness fixes.

A separate source rebuild into `target/e5-t22c/acceptance-image` produces exactly
the same ext4 SHA256 as v4, and the rebuilt ELF/custom-file/source bindings pass.
The candidate lock remains outside the acceptance path until the real run passes.

### 2026-09-06 — worker — local demo and asset handoff

The built app exposes Live resize and an explicitly in-progress capability.
`E5_DEMO_TASK=E5-T22c E5_DEMO_OUT=evidence/e5-t22c/iteration-demo node
tools/verify/e5-t18e-demo-smoke.mjs` loads the built app once: 126 passed, zero
failed, zero console/HTTP errors. Screenshot SHA256
`458e72fccb6e9b21a1a5aa1e075f50e2d2511b95f9bc88376f603924bb03c4f3`.
The shared smoke tool retains its T18e defaults and stages the same committed
Alpine manifest that deployment stages, instead of failing on its absent dist copy.

`node tools/verify/e5-t22c-dev-route.mjs` confirms the selected chunk manifest
and a content-addressed object are exact, COOP/COEP are present, and four arbitrary
or traversal paths return 404. Its disposable server is stopped afterwards;
recording: `evidence/e5-t22c/dev-route/scripted-proof.json`. A selected asset
directory without manifest/chunks is rejected before the server starts. These
are local tooling checks, not a live deployment or completed resize verdict.

### 2026-09-06 — worker — in-place client proof survives; timing gap remains

Corrected iteration at `3970f1ed`, recorded under `evidence/e5-t22c/iteration-v4b/`,
keeps Weston PID 961, foot PID 1018, wl_output 16, three GPU resources and identical
terminal marker pixels through all seven final modes. Wayland, independently
decoded DRM EDID, actual scanout and canvas agree; browser errors are empty.
Observed release-to-paint times are 3320 ms (803x603), 2437 ms (640x480), 3775 ms
(1280x800), 6535 ms (2560x1600), 4550 ms (801x601), 3238 ms (802x601), and 8305 ms
(1201x801 after another request). Every sample exceeds the unchanged 2000 ms gate.
The shadow-copy change improves large-mode time substantially but is not enough.

Provisional verifier source review found three harness gaps, not a final verdict.
The Make target now forces strict mode and its own artifact paths. The overlap
test now pauses after a consumed-but-unfinished transition, rechecks that state,
accepts the replacement at the real GPU with identical retired-instruction counts,
then resumes. The old v4b overlap sample is **not** claimed to prove this stronger
ordering. Scoped Git and per-response byte checks bind the transitive served
runtime to the frozen commit, with kernel bytes bound to the committed manifest;
unrelated task/deployment dirt is excluded. Regression tests cover dirty/staged
imported code and inherited iteration controls. Final overlap/timing proof awaits
the next real run; no acceptance lock or verified status is published yet.
