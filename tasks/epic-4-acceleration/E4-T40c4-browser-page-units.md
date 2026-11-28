---
id: E4-T40c4
epic: 4
title: Browser compiled page units — install, evict, measure, default
priority: 0.387693
status: pending
depends_on: [E4-T40c3]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/wasm`: compile a page unit once the page is hot (thousands of entries), one module per page,
installed in the Rust module's function table; bounded count with eviction; `?pages=0` turns it off.
`web/main.js`: on by default for the Replay desktop only if faster.

## Deterministic acceptance

Same bundle, interleaved: click result, key echo and node -e faster than the interpreter by a stated margin;
idle not worse; online acceptance passes; the browser on/off state digest comparison matches.

## Verification log
