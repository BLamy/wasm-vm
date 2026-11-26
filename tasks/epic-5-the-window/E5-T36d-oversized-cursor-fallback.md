---
id: E5-T36d
epic: 5
title: Replay desktop on legacy KMS — a cursor image larger than the 64x64 plane still shows a pointer
priority: 0.3876545
status: pending
depends_on: [E5-T36b]
estimate: S
risk: medium
capstone: false
---

## Why this exists

E5-T36b's verifier (evidence/e5-t36b/verifier/recheck-new.log) found that on the legacy-KMS
session a cursor image larger than virtio-gpu's 64x64 cursor plane is drawn nowhere: the plane
leaves the CRTC and wlroots 0.17's software fallback fails under the pixman renderer ("Cursor
texture too large (128x128)", "Failed to render cursor buffer"). The same theme is painted on
generation 1 and on the same image restarted on atomic KMS.

Nothing the image ships produces such a cursor (it ships no cursor theme; wlroots' built-in
cursor is small; the guest's Chrome scales CSS cursors up to its 128x128 maximum to a 64x64
plane image: evidence/e5-t36b/self-checks/t36b-css-cursor-sizes.log). It takes a cursor theme
of more than 64 px set through sway, or a Wayland client that supplies a larger buffer itself.

## Boundary

Find where the fallback fails (wlroots' pixman software cursor path, or sway's use of it) and
either make the oversized cursor drawn (in software, or scaled onto the plane) or keep the
session from ever choosing a cursor larger than the plane. Guest image sources only.

## Deterministic acceptance

The verifier's oversized-theme check (65x65 and 128x128 themes over sway's title bar and over
foot) shows a pointer — on the plane or painted into the frame — on the session E5-T36b ships,
with its controls (64x64 on the plane; generation 1 painted).

## Verification log
