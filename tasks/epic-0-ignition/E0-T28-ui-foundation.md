---
id: E0-T28
epic: 0
title: Shared interface foundation on @brett_lamy/ui (build, tokens, shared nav)
priority: 0.1
status: verified
depends_on: [E0-T27]
estimate: S
risk: medium
capstone: false
---

## Boundary

First slice of the site redesign (parent E0-T31). Install the pinned `@brett_lamy/ui@5.10.1`
into the existing `web/` package and build a shared interface bundle with the toolchain that
already exists for the Docstream reader (esbuild 0.28.2, React 19.3.0). No second bundler, no
Rust changes, no change to guest/runtime behavior.

In scope:

- `web/ui/src/` — design tokens (warm dark ink, one restrained accent, IBM Plex type served from
  this origin), `UIRoot` (BLProvider + a viewport portal layer), the shared `SiteNav` (desktop
  links, phone sheet), the diagnostic route index (Dialog + List), and thin compositions of
  library controls (`ButtonLink`, `SettingSwitch`, `Choice`, `Picker`, `Field`). Every control is
  a library component; nothing is hand-drawn to look like one.
- `tools/build-ui.mjs` (`npm run build:ui`, called by `make web-build`) emitting `web/ui.js`,
  `web/ui.css`, `web/ui-assets/`, and stamping `?rev=` into pages from the emitted bytes.
- `tools/build-web-dist.sh`: copy `ui-assets/`, apply the deploy root swap to the bundle's route
  table, restamp the shipped revs, include the fonts in the service-worker version.
- A small visible use: the app shell header mounts the shared nav (keeping `#version`,
  `#audio-autoplay-badge` and the `.tab[data-tab="ide"]` address), and `ui-kit.html` shows every
  shared control.

Out of scope: redesigning the launcher/workspace (E0-T29) or the homepage and public pages
(E0-T30).

### Latest-source integration (2026-10-30, re-opened)

The slice was first built and verified on old `main` (05fa92c82 → 78124cf53). That source was the
wrong base: the product stack's tip is PR 626 `codex/omarchy-streamed-software-restore` at
`c396efe1ecd061721865a5929235e6d0a6268561` (E9 recording/session/timeline/branch/bundle/network
controls, streamed software restore, the factory GPU runtime, current E9 guides, and the four
case-study pages). This branch, `codex/ui-redesign`, is a stack layer directly above it. The
foundation delta is re-applied there and must be re-proven on that source; the earlier log
entries and `evidence/ui-redesign/foundation{,-r2}/` are historical and prove nothing about it.

Added for the integration, same boundary (shared nav, provider, styles; no runtime semantics):

- The shared nav lists **Case studies** (`./case-studies.html`) on desktop and in the phone
  sheet. The four existing case-study pages, their content and status labels are unchanged.
- From the app (`current="app"`), Docs, Case studies and Roadmap open in a new tab
  (`target=_blank rel=noopener`), so reading them never ends a running guest. The current-machine
  entry stays in-document (`#ide`) and still dismisses the phone sheet.
- The app header (`body > header`) is the shared warm bar, and the page tokens are the warm ink
  so the header matches the page. main.js's autoplay notice `#audio-autoplay-badge` stays in the
  DOM (its id, text and state writes untouched) but is never displayed in the header, whatever
  the controller sets. Its readout in Settings belongs to E0-T29.
- Integration only keeps both stylesheets (`session-library.css` and `ui.css`) and both build
  steps (`session-web` and `build:ui`) where 626 and the foundation touched the same lines.

## Deterministic acceptance

`bash tools/verify-ui-foundation.sh`

after `make web-build` and with `web/dist` rebuilt by `tools/build-web-dist.sh`. It checks: exact
pins and registry integrity of `@brett_lamy/ui@5.10.1`, single copies of React/react-dom/react-aria;
two builds produce identical bytes; the bundle ships no editor/markdown/math/replay/storage/
networking code and the required library modules are present; the stylesheet references only
same-origin assets; no gradients or glows in `web/ui/src`; source and dist pages reference the
exact revs they ship; dist routes are root-swapped; `sw.js` is stamped; and the three Playwright
checks in `web/tests/ui-foundation.spec.js` pass (kit controls operate, phone nav sheet, app
shell mount with every source-page id intact, cascade isolation, viewport-anchored dialogs, zero
browser errors).

## Adversarial verification

Medium risk: acceptance criteria plus one bounded novel attack. Angles worth trying:

1. **Fake library** — confirm the rendered controls carry the library's `data-slot` markers and
   come from `node_modules/@brett_lamy/ui/dist` modules listed in `target/ui-build/metafile.json`,
   not local lookalikes.
2. **Cascade leak, both ways** — the app page's unlayered element CSS must not restyle island
   controls (the spec compares a Button across the app and the legacy-free kit page), and the
   island's tokens must not leak into the legacy page (`--muted`, `--line`, `--accent` are
   redefined only on `.wv-ui`). Remove the `all: revert-layer` guard and the spec must fail.
3. **Runtime DOM** — main.js/ide.js/tabs.js ids and the `.tab[data-tab="ide"]` entry survive the
   mount; `#ide` stays in-document (no reload of a running guest); `?embed` still hides the header.
4. **Deploy swap** — in `web/dist`, the bundle links `./app.html#ide` and `./`, never
   `./index.html`/`./landing.html`; every page's `?rev=` hashes to the shipped bytes; an empty
   portal layer never intercepts pointer input.
