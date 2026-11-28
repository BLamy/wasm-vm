---
id: E4-T40c
epic: 4
title: Compiled tier for the turbo loop — region-sized units (planning parent)
priority: 0.38769
status: pending
depends_on: [E4-T40b]
estimate: L
risk: high
capstone: false
---

## Why this exists

The turbo loop (E4-T40b) is an interpreter. A compiled tier on top of it was prototyped on
2026-11-24 and measured; this file records the result so the next attempt starts from it.

### What was built (scratch branch `scratch/next-work`, not merged)

- `crates/core/src/turbo_jit.rs`: the contract for a compiled block — a function that runs a
  block's leading inline ops directly on the machine's own state (register array, PC, the
  fast TLB the interpreter uses, guest RAM, the dirty bitmap, the code-page filter) through
  baked addresses, and returns `retired | status << 8` (done / bail before op k / store hit a
  possible code page). Nothing is copied in or out, so the turbo loop accounts for what a
  compiled block retires exactly as for inline interpretation. A registry keyed by physical
  address lets a block that was evicted and decoded again pick its code up without a
  recompile.
- `crates/wasm/src/turbo_emit.rs`: one module per block, a transcription of
  `integer_result`/`turbo_step` including the fast-TLB probe and hit accounting.
- `crates/wasm/src/turbo_jit.rs`: instances are installed in the Rust module's own function
  table (linked `--growable-table`), so a compiled block is called with one `call_indirect`
  and no JavaScript.

### What was measured (Replay desktop, Chrome 158, M4 Max, decoded cache 65536)

| | Interpreter (turbo loop) | One compiled module per block |
|---|---:|---:|
| Instructions through compiled code | — | 98% (9,347 M of 9,560 M), 5.6 ops per call |
| Blocks compiled / reused from the registry | — | 172,729 / 767,261 |
| Node integer loop | 9.3 s | 13.9 s |
| Shell loop | 6.1 s | 6.4 s |
| Click result (3 trials) | 455–500 ms | 647–995 ms |
| `node -e` to prompt | 5.1 s | 6.6–8.8 s |
| Idle steady state | 153 MIPS | 142 MIPS |

The guest behaved identically (same instruction counts for the same work). It was slower.
A unit of five guest instructions does not pay for a call into another wasm instance plus the
host engine's per-module compile cost (about 170,000 synchronous module instantiations in a
100-second session) and its baseline-tier code. This is the same wall the older browser JIT
hit from a different direction.

## What a next attempt must change

Compile region-sized units so one call retires hundreds of instructions: the hot blocks of
one code page in one function, with in-page branches and fall-throughs taken inside the
function, the retire-count horizon and work budget checked there, and the fetch-TLB entry of
the page re-validated at each in-page block entry so translation behaviour stays what
`enter_block` does. Compile only what is demonstrably hot (thousands of entries, not 32), so
the module count stays in the low thousands. The contract, the in-place layout and the
equivalence gates (boot oracle, `tools/perf/turbo-equivalence.sh`, and a browser-side
on/off state comparison) carry over.

This is a planning container; split it into S tasks before starting.

## Measurements after E4-T40f/g (2026-11-28)

Click result on the Replay desktop is now about 230 ms (was 260-265 ms), `node -e` about 1.5 s. A CPU
profile of the worker during 8 clicks (named wasm build, `evidence/e4-t40g/profile-after/top.txt`):
`Machine::run` (the turbo loop, everything inlined) 70 % of the busy time, `enter_block` 19 %,
`Hart::execute` 2 %, the cache probe under 2 %, discovery gone. Trimming `enter_block` further (no weak
handle on a memo hit) measured within noise (about 1 %) and was not kept. The interpreter costs about
13 ns per guest instruction; the click itself is about 26 M guest instructions at about 95 MIPS.

Where the guest spends a click (`evidence/e4-t40g/guest-cpu-per-click.json`, per-process utime+stime over 8
clicks): Chrome's three processes 49 ticks, sway 30 ticks (input handling and pixman composition), the
monitor 3; 78 user + 14 system ticks in all. So a compiled tier speeds up both; a guest-side reduction would
have to come from Chrome's software raster or from sway's per-event work.

### V8 tiering is not the limit (2026-11-28)

`desktop-latency --chrome-args=--js-flags=--no-liftoff` (TurboFan for everything from the start) against the
default, interleaved, two loads a side (`evidence/e4-t40c-tiering-probe/`): click 304.6, 296.0 vs 238.4, 238.3 ms;
node -e 1810, 1819 vs 1345, 1347 ms; MIPS during clicks 79.5, 78.4 vs 95.3, 96.8. The default tiering already runs
the turbo loop at its best; forcing TurboFan is slower. The interpreter's per-instruction cost is the code itself.
