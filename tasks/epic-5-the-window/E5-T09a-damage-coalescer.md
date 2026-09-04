---
id: E5-T09a
epic: 5
title: Core virtio-gpu damage coalescer
priority: 509.1
status: pending
depends_on: [E5-T07d]
estimate: S
risk: high
capstone: false
---

## Goal

Add a deterministic per-scanout damage accumulator so multiple RESOURCE_FLUSH rectangles can be
represented as one bounded present plan without changing guest completion timing.

## Boundary

This slice owns the core rectangle normalization, clipping, union, spill-to-bounding-box policy, and
its unit tests. It does not own dirty tiles, browser scheduling, page metrics, or performance docs.

## Deliverables

- A core `DamageAccumulator` (or equivalent) with a documented maximum of 16 retained rectangles.
- Overlap, adjacency, containment, clipping, drain, and 17th-rectangle bounding-box tests.
- A stable counter/result shape that later tile and browser slices can consume.

## Acceptance criteria

- Overlapping, adjacent, and contained rectangles coalesce deterministically without losing covered
  pixels; disjoint rectangles remain separate up to the configured bound.
- The 17th retained rectangle collapses the plan to one resource-bounded bounding box, and draining
  returns a fresh empty accumulator.
- Exact boundary cases, including `x=63,w=2`, right/bottom edges, zero-sized input, and clipped
  input, have explicit assertions.

## Verification command

`make verify-E5-T09a`

## Adversarial verification

Feed seeded random rectangles, including repeated edge-touching and out-of-bounds inputs, and
compare the accumulator's covered-pixel mask with a simple independent reference mask after every
insert and drain.

## Verification log

(empty)
