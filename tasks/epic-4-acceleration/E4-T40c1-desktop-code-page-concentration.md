---
id: E4-T40c1
epic: 4
title: Measure how concentrated the Replay desktop's interactive work is in code pages
priority: 0.38769
status: verified
depends_on: [E4-T40g]
estimate: S
risk: low
capstone: false
---

## Boundary

Measurement only. The hot-PC profiler (`prof::ProfStats`, 64-byte regions, 1-in-~1024 sampling) gains a
top-K argument on the worker path (the page talks to the whole-machine worker, where `getProfile` is not
reachable today), and a script runs the desktop's click, key echo and `node -e` scenarios with it armed,
then reports the cumulative share of samples covered by the hottest 1, 10, 100, 1000 physical code pages,
and how many distinct pages are touched.

## Deterministic acceptance

`node tools/perf/code-page-concentration.mjs --url http://127.0.0.1:8125 --app /app.html` writes the curves for the
three scenarios; profiling off changes nothing measurable (desktop-latency with and without the profiler armed,
idle and click within noise).

## Why

E4-T40c2's unit is a code page: if the hottest few hundred pages hold most of a click, page-sized compiled units
can cover it with a low module count (the per-block prototype instantiated ~170,000 modules and lost).

## Verification log

### 2026-11-28 — worker — claim

Commits: `fd66ea5de` (`getProfile(topK)` through the worker controller; with the profiler armed the turbo loop
stands aside so every retirement can be sampled — `turbo_ok` gains `&& !self.profiling`; `tools/perf/code-page-concentration.mjs`),
`a2bc0747f` (build id). Profiling is opt-in (`?profile=1`); with it off nothing changes (the only runtime change is the
extra `!self.profiling` term, false by default).

`node tools/perf/code-page-concentration.mjs --url http://127.0.0.1:8125 --app /app.html` (generation 4, `--query`
`net=0`; `evidence/e4-t40c1/concentration.json`), share of sampled retirements in the hottest virtual pages:

| scenario | samples | pages | top 1 | top 10 | top 100 | top 1000 | kernel |
|---|---|---|---|---|---|---|---|
| 8 clicks on "Run again" | 371,487 | 2,488 | 40.0 % | 65.5 % | 82.4 % | 98.5 % | 8.2 % |
| 5 typed `echo hello` lines | 157,436 | 1,693 | 24.0 % | 50.2 % | 83.5 % | 99.3 % | 32.7 % |
| 3 typed `node -e` | 254,807 | 1,342 | 5.0 % | 34.5 % | 84.7 % | 99.8 % | 69.4 % |

So a hundred page units would cover over 80 % of each, a thousand nearly all (E4-T40c2's premise holds).

Who the hottest pages are (`whose-page.mjs`, the warm snapshot's mappings; `hot-regions-in-page.mjs`; symbols from
Ubuntu's debuginfod for libpixman build id `bb3d57b21ce7…`): the top page of clicks and typing (0x7fffadd3e000) is
sway's `libpixman-1.so.0.42.2` +0x2d000; inside it, over 8 clicks, `fast_composite_over_8888_8888` (+0x5c0, +0x640:
102,267 samples) and `fast_path_fill` (+0xdc0: 46,397) — about 150 M guest instructions, roughly 19 M of a click's
~26 M. Next: Chrome's own code (`chrome` +0x3eef000 10.3 %, +0x3e7e000 5.6 %), libc (+0x87000, 3.1 %). `node -e` is
mostly kernel (69 %: faulting in the 117 MB binary and the snapshot).

Limits: pages are virtual (a library page shared by several processes counts once per address, and two processes'
different code at the same address count together — the libgobject/libpixman alias above was resolved by symbols);
sampling is 1 in about 1,024.

### 2026-11-28 — verifier — VERDICT: verified

Low risk: direct-result inspection at head `3a46f316d` (8125 serves this head's web/dist: sha256 of loader.js, wasm,
sw.js equal local). Predictions written first: `evidence/e4-t40c1/verifier/predictions.md`.
- P1 profiling off by default — HELD. `profiling: false` (crates/core/src/lib.rs:1085); armed only via
  `set_profiling`/`set_host_timer`, reached from `?profile=1` (web/loader.js:955, web/main.js:1316, test-only
  web/desktop-resize.js:51) or CLI `--profile`; no production caller passes `profile: true`. With it off the new
  `&& !self.profiling` term is `&& true`, so `turbo_ok` is unchanged; `getProfile(topK)` defaults to the old 10.
  The acceptance's "within noise with and without the profiler armed" was not measured by the worker and cannot
  hold literally (armed disables turbo by design); read as "off path unchanged", which holds by inspection.
- P2 concentration rerun — HELD. `node tools/perf/code-page-concentration.mjs --url http://127.0.0.1:8125 --app
  /app.html --out evidence/e4-t40c1/verifier/concentration.json`: click 353,029 samples/2,497 pages, top 1/10/100/1000
  42.1/64.1/81.4/98.4 %, kernel 8.6 %; type 158,148/1,690, 23.9/50.3/83.3/99.3 %, kernel 34.2 %; node 233,548/1,300,
  5.1/35.1/83.6/99.8 %, kernel 76.2 % (claim: 82.4/83.5/84.7 % at top 100). Top click page 7fffadd3e, 148,688 samples.
- P3 attribution — HELD. `hot-regions-in-page.mjs ... 7fffadd3e` (verifier/hot-regions.log): +0x5c0 58,778,
  +0xdc0 46,406, +0x640 43,478, +0xc40 773. target/e4-t40c1-libpixman.so and the debug file share build id
  bb3d57b21ce79c6010f9560d0c25d2f3a50aacdf; PT_LOAD offset 0 = vaddr 0; `riscv64-linux-gnu-nm` (verifier/pixman-symbols.txt):
  0x2d5c0, 0x2d640 in `fast_composite_over_8888_8888` [0x2d54a,0x2d690); 0x2ddc0 in `fast_path_fill` [0x2dd42,0x2e03e).
- P4 owner — HELD. `whose-page.mjs` (verifier/whose-page.log): `83 sway r-xp libpixman-1.so.0.42.2 +0x2d000`, aliased
  with chrome's libgobject-2.0 +0x13000 (the claim's stated virtual-page caveat). Not independently checked: that the
  guest's libpixman file has the same build id as the target/ copy.
- SUITE: discard — measurement with sampling noise; the curves are evidence, not a stable assertion.