5. **Determinism** — rebuild after `npm ci` in a different checkout path; bytes must match.

## Verification log

> **Historical, old-main source.** The entries below up to and including "r2 — VERDICT: verified"
> were recorded against `05fa92c82`/`78124cf53`, not the PR 626 stack. They are kept as history
> (digests in `evidence/ui-redesign/foundation/changed-source-sha256.txt`, `dist-ui-sha256.txt`
> and `foundation-r2/SHA256SUMS`) and do not verify the latest-source integration above.

### 2026-10-30 — worker — implemented, submitted for verification

Implementation head: `75990631b` (on `05fa92c82`; commits `fb34fc4bb`, `74c290934`,
`75990631b`). Evidence: `evidence/ui-redesign/foundation/` (`HEAD` names the head it was recorded
at).

Commands, at that head:

- `make web-build` — exit 0; runs `npm ci` from the new lock, then `npm run build:ui`
  (`make-web-build.log`, recorded on the pre-commit tree; the emitted bundle bytes after the clean
  `npm ci` were identical to the earlier local build, rev `42d35824ed6a`).
- `bash tools/build-web-dist.sh` — run by the pre-commit hook on every implementation commit;
  each rebuild reproduced the staged `web/dist` exactly, and the only dist changes against
  `05fa92c82` are `app.html`, `sw.js`, `tasks.json` and the new `ui.js`, `ui.css`, `ui-kit.html`,
  `ui-assets/*` (`changed-dist-files.txt`).
- `bash tools/verify-ui-foundation.sh` — PASS, exit 0 (`verify-ui-foundation.log`): pins and
  registry integrity, single React/react-dom/react-aria, two builds byte-identical (digest
  `dff54c6c…`), 25 library modules shipped and no editor/markdown/math/replay/storage/
  networking code, same-origin assets only, no gradients/glows in `web/ui/src`, exact revs in
  source and dist pages, root-swapped dist routes, stamped `sw.js` (`934c84b562c9`), and 4/4
  Playwright checks.
- Published-layout check (`dist-browser-check.mjs` → `dist-browser-check.json`): `web/dist`
  served as deployed; `/app.html` at 1280 and 390 px and `/ui-kit.html` at 390 px mount the nav,
  zero browser errors, zero horizontal overflow; nav links resolve to `./`, `./docs.html`,
  `./roadmap.html`, `#ide` (app) and `./app.html#ide` (kit).

Sizes as shipped (`bundle-sizes.txt`): `ui.js` 685,766 B (217,485 gzip), `ui.css` 260,921 B
(43,430 gzip), fonts 75,308 B (three latin woff2). The JS is React/react-dom and the library's
own dependencies (react-aria, framer-motion, tailwind-merge); the library's code is ~67 KB of it
(`bundle-metafile.json`). The CSS is the library's precompiled sheet plus ~5 KB of ours; the
`drop-unused-package-css` step removed docstream, KaTeX and rrweb CSS (~145 KB) whose importing
modules ship no code, and fails the build if that ever stops being true.

Claim. The site now has one shared interface built from the real `@brett_lamy/ui@5.10.1`
components — `BLProvider`, `Button`/`buttonVariants`, `Dialog*`, `Sheet*`, `List`, `Switch`,
`Segmented`, `Select*`, `TextField`/`Label`/`Input`, `Badge` — with the existing esbuild/React
toolchain. The app header renders the shared nav (the Playwright run shows the library's
`data-slot` markers inside the header island), every id written in `web/index.html` still
exists after mounting, `#version`/`#audio-autoplay-badge` stay outside the React root, and the
demo entry keeps `.tab[data-tab="ide"]` with an in-document `#ide` link. Island tokens are
scoped to `.wv-ui` and an `all: revert-layer` guard isolates library controls from the page's
unlayered element CSS: the same Button computes identically (12 properties) in the app header
and on the legacy-free kit page; with the guard removed that check fails on 5 properties
(sabotage run, guard restored, rebuilt bytes identical). Dialogs and sheets portal into a fixed
viewport layer — before that fix the Diagnostics dialog measured 8 px tall in the app header —
and the empty layer never takes pointer input. The kit page operates each control (switch row,
segmented arrows, select option, text field, alert dialog action) and fits 390 px.

Notes for the verifier:

- Playwright runs use `PW_DISABLE_TS_ESM=1`, set only inside `tools/verify-ui-foundation.sh`:
  under Node 24 the pinned Playwright 1.49.1 hangs in its TypeScript ESM loader before test
  discovery (even `--list`). The spec is plain JS. Its UI timeouts are 45 s per test and 5 s per
  expectation, not the guest-boot defaults.
- The guard also reverts unlayered page rules aimed at the island root itself, which is why the
  app's mount point sizes the island with grid (`75990631b`).
- Not run here: the full in-browser suite and guest boots (scheduled at the final head), a cold
  clone (no portability claim beyond the clean `npm ci` rebuild), and Firefox/Safari.
- `ui.js` is shared by every page that opts in; docs pages still load their own React through
  the Docstream reader, so a page using both would load React twice. No page does yet; E0-T30
  must settle this before mounting the nav on the docs reader.

### 2026-10-30 — fresh verifier — VERDICT: refuted

Reviewed submission `6a9bb8c0490c5f7b312685c59ea1e07f2808538b`, implementation
`75990631bc1612ecfa06fef1fc5b08a2343ee134`, diff from `05fa92c82`. Predictions P1–P10
were recorded before opening worker evidence. No implementation code was edited. Status returns
to `in-progress`; the worker has three bounded foundation defects to fix.

