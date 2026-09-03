---
id: E4-T36
epic: 4
title: Guarded cross-page direct links
priority: 436
status: in-progress
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Link high-value direct-control-flow edges across physical pages only after authoritative VA+PA
observation and validate the target with the generated EXEC-TLB predicate.

## Acceptance criteria

- Cross-page links preserve checksum, exact retire counts, timer/device boundaries, and SMC removal.
- The fresh Node fixture reaches at least 7.3 logical blocks per engine call without a live-module or
  retranslation storm.

## Adversarial verification

Change the target mapping after publication, invalidate the target page, deny execute permission,
and force a remaining-budget tail at the link boundary. Every refusal must fall back exactly once.

## Verification log
