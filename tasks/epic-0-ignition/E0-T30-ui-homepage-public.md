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

### 2026-10-30 — fresh verifier — PR 626 public slice — VERDICT: refuted

Reviewed product `20bfdcb8cd8df1cb2c03dcbfb624cec4ecdc1570`, recorded head
`788ce00143309dbe4a94c89142da257ab7ab5ade`, and stopped-worker claim
`7cd626e4cacf2bccd275510d62d38986da3d090f` above verified B `60232554f`.
Predictions P1–P7 were sent to the coordinator before opening the final evidence. This is one
bounded medium-risk review; the reserved phone nested-404 attack is consumed and HELD.
No implementation was edited. Status returns to `in-progress` for the small repair below.

- **P6 ordinary phone targets — FAILED.** Predicted standalone public actions own at least a
  44 px hit area. At 390 px, RV-Phone's “See the current status →”
  (`web/case-study-riscv-os.html:17`) is `358 × 25.59375` at `(16, 476.8125)`;
  homepage “All case studies →” (`web/landing.html:48`) and index “Open the live machine →”
  (`web/case-studies.html:16`) are also 25.59375 px high. Their `::after` is `none` and the
  ±21.5 px vertical points around their centre belong to the parent, not the anchor.
  `site.css:47,127,137` supplies color/grid layout but no owned 44 px target for these
  standalone actions. The recorded route test's `smallTargets` (`ui-public.spec.js:40`) scans
  only `.wv-ui`, so its green result misses this boundary. Receipt:
  `target/ui-verifier/public-626/phone-standalone-targets.json`, screenshots
  `phone-target-{1,2,3}.png`; promoted test at `web/tests/ui-public.spec.js:388` fails at the
  owned-band assertion on both **390 and 360 px** (`owned-phone-targets-test.log`, two traces
  under `pw-owned-targets/`). **Demand:** give the standalone public CTA links an owned target
  of at least 44 px and retain a real activation check; preserve their destinations and inline
  prose links. The promoted test accepts a real expanded pseudo-element as well as a taller
  link box, so the repair need not change type or visual treatment.
- **Physical recheck qualification.** At the RV-Phone link, a real touch 5 px below the DOM
  rectangle **did activate** `#status` in this Chromium phone context. A pointer at that same
  point did not, and a centre touch did. This is a declared owned-target-size failure, not a
  claim of broken navigation or that every nearby touch fails. Exact receipt and recording:
  `phone-target-recheck.json` / `phone-target-recheck.zip`. The first ad-hoc recheck incorrectly
  expected the nearby touch to remain inert; it was corrected before this verdict. Both
  geometry-only first test receipts (`pw-targets/`) and the final owned-band test receipts are
  retained, without weakening the 44 px assertion.

**Other predictions and flows (carry these HELD results into the repair review):**

1. **P1 homepage → real guest — HELD.** One primary “Start Linux”, secondary chooser, real
   architecture model, no decorative background canvas. The source route reaches BusyBox and
   trusted `printf` produces `home-42`; the worker's additional start recording prints
   `home-626`. `public-626/verify-ui-public.log:6026–6832`, `capture.json` start, and
   `target/e0t30-626/home-start-guest.zip`. Independent public acceptance rerun: **17/17**
   (`target/ui-verifier/public-626/public.log`, 24.1 s). This rerun preserved all substantive
   `landing-hero` and benchmark assertions.
2. **P2 architecture controls — HELD.** Actual library Segmented and motion Button press the
   native scene controls; pointer/arrow selection updates scene/caption, reduced motion starts
   paused, and the forced no-WebGL fallback follows selection. The one forced WebGL console
   error is expected only in that sabotage capture; ordinary captures have none.
3. **P3 docs chrome — HELD.** Real library controls drive search, subject filter, archive,
   history, source/Markdown actions and phone Close/focus return; no inert Browse toggle at
   800 px. Article stays outside `.wv-ui`. The current local reader metafile has one root
   React/ReactDOM set, 23 live UI-package modules and no shipped UI-nested Docstream/editor
   code. The 155-page, 1533-source corpus, 236 links and 181 code blocks pass unchanged.
   Docstream 1.33, section search and the current task-based guide remain E0-T32.
