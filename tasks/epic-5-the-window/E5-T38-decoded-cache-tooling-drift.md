---
id: E5-T38
epic: 5
title: Repair or retire verification tooling that has drifted (E5-T26k cache test, latency favicon filter)
priority: 0.387661
status: pending
depends_on: [E4-T40d]
estimate: S
risk: low
capstone: false
---

## Boundary

Test and measurement tooling only; no runtime change.

1. `web/tests/e5-t26k-decoded-cache.test.mjs` fails at module load at `2353157fe` and since:
   it matches `loader.js` source text for `const manifest = await fetchJsonAsset(manifestUrl,
   "boot manifest");`, which is now the second arm of a conditional. With that one match
   repaired, 7 of its 11 tests pass and 4 fail on further source-text and worker-protocol
   drift. Repair the four against today's loader, or retire the ones that
   `web/tests/e4-t40d-decoded-cache-sizes.test.mjs` now covers. Its size lists, and those in
   `tools/verify/e5-t26k-decoded-cache.mjs` and `tools/verify/omarchy-input-diagnostic.mjs`,
   still name only 4096 and 16384; decide per tool whether that is the experiment's own
   fixture (leave, and say so) or a stale copy of the selectable list (update). The pinned
   `web/gpu-runtime/<hash>/decoded-cache.js` is a frozen runtime copy and stays as it is.
2. `tools/perf/desktop-latency.mjs` filters the favicon 404 by message text; Chrome 158's
   message carries no URL, so every run records one console error. Filter on the failed
   request's URL instead, so `consoleErrors` is empty on a clean run.

## Deterministic acceptance

`cd web && node --test tests/e5-t26k-decoded-cache.test.mjs tests/e4-t40d-decoded-cache-sizes.test.mjs`
passes; `node tools/perf/desktop-latency-selftest.mjs` passes and a clean run of the
benchmark reports `consoleErrors: []`.

## Adversarial verification

Low risk: inspect the direct result.

## Verification log
