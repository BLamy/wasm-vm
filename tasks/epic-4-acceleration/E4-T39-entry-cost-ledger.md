---
id: E4-T39
epic: 4
title: Compiled entry-path cost ledger
priority: 439
status: pending
depends_on: [E4-T35]
estimate: S
risk: high
capstone: false
---

## Goal

Measure the cost of state copy, indirect table dispatch, authority checks, memory-split exits, and
device boundaries separately so future changes target the dominant term.

## Acceptance criteria

- The exact Node run emits bounded counters/timers for each entry-path term and the same checksum.
- The report identifies a dominant term with a reproducible delta; threshold or quantum changes alone
  do not count as a fix.

## Adversarial verification

Run interpreter, JIT, JALR-off, and region-off controls with the same restored image. Reject any
report that lacks a runtime digest, first-command boundary, or exact retired/checksum oracle.

## Verification log
