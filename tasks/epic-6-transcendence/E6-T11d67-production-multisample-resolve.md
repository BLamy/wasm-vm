---
id: E6-T11d67
epic: 6
title: Provide real four-sample rendering and original VirGL resolve
priority: 525.027035
status: in-progress
depends_on: [E6-T11d66]
estimate: S
risk: high
capstone: false
---

## Boundary

Qualify actual four-sample WebGL2 renderbuffer storage, admit bounded production
2D color/depth attachments with samples 2 or 4, and execute original VirGL BLIT
resolves through owned native framebuffers. Preserve prior single-sample proof
profiles. Count native sample allocation bytes, reject unsupported shapes and
formats before effects, and retain both resources through GPU fence completion.
Raise MAX_SAMPLES to four only with physical qualification and executable proof.

## Deterministic acceptance

`make verify-E6-T11d67` records original resource-create, surfaces, clear/draw,
BLIT and readback with actual four-sample native storage. Independent expected
resolved color/depth and partial edge coverage must match. The actual guest
GLES numeric probe must report MAX_SAMPLES >= 4 without any below-floor limit.

## Adversarial verification

Fresh verifier attacks one-beyond sample counts, unsupported targets, mismatched
attachment samples, signed boxes/format reinterpretation, allocation overflow,
unref/destroy during an in-flight resolve, and context loss. Sabotage sample
allocation or native resolve and require pixel/guest probes to fail. Preserve
old profiles' refusal of multisample metadata.

## Verification log

### 2026-10-13 — worker — started from independent negative proof

The production integration parent is blocked on the original guest transcript
`target/evidence/critic-omarchy-gpu-ui-local07-03/numeric-guest.log`. Only sample
count failed the 29 independent GLES numeric queries; unsupported border/sRGB
extensions and desktop GL contexts were correctly refused.