4. **P4 roadmap — HELD.** Search, native value synchronization, Gantt/Kanban, filters, task
   detail, library Close/Escape and focus return work in the current recording. Direct bounded
   keyboard check also exercises the newly filtered visible-control Tab wrap: Shift+Tab from
   library Close stays in the detail, Tab returns to that Close, Escape closes
   (`roadmap-keyboard.json`). Ledger data and controller logic stay intact; colors/copy are
   declarative.
5. **P5 case studies/proposals — HELD.** Homepage → index → articles and phone menu reach all
   four routes; anchors, attribution/source links, status and security cross-link survive.
   The three article `<main>` blocks exactly match B after the declared class renames and
   RV-Phone H1 correction. RV-Phone explicitly has not booted; hosting and celld integration
   remain proposed. Phone comparison rows stack. Copy no longer claims every console line is
   guest-written; host startup status is acknowledged. Benchmarks remain traceable to their
   committed JSON, including unavailable rows. No bounce/conversion claim is inferred.
6. **P6 root swap and the ONE nested-404 attack — HELD except the target finding.** Independent
   dist check passes 38 stamps / 31 pages / 112 scripts, 12 public pages and 185 links/assets.
   A Pages-like fallback at `/retired/field/guide/topic?revision=old` on a 390 px phone loads
   root assets/library navigation; keyboard skip stays on that URL and focuses `main`; real
   menu→Docs and recovery→homepage actions reach the correct pages. All three recovery actions
   own 44 px boxes, all four captured steps have zero horizontal overflow, zero errors and no
   guest/heavy requests. Receipts: `nested404.{mjs,json,zip,log}` and numbered `01`–`04` images.
7. **P7 deploy opt-in — HELD, no deployment claim.** Default `main`, explicit `main`, preview
   branch and invalid-name dry runs pass. The command is an array with the requested branch as
   one argument; R2/range/digest/size staging safeguards are unchanged. Actual upload/auth/Pages
   preview and final clean-clone proof remain coordinator steps after D and final combined grades.

**Identity and sufficiency.** All **35 committed evidence + 77 target receipts** match their
manifests (`6abaf82f071c97a4deae11f1f4e8bb97f1f0d832e1096382537e09a3942f4bb6` and
`d31173393335d21d43a1ee48b0612a2b3f6350466e7e7605d4936915742c2c4e`). The current 47 success
traces contain 3536 after-events; 45 intermediate poll assertions recover in successful parent
assertions, with no unresolved trace error. The first stale-H1 failure is retained, not presented
as green. Product→recorded changed only that harness expectation plus catalog/SW metadata;
recorded→claim is evidence/task/queue/catalog/SW metadata. UI source hash `76d15e673a14…` maps
exactly to deployed `c4e7bb0de506…` by the declared route transform; CSS bytes agree. Service
worker `d7a84391c839` reconstructs from 585 declared shell inputs; source/dist catalogs match
and all 760 task records' status/boundary/contracts/logs match task source. Receipts:
`identity-audit.json`, `metadata-audit.json`, `coverage-audit.json` in the verifier folder.

Every one of the **215 changed paths** is classified in that coverage receipt. Public behavior
uses the recorded flows above; generated docs chunks/fonts carry the unchanged renderer and
the checked build graph; literal CSS/tokens/theme/content, revision hosts, task metadata, build
guards and progressive fallback markup are static/configuration waivers rather than new guest
claims. The sole `e9-gpu-results-browser.mjs` edit renames a hashed asset from retired
`marketing.css` to `site.css`; its physical-GPU campaign is appropriately waived. Decorative
shader/style deletion is intentional and absence-tested. No native/Rust/session gauntlet is
restarted: **776 protected runtime/B/docs/artifact blobs are identical to verified B**, whose
127/0 and guest/input/recording evidence stays HELD. The 20 historical large receipts remain
parked under ignored `target/ui-historical-preserved/`, not untracked at their former paths.

**Provisional seven scores (current A+B+C, not final D/whole-request acceptance):**

