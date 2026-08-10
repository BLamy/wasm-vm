---
id: E4-T30
epic: 4
title: Predecode entry-hit reuse and production fast-interpreter mode
priority: 430
status: in-progress
depends_on: [E1]
estimate: S
risk: high
capstone: false
---

## Goal

Turn the existing predecoded block cache into an actual hot-loop acceleration: a repeated
physical entry PC reuses its decoded block instead of decoding, allocating, walking, and
reinserting that block on every branch. Once the regression is removed, make block caching plus
bounded interrupt batching the browser Linux interpreter's default, with an explicit A/B escape
hatch.

## Acceptance criteria

- A deterministic loop test proves one block build followed by entry hits while JIT discovery still
  counts every block entry.
- The release pure-ALU microbenchmark with the cache on is at least 1.5x its pre-fix cache-on result,
  does not trail cache-off, and stays above the committed performance floor.
- PMP execute permission, paging aliases, SMC/DMA invalidation, `fence.i`, pathological one-entry
  eviction, and cache-on/off retire traces remain correct.
- Browser Linux enables the proven cache + <=128-retire interrupt batching by default; a query option
  can force the legacy interpreter for differential diagnosis.
- Native tests, wasm32 build, format, and clippy remain green.

## Adversarial verification

Predict then attack: revoke execute permission after a cached hit; execute one physical page through
two virtual aliases; patch a cached instruction with a guest store and DMA; use a one-entry cache;
and sabotage the hit path so discovery is not incremented. Any stale instruction, skipped fault,
trace divergence, or JIT threshold that never fires refutes the change.

## Verification log

