---
id: E0-T30
epic: 0
title: Homepage and public pages on the shared interface — honest copy, architecture model kept
priority: 0.3
status: implemented
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

### 2026-10-30 — worker — PR 626 integration, implemented (submitted for a fresh verifier)

**Frozen product head: `20bfdcb8cd8df1cb2c03dcbfb624cec4ecdc1570`** (`web/ui/src` `2d5cf28b…`,
`web/dist` `01fb4020…`; `ui.js` rev `76d15e673a14`, `ui.css` rev `74f187f16a37`). Recorded at
`788ce00143309dbe4a94c89142da257ab7ab5ade`, which changes only the promoted navigation test's
expected heading plus the ledger and its `sw.js` stamp (`git diff 20bfdcb8c 788ce0014`: those
three files). Base: verified E0-T29 `60232554f` (PR 628) above foundation PR 627 and PR 626
`c396efe1e`. Lifecycle: `bc77e8642` (task, E0-T31, new pending E0-T32, queue).

**Integration.** The coordinator's 3-way apply of the old-main public delta staged 43 paths and
left 15 conflicts (it excluded `web/marketing.css`, which 626 had changed). Resolved for 626 +
A + B: `web/index.html` and `web/ui-kit.html` keep 626's `session-library.css` and the B bundle
(stamps regenerated); `site-nav.jsx` keeps the foundation's Case studies new-tab set; the six docs
alias pages take the regenerated reader build; `landing.html`, `roadmap.html`, `products.html`,
`work-market.html`, `security.html` take the redesigned markup — 626's only changes there were the
Case studies nav link (now the shared nav) and, in `security.html`, the "Layered AI isolation"
section, re-inserted verbatim; `build-web-dist.sh` swaps routes for the case pages and 404. 626's
`roadmap.js` E9 epic and iPhone caveat, `deploy-cloudflare.sh` R2 range check, and every E0-T29
file are intact.

**626 case studies.** `case-studies.html`, `case-study-riscv-os.html`,
`case-study-ai-sandboxing.html`, `case-study-deterministic-simulation.html` now use the shared
nav (`data-current="case-studies"`), `ui.css` + `site.css`, the shared footer and `ui.js`; their
`<main>` is carried byte-for-byte except `wrap` → `wv-site-wrap` and `text-link` →
`wv-text-link`, so every story, id/anchor (`#loop`, `#layers`, `#workflow`, `#status`, …),
status line, proposal label and source link is kept. Copy changes: the index heading
"Build the system. Show the run." → "Case studies" (lede: what has run vs what is a plan) and its
cards → a plain list (all four entries, statuses and links kept; "What are you building? ↗"
marked external); the RV-Phone article heading "Prompt a phone OS. Boot it in a tab." →
"Prompting a RISC-V phone OS" (its label says the image has not booted). Case styles move into
`site.css` (warm tokens; ≥ 12 px labels; phone stacking of the RV-Phone table with its two column
labels); `web/marketing.css` is deleted, and `tools/verify/e9-gpu-results-browser.mjs` hashes
`site.css` in its place (that GPU probe is not run here). The homepage gains a "Case studies"
section listing the three studies with their statuses and an index link; public footers link
Case studies.

**Commands at `788ce0014`** (dev server `tools/serve-dev.sh 8198`):
- `UI_WORKSPACE_PW_ARGS="--trace on --output ../target/e0t30-626/pw-workspace" UI_PUBLIC_PW_ARGS="--trace on --output ../target/e0t30-626/pw-public" bash tools/verify-ui-public.sh`
  → **PASS**: foundation (digest `f7129f11…`, 15/15), workspace hosts + **29/29** (promoted
  navigation, 16 workspace, 12 recordings incl. the E0-T29 verifier's pane-unmount regression),
  deploy plan (default production `main`; `PAGES_BRANCH=ui-redesign/Preview_1` → preview alias;
  `bad branch`, `-x`, `../up` rejected; print-only, nothing deployed), public pages incl. the four
  case pages on the shared interface, docs corpus (155 pages, 1533 sources, 236 links, 181 code
  blocks) and dist packaging, **17/17** public browser tests (routes at 1280/1440/390/360,
  home start → BusyBox `printf`, model layers/motion/reduced motion/no-WebGL fallback,
  embedded session and benchmark rows vs JSON, docs search/filter/archive/source/history/alias
  and phone menu, roadmap search/view/filters/detail, app Docs in a new tab with the guest kept,
  case studies home → index → articles with statuses/anchors/source links and the phone table,
  plus `landing-hero` and `benchmarks-home`), and the built-dist check (38 rev stamps / 31 pages,
  112 reader scripts, nested `/old/docs/missing-topic` 404 with 10 root-resolved links, 12 public
  pages, 185 links/assets). Log `evidence/ui-redesign/public-626/verify-ui-public.log`; 46 traces.
- `node evidence/ui-redesign/public-626/capture.mjs` → home/cases/three articles/docs/roadmap/
  products/404 at 1440 and 390, home/cases/docs/roadmap at 1280 and 360: overflow 0, no errors;
  homepage Start Linux → `index.html?guest=busybox#ide`, trusted `printf` → `home-626`
  (trace `target/e0t30-626/home-start-guest.zip`); model at 1440 normal (`animated`), reduced
  motion (`paused`) and no WebGL (text fallback follows the Devices choice; the one console error
  is three.js reporting the forced WebGL failure).
- First attempt at the frozen product (`20bfdcb8c`) failed one test: the promoted navigation test
  expected the old index heading. Receipts in `target/e0t30-626/failed-20bfdcb8c/`; the test now
  expects "Case studies" (real content change, no product change).

**Carried unchanged:** E0-T29's RISC-V 127/0 and its other evidence (no runtime, controller or
module change here); E0-T28's foundation proof re-ran inside this gate.

**Coverage of changed hunks.** Executed in the recorded run: every public route and case page
(sweep, case tests, dist check), the homepage case list and footers, the security section
(link asserted), the case CSS at desktop and phone (screenshots, table stacking assertion), the
verify/check scripts' case-page additions. Not executed: `e9-gpu-results-browser.mjs` (asset list
edit only; GPU campaign out of scope).

**Digests.** `evidence/ui-redesign/public-626/SHA256SUMS` (`6abaf82f…`) over committed evidence;
`target-SHA256SUMS` (`d3117339…`) over the 46 gate traces, the start trace and the failed-run
receipts.

**Limits.** Docstream stays 1.9.1; reader content and search are unchanged (E0-T32). No physical
iPhone, GPU speed, process RSS, bounce or conversion claims. The design grades for the combined
site wait for E0-T32. No cold clone, push or deploy.

