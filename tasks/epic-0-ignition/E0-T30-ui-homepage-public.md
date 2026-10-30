---
id: E0-T30
epic: 0
title: Homepage and public pages on the shared interface — honest copy, architecture model kept
priority: 0.3
status: in-progress
depends_on: [E0-T29]
estimate: S
risk: medium
capstone: false
---

## Boundary

Third slice of the site redesign (parent E0-T31). **Source (2026-10-30):** the PR 626 stack
(`c396efe1e`) with the verified E0-T28 foundation (PR 627) and E0-T29 workspace (`60232554f`,
PR 628), on branch `codex/ui-redesign-public`. The old-main delta (`f221fb166..2ad89f034`) is
re-applied here; its earlier evidence and grades are history (saved on the local preliminary
branches) and prove nothing about this source. One public-interface boundary: the homepage
(`web/landing.html`, published as `/`), the docs reader chrome (`web/docs-src/app.jsx`, its six
HTML aliases), the roadmap (`roadmap.html`, `roadmap-page.js`), the proposal pages
(`products.html`, `work-market.html`, `security.html`) and `404.html`, plus one opt-in preview
setting in `tools/deploy-cloudflare.sh`.

Risk is medium, not low: ordinary public controls (navigation, the architecture model's layer
and motion controls, the embedded session, roadmap search/filters/view/detail, docs menu,
search, subject filter and archive) are replaced with `@brett_lamy/ui` components bridged to the
existing behavior, and a release tool gains a branch argument. No guest architecture,
persistence, auth, docs corpus, benchmark data or runtime engine change.

- **Homepage**: says what the machine is in a sentence, with one primary action that starts the
  E0-T29 recommended guest (`./index.html?guest=busybox#ide`, the existing query contract) and
  a secondary path to the guest chooser. The real interactive architecture model
  (`hero-scene.js`) stays, with its layer and motion controls rendered by the library; the
  decorative full-screen shader background (`landing.js`) is removed. Every benchmark row,
  unsupported/unmeasured boundary and raw-data link is preserved; figures come from committed
  JSON and link to it. No invented graphics, fake transcripts, glow or gradient headings.
- **Docs reader**: keeps Docstream's renderer, corpus, search, subject filter, archive ledger,
  source links, aliases, history navigation and outline. The shared nav and library controls
  are compiled into the reader's own bundle (one React per page); the `.wv-ui` guard never wraps
  the rendered article.
- **Roadmap**: keeps `roadmap.js`'s data, filtering, Gantt/Kanban views and recorded task
  detail; its toolbar and detail close are library controls over the native inputs.
- **Proposal pages and 404**: shared nav, type and tokens; proposals stay labelled as proposed.
- **App header**: Docs and Roadmap open in a new tab from the running app so help never ends a
  guest; current-machine navigation stays in-document.
- **Preview deploy**: `PAGES_BRANCH` (default `main`, i.e. today's production behavior) lets the
  existing validated artifact staging publish to a named Pages preview branch. Not deployed here.

### PR 626 integration (what this source adds to the boundary)

- **Case studies.** 626 ships four routes the old source lacked: `case-studies.html` (index),
  `case-study-riscv-os.html` (RV-Phone, Phase 0: no phone image boots yet),
  `case-study-ai-sandboxing.html` (hosted AI sandboxing: proposed) and
  `case-study-deterministic-simulation.html` (deterministic simulation / celld integration:
  proposed, not an endorsement and not a workload run in wasm-vm). All four move onto the shared
  nav, tokens and type, keeping every story, anchor, attribution/source link and status, and the
  index plus three articles are findable from the shared nav and the homepage. Styles they need
  move from `marketing.css` into `site.css`; the old blue stylesheet is retired, not restored.
- **Workspace (E0-T29) carried unchanged:** native ids and controller semantics, Recordings /
  Checkpoints / storage / Self-checks, exact transition strings, help opening in a new tab with
  `noopener`, the warm header with the autoplay node hidden, Settings → Sound, the current Omarchy
  streamed software-restore copy, and the verifier's recording-pane lifecycle regression.
- **Docs:** reader chrome only. Docstream stays at 1.9.1 and every current 626 guide and reference
  is kept; the Docstream upgrade and content refresh are E0-T32.
- **404:** `<base href="/">` so a Pages fallback at a nested path resolves assets and recovery
  links from the root; the skip link stays on the page.

Fonts and assets stay same-origin; published root-swap links work in every generated bundle; no
claims about visitor behavior (bounce, conversion) without analytics.

## Deterministic acceptance

`bash tools/verify-ui-public.sh`: reruns the foundation and workspace acceptance (shared nav,
provider and styles are affected), checks the deploy script's branch handling without
deploying, and runs `web/tests/ui-public.spec.js` against the source tree and the built
`web/dist` (root swap): every public route at 1280/1440 and 360/390 px with zero browser errors
and no horizontal overflow; the homepage primary action reaches the real BusyBox guest; the
architecture model's library layer control changes the scene and caption (and its fallback);
reduced motion; working phone menu; docs search/filter/source/archive/back; roadmap search,
filters, view and detail; benchmark rows match their JSON; 44 px phone targets; the app's Docs
link opens a new tab without disturbing a running guest. Existing `landing-hero`,
`benchmarks-home` and `roadmap-oci` specs keep their substantive assertions.

## Adversarial verification

Medium risk: acceptance plus one bounded novel attack. Angles: (1) a public control that looks
like the library but is a restyled native widget, or a library control that no longer reaches
the behavior it replaced; (2) a benchmark figure not traceable to committed JSON, or a proposal
presented as shipped; (3) the docs article or engine surfaces altered by the `.wv-ui` guard, or
React/fonts loaded twice; (4) `web/dist` links broken by the root swap; (5) the deploy script
publishing to production when a preview branch is requested, or changing default behavior.

## Verification log

> Earlier E0-T30 work on old main (`2ab9310fe`, `2ad89f034`) and its evidence/grades live on the
> local preliminary branch `codex/ui-preliminary-public-20261030`; they are history only.