- **P6 / route-index activation — FAILED.** Predicted ordinary pointer activation would follow
  the visible menu and diagnostic links. In the phone sheet, the current-machine anchor computes
  `pointer-events: none`; `elementFromPoint` returns `data-slot="list-row-content"`, and normal
  clicks time out. The permanent diagnostic-route test likewise cannot click “Interface kit”.
  The anchors are nested in the library's noninteractive title wrapper in
  `web/ui/src/components/site-nav.jsx:47` and `route-index.jsx:21`; the stretched-link styles at
  `web/ui/src/styles.css:177` do not restore pointer access. Citation:
  `target/ui-verifier/foundation-r1/mobile-current-app.json:15,24,26`, SHA-256
  `f4fc5cf79b10806ccb19a73d5b7218bc972d86d373fbe2bdc40f6a2fcbbb7a6b`;
  `regressions-final.log:18,63` in the same directory. **Demand:** make both existing row-link
  compositions accept normal pointer input; retain real link semantics and pass the promoted
  pointer regressions.
- **P8 / current-app phone navigation — FAILED.** Predicted activating the current Machine
  entry would preserve the document/IDE and dismiss the sheet. Keyboard Enter instead navigates
  `/index.html?nosw#ide` to `/index.html#ide`, losing both window and IDE-node sentinels.
  The packaged app repeats this from `/app.html?nosw#ide` to `/app.html#ide`. The mobile mapping
  uses `route.href` at `site-nav.jsx:47`, bypassing the desktop `#ide` handling at line 21.
  Citation: `mobile-current-app.json:30` (digest above),
  `target/ui-verifier/foundation-r1/additional-checks.json:61`, SHA-256
  `ead10d2f9270b972cba8c80aa6e1fbe0b76a725ef2252e43ce63d91560663f27`;
  `regressions-final.log:108` records expected sentinels versus observed nulls.
  **Demand:** keep current-app navigation in-document, preserve its query/session state, and
  dismiss the phone sheet for pointer and keyboard activation.
- **P4 / primary-link foreground — FAILED.** Predicted `buttonVariants` links would retain the
  library primary foreground, matching Button. The nav link instead renders
  `rgb(236, 232, 225)` on `rgb(228, 168, 83)` (contrast 1.715:1), while Button uses the intended
  `rgb(26, 19, 6)` (8.796:1). The blanket `.wv-ui a { color: inherit; }` at
  `web/ui/src/styles.css:116` overrides the library foreground in `site-nav.jsx:85` and the
  `ButtonLink` composition. Citation: `additional-checks.json:48` (digest above),
  `regressions-final.log:142`; captured in `kit-primary-link.png` in the verifier directory.
  **Demand:** preserve the themed foreground for primary links and pass the promoted parity check.

**Predictions retained for incremental verification:**

| Prediction | Outcome and concrete evidence |
| --- | --- |
| P1 authentic library | **HELD.** Exact package/registry-integrity pins and single React/react-dom/react-aria pass; recorded metafile contains 25 contributing `@brett_lamy/ui/dist` modules (66,639 B), and browser markers render. Worker source/bundle digests match the frozen implementation. |
| P2 bundle boundary | **HELD.** Required library modules contribute; no banned editor/markdown/math/replay/storage/network module contributes. Independent acceptance rerun passes these checks. |
| P3 reproducibility | **HELD, same checkout.** Two builds reproduce digest `dff54c6c9c6894d376aba50bf7fa308967641191ff72446513e2016e8dcef3a9`. **NEEDS EVIDENCE, different checkout path:** deferred until correctness holds; no cold clone spent on a refuted head. |
| P4 type/tokens/isolation | **HELD** for self-hosted IBM Plex, scoped palette, 12-property app/kit Button parity, and unchanged sampled legacy control styling. Primary-link foreground is the separate failure above. |
| P5 kit controls | **HELD.** Existing acceptance operates switch row, segmented arrows, select, field, and confirmation action; verifier also presses Start and cancels the alert (`additional-checks.json:22,23`). |
| P6 phone sheet | **HELD** for responsive replacement, 390px kit fit, and actual 360px scrolled-page sheet fit; link activation remains failed. |
| P7 viewport/focus/empty layer | **HELD.** At scrollY 2064, 360×640 sheet bounds are `(54,0,306,640)`; 25 Tabs remain inside, Escape detaches and restores trigger focus. On a scrolled 1280×480 page, diagnostic dialog bounds are `(360,24,560,432)`. Alert cancel detaches; acceptance confirms empty layer click-through (`additional-checks.json:2,23,36`). |
| P8 runtime DOM | **HELD** for source-page ID survival, version/audio ownership, and the desktop `.tab[data-tab="ide"]` address. Mobile document preservation fails above. Embed CSS is unchanged by the diff; its header-hiding selector remains effective on the retained outer header. |
| P9 packaging | **HELD.** All seven UI/dist asset hashes in the worker manifest match the submission. Only generated task metadata and the resulting `sw.js` version changed after recording. Independently reconstructing the final shell hash gives `28e685f2386e`, exactly the submitted worker version (`exact-head-sw.json`); the recorded earlier `934c84b562c9` is not treated as final-head evidence. Source/dist revs and route swap pass acceptance. |
| P10 browser health | **HELD** on the existing kit/app acceptance paths: four original checks pass with zero recorded non-favicon browser errors. No guest/runtime semantic claim is made. |

**Changed-hunk coverage audit:**