| Dimension | Score | Visible basis / smallest outstanding change |
|---|---:|---|
| Typography | 8.7 | Plex Sans hierarchy and readable body; Mono is reserved for labels/data. Home/case/docs 1440/390 captures. |
| Restraint and product character | 8.6 | Warm neutral/amber palette and the actual machine cutaway; plain editorial case lists replace cards/glow. |
| Mobile usability | **7.5** | Terminal-first B, phone overlays and stacked tables hold; give the named standalone CTA pattern its owned 44 px band to reach 8. |
| Homepage clarity/engagement | 8.8 | Clear Linux/tab statement, one real start, interactive layers, optional in-page session and discoverable studies. |
| Starting/configuration ease | 8.4 | One recommended shell start; advanced desktop, Tools and Settings remain optional and real. Task-based guide update remains D. |
| Concise honest copy | 8.3 | Snapshot/host status and proposal limits are explicit; measurements retain scope and raw sources. Current-guide refresh remains D. |
| Actual UI-library consistency | 8.6 | Package controls in shared navigation, home/model, roadmap and docs; native xterm/canvas/engine hosts preserved. |

Screen evidence includes current public `home-*`, `cases-*`, all three `case-*-390.png`,
`docs-1440/390.png`, `roadmap-360.png`, `products-390.png`, verifier numbered fallback captures,
and the unchanged latest-stack B first-view/terminal/Tools/Settings captures. This review does
not assert physical-device accessibility compliance, measured conversion, a working container
backend, GPU qualification or a final combined score. C has one bounded repair; D is still pending.

**SUITE:** promoted the meaningful ordinary-target regression at `ui-public.spec.js:388` (two
phone widths, owned band and real activation). It fails 2/2 at the required geometry assertion.
Keep the existing permanent nested404 dist check; the independent phone fallback probe is a
receipt, not another broad recurring guest suite. No further attack is requested on repair:
recheck the CTA/harness boundary, carry these HELD results and reconcile fresh metadata only.

Commands: scoped `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8193` public 17-test acceptance with
`--trace on --output ../target/ui-verifier/public-626/pw-public`; focused `--grep 'standalone
public actions'` to `pw-owned-targets`; `node tools/check-ui-public-dist.mjs web/dist`;
`node target/ui-verifier/public-626/nested404.mjs`; task policy before queue regeneration.

### 2026-10-30 — worker — r2: owned 44 px targets for standalone public actions (submitted for recheck)

**Frozen product head: `77ab6346592d56beea21944ccdc4a073f9b4d301`** (`web/dist`
`afb55368…`). Starts from the verifier's refuted entry above (`33e847b76`, status
`in-progress`) and its promoted test (`ui-public.spec.js` "standalone public actions …").

**Delta from `20bfdcb8c`** (`git diff 20bfdcb8c 77ab63465`, excluding ledger/SW metadata): one
rule in `web/site.css` after `.wv-section-head p` —
`:is(.inner-hero, .wv-section-head) > a { display: inline-flex; align-items: center; justify-self: start; min-height: 44px; }`
— copied unchanged into `web/dist/site.css` (`cmp` identical); the promoted test (verifier's,
unchanged); `smallTargets` in `ui-public.spec.js` now also measures
`:is(.inner-hero, .wv-section-head) > a[href]` (standalone actions outside library islands);
and the earlier navigation-test heading. No markup, copy, anchor, destination, `ui.js`/`ui.css`
or runtime change; prose links are untouched. The rule covers the three named actions plus the
same pattern elsewhere ("Open the full app →", "Open the docs →", "See the isolation stack →",
"From a failing seed to a regression →", the proposal pages' specification links).

**Commands at `77ab63465`:**
- `node tools/check-docs.mjs` (155 pages, 1533 sources, 236 links, 181 code blocks);
  `python3 tools/check-docs-dist.py web/dist`; `ui-public.spec.js` + `landing-hero` +
  `benchmarks-home` with `--trace on --output ../target/e0t30-626/r2/pw-public` → **19/19**
  (the 17 recorded tests plus the promoted test at 390 and 360); `node tools/check-ui-public-dist.mjs
  web/dist` → PASS (38 stamps / 31 pages, nested 404, 12 pages, 185 links/assets).
  Log `evidence/ui-redesign/public-626-r2/focused-public.log`.
- `node evidence/ui-redesign/public-626-r2/standalone-targets.mjs` → source tree and built dist at
  390 and 360: each named action is 44 px tall (widths 176.27 / 129.8 / 177.66), owns all four
  ±21.5 px band points, and a real touchscreen tap at the band's bottom edge reaches
  `#status`, `/case-studies.html` and `/index.html#ide` (dist: `/app.html#ide`). Screenshots
  `source-`/`dist-*-390.png`; traces `target/e0t30-626/r2/standalone-*.zip`.
- Harness sabotage (before freezing): with the rule removed, the 390 px route sweep fails on
  "Open the full app →", "All case studies →" and "Open the docs →" (`harness-sabotage.log`);
  restored.

**Physical-touch note (kept as the verifier recorded it):** before this repair a real touch 5 px
below the RV-Phone link already activated it in this Chromium phone context; the failure was the
declared owned-target geometry, not navigation.

**Carried unchanged:** the verifier's HELD P1–P5, P6 (nested 404, dist) and P7 (deploy dry runs);
r1's workspace 29/29 and foundation 15/15 at `788ce0014` (no workspace, foundation, library
bundle or runtime byte changed since); E0-T29's RISC-V 127/0 and runtime evidence. Not rerun.

