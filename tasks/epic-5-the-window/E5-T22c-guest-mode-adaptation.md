---
id: E5-T22c
epic: 5
title: Apply guest desktop hotplug modes without restarting the compositor
priority: 522.3
status: blocked
depends_on: [E5-T22b, E5-T22e, E5-T22f, E5-T22g]
blocked_on: E5-T22g browser-JIT entry timer cost
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

### 2026-09-06 — worker — remove idle EDID filesystem polling

Add a regression that calls the actual poll callback for 10,000 settled-mode
ticks and counts its external opendir calls. Old code fails the predicted zero
I/O assertion (`evidence/e5-t22c/idle-poll/red.log`). The adapter now uses the
already-required, actual upstream connector cache as a cheap change trigger,
and reads independent sysfs EDID only when that cache indicates a valid different
native size. Pending/disabled outputs also avoid unnecessary reads; unused owned
mode blobs still get their bounded cleanup. A cached one-pixel change prompts an
EDID read but cannot authorize a modeset when that read fails.

Pinned upstream `drm.c` refreshes the connector before considering whether the
frontend needs a heads-changed notification, so this does not depend on physical
size rounding. Existing switch/EDID/ownership predicates remain in force.
The actual-adapter ASan/UBSan harness passes 232,494 checks, including the new
idle and one-pixel trigger cases (`idle-poll/green.log`). This removes measured
unnecessary calls, not yet a claim that the real two-second target is met; build
a new immutable v5 image and re-record the guest after this runtime change.

### 2026-09-06 — worker — idle optimization does not close timing; visual gap found

Iteration at `9a381d1e`, preserved in `evidence/e5-t22c/iteration-v5/`, boots
image SHA256 `573329db31046341990e39aefe94023d1b6147270faed3e7a065656e1912426c`.
All seven requested modes agree across Wayland/EDID/scanout/canvas, retaining
Weston 961, foot 1018 and the exact terminal marker pixels. The corrected paused
overlap check passes, and browser errors are empty. Resize takes 3351, 2705,
4069, 6445, 4561, 2933 and 4180 ms respectively: the idle optimization does
**not** close the two-second gap. Do not label this acceptance.

Visual inspection of `2560x1600.png` reveals another insufficiency: wallpaper
and panel occupy only the original 901x701 area, with black beyond it. The same
defect is visible in v4b. Dimension agreement and a retained client alone do not
prove a fully repainted desktop. Add a native-canvas edge coverage check, its
old-size-desktop/black-padding negative regression, and a bounded real wait to
distinguish late shell drawing from a permanently stale surface. No runtime
fix or new performance waiver is claimed; the unchanged image is investigated
first. The existing host/reset/client-identity results remain held.

### 2026-09-06 — worker — distinguish delayed shell repaint from missing notification

The unchanged v5 image, run with full-edge waiting at `3888e6b8`, eventually
fills every requested mode correctly. The 1280x800 expansion first paints at
4104 ms but fills at 27065 ms; 2560x1600 first paints at 8497 ms and fills at
83303 ms. Both resulting screenshots show the expanded wallpaper and panel,
with the original terminal marker and processes retained. This is delayed
client repaint, not proof of a missing native resize signal. The diagnostic
protocol-logging boot overlaps this run, so these are observed diagnostic times,
not an uncontended performance baseline. No timing criterion is waived.

Test the selected Weston's existing solid-background configuration next. Its
client uses a one-pixel buffer with a Wayland viewport destination instead of
rerasterizing the stock wallpaper for every expanded mode. The real output
mode, Weston/pixman renderer, user identity, terminal and panel remain unchanged.
This is a deliberate visual simplification inside the guest image boundary,
not CSS scaling of the guest framebuffer. A loopback-test-only profile option
uses the existing sampled guest profiler; strict acceptance never enables it.
The next immutable v7 image must still earn the real browser checks.

### 2026-09-06 — worker — freeze the publication inputs, not just served code

A new regression edits the image lock and its package/custom-file manifests
without changing their already-captured in-memory values. The previous runtime
freeze omitted those paths and incorrectly accepted the dirty tree. Preserve
the failing check in `evidence/e5-t22c/freeze-lock/red.log`; add the three paths
to the frozen tree and require them to be Git-tracked before recording. The
extended dirty/staged checks and an untracked-lock negative test now pass
(`freeze-lock/green.log`). This is a harness proof repair; no guest semantics or
existing held device-boundary result changes, and no final acceptance is claimed.

### 2026-09-06 — worker — solid background reduces repaint cost; focus profiling

The v7 image (`811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e`)
at `38da087a` retains all real mode/client/marker checks with no browser errors.
Full 1280x800 coverage takes 4756 ms and 2560x1600 14485 ms, versus roughly
27 s and 83 s with wallpaper. This run has guest profiling enabled; it is a
diagnostic comparison, not a final performance acceptance. All seven modes
still exceed two seconds. Recording: `evidence/e5-t22c/iteration-solid-v7/`.

The initial before/after profile pair also includes the later diagnostic status
queries, so do not attribute its entire delta to resizing. Add separate samples
at first paint and edge completion, before the queries. A Chrome CPU profiler
now targets the exact owned whole-machine worker and records only the resize
window (including bounded sampling-control overhead). Its real-worker test
rejects a missing target and observes a known CPU probe in the chosen worker.
An iteration-only fixed-command stdin loop can retain this same disposable
guest for follow-up measurements; strict acceptance cannot enable that loop or
either profiler. No arbitrary guest/host commands or network control endpoint
are added. Kernel debug-setting observations remain leads, not a kernel change.

### 2026-09-06 — worker — isolate the measured engine prerequisite

Exact repro at `9b656c7f`: `E5_T22C_ITERATION=1 E5_T22C_PROFILE=1
E5_T22C_CPU_PROFILE=1 E5_T22C_INTERACTIVE=1
E5_T22C_IMAGE_DIR=target/e5-t22c/desktop-image-solid-v7
E5_T22C_CHUNKS=target/e5-t22c/chunks/desktop-solid-v7
E5_T22C_OUT=target/e5-t22c/iteration-solid-v7-cpu
node tools/verify/e5-t22c-guest-mode.mjs`. After the usual seven modes, fixed
stdin commands request 1373x907, 640x480, 2560x1600, then stop. All ten real
mode/EDID/canvas/client/marker checks hold, browser errors remain empty, and
every timing exceeds two seconds. The first maximum-mode expansion paints at
7617 ms and fills at 15005 ms; the repeated maximum fills at 13097 ms. Preserve
the complete run in `evidence/e5-t22c/iteration-solid-v7-cpu/`.

The focused Chrome profiles place 30.71% and 30.06% of those maximum-mode
windows inside `Machine::sync_pmp_code_permissions`, including its callees.
Reconstruct function names from the same release compiler output and require
byte identity of **every non-custom Wasm section** before applying any name.
The production Wasm remains `c1c854b8bb3b5cfbcc5a6a6f45199fca2151d7d949e7c707b546343504d7cb0f`;
no profiling build is loaded into the guest. `cpu-summary.json` binds the names,
raw profiles and executable sections; its README gives exact reproduction.

Source inspection finds a full cached-instruction audit on S/U transitions,
although `Csrs::pmp_ok` and `Pmp::check` treat S and U identically. Preserve the
M-mode distinction and revision-change invalidation. This engine/security
boundary is outside the compositor-only slice: isolate it as E5-T22f, leave C
blocked until that prerequisite is verified, and then remeasure the same image.
No claim that removing this cost alone will meet two seconds; no criterion is
waived, no kernel/renderer switch, no final image lock or verified status.