| Changed area | Classification |
| --- | --- |
| `ui-root.jsx` and viewport/focus styles | **Executed:** kit/app mounts, dialogs, phone sheet, scrolled viewport checks and empty-layer assertion. |
| `site-nav.jsx`, `route-index.jsx`, row/link styles | **Executed; refuted** at pointer activation, current-app routing and primary-link foreground. Diagnostic/current-page data maps are rendered. |
| `primitives.jsx` and `kit.jsx` | **Executed:** switch, segmented/select/text choices, ButtonLink rendering, primary action, confirmation/cancel and token swatches. Static specimen labels are declarative; sample secondary/ghost/destructive buttons have no application handler to prove. |
| `ui/src/index.jsx` | **Executed:** app and kit dispatch/mount. Unknown-island warning and already-mounted guard are **waived defensive/logging paths**, outside the product claim; no runtime node removal beyond the island is introduced. |
| `routes.js`, type/color/spacing tokens and media rules | **Waived declarative data**, with rendered routes/type and desktop/360/390px result checked. |
| `build-ui.mjs`, Makefile/npm build entry, dependency lock | **Executed:** recorded clean installation/build plus independent twice-built acceptance, exact module/hash checks; failure-only validation guards are waived tooling diagnostics. Different-path proof remains deferred as above. |
| `build-web-dist.sh`, emitted JS/CSS/fonts/HTML and `sw.js` | **Executed:** recorded build/package output; independent source-to-dist transform/rev/asset checks and exact submitted SW digest reconstruction. No deployment was performed. |
| `.gitignore`, README, task planning/queue and generated task JSON | **Waived metadata/docs**; submission-only metadata changes explain the worker-recording digest exceptions. |
| Worker evidence scripts/logs/screenshots/metafile | **Evidence, not product behavior.** Digests checked; relevant kit/sheet/dialog screenshots inspected. The worker dist phone capture inspected closed-nav hrefs only, so it does not prove activation. |
| Original foundation checks | **Executed, 4/4 pass.** They inspect visibility/hrefs but did not activate the failing links or compare primary-link text color. |

**SUITE:** four promoted cases in `web/tests/ui-foundation.spec.js:194,204,237` cover a real
diagnostic pointer click, phone current-app pointer and keyboard preservation/dismissal, and
primary-link/Button foreground parity. All four fail on this implementation, each bounded by
5 s actions/assertions and the existing 45 s test cap. Existing four checks remain unchanged.

Commands and recordings:

- `bash tools/verify-ui-foundation.sh` before adding the regressions — PASS, four original
  checks; `target/ui-verifier/foundation-r1/acceptance.log:118`.
- `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8157
  PLAYWRIGHT_JSON_OUTPUT_NAME=target/ui-verifier/foundation-r1/regressions-final.json
  node web/node_modules/playwright/cli.js test tests/ui-foundation.spec.js --config=web/playwright.config.js --grep 'diagnostic routes
  accept|phone current-machine|primary navigation action retains' --reporter=list,json` —
  four promoted checks fail; `target/ui-verifier/foundation-r1/regressions-final.log` and JSON.
- `node target/ui-verifier/foundation-r1/additional-checks.mjs` — source/packaged navigation
  repeat, scoped controls and scrolled viewport measurements; recorded Playwright traces
  `mobile-current-app.zip`, `additional-checks.zip` in that directory, with all report digests in
  `SHA256SUMS`. Retained failing-test traces are under `web/test-results/ui-foundation-*`.

Next review is incremental: recheck these three defects and touched UI/test/build boundaries,
then perform the deferred different-path build proof. Preserve the unaffected HELD outcomes when
their code/dependency boundary and evidence digest are unchanged. Full guest suites, final
whole-site grading, deployment, Rust/wasm semantic gauntlets and merges are outside this slice.

### 2026-10-30 — worker — r2: refutations P4/P6/P8 addressed, resubmitted

Implementation head: `d8cb8501c` (one commit on the verifier's `3c20d46a0`). Evidence:
`evidence/ui-redesign/foundation-r2/` (`HEAD` = `d8cb8501c…`; every file hashed in
`SHA256SUMS`). Only `web/ui/src/components/{primitives,site-nav,route-index,kit}.jsx`,
`web/ui/src/styles.css`, the spec, rev stamps in `web/index.html`/`web/ui-kit.html` and the
rebuilt `web/dist` changed in product code (`changed-since-r1.txt`, `changed-source-sha256.txt`).
No dependency, build-script, dist-script or runtime change.

Fixes:

- **P6 row activation.** The library renders `List.Row` title/subtitle inside a
  `pointer-events:none` body; its pressable rows are its own overlay `<button>`, and its row
  gesture handler skips `a[href]`. New `LinkRow` (`primitives.jsx`) passes a real `<a>` as the
  row's `children` (the library's live control area), stretches its hit area over the row body,
  reuses the library's title/subtitle classes, and names the link by its title with the detail as
  `aria-describedby`. Used for every phone-menu row and every diagnostic route (dialog, sheet,
  kit). No overlay buttons, no forced clicks.
- **P8 current-app phone entry.** `routeHref()` gives the phone menu the same in-document `#ide`
  as the desktop nav when the page is the app. The sheet is now controlled and closes on an
  in-document link for pointer and keyboard; react-aria returns focus to the Menu button.
