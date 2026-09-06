---
id: E5-T22c
epic: 5
title: Apply guest desktop hotplug modes without restarting the compositor
priority: 522.3
status: in-progress
depends_on: [E5-T22b]
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