**Digests.** `evidence/ui-redesign/public-626-r2/SHA256SUMS` (`841627e4…`), `target-SHA256SUMS`
(`39d72776…`) over the 19 public traces and four standalone-target traces. r1 evidence and the
verifier's receipts are unchanged. The 20 historical large files stay parked by the coordinator
under `target/ui-historical-preserved/` (outside Git).

**Mobile score (provisional):** the verifier's 7.5 named only this pattern; with every standalone
action owning a 44 px target and the sweep now measuring them, I would put mobile at about 8 —
for the verifier to judge. Final combined scores wait for E0-T32.

### 2026-10-30 — fresh verifier — r2 — VERDICT: verified

Incrementally reviewed frozen product `77ab6346592d56beea21944ccdc4a073f9b4d301` and stopped-worker
claim `88215d251dff45e96037010d0e04574a77530691`. Predictions were recorded before opening r2
evidence. Only the prior standalone-target failure, directly touched harness and metadata were
rechecked; all other P1–P7 results, 776 protected blobs, A/B evidence and the consumed nested404
attack remain **HELD** with their unchanged boundaries/digests. No new attack or runtime campaign.

- **R2 owned phone targets — HELD.** The new rule at `web/site.css:54` gives standalone hero /
  section actions real 44 px boxes. All three named links own the four ±21.5 px band points at
  390 and 360 px in both source and dist; trusted bottom-band taps reach `#status`, the case
  index and the machine (`app.html` after root swap). `public-626-r2/standalone-targets.json`
  records all 12 states, with four traces and matching screenshots. Independent promoted-test
  rerun passes **2/2** in 2.1 s (`target/ui-verifier/public-626-r2/owned-targets.log`,
  `pw-owned-targets/`). The prior nearby-touch success remains accurately qualified; the repair
  fixes owned geometry without claiming navigation had failed.
- **R2 shared pattern and harness — HELD.** The expanded target sweep includes standalone
  actions outside `.wv-ui`; the worker's **19/19** public acceptance, corpus and dist checks
  pass (`focused-public.log:1023–1027`). Removing the new rule made that sweep fail on the three
  homepage section actions (`harness-sabotage.log`); restoration is present in frozen bytes.
  Inline prose links, markup, copy, destinations, `ui.js` / `ui.css` and runtime are unchanged.
  Screenshots of repaired RV-Phone, home case list and case index retain the established type,
  spacing and wrapping. No additional visual repair is required in C.