- **P4 primary-link foreground.** The island anchor reset (`color: inherit; no underline`) moved
  from the `wv` layer (after the library's utilities) to a new `wv-base` layer below the
  library's components/utilities. `buttonVariants` links keep `text-primary-foreground`;
  `.wv-nav-link`, `.wv-row-link` and `.wv-prose a` still style from `wv`.

Commands, at `d8cb8501c` with a clean implementation tree:

- `bash tools/verify-ui-foundation.sh` — PASS, exit 0 (`verify-ui-foundation.log`): all prior
  static checks; deterministic digest `2c820b70…`; 12/12 Playwright (scoped
  `PW_DISABLE_TS_ESM=1`): the original 4, the verifier's 4 promoted regressions (diagnostic
  pointer click; phone current-machine pointer and keyboard; primary foreground parity), and 4
  worker additions (focus returns to Menu after in-document activation; phone-menu row navigates
  on an ordinary tap and is hit-testable at its centre, with accessible name exactly "Docs"; a
  mouse click on a row's chevron area follows the link; a prose link is accent-coloured and
  underlined while nav and primary links are not).
- `bash tools/build-web-dist.sh` — run by the pre-commit hook for `d8cb8501c`; `sw.js` version
  `5df69601af37`.
- `node evidence/ui-redesign/foundation-r2/dist-activation-check.mjs http://127.0.0.1:8232 …`
  with `web/dist` served as deployed → `dist-activation-check.json`, Playwright traces
  `dist-phone-current-machine-{tap,keyboard}.zip`, `dist-desktop-diagnostic-and-foreground.zip`:
  at 390 px on `/app.html?nosw#ide`, tapping and pressing Enter on "Open the machine" (href
  `#ide`) leaves the URL `…/app.html?nosw#ide`, keeps both window and `#ide-root` sentinels,
  detaches the sheet and focuses Menu; at 1280 px a mouse click on the "Interface kit"
  diagnostic row lands on `/ui-kit.html`; primary link and Button both compute
  `rgb(26, 19, 6)` on `rgb(228, 168, 83)` (8.796:1). Zero browser errors throughout.
- `dist-browser-check.mjs` → `dist-browser-check.json`: packaged app (1280/390) and kit (390)
  mount with zero errors and zero overflow. Screenshots: `kit-desktop.png`,
  `kit-phone-menu-sheet.png`, `app-desktop-diagnostics-dialog.png`, `app-*.png`, `dist-*.png`.

Sizes (`bundle-sizes.txt`): `ui.js` 686,294 B (217,731 gzip), `ui.css` 261,152 B (43,471 gzip);
fonts unchanged. Still 25 library modules.

HELD carried forward (code, dependency boundary unchanged): P1 authentic library, P2 bundle
boundary, P3 same-checkout reproducibility (re-proved at the new digest; different-path proof
still deferred to the verifier), P5 kit controls, P7 viewport/focus/empty layer, P9 packaging
transform, P10 browser health. P4 tokens/isolation and P6/P8 non-activation parts unchanged.
Not run: full guest suites, cold clone, Firefox/Safari.

### 2026-10-30 — fresh verifier — r2 — VERDICT: verified

Verified submission `11f78a874b5025cccc96a226238016179f1cd4dc`, implementation
`d8cb8501c648b766b6718d9da09265dafd55e561`. This is an incremental review of the three
refutations and the deferred different-path build proof. The original falsifiable predictions
were retained; no implementation or test code was edited in this review.

- **P6 row activation — HELD.** Normal diagnostic pointer activation lands on `/ui-kit.html`.
  Source acceptance also proves a phone-menu Docs tap, the exact accessible name “Docs”, and a
  click in the row's chevron area. The new `LinkRow` uses the library's live child area with a
  real anchor; both detail/current and plain link variants render. Citation:
  `target/ui-verifier/foundation-r2/dist-activation-check.json:26` and the corresponding
  `dist-desktop-diagnostic-and-foreground.zip`; source cases at
  `web/tests/ui-foundation.spec.js:194,266,287` pass.
- **P8 current-app phone navigation — HELD.** At the packaged `/app.html?nosw#ide`, both an
  ordinary tap and keyboard Enter follow `#ide`, retain the exact URL/query, preserve window
  and IDE-node sentinels, detach the sheet, and restore Menu focus. Citation:
  `target/ui-verifier/foundation-r2/dist-activation-check.json:2,14`, SHA-256
  `c4ba15ce855d54875d96b02a41a9f80cd5f6f6ba8b4b3518868f3e147f972476`;
  traces `dist-phone-current-machine-{tap,keyboard}.zip` in the same directory. The original
  promoted source pointer/keyboard cases and the worker focus-return case also pass.
- **P4 primary-link foreground — HELD.** Both Button and primary link compute
  `rgb(26, 19, 6)` on `rgb(228, 168, 83)` (8.796:1). Prose links retain the accent and underline;
  nav/button links retain their own variant styling. Citation: `dist-activation-check.json:30`
  (digest above), source parity/prose checks at `web/tests/ui-foundation.spec.js:237,296`, and
  inspected r2 kit screenshots. The lower `wv-base` layer fixes the previously overriding rule.
