---
id: E4-T40c3
epic: 4
title: The turbo loop runs compiled page units
priority: 0.387692
status: pending
depends_on: [E4-T40c2]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/core/src/turbo.rs`: at a block entry whose page has a compiled unit, call it instead of interpreting;
account its retirements exactly as inline interpretation does; fall back on every exit reason. Off by default.

## Deterministic acceptance

`tools/perf/turbo-equivalence.sh` and `decoded-cache-equivalence.sh` give the E4-T40f digest with compiled pages on
(native runtime), and the compiled share of retirements on the desktop snapshot run is reported.

## Verification log
