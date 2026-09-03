---
id: E5-T05c
epic: 5
title: Epic 5 kernel headless boot and provenance regression
priority: 505.3
status: in-progress
depends_on: [E5-T05b]
estimate: S
risk: high
capstone: false
---

## Goal

Prove the rebuilt kernel still boots the existing E3/E4 headless image to its serial login path
without a virtio-gpu device, while preserving the old boot/error profile and exact artifact
provenance.

## Deliverables

- A deterministic native headless boot capture using the rebuilt kernel and the existing rootfs,
  including the serial login boundary and guest instruction/time totals.
- A dmesg comparison/allowlist for new graphics/input/sound/console initialization lines and any
  unexpected warnings or errors.
- Final task evidence tying the booted kernel hash, config hash, manifest hash, and measured size
  delta together.

## Acceptance criteria

- The existing image reaches `login:` with serial console intact within 10% of the E4 baseline.
- With no virtio-gpu attached, dmesg has no DRM probe errors; newly enabled built-in drivers do not
  introduce an unallowlisted warning or boot hang.
- The recorded config still has every required symbol `=y` and no `=m`; its hash matches the
  manifest/release evidence from E5-T05b.

## Adversarial verification

Boot once with `console=tty0` only and once with the normal serial arguments; distinguish silent
alive from a pre-fbcon hang by instruction progress. Diff full dmesg against the E4 baseline and
rerun the checksum/config gates from a clean build output.

## Verification log
(empty)