- **P3 different-path reproducibility — HELD.** A fresh local sparse clone at the exact
  submission head contains the complete UI build boundary, package/lock and stamped pages;
  unrelated guest artifacts are excluded. With `RUSTFLAGS`, `RUST_LOG`, `CARGO_*`,
  `NODE_OPTIONS`, `ESBUILD_BINARY_PATH`, `GIT_*` and `PLAYWRIGHT_*` scrubbed, clean `npm ci
  --no-audit --no-fund` and `npm run build:ui` pass. JS, CSS and all three fonts are byte-identical
  to the original checkout; git status is empty before and after. JS SHA-256 is
  `99fb55f94f0a164b43e621c82ccaf2e52d0aaf33df4e724115c4c0e5a80d9099`; CSS is
  `c46fc0216d7d55f05ed72cc8fc4f65ab91e35ba9a7e3b42cb2ff49bda60fe00e`.
  Citation: `target/ui-verifier/foundation-r2/clean-build.json`, SHA-256
  `80b0ef992823df2a297d8d55dde71d954179acdbf5db04b296233f492259b161`, with
  `clean-build.py`/`clean-build.log`. The scratch clone was removed after recording the proof.

**Retained outcomes and coverage.** P1 authentic package/context, P2 bundle boundary, P5 kit
controls, P7 provider/viewport/focus/empty-layer behavior, P8 runtime-owned DOM, and the unaffected
parts of P4/P6/P9/P10 remain HELD from r1 where code/dependency boundaries are unchanged. The full
foundation acceptance was rerun once and passes **12/12** (10.1 s), including the original four,
the four promoted regressions, and four focused worker additions. It also re-proves the static
pins, 25 library modules, absence of banned code, font URLs, cascade isolation, page IDs, revs and
source/dist transform. Same-checkout build digest:
`2c820b70646ec227a9f0368d5d645aa08b4b56818950f81d3a1db864a6dc3848`.

Changed repair hunks are covered: `primitives.jsx` LinkRow with/without detail and current-page
state; `route-index.jsx`/`site-nav.jsx` render and actual navigation; controlled sheet closing and
focus return; `wv-base`/row/prose styles and kit prose example; all added tests. Rev-stamped
HTML and rebuilt dist are covered by byte/route checks. Declarative data, existing defensive
logging guards, and metadata retain the r1 waivers. No changed product behavior remains unproven.

**Exact-head evidence audit — HELD.** All 25 r2 evidence files match `SHA256SUMS`; all touched
product-source digests and seven UI/dist asset digests match the submission. Source-manifest
exceptions are the two intentionally restored r1 captures and generated task/claim metadata.
The submission's later `sw.js` version is independently reconstructed as `c56fc0ce3878`, matching
the shipped file; the earlier recorded `5df69601af37` is not substituted for it. Citations:
`target/ui-verifier/foundation-r2/manifest-check.json` and `exact-head-check.json`. The packaged
activation repeat has zero recorded browser errors. UI bundle source sizes are 686,308 B JS and
261,152 B CSS; shipped JS is shorter only by the documented route swap.

Commands and permanent suite:

- `PLAYWRIGHT_PORT=8159 bash tools/verify-ui-foundation.sh` — PASS, 12/12;
  `target/ui-verifier/foundation-r2/acceptance.log`, SHA-256
  `bfe5bfbb18ae3782ae007059ea4158b1e3b827ba58132c744cb0762a92fce3db`.
- `node evidence/ui-redesign/foundation-r2/dist-activation-check.mjs
  http://127.0.0.1:8160 target/ui-verifier/foundation-r2` — recorded packaged activation repeat,
  followed by independent assertions on all reported values.
- `python3 target/ui-verifier/foundation-r2/clean-build.py` — PASS, fresh different-path install,
  build, clean-state and byte-identity proof. All verifier recording digests are in that directory's
  `SHA256SUMS`.
- **SUITE:** retain all 12 cases in `web/tests/ui-foundation.spec.js` and the deterministic
  `tools/verify-ui-foundation.sh` acceptance. No additional regression is needed for this repair.

Verdict applies to the shared foundation slice. Whole-site design scoring, launcher/public-page
work, guest/runtime gauntlets, other browser engines, deployment and merges remain outside it.

### 2026-10-30 — worker — PR 626 integration, implemented (submitted for a fresh verifier)

**Product head: `9347dd4bc60c069e110b179b1218666b9e169a7b`** (`codex/ui-redesign`, one layer above
PR 626 `c396efe1ecd061721865a5929235e6d0a6268561`). Tree at that head: `web/ui/src` `8ebba569…`,
`web/dist` `ecdbdb27…`. The commit that records this entry changes only the task file, the
queue, `web/tasks.json` and evidence; the hook re-copies the ledger into `web/dist`.

Integration. The coordinator applied the old-main foundation delta with `git apply --3way`; two
files conflicted and were resolved keeping 626's lines and adding the foundation's:
`Makefile` (`session-web` build and `web/session-pkg` kept, `npm run build:ui` added) and
`web/index.html` (`session-library.css` kept, `ui.css` added; the shared-nav header mount merged
cleanly). Every E9 control, the case-study pages and the guides are untouched; no Rust, runtime
controller or artifact manifest changed.

Added on this source (see Boundary → Latest-source integration):
- `web/ui/src/routes.js`: `case-studies` route; `site-nav.jsx`: `NEW_TAB_FROM_APP`
  (docs, case-studies, roadmap → `target=_blank rel=noopener` with "(opens in a new tab)" names
  and an "Opens in a new tab" row detail when `current="app"`); `primitives.jsx`: `LinkRow target`.
- `web/index.html`: warm page tokens; `body > header` background `rgb(21 20 16 / 0.94)`;
  `.audio-autoplay-badge { display: none !important; }` replacing the amber/cyan/red badge rules.
  main.js/autoplay.js still write the badge's state, text and `hidden`.
