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
