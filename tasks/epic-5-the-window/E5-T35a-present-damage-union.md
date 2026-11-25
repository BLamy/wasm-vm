---
id: E5-T35a
epic: 5
title: Paint the union of coalesced damage so an earlier flush is never left stale on the canvas
priority: 0.38764
status: implemented
depends_on: [E4-T40b]
estimate: S
risk: low
capstone: false
---

## Boundary

`web/src/sink/presentation.js` only (host presentation; no guest or wasm change).

The frame scheduler keeps one pending frame and presents at most once per animation frame.
Every frame carries the whole resource, but the presentation controller painted only the
newest frame's rect. When two guest flushes land inside one animation frame — a button
repaint, then a flush elsewhere such as the cursor — the first region was never painted and
stayed stale until some later flush happened to cover it.

Track the damage queued behind the scheduler and paint its union with the newest rect (same
resource size only; a resized resource already repaints in full). An immediate present that
replaces a queued frame keeps that frame's damage too.

## Deterministic acceptance

`cd web && node --test tests/e5-t06d-presentation.test.mjs tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs`
passes, including three new cases: coalesced flushes paint the union with the newest pixels
and painted damage is not carried into the next frame; queued damage of another resource
size is not unioned into a resized frame; an immediate present keeps the damage of the
queued frame it replaces.

## Adversarial verification

Low risk: inspect the direct result. The new test must fail on the previous
`presentation.js`.

## Verification log

### 2026-11-24 — worker — claim (head `2356edbd1`)

Implementation: `08d2fdda9` (`web/src/sink/presentation.js`, tests in
`web/tests/e5-t06d-presentation.test.mjs`, rebuilt `web/dist`); `2356edbd1` only refreshes the
generated `web/gpu-checkpoint-build.js` so it equals the copy in `web/dist`.

Commands, at `2356edbd1`:

- `cd web && node --test tests/e5-t06d-presentation.test.mjs tests/e5-t09c-present-scheduler.test.mjs tests/e5-t09d-hidden-present.test.mjs`
  → 19 pass, 0 fail. Log `evidence/e5-t35a/tests.log`
  (sha256 `386820a8068acb153f7ee534d3f273676c9c887126418ee4868bd79fb81fa1c7`).
- Sabotage: `git show dd668e65e:web/src/sink/presentation.js > web/src/sink/presentation.js`,
  then `node --test tests/e5-t06d-presentation.test.mjs` → 6 pass, 2 fail ("frames coalesced
  within one animation frame paint the union of their damage", "an immediate present keeps the
  damage of the queued frame it replaces"); file restored afterwards. Log
  `evidence/e5-t35a/sabotage-old-presentation.log`
  (sha256 `781ee96b66d4a59c5b4e701bb1114e9b0517189509f127a2736707260c97e009`). The third new
  case (another resource size is not unioned) passes on the old code too: it guards the new
  code against over-painting, it does not detect the old bug.
- `cmp web/src/sink/presentation.js web/dist/src/sink/presentation.js` → identical.
- Browser sanity on the committed bundle (`bash tools/serve-dist.sh 8125`):
  `node tools/perf/desktop-latency.mjs --url http://127.0.0.1:8125 --app /app.html --label damage-union --n 3 --scenarios idle,click,sweep,type --out evidence/e5-t35a/browser-dist.json`
  → exit 0, no missing samples, one console message (the favicon 404). Click result median
  516 ms, sweep 454 ms, key echo 43 ms: the same range as before the change, so the union does
  not cost visible latency. `evidence/e5-t35a/browser-dist.json`
  (sha256 `1c6f4adb6edc2947ce44e03a5e2fd9b03a53310acab87ab9d20be1df82ee7491`).

What this shows: with two flushes inside one animation frame the controller now paints one rect
covering both, using the newest frame's pixels, and forgets that damage once painted; a queued
frame of another size is not folded into a resized frame; a synchronous present that replaces a
queued frame still paints the queued frame's region. Not shown: a browser capture of the stale
region itself. The stale-rect symptom needs two guest flushes to fall inside one 16 ms frame,
which I could not force reliably from outside the guest, so the unit tests are the evidence of
record and the browser run is only a no-regression check.
