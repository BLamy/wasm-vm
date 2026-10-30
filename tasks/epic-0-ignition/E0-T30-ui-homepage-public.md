---
id: E0-T30
epic: 0
title: Homepage and public pages on the shared interface — honest copy, architecture model kept
priority: 0.3
status: pending
depends_on: [E0-T28]
estimate: S
risk: low
capstone: false
---

## Boundary

Third slice of the site redesign (parent E0-T31). Move the homepage (`web/landing.html`, published
as `/`) and the public pages (`products.html`, `work-market.html`, `security.html`,
`roadmap.html`, `404.html`, and the docs reader chrome) onto the E0-T28 shared nav, type and
tokens. Presentational only: no change to the runtime, the docs corpus, or the benchmark data.

- Homepage leads with what the machine is and one action to start it; the existing interactive
  architecture model (`web/hero-scene.js`) is kept and integrated, not replaced by decorative
  effects. No cyan/purple glow, decorative gradients, emoji icons or invented metrics.
- Copy is short and checkable: every number shown comes from a committed data file
  (`runtime-benchmarks.json`, `runtime-compute-benchmarks.json`, `tasks.json`) and links to it.
  No claims about visitor behavior (bounce rate, conversion) without analytics.
- Proposal pages stay labelled as proposals.
- Phone layout at 390 px without horizontal overflow; reduced-motion respected.

Risk is low because these pages do not reach guest runtime code; if the slice touches the app
shell or runtime modules it must be re-classified before starting.

## Deterministic acceptance

`bash tools/verify-ui-public.sh` (to be written with the slice): reruns the E0-T28 checks; for
each public page at 1280 px and 390 px asserts the shared nav is mounted, zero browser errors,
no horizontal overflow, and that every rendered figure matches its source JSON; asserts the
architecture model still initialises (or shows its fallback with WebGL disabled); and checks the
built `web/dist` root swap (`/` homepage, `/app.html` app) links resolve.

## Adversarial verification

Low risk: the verifier inspects the direct result — screenshots at both widths, the figure-to-
source check, and that no runtime file changed in the diff.

## Verification log