- **R2 identity / coverage — HELD.** All earlier 35+77 and new 12+23 evidence/target receipts
  match their manifests. New manifest hashes are `841627e4f00393b98f6d6da5b0997b7219c9665320293d00b0ce958cd4898d83`
  and `39d72776a696f3efaba25a52a5ce23a29d83a956bc3d1bade1641829d5abfbbf`.
  All 23 current traces have no unresolved error (two intermediate poll assertions recover).
  Source and dist `site.css` match SHA-256 `ffe850099ac6b346b651944ff00d7f9c5f034dcb0a8b2a2f44a6dc819d96b6d9`.
  Product→claim adds only declared evidence/task/queue/catalog/SW metadata; the source/dist UI
  hashes stay `76d15e673a14…` / `c4e7bb0de506…`. Service worker `7b51be60d2b9` reconstructs;
  source/dist catalogs agree and all 760 task status/boundary/contract/log records match source.
  Full receipt: `target/ui-verifier/public-626-r2/identity-audit.json`. The CSS rule and expanded
  selector execute in current captures/tests; comments are a static waiver. Prior coverage
  classifications, including the GPU asset-list-only waiver, stand unchanged.

**Provisional scores:** typography **8.7**, restraint/product character **8.6**, mobile **8.2**
(raised from 7.5 after the owned-target repair), homepage clarity/engagement **8.8**, starting /
configuration ease **8.4**, concise honest copy **8.3**, actual UI-library consistency **8.6**.
These apply to the current A+B+C interface. E0-T32's current Docstream/content requirement and
the final combined reassessment, once-only portability proof and coordinator preview remain
pending; this is not final closure of the user's whole redesign request.

**SUITE:** retain the two promoted owned-band tests and the expanded ordinary-target sweep.
No further test or implementation edit was necessary. Command: `PW_DISABLE_TS_ESM=1
PLAYWRIGHT_PORT=8194 node node_modules/playwright/cli.js test tests/ui-public.spec.js --grep
'standalone public actions' --trace on --output ../target/ui-verifier/public-626-r2/pw-owned-targets
--reporter=list` from `web/`; task policy before queue regeneration. No push, deploy or merge.

### 2026-10-30 — coordinator — deployment interpolation repair activated

The final isolated preview attempt from frozen docs release
`2d7b3414d0b16a744a246236f275870e51ba88a4` authenticated every required R2 object,
then stopped **before** invoking Wrangler: macOS Bash/default UTF-8 parses the ellipsis
after `$DEPLOY_TARGET` as part of the variable at `tools/deploy-cloudflare.sh:238`.
The log reports an unbound variable; the outer process status was zero, so it is not a
successful deployment receipt. The failed log, head, and five staged manifests are preserved
under `target/ui-release-626/deploy-first-attempt/`. Only those five expected manifest
rewrites were restored before checking out the owning public layer.

Reopen this boundary for one literal logging interpolation repair, using the same Opus
worker. No UI, package, runtime, asset guard, argument or publication-target behavior change
is authorized by this repair. The previous UI evidence, single bounded attack and seven
final grades carry by unchanged source/evidence. Narrow submission: shell syntax, the
actual repaired log under default macOS UTF-8 Bash, preview command resolution, then the
real isolated deployment. A fresh verifier decides coverage/carry; no broad repeated suite
or second full pristine clone is required for this one output line.

### 2026-10-30 — worker/coordinator — logging repair implemented

Actual Claude Code Opus5.5 repair product `92792d2bea496723b2344f93ea43be383450f715`
changes exactly one output interpolation at line238 to `${DEPLOY_TARGET}…`. No UI, package,
guard, command, target or runtime bytes changed. `evidence/ui-redesign/public-626-deploy-repair/`
holds the failed pre-Pages log/receipt, actual worker result/model usage, `direct-proof.py`,
`direct-proof.json` and SHA256SUMS. Direct commands at that product: `bash -n
tools/deploy-cloudflare.sh`, the exact actual source echo line in default inherited macOS
Bash (`C.UTF-8`, `set -eu`), and `PAGES_BRANCH=ui-redesign-20261030 DEPLOY_PRINT_ONLY=1
bash tools/deploy-cloudflare.sh`: all zero, expected preview URL and noninteractive single
branch argument. These prove the logging path and unchanged preview resolution; a real
upload remains pending after fresh verification and rebase of the docs layer.

Carry all prior UI proofs/grades, the previously consumed novel attack, and the completed
2d7b3414d0 correct-source pristine build with73checks and780identical dist files by unchanged
product boundary. This literal shell output fix has no new UI behavior to exercise. Fresh
verifier decides carry and direct sufficiency.