- `web/tests/ui-foundation.spec.js`: phone-sheet Case studies href; three new tests —
  Case studies from the nav on desktop and phone (and the index's three studies answer 200);
  from the app, Docs/Case studies/Roadmap carry `_blank`/`noopener`, the Case studies popup has no
  opener and the app document and URL are unchanged (desktop and phone); the warm header and
  body colours, a written autoplay state, and the badge staying `display:none` after a forced
  `hidden=false` + `unavailable` write, with no errors or overflow (1280 and 390).

Commands (frozen head, after `make web-build`, which built the new `web/session-pkg`):
- `bash tools/verify-ui-foundation.sh` → **PASS**: pins (`@brett_lamy/ui` 5.10.1 with registry
  integrity, React 19.3.0, single react/react-dom/react-aria), deterministic build digest
  `016f85caf147c0073781e61bb2147f51902496e6e6308eab59ce1829febb4e4e`, tree-shaking, same-origin
  assets, no gradients/glows, source and dist rev stamps, root-swapped dist, stamped `sw.js`,
  Playwright **15 passed** (12 carried tests re-run on this source + 3 new).
  Log `evidence/ui-redesign/foundation-626/verify-ui-foundation.log`.
- `PW_DISABLE_TS_ESM=1 node node_modules/playwright/cli.js test tests/ui-foundation.spec.js
  --trace on --output ../target/e0t28-626/pw` → 15 passed; 15 traces (19 MB, ignored path)
  hashed in `evidence/ui-redesign/foundation-626/traces-SHA256SUMS`.
- `node evidence/ui-redesign/foundation-626/capture.mjs` → `capture.json` and screenshots:
  source app at 1440/1280/390 (header `rgba(21, 20, 16, 0.94)`, badge `display:none` with state
  `locked`, nav Home / Docs `_blank` / Case studies `_blank` / Roadmap `_blank` / Machine `#ide`,
  overflow 0, no errors); phone sheet rows; tapping "Open the machine" keeps
  `index.html?nosw#ide` and closes the sheet; kit nav → `case-studies.html`. Built `web/dist`
  served with its `_headers`: `/app.html` at 1280 and 390 links `./`, `./docs.html`,
  `./case-studies.html`, `./roadmap.html`, `#ide`; `/`, docs, roadmap, case-studies, the three
  studies and `ui-kit.html` answer 200; header warm, badge hidden, no errors.
- Digests: `evidence/ui-redesign/foundation-626/SHA256SUMS` (all files above, incl. the traces list).

Claim. On the PR 626 source the foundation's library bundle, nav, menu, kit, isolation guard and
deploy swap behave as on old main (the 12 historical tests pass unchanged against this source);
Case studies are reachable from the shared nav on desktop and phone; reading pages opened from
the app leave the app document (and so a running guest) in place while the current-machine entry
stays in-document and closes the sheet; the app header is the warm bar on a warm page and the
autoplay notice cannot appear in it while its controller state keeps being written.

Carried, not re-proven: nothing. The old-main entries above are history only (their evidence is
kept by digest: `foundation-r2/SHA256SUMS` `ddb6fb23…`, `foundation/changed-source-sha256.txt`
`219dfc14…`, `foundation/dist-ui-sha256.txt` `ab73f4ed…`).

Limits.
- The launcher below the header still has 626's blue gradient and system font; restyling it is
  E0-T29. At ≤1000 px the core version readout wraps under the nav (626 layout; E0-T29 drops it on
  phones). The autoplay readout in Settings is E0-T29 (`/tmp/wasm-vm-ui-port-header-sound.patch`).
- No guest was booted for this slice: "guest survives" is proven as "the app document and URL are
  unchanged" (window token), not with a running guest. The riscv-tests 127/0 suite is not part of
  this acceptance and was not run.
- The dist browser check ignores `/releases/` responses (boot artifacts are staged at deploy time).
- No cold clone (coordinator, after the final combined grade); nothing pushed or deployed.
- `@brett_lamy/ui` 5.10.1 is the coordinator-confirmed latest; not re-queried here.

### 2026-10-30 — fresh verifier — PR626 integration — VERDICT: verified

Reviewed submission `09a9d051d746b27d2407d051192ec6c423a4f735`, frozen product
`9347dd4bc60c069e110b179b1218666b9e169a7b`, against immutable stack tip
`c396efe1ecd061721865a5929235e6d0a6268561`. Predictions were prepared from the task/diff
before inspecting `foundation-626` evidence. This verdict covers the shared foundation;
old-main design scores do not grade this combined source. No implementation was edited.

- **P1 latest functionality/content preservation — HELD.** Source review and the
  766-entry blob audit prove the retained crate sources, current guides, E9 timeline/runtime,
  retained GPU runtime/session package and case-study artifacts unchanged. The four source
  case-study pages and their packaged counterparts remain at their existing URLs; desktop
  and phone acceptance follows the index and checks each article answers 200. `Makefile`
  retains the session-web build/copy, and `index.html` retains session-library.css and every
  runtime-owned ID after mount. Citations: `target/ui-verifier/foundation-626/identity-audit.json`,
  source diff `c396efe1e..9347dd4bc`, `web/tests/ui-foundation.spec.js:314`, and worker
  `evidence/ui-redesign/foundation-626/capture.json`.
- **P2 authentic library/build boundary — HELD.** Independent acceptance checks exact
  5.10.1 integrity, single React/react-dom/react-aria contexts, the 25 real library modules,
  prohibited heavy-module exclusion, same-origin fonts, deterministic repeated build,
  source/dist root swap and shipped revs. Combined digest is
  `016f85caf147c0073781e61bb2147f51902496e6e6308eab59ce1829febb4e4e`;
  source JS SHA-256 `89193e0eaef5e991c89f51815e3a8cf710b2edae7fdc519609ee74f21971a226`,
  CSS `c46fc0216d7d55f05ed72cc8fc4f65ab91e35ba9a7e3b42cb2ff49bda60fe00e`.
  Citation: `target/ui-verifier/foundation-626/acceptance.log:1-9` and the current build report.
  Different-path portability is reserved for the final combined artifact by the coordinator;
  the old-main clone is not substituted for this source.
- **P3 unchanged foundation behaviors — HELD on the latest base.** All 12 original
  kit/isolation/viewport/normal-pointer/primary-foreground/prose/current-machine checks rerun
  successfully alongside the three integration cases: **15/15** in 19.0 s. The worker's
  15 recorded traces contain real actions and agree with its passed log. Three transient
  expect.poll attempts settle successfully in their parent assertion; none is a hidden
  terminal failure. Citations: `acceptance.log:1426`, `coverage-audit.json`,
  `evidence/ui-redesign/foundation-626/traced-run.log`, and its `traces-SHA256SUMS`.
- **P4 separate-context navigation and bounded novel attack — HELD.** On a real 390 px
  BusyBox guest, trusted input creates a file before keyboard Enter activates Case studies
  in the phone sheet. The new page is `/case-studies.html`, has the expected heading/article
  links and `opener=null`. Returning retains the exact controller object, IDE object,
  document token, URL and `{key:"busybox",generation:1}`. After explicit native terminal
  focus, trusted `cat /tmp/ui-foundation-626.txt` returns `foundation-survival-626` with zero
  errors. Citation: `target/ui-verifier/foundation-626/phone-real-guest-nav.json`, trace
  `phone-real-guest-nav.zip`, screenshots `phone-keyboard-studies.png`,
  `phone-studies-popup.png`, `phone-shell-after-return.png`. The separately promoted test
  passes **1/1** in 8.1 s (`promoted.log`, `promoted-pw/*/trace.zip`).
  This strengthens the worker's page-token-only evidence with a real guest and real file.
- **P5 current-machine/dismissal — HELD.** Existing pointer and keyboard cases prove
  `#ide` preserves the exact document/URL and dismisses the sheet; the focus-return case
  confirms Menu receives focus. Ordinary diagnostic and whole-row pointer actions work.
  Citations: `web/tests/ui-foundation.spec.js:194,204,253,287`, current acceptance and traces.
- **P6 warm header/hidden notice — HELD.** Recorded desktop/phone captures show the
  warm header `rgba(21,20,16,0.94)`, warm body and no horizontal overflow. The badge ID and
  controller state writes survive; independent acceptance observes a valid state and proves
  `display:none` after `hidden=false`/unavailable writes. The header contains no yellow notice.
  Citations: `web/tests/ui-foundation.spec.js:379`, worker `app-1280.png`, `app-390-menu.png`,
  `capture.json`; launcher styling below it remains the explicitly pending workspace slice.

**Focus qualification, not a mobile completion claim.** The first bounded attack failed to
read back after an ordinary terminal-wrapper tap: focus remained on Menu, with no typed echo.
It did not replace or pause the guest. That native terminal source is unchanged from PR626.
The preserved first receipt is `first-phone-real-guest-nav.{json,zip}`; the successful receipt
explicitly records the tap's Menu focus, the focus-only helper's actual textarea focus and
the later trusted guest readback. The coordinator assigned ordinary tap recovery to E0-T29;
its acceptance/log now requires this exact popup-return path without any programmatic focus
helper. It must pass before the final mobile grade. No runtime defect was silently repaired
or waived for the final UI.

**Identity/coverage — HELD.** All 14 current evidence files and 15 ignored trace archives match
their recorded SHA-256 digests. The submission changes only evidence/task metadata,
`web/tasks.json`, `web/dist/tasks.json` and `sw.js` after the frozen product. Independently
hashing the 583 shell inputs with the original SW placeholder reconstructs the final
`cb389062436c` stamp exactly (`metadata-audit.json`). This verifies final shipped metadata,
not an earlier stamp. All 97 changed paths from PR626 are classified in `coverage-audit.json`:
product behavior executes in the current kit/nav/phone/overlay runs; generated assets have
byte/route/rev checks; dependency/config/route data and defensive logging guards have explicit
static waivers; historical evidence remains historical. No unproven claimed behavior remains.
No claim of rebuilt ordinary-Wasm identity was introduced.

**SUITE and commands.** Retain the 15 foundation cases and promote
`web/tests/ui-foundation-guest-navigation.spec.js` for actual guest/file preservation. Its
explicit focus isolates this navigation contract and does not certify ordinary phone tapping.

```
PLAYWRIGHT_PORT=8189 bash tools/verify-ui-foundation.sh
node target/ui-verifier/foundation-626/phone-real-guest-nav.mjs
cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8190 node node_modules/playwright/cli.js test tests/ui-foundation-guest-navigation.spec.js --trace on --output ../target/ui-verifier/foundation-626/promoted-pw --reporter=list
```

All verifier receipts, including the initial failure, are hashed by
`target/ui-verifier/foundation-626/SHA256SUMS`. No runtime/GPU/performance gauntlet, cold clone,
deployment, push, merge or combined design grade was performed for this slice.
