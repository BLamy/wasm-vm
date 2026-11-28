---
id: E4-T40c1
epic: 4
title: Measure how concentrated the Replay desktop's interactive work is in code pages
priority: 0.38769
status: in-progress
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
