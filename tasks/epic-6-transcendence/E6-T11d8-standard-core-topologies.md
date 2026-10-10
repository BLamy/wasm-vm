---
id: E6-T11d8
epic: 6
title: Execute bounded standard core line and triangle-fan draws
priority: 525.02703901
status: in-progress
depends_on: [E6-T11d7]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend only the host-selected standard async draw facet with ordinary Gallium
LINES, LINE_LOOP, LINE_STRIP and TRIANGLE_FAN (modes1,2,3,6). Select their matching
native WebGL2 primitive for all four existing ordinary/instanced array/index
entry points. Preserve actual-index fetch bounds, native IDs, constant/instance
attributes, aggregate work limits, delayed GPU reads and retained ownership.
Unsupported points/point size, quads/adjacency/patches, restart and base offsets
remain explicit errors. Legacy factories still admit only their triangles/strips.
This slice changes no shader, texture, resource, state or production capability
qualification. Native line width remains the existing one-pixel state.

## Deterministic acceptance

`make verify-E6-T11d8` binds literal independently mapped Gallium mode fields and
actual headed native hardware calls. Independently predict complete physical
pixels for axis-aligned one-pixel segments, open/closed loops, strips and a
triangle fan, using original input bytes and source geometry. Interior line pixels are
strict; fragment-center endpoints admit the GLES3 section3.5 bounded native
half-open alternatives, declared before comparison. No loop-edge interior or
fan-area pixel is waived by those endpoint alternatives. Include arrays,
byte/short/u32 wide indices, zero/one/positive instance counts, constant color
records, instance-fed values, nonzero binding offsets and three bounded schedules.
Make each native primitive distinguishable from the others: assert the loop's
closing segment and a fan region that the same vertices in strip order omit.

Prove incomplete primitive tails retain native no-geometry behavior while fetch
bounds/work budgets remain conservative; exact-end ranges admit and one byte
short rejects before draw. Exercise false min/max hints, stale pending index,
constant read cancellation/name reuse and A/B/A restoration through the already
verified ownership boundary. A served actual-mode corruption must complete the
native draw/fence and fail the named full-pixel oracle. Retain the full D6 gate (including affected legacy boundaries) and D7 physical
acceptance plus its actual generic sabotage and offline pixel audit once at the
frozen head. The D7 historical receipt pins an unchanged decoder, so authenticate
its original carry evidence without rewriting that receipt for this new mode
extension. Carry unchanged compiler, resource, cache and other state evidence,
then run one final pristine exact-head clone. Seal original wire/input/native state/pixels and per-hunk coverage.
A fresh critic alone may verify. No complete API, guest, production capset,
frame-rate, MIPS or demo deployment follows from the isolated facet.

## Adversarial verification

Predict the exact primitive and closing/fan coverage before inspecting evidence.
Invent one bounded seed with offset/wide-index geometry and another native
schedule. Attack exact end, short fetch, malformed mode packets, mode restoration,
work limits and delayed source lifetime. Sabotage the promoted mode oracle once.
Classify every changed hunk with recording or narrow waiver, and carry unrelated
HELD boundaries without re-litigation.

## Verification log

(empty)
