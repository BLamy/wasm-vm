---
id: E5-T25a
epic: 5
title: Freeze test-only desktop performance instrumentation and injection hooks
priority: 525.1
status: pending
depends_on: [E5-T09e, E5-T18e]
estimate: S
risk: medium
capstone: false
---

## Goal

Create the narrow, test-only boundary that later performance slices use to inject
deterministic pointer/key events and observe actual display presents. Keep all hooks
out of the normal release surface and make the counters describe drawn damage, not
host calls that a null sink could count.

## Boundary

Own only the feature-gated input injection API, sink-side present/damage telemetry,
and deterministic fixture adapter. Do not choose thresholds, publish baselines, or
change guest scheduling, compositor behavior, or production input semantics.

## Deliverables

- A test-only injection interface for pointer press/move/release and focused keypress
  events with deterministic ordering and no caller-supplied shell command.
- Sink telemetry for drawn presents, damage rectangles, bytes uploaded, and guest
  instruction attribution, with explicit null-sink behavior.
- A fixture/unit target that proves the event sequence and damage intersection
  records are stable.
- A release/feature audit proving the hooks are absent or unreachable in the normal
  build.

## Acceptance criteria

- [ ] A deterministic fixture injects the documented pointer/key sequence and receives
      the same ordered guest events and telemetry on five repetitions.
- [ ] A present with a damage rectangle records one drawn-present sample and its
      exact rectangle; a null sink cannot report a drawn frame merely because the host
      requested one.
- [ ] The feature-disabled/release artifact exposes no callable injection entry point
      and the static audit records the exact command and result.
- [ ] Native and wasm/browser-facing telemetry schemas agree byte-for-byte for the
      fixture record.

## Verification command

make verify-E5-T25a

## Adversarial verification

Replace the display sink with a null sink that acknowledges presents without drawing;
the drawn-present count and damage ledger must not claim healthy FPS. Inject a release
without a press, duplicate a sequence number, and submit an out-of-bounds rectangle;
each must be rejected or recorded as an explicit no-op without corrupting the next
valid event. Audit the release artifact for the hook symbol and feature string.

## Verification log

(empty)
