# Initial-run cache qualification — no final verdict

Recorded 2026-09-06T05:48:13.259Z. This is an additive qualification of the original
9ed9e0d1 browser run, not a task-status change. Main checkout inspected at
8de49f979b8b20595b871fcdb90f0af36af0116a.

## Evidence retained

The independent partial audit covers cold-01 through cold-24 plus warm-prime and
warm-reload: 26 cases, 52 PNG/framebuffer digest matches, and 26 exact 94-pixel
cursor checks. The parent reports all 27 original cases completed; cold-25 and
the final aggregate were not independently inspected in this partial audit.
The existing files remain byte-for-byte unchanged:

- `partial-through26.json`: SHA-256
  `2144d58a9429a00bc11af69aa55a423a8166c04cadb5af6258d72f5827f372f1`.
- `partial-through26.md`: SHA-256
  `609cc442e8071489d9146b25c663c1bb8cc19066e722043b029e422f87951893`.
- Prior first-13, second-13, publication, drill, docs-recheck and prediction records
  remain initial-run evidence; this note does not rewrite their observations.

HELD carries forward for the already checked runtime/source bindings, rebuilt
image, manifests/chunks, Docker failure diagnostics, corrected documentation and
recovery command, integrity regressions, and desktop/cursor/launcher observations.
Unchanged T18a–d results remain HELD. No guest semantic refutation was established.

## Cache claim boundary

The original harness's `cacheDisabled=true` and `cacheHits=0` fields demonstrate
the page CDP setting and its observed counter, not worker-wide HTTP-cache disable.
Fresh browser contexts remain established by the harness; this is distinct from
disabling HTTP caching for repeated worker requests within each context.

The worker-cache-policy portion of prediction P-F2 is **NEEDS EVIDENCE** for the
original run. The original warm pair's measured timing, same-context reload and
configuration are retained observations, but actual warm HTTP-cache reuse was
not established by that page counter. No speedup or cache-disabled timing claim
may be inferred from those values. The earlier partial audit already withheld
the actual-warm-reuse claim.

The parent's reported page-only probe reproduced worker cache reuse under both
page policies. By the time of this independent read, the live probe files had
already been replaced with the cold-routing variant. Accordingly, that earlier
page-only cold result is attributed to the parent, not represented as an
independently inspected surviving trace.

## Inspected probe snapshot

Preserved byte-for-byte from the worker-owned `target/` files, without executing
or editing them:

- `cache-route-probe.snapshot.mjs.txt`: source SHA-256
  `79ce008001b7b649f9c6baccd41bf4d171d41cc653ff296d83743da8e3b619ca`.
- `cache-route-probe.snapshot.json`: report SHA-256
  `6f4da2621a05bb058cd95bcc288523f46a7041cab44eb77ce629ff344db7f52b`.

Source line 24 installs `context.route('**/*', route => route.continue())` only
when cold; lines 32–39 fetch the same immutable 131072-byte chunk twice in a
dedicated worker, then repeat in a new worker after page reload. This is a
standalone observer probe, not a guest boot.

Observed transfer sizes:

- Cache enabled, prime: 131372 then 0 bytes.
- Cache enabled, reload: 0 then 0 bytes.
- Cold routing, prime: 131372 then 131372 bytes.
- Cold routing, reload: 131372 then 131372 bytes.

Every entry reports encoded/decoded body size 131072. Every phase reports
`pageCacheEvents=0`. The server log records five chunk GETs, consistent with
one warm transfer plus four routed-cold transfers.

This supports the page-counter blind spot and the proposed cold-routing
correction in this probe. It does not retroactively establish either cache
policy for the initial boot matrix, and is not yet evidence that the revised
acceptance harness observes and guards the actual boot worker. Browser version
in this report is a source literal, not an independently queried version.

## Pre-registered bounded attack for the forthcoming guard

These predictions are written before receipt/review of the revised guard or
its affected frozen-browser evidence. Execute only after the parent provides
that guard, without editing worker files or running guest boots.

- C1 — Intact guard: a tiny same-URL immutable-chunk dedicated-worker calibration
  will distinguish routed cold transfers (positive network transfer for each
  full-body response) from actual enabled-cache reuse (zero transfer with a
  valid full-size body). New-worker-after-page-reload observations must be
  included; page-only cache counters cannot satisfy this check.
- C2 — Disposable sabotage: remove only the worker-effective routing from the
  calibration while retaining page `Network.setCacheDisabled(true)`. The
  repeated worker request will expose reuse, and the actual new cold-cache guard
  must reject it. A green result would falsify the guard's claimed sensitivity.
- C3 — Empty observer: a narrowly scoped fixture with missing/empty worker
  timing evidence must not count as a successful cache calibration. If the
  revised guard accepts it, that is an evidence-sufficiency failure.

Use the actual supplied guard for these checks, not a separately reimplemented
predicate. Keep the fixture disposable and preserve its outputs. The parent
owns the affected final browser-proof rerun; runtime/image/rebuild and unrelated
gates are not restarted.

No implementation, frozen clone source, task status, queue, commit or deployment
was changed. Final verdict remains deferred as requested.
