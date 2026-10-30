---
id: E0-T32
epic: 0
title: Docs reader on Docstream 1.33 and a current field guide
priority: 0.35
status: verified
depends_on: [E0-T30]
estimate: S
risk: medium
capstone: false
---

## Boundary

Fourth slice of the site redesign (parent E0-T31), after the public pages (E0-T30). One boundary:
the Docstream reader and the docs it publishes. No Rust, runtime, session-format, artifact, image,
network or boot change; the workspace, recordings, case studies and public pages are carried.

- **Library.** Pin `@brett_lamy/docstream` 1.9.1 → 1.33.0 (official release, source
  `github.com/BLamy/docstream` at `9ba2d1190aff8cc2c8f886cefcc76b391da43c63`) with an exact
  lockfile entry; `@brett_lamy/ui` stays 5.10.1; one React; no CDN; the existing local esbuild
  build stays.
- **Search.** Use `@brett_lamy/docstream/site` `buildDocsTree` + `createDocsSearchIndex` for ranked
  title/heading/body matches with excerpts that land on the matching section, replacing the
  broad substring page filter. Repeated headings get the same deterministic ids in search
  results, rendered headings and the outline. Keep the subject filter, page/query URLs,
  Back/Forward, the six alias entry pages, source/provenance, the archive ledger, Copy/View/
  Download Markdown, the interactive architecture demo, the outline, readable code/tables and
  error states; guard async loads against stale responses.
- **Rendering.** Pele-backed Mermaid for a real architecture and/or record → open → seek →
  continue diagram (source tab kept, SVG lazy, no console errors); `AssetResolverProvider` for
  per-document source-relative images (no global asset base); an evidence thumbnail only where a
  real captured image or repo diagram exists. Warm tokens and `color-scheme` cover code
  highlighting, overlays and diagram cards. Docstream `ReplayPreview` (rrweb page replay) is not
  wasm-vm's `.wvsession` time travel and is not presented as such.
- **Content.** Audit every current guide for the final launcher / Tools / Settings / Recordings
  labels and source vs published routes; rewrite the quickstart around Start Linux (BusyBox),
  real terminal use, then optional panes and other machines; short task-based recording / open /
  seek / continue / export / import / checkpoint / storage guidance matching the shipped UI and
  its restrictions. Keep the 626 time-travel and storage guides, the case-study distinctions
  (RV-Phone Phase 0, hosted AI sandboxing and celld integration proposed) and the streamed
  software-restore scope (no physical-iPhone or process-RSS claims).
- **References.** Keep the pinned migration/provenance inventory as is (all 1533 sources,
  digests, code blocks, dispositions, links; no rewritten history). Add a separately versioned
  current reference set (`docs/design/session-replay.md`, `session-format.md`,
  `session-store.md`, `session-gpu-history-reader.md`, contract/qualification JSON where useful)
  from exact tracked blobs with immutable revision and digest, clearly marked current in the
  catalog, coverage page and reader. The reader keeps all current pages (155 before the additions);
  counts come from data.

## Deterministic acceptance

`bash tools/verify-ui-docs.sh`: the docs corpus/catalog/link/code-block checks (pinned inventory
unchanged; current references authenticated), the reader and dist build, and Playwright
(`PW_DISABLE_TS_ESM=1`) at desktop and 360/390 px: ranked search to the exact heading by pointer
and keyboard, Back and direct URL + hash, every alias, source and Markdown actions, a real diagram
SVG and its source, a per-document relative image with a full-size view, the architecture demo and
its code tab, quickstart and session-reference links, no horizontal overflow or console errors,
ordinary targets at least 44 px, overlay close with focus return, wide tables scroll; plus the
retained E0-T30 public gates as appropriate.

## Adversarial verification

Medium risk: acceptance plus one bounded novel attack. Angles: a search result that lands on the
wrong or duplicate heading; a stale async page or search response overwriting a newer navigation;
a guide label or route that no longer matches the shipped UI; a current reference without an
immutable source digest, or the pinned inventory silently changed; a proposal presented as
shipped; two Reacts or a CDN load.

## Verification log

### 2026-10-30 — worker — implemented (submitted for a fresh verifier)

**Frozen product head: `be6df4c1e73fdce0983b063ab0a7405274600ce2`** (`web/docs-src` `6347263f…`,
`web/dist` `6da2e61b…`), above verified E0-T30 `d620694b7` (PR 629). Activation `98e40e5a6`.
Product commits: `2cb02b008` (reader, content, references, checks), `be6df4c1e` (Mermaid fences
left out of search input). The first recorded run at `2cb02b008` passed; its evidence moved to
`target/e0t32-626/superseded-2cb02b008/` when the search excerpt fix changed the product.

**Package.** `@brett_lamy/docstream` 1.9.1 → **1.33.0** (exact pin; lock integrity
`sha512-oqUbekzn…yBQ==` from the registry tarball, release source `9ba2d11`); `@brett_lamy/ui`
5.10.1, React 19.3.0 and react-aria single copies (the UI package keeps its own nested
Docstream 1.32, as before). No CDN; local esbuild build unchanged.

**Reader (`web/docs-src/app.jsx`, new `anchors.js`, `docs.css`).**
- Search: `@brett_lamy/docstream/site` `buildDocsTree` + `createDocsSearchIndex` over
  `docs-content/search-corpus.json`, fetched on first search (focus, typing or ⌘/Ctrl K); ranked
  results show page title, section and an excerpt with the match marked, filtered by subject, and
  open `docs.html?page=…#section`. The catalog every page loads no longer carries full text
  (1.14 MB → 88 KB). The archive ledger keeps its path search.
- Anchors: the 1.33 renderer gives every heading `id = slugify(text)`. `anchors.js` numbers
  repeats in document order for rendered ids and the outline, and aligns each search section to
  the rendered heading by position (sections and outline share document order), so the library's
  own slug quirks (e.g. `` `div_by_zero.S` `` → `divbyzero-s`) land on the real heading
  (`div-by-zero-s`); fallback numbering if counts ever differ. Search input drops the properties
  block (so `kind:`/`source:` are not indexed and the title is stripped as the library intends)
  and Mermaid fences (readable excerpts). `check-docs.mjs` proves all 888 sections of all 159
  pages align.
- Navigation: hash targets scroll under the sticky header, receive focus, and are held in place
  while diagrams/images settle (stops on reader input, 600 ms of stable size, or 4 s);
  Back/Forward and direct URLs work; aborted page loads never write state; in-article links to
  reader pages and same-page anchors navigate in place with history (1.33 marks article links
  `target=_blank`); the phone library overlay traps Tab and its Close returns focus.
- Rendering: `AssetResolverProvider` resolves a page's `./images/…` next to its Markdown;
  thumbnails of real E0-T29 workspace captures (`launcher.png`, `terminal.png`,
  `recordings.png`, copied from `evidence/ui-redesign/workspace-626-r2/`) with the full image on
  hover/focus; a Pele-drawn Mermaid flow of record → open → seek → continue → export/import in the
  time-travel guide; warm `--docs-tok-*` code colours; the hidden thumbnail card no longer widens
  the phone layout viewport (it had made quickstart 421 px wide in a 390 px phone).

**Content (`web/docs-source/guides/`).** Quickstart rewritten around **Start Linux** → terminal
→ optional Files/Containers/Editor/Recordings/Settings → Other machines / Desktop settings, with
`?guest=` values from `main.js` and source vs published routes. time-travel, storage, graphics,
desktop, networking, overview and explainers use the shipped labels (Recordings → Replay /
Checkpoints, Stop recording — not the non-existent "Finish sample early" — Exact transition, Go to
keyframe/event, Run/Save/Discard continuation, Go live, Cancel local transfer, Delete local
recording, Checkpoints → Storage → Limits and cleanup, Settings → Keyboard/Pointer/Sound/Network,
Self-checks) and source routes (`./index.html#ide`; swapped to `./app.html#ide` in dist). Storage
no longer says export/import is a future milestone. Graphics states E5.5-T07's streamed software
restore (removes the 605 MiB expanded JS buffer; no total-memory claim; physical iPhone
unverified). Explainers marks what is new since 1.9 and that Docstream `ReplayPreview` (rrweb) is
unrelated to `.wvsession` recordings. Every existing guide, case-study distinction and limit is
kept.

**Current references.** `docs/design/session-replay.md`, `session-format.md`,
`session-store.md`, `session-gpu-history-reader.md` published from exact blobs at
`c396efe1ecd061721865a5929235e6d0a6268561` (PR 626) as `current-docs-design-*` pages (group
"Current references", properties carry that revision and source SHA-256, contract JSON linked at
the same revision). They are outside the pinned `2691b24` migration inventory:
`design/documentation-migration.json` and the ledger are byte-identical; the reader has 159 pages
(155 + 4). `check-docs.mjs` authenticates each current blob, its code blocks, and that none
entered the ledger; `check-docs-dist.py` checks the published corpus and images.

**Commands at `be6df4c1e`:**
- `UI_WORKSPACE_PW_ARGS=… UI_PUBLIC_PW_ARGS=… UI_DOCS_PW_ARGS="--trace on --output ../target/e0t32-626/pw-docs" bash tools/verify-ui-docs.sh`
  → **PASS**: foundation 15/15 (digest `f7129f11…`, identical to E0-T30: `ui.js`/`ui.css`
  unchanged), workspace 29/29, deploy dry runs, public pages, docs corpus (1533 sources, 159
  pages, 4 current at `c396efe1e`, 254 local links, 182 unchanged code blocks, 888 aligned
  sections), dist packaging, public 19/19, dist check (nested 404, 12 pages, 191 links/assets),
  Docstream pin + bundle checks (one React; site search, tree and asset resolver in the entry;
  Pele/rrweb/Strudel lazy; no CDN; no replay/Strudel/STL/TUI block in content), docs 7/7.
  Log `evidence/ui-redesign/docs-626/verify-ui-docs.log`; 55 traces under `target/e0t32-626/pw-*`.
- `node evidence/ui-redesign/docs-626/capture.mjs` → quickstart, search, landed section,
  time-travel diagram and current reference at 1440/1280/390/360: overflow 0 (measured against
  the configured viewport), no errors; "seek transition" → `time-travel#move-through-history`,
  focused at 95 px.
- Sabotage: without the thumbnail-card rules the phone docs test fails with 31 px overflow
  (`thumb-overflow-sabotage.log`); restored.

**Tests.** New `web/tests/ui-docs.spec.js` (7): ranked search + keyboard + exact heading +
Back/Forward + readable excerpt; library-slug alignment and unique ids/outline; direct hash, all
six aliases, superseded load; current reference provenance/revision/Markdown/coverage, in-article
link Back, same-page anchor; Mermaid SVG + source, per-document image and full card, architecture
demo + code, quickstart routes; phone 390/360 overlay focus trap, result ≥ 44 px, landing, Close
focus return, thumbnail card within the screen, wide-table scroll. `ui-public.spec.js`: docs tests
updated for ranked results (real changed interaction); `overflowX` now measures against the
configured viewport in both specs.

**Changed-hunk coverage.** Executed in the recorded run: every reader change above (tests and
captures), corpus/check/finalize changes (`check-docs.mjs`, `check-docs-dist.py`, dist build),
guide content (rendered and searched; quickstart/time-travel/storage/current refs navigated).
Static: CSS colour tokens (seen in captures), explainers/networking/graphics/desktop prose (built,
link-checked, round-tripped). Not executed: the anchors fallback branch (no page currently has a
section/outline count mismatch; 158 align by position, 1 via fallback numbering — it is exercised
by `check-docs.mjs`), repeated-heading numbering (no current page repeats a heading; rule shared
by reader and checker).

**Limits.** `DocsRenderer` statically includes Docstream's replay/STL/Strudel/TUI wrapper
components (their engines stay lazy); no page uses them. Search ranking is the library's (an
opening section can outrank a deeper one). Pele diagrams link to `pele.run` (link only, nothing
loaded from it). Evidence thumbnails are E0-T29 captures of the workspace at `505d29064`
(unchanged UI since). No physical iPhone, GPU, RSS or visitor-behaviour claims. Final combined
design grades belong to the fresh verifier. No cold clone, push or deploy.

### 2026-10-30 — fresh verifier — VERDICT: refuted

Reviewed frozen product `be6df4c1e73fdce0983b063ab0a7405274600ce2`, claim
`73ae7d08f1b637c10db9c56eccdcfcc090e8b88d`, against verified C `d620694b7`. Predictions were
recorded before evidence, then updated from the final source-only Mermaid-search delta. The one
reserved reader attack is now consumed and **HELD**. Status returns to `in-progress` for the two
bounded repairs below; no implementation was edited.

- **P4/P5 phone Docstream actions — FAILED.** Predicted ordinary rendered actions outside
  `.wv-ui` own a 44×44 px target. On both 390 and 360 px phones, **Copy Mermaid source**
  (`.docs-mermaid-preview .docs-split-copy`) owns **28×44 px**: both ±21.5 px horizontal points
  miss. **Open in Playground** (`.docs-mermaid-preview a.docs-split-action`) owns
  **145.59375×29.4375 px**: both vertical band points miss. Source receipt
  `target/ui-verifier/docs-626/diagram-targets.json` records exact boxes/band points, with
  screenshots at each width. Rechecked with recorded tests: `web/tests/ui-docs.spec.js:214`
  fails at `:232` for **both controls at both widths** (`geometry.log`, traces under
  `pw-geometry/`). The existing phone CSS at `docs.css:14` gives article buttons height but not
  width and does not size this anchor; wrapper-only/result-only checks miss these controls.
  **Demand:** provide owned 44 px targets for these ordinary Docstream action controls and keep
  the rendered-control coverage outside `.wv-ui`; inline prose links need no retint or padding.
- **Recheck qualification.** Copy succeeds from its centre and puts the actual Mermaid source
  in the clipboard; the Playground link is the expected `https://pele.run/playground#source=…`
  with `_blank`. This is a target-size failure, not broken action behavior or a claim about
  third-party availability. Receipt/recording: `diagram-recheck.json` / `diagram-recheck.zip`.
- **P6 honest terminal guide — FAILED.** New quickstart line 14 (published line 20) says
  “everything after them comes from the guest,” referring to initial host status lines. The
  unchanged runtime writes later host-origin storage, worker-stop and halt notices at
  `web/main.js:1105`, `:1586` and `:1598`. These are host lifecycle/status messages, not guest
  console output. The incorrect sentence is also visible in the final worker
  `search-1440.png` capture. **Demand:** replace the universal origin claim with wording that
  input reaches the guest shell and the host can also print status/error messages. No engine
  change or failure campaign is required; this is a source/guide factual contradiction.

**Predictions that HELD (retain these on repair):**

- **P1 package and real features — HELD.** Exact top-level Docstream 1.33.0 registry integrity,
  UI 5.10.1 and one shipped React/ReactDOM root; `/site` search/tree and scoped asset resolver
  are present, Pele is real and lazy, and no CDN/widget block is used. The UI package's retained
  nested 1.32 dependency and upstream inactive wrappers do not imply a second live renderer.
- **P2 search/navigation — HELD.** Ranked prose excerpts, exact focused section destinations,
  the real `div_by_zero.S` slug discrepancy, direct hashes, all six aliases, subject/archive,
  source/Markdown/history, same-page and same-reader article links, and architecture demo/source
  work. Independent original docs acceptance passes **7/7** in 17.5 s (`docs.log`, `pw-docs/`).
  Mermaid search-input filtering is exercised by “seek transition” → `move-through-history`
  without diagram arrows in the excerpt; other code remains indexed.
- **ONE delayed-response + Back/hash attack — HELD.** Starting at
  `quickstart#your-first-session`, a normal architecture link fetched real 200 Markdown bytes
  (2533 bytes, SHA-256 `0979635bbce725a6907ed74e26a91f865df1081dacf0bb58940f14b0c38820a5`).
  The response was held while actual Back restored quickstart and its hash, then fulfilled.
  URL, H1, title, source href, outline and focused heading stayed identical; no page errors.
  `back-delayed-response.{mjs,json,zip,log,png}` records the whole probe, with actual bytes and
  no production fixture edit. Do not add or repeat a new attack in the repair review.
- **P3 current references/history — HELD.** All four current-reference source digests match
  exact `c396efe1e` Git blobs and their separate revision; source inventory and published
  historical ledger remain byte-identical to C. The source-generated ledger equals the tracked
  inventory. Catalog is 159 pages, history is still 1533 sources; 182 current total code blocks
  and 888 sections pass the checker. Guide images match exact B captures by SHA-256.
- **P4/P5 rendering/phone layout — HELD except action geometry.** Real Mermaid SVG plus source,
  scoped relative images and full-size cards, warm tokens, configured-viewport overflow checks,
  phone library focus trap/Close return and horizontally scrollable tables pass. The old hidden
  thumbnail overflow is caught by the recorded sabotage and fixed in frozen bytes. No full
  physical-device or accessibility-compliance claim follows.
- **P6 current guide paths/limits — HELD except the one origin sentence.** Start Linux,
  Tools/Settings, Recordings/Replay/Checkpoints/storage, transfer and continuation labels match
  the current workspace. Software restore/iPhone/RSS and all four case-study proposal limits
  remain qualified. Docstream rrweb replay is explicitly distinguished from `.wvsession`.
- **P7 preservation/packaging — HELD.** All A/B/C results carry by unchanged boundary/digest;
  the final worker gate reruns **15+29+19+7 = 70** checks successfully. Core runtime, session,
  artifact and shared UI sources/bundles are unchanged. The prior phone return/input, C's
  owned standalone actions and the consumed nested404 proof are not re-litigated.

**Identity / sufficiency.** All **22 evidence and 55 target receipts** match manifests
`3eef2ef6fa543613f57be061ec31c0870348aff909c8f28682185536ae875d5b` and
`908fd079b31127679dee23ebab68f4b37694d851a78e5d340e42a35df0b5052d`. The 55 current traces have
no unresolved error; 72 intermediate poll assertions recover. Earlier `2cb02b008` recordings
are correctly superseded, not used for the final excerpt claim. Product→claim contains only
declared evidence/task/queue/catalog/SW metadata. UI source/dist hashes stay `76d15e673a14…` /
`c4e7bb0de506…`; CSS stays `74f187f16a37…`. Source/dist task catalogs agree and all 760 task
records' status/boundary/contracts/logs match source. SW **`c73acd282903`** reconstructs from
551 shell inputs. Full receipt: `target/ui-verifier/docs-626/identity-audit.json`.

All **253 changed paths** are classified in `coverage-audit.json`: recorded current reader
behavior and corpus/build/finalize checks; static prose/type/theme/HTML stamps/config/error
guards waived with source inspection; upstream generated/lazy unused renderer wrappers waived
because no page activates those features, without demanding package removal. For the explicitly
unexecuted repeated-heading path, a promoted **labelled in-memory fixture** (no published prose
mutation) exercises the official parser/site index, leading-title counting, duplicate numbering,
search/outline agreement and fallback numbering: **1/1 passes** (`ui-docs.spec.js:195`,
`promoted.log`). This closes that deterministic helper gap; current real-heading DOM alignment
is separately recorded. No unrelated native/GPU/compatibility suite or cold clone was run.

**Seven combined grades at this product (each must independently reach 8):**

| Dimension | Score | Evidence and remaining change |
|---|---:|---|
| Typography | 8.7 | Consistent Plex hierarchy, legible body/code and restrained Mono labels across retained C and new docs captures. |
| Restraint / product character | 8.6 | Actual machine model, warm palette, editorial case pages and real evidence thumbnails; no generic visual filler. |
| Mobile usability | **7.6** | Terminal-first app, fixed C actions, fitted thumbs/search/tables hold; fix the two undersized diagram action targets. |
| Homepage clarity / engagement | 8.8 | Unchanged clear statement, one actual guest start, useful interactive model and discoverable cases; C proof carries. |
| Starting / configuration ease | 8.6 | Quickstart now follows Start Linux → terminal → optional tools; section search and current recording/storage guides reduce hunting. |
| Concise honest copy | **7.7** | Most limits/provenance are clear, but remove the false universal claim about later terminal output. |
| Actual UI-library consistency | 8.6 | Actual UI 5.10.1 controls, real Docstream 1.33 features and unchanged native engine surfaces; hit size is counted under mobile. |

These are current combined grades, not an average and not completion of the user's goal. Two
categories remain below 8. Other five grades/visuals may carry into the bounded repair unless
their boundary changes. Coordinator's once-only pristine clone and isolated Pages publication
proof remain pending after correctness and all seven grades hold; no production deploy or merge.

**SUITE:** promote the two rendered-action geometry checks and the passing heading fixture.
The existing permanent superseded-load/direct-hash/Back tests already cover the navigation
mechanisms; retain the exact combined attack as a receipt rather than another recurring probe.
No copy-literal test is added for this small prose correction. Commands: original 7 docs cases
with `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8195 --trace on`; focused `--grep 'heading fixture|Docstream
diagram actions'` / `--grep 'Docstream diagram actions'`; the recorded probe script above;
task policy before queue regeneration. No push, deploy, merge or implementation edits.

### 2026-10-30 — worker — implemented (repair r2, submitted for a fresh verifier)

**Frozen product head: `08253b1f866d3aa03de0bdce7ab25ea3e3aeb199`**, one product commit above
verifier `056ee6c87` (prior product `be6df4c1e`). Only the two refuted points changed:

- **P4/P5 diagram action targets.** `web/docs.css` (+6): on `max-width:760px` or
  `pointer:coarse`, `.reader-document :is(button, a.docs-split-action)` gets
  `min-width/min-height: 44px` (split actions centred). Docstream's own article actions (code and
  diagram Copy, Open in Playground, demo controls) are sized; prose links are untouched. There is
  no wrapper, and fine-pointer desktop is unchanged.
- **P6 terminal sentence.** `web/docs-source/guides/quickstart.md` step 2 now says: "What you
  type goes to the guest's shell. The host can also print its own status or error lines in the
  terminal, such as startup progress, a full-storage pause or a stopped machine." This covers
  `main.js:1105/1586/1598`; there is no engine change.
- Generated by the hook: `web/dist` `docs.css`/`reader.css`, the `reader.js` corpus rev, docs
  HTML stamps, `catalog.json`/`quickstart.md`/`search-corpus.json`, and `sw.js`/`tasks.json`
  metadata. No Rust, runtime, session, artifact, shared UI or package change.

**Commands at `08253b1f8`** (log `evidence/ui-redesign/docs-626-r2/focused-docs.log`, header
`# 08253b1f8…`):
- `node tools/check-docs.mjs` → 1533 sources, 159 pages (4 current at `c396efe1e`), 254 links,
  182 code blocks, 888 aligned sections. `python3 tools/check-docs-dist.py web/dist` → ok.
- `(cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8128 node node_modules/playwright/cli.js test
  tests/ui-docs.spec.js --trace on --output ../target/e0t32-626-r2/pw-docs)` → **10/10**. This
  includes the promoted `:195` heading fixture and `:214` "Docstream diagram actions own 44 px"
  at 390 and 360, which failed at `be6df4c1e`.
- Same runner, `tests/ui-public.spec.js -g "docs|every public route"` →
  `pw-public-docs` **7/7**; `node tools/check-ui-public-dist.mjs web/dist` → PASS (38 stamps on
  31 pages, nested 404, 12 pages, 191 links/assets).
- `node evidence/ui-redesign/docs-626-r2/diagram-actions.mjs` → `diagram-actions.json`. It covers
  the source tree (`:8198`) and the built `web/dist` (served with its `_headers`), each at 390 and
  360, in a touch/mobile context:
  - **Copy:** 44×44, all four ±21.5 px band points owned. A real touchscreen tap at the band's
    right edge puts the `flowchart LR…` source in the clipboard. After the clipboard is cleared,
    Tab reaches Copy and Enter copies again.
  - **Open in Playground:** 145.59×44, full band. A tap at the band's bottom edge opens a new tab
    whose request is `https://pele.run/playground` (aborted, URL recorded). The href fragment
    carries the source, with `target=_blank`.
  - **Quickstart:** shows the host-status sentence and not the old claim.
  - Overflow 0 and no errors in all four contexts.
  - Recordings: `target/e0t32-626-r2/diagram-actions-{source,dist}-{390,360}.zip`. Screenshots:
    `diagram-actions-390.png` (whole card) and `{source,dist}-quickstart-terminal-390.png`
    (byte-identical).
- Manifests: `docs-626-r2/SHA256SUMS` `08f8dec7…02d8a6` (7 files); `target-SHA256SUMS`
  `e57e45f9…dd16e5` (23 files: 17 Playwright traces, 4 action recordings and 2 Playwright
  `.last-run.json` files).

**Coverage.** Both changed source hunks executed.
- **CSS rule:** executed at 390 and 360 on source and dist, by the promoted geometry test and the
  touch/keyboard proof. A pre-commit scan of every visible matching control on six pages found
  none under 44 px and no overflow.
- **Quickstart sentence:** rendered on source and dist, and passed through `check-docs`/the
  search corpus.
- **Generated dist/metadata:** checked by `check-docs-dist` and `check-ui-public-dist`.
- **Not executed:** the `(pointer:coarse)` branch above 760 px (for example a tablet). It is the
  same declarations, waived.

**Carried, unchanged boundaries.** P1, P2, P3, P7 and the consumed delayed-response/Back attack
stay HELD. P4/P5 and P6 hold except the repaired points. The be6 70-check acceptance
(15+29+19+7) carries: foundation/workspace/public sources and the package lock are unchanged,
and the docs and public-docs suites were rerun above. No new attack, cold clone, push or deploy.

**Limits.** Mobile is a Chromium touch emulation at configured widths; this is not a
physical-device claim. Third-party pele.run was not loaded. Whether mobile usability and concise
honest copy now reach 8 is for the fresh verifier to judge; the other five grades' boundaries are
unchanged.

### 2026-10-30 — fresh verifier — VERDICT: verified (repair r2)

Reviewed frozen product `08253b1f866d3aa03de0bdce7ab25ea3e3aeb199` and implemented claim
`428537953c1a30fd6c2278ca0d532eadff7ca9f8` against prior critic `056ee6c87`. Predictions were
recorded before inspecting r2 evidence: owned 44 px actions with working edge activation,
qualified terminal copy in source/dist, declared metadata-only submission and unchanged carried
boundaries. Both earlier failures are resolved; no new attack or implementation edit occurred.

- **P4/P5 phone Docstream actions — HELD.** `web/docs.css:53–55` now sizes the controls
  themselves. `evidence/ui-redesign/docs-626-r2/diagram-actions.json:2–161` shows Copy **44×44**
  and Playground **145.59×44**, all four ±21.5 px points owned on source and dist at 390/360;
  overflow 0 and errors empty in all four contexts. Independently reran the two promoted
  rendered-action cases (`web/tests/ui-docs.spec.js:214`): **2/2 pass** in 2.0 s on separate
  port 8196; log/traces under `target/ui-verifier/docs-626-r2/{geometry.log,pw-geometry/}`.
  Inspected the actual action recordings, not only the summary: source-390 trace
  `diagram-actions-source-390.zip` touch `call@67` copies the real `flowchart LR` source
  (`call@71`); clipboard clear `call@75`, keyboard Enter `call@89` and read `call@93` prove
  keyboard activation independently. Bottom-edge touch `call@103` opens a new tab requesting
  `https://pele.run/playground`; `call@111` contains the actual diagram source in its href.
  All four trace outcomes authenticate in `identity-audit.json`. The third-party request was
  deliberately aborted: this proves the link/action, not external service availability.
- **P6 truthful terminal copy — HELD.** `web/docs-source/guides/quickstart.md:14` now explicitly
  allows host status/error output after startup, consistent with unchanged `web/main.js:1105`,
  `:1586`, `:1598`. The old universal-origin sentence is absent from generated Markdown/search
  content. Source and dist text appears in all four recordings (source-390 `call@121`) and the
  byte-identical `{source,dist}-quickstart-terminal-390.png`; the new diagram/card capture also
  preserves the warm typography and readable layout. No engine or exceptional-state campaign
  is necessary to prove this factual prose correction.
- **Identity/metadata — HELD.** Evidence HEAD is exactly `08253b1f8`. New manifests authenticate
  all **7+23** files: SHA256SUMS
  `08f8dec7324dd84259b59172df73bc0cbfd607cb7c3c6361f9b563edad02d8a6`, target manifest
  `e57e45f963665831d35f66148e2bbfb26c1b1fedbadfff486e63433c0ddd16e5`. Prior **22+55** files
  still match their unchanged `3eef2ef6…` / `908fd079…` manifests. The 17 new acceptance traces
  are intact; 23 nested polling assertions recover in successful parents, with no unresolved
  errors (`trace-integrity.json`). The recorded log has docs **10/10**, affected public **7/7**,
  corpus/dist PASS (`focused-docs.log:302`, `:671`, `:675`). Product→claim changes only the
  declared log/queue/evidence/task catalogs/SW. Source and dist task catalogs are byte-identical;
  all **760** records' status/contracts/logs agree with source before this verdict. The exact SW
  reconstructs as **e9ff807d2c66** over 551 shell inputs. Generated reader JS differs only in its
  corpus rev, source/dist docs CSS agrees, and reader logic, package lock, runtime/shared UI,
  migration inventory and current-reference boundary remain unchanged. Audit and independent
  receipts: `target/ui-verifier/docs-626-r2/{identity-audit.py,identity-audit.json,SHA256SUMS}`.
- **COVERAGE/carry — HELD.** Both changed source hunks execute in source/dist phone captures;
  the rebuilt corpus, cache and alias stamps are covered by direct checks. The >760 px
  `(pointer:coarse)` selector arm is **waived as declarative**: it uses the identical 44 px
  declarations, with no separate handler/state path or physical-tablet claim. Other theme
  declarations and generated hash/catalog metadata are waived by source/digest inspection.
  Carry r1 P1/P2/P3/P7, unaffected P4/P5/P6 outcomes, A/B/C proofs, the passing labelled heading
  fixture and the consumed **actual delayed architecture response → Back/hash** attack by
  unchanged code/dependency/evidence digests. No new/repeated attack, untouched suite, cold
  clone or physical-device test was run. Prior per-group coverage waivers remain unchanged.

**Final combined design grades at this product (each independently exceeds 8):**

| Dimension | Score | Basis |
|---|---:|---|
| Typography | 8.7 | Carried Plex hierarchy, body/code legibility; repaired captures retain it. |
| Restraint / product character | 8.6 | Carried warm machine interface, editorial cases and real evidence images. |
| Mobile usability | **8.3** | The remaining Docstream action targets now own 44 px; phone library, image/table layout and terminal-return proofs carry. |
| Homepage clarity / engagement | 8.8 | Unchanged clear next action, actual guest start, interactive model and case stories. |
| Starting / configuration ease | 8.6 | Current Start Linux → terminal → optional tools guidance, ranked section search and session guides hold. |
| Concise honest copy | **8.5** | The false universal output claim is replaced by short, accurate host/guest wording; current limits/provenance carry. |
| Actual UI-library consistency | 8.6 | Actual UI 5.10.1 and meaningful Docstream 1.33 search/renderer/actions, with native engine hosts preserved. |

**SUITE:** keep the two previously promoted owned-target regressions and the passing heading
fixture; no additional test or literal-copy assertion is needed. Commands: focused Playwright
with `PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT=8196 --grep 'Docstream diagram actions' --trace on`;
digest/source/dist/trace audit above; task policy **before** queue regeneration. This verifies
E0-T32's local boundary. The coordinator's once-only exact-source pristine clone and isolated
Pages publication/real-guest smoke proof remain pending, so the overall requested closure is
not yet complete. No push, deploy, merge or stack edit.

### 2026-10-30 — coordinator — final reproducibility and published-release claim

**Frozen published source:** `d6a3d9999f05e3e5ad7662b22f14ed95999ba2b4`. **Pristine source:**
`2d7b3414d0b16a744a246236f275870e51ba88a4`. These are deliberately distinct heads: after
the successful pristine proof, the first deployment authenticated all R2 objects but stopped
before Pages on the known UTF-8 Bash log interpolation. Actual Opus repaired that single
output line on its owning public layer (`92792d2be`), freshly verified by `4eea41a1a`;
the docs layer was rebased and its verified task metadata refreshed.
`evidence/ui-redesign/release-626/final-reconciliation.json` authenticates the entire source
diff: one braced shell output interpolation, C task/evidence, and task catalog/cache metadata.
All **780** dist paths remain; **778** files are byte-identical to the pristine build, with
only `tasks.json` and `sw.js` differing as declared metadata. Interface, runtime, packages,
guides, catalog and assets are unchanged. Carry all local HELD results, the consumed bounded
attack, final seven grades **8.3–8.8**, and the pristine **73/73** UI checks.

**Pristine proof.** The fresh Git clone at the exact declared pristine head rebuilt Rust/Wasm
and npm dependencies from scrubbed environment, then passed **15 foundation +29 workspace
+19 public +10 docs** acceptance checks. All **780 generated files** matched the root release
byte for byte, with no tracked changes. No ignored target/node_modules/pkg caches were
copied. To fit the repo's 15.4 GB tracked evidence on this disk, program source was checked
out from Git, tracked historical evidence was APFS-cloned from that same frozen head, and
a full fresh-index Git diff authenticated all 31,970 tracked paths. One earlier checkout-only
attempt exhausted disk before any build/tests; it is preserved separately and is not a pass.
The entire 22-file external `releases/` directory was staged and inventoried, including 10
legacy/auxiliary extras. The build recipes and browser GETs identify only the three declared
manifest boot inputs; no OS-level full-file-read tracing is claimed. Exact script, step
commands, logs, input and file digests are under `release-626/pristine/`,
`release-inputs.json`, `reproducibility.json` and the separate checkout failure directory.

**Publication.** `python3 /tmp/wasm-vm-ui-publish-final.py` ran
`PAGES_BRANCH=ui-redesign-20261030 bash tools/deploy-cloudflare.sh` at the final frozen
head. It authenticated exact R2 bytes, enforced the 25 MiB Pages limit and published the
isolated preview **https://9f071e86.wasm-vm.pages.dev**. `deploy-command.json` and `deploy.log` retain
the exact source/command/receipt; production was not published. The five expected deployed
manifest URL rewrites were archived in `published/deployed-manifests/`, then only those
five tracked files were restored to HEAD after the proof; no other source edits occurred.

**Published browser proof.** `python3 /tmp/wasm-vm-ui-run-published-proof.py` runs the
archived `published-smoke.mjs` against the immutable preview origin. It passed
**14 checks**, **25 fixed file SHA256 bindings** and
**187 distinct completed same-origin requested-file bindings**,
with **0 unexpected HTTP/console/page/binding errors**. The actual main Start Linux
action restored the real BusyBox guest; trusted terminal keyboard input evaluated shell
arithmetic and printed `preview-42`. The recording also shows current Docstream 1.33.0
ranked search to a focused exact section, actual Mermaid SVG/source and source-relative
recording thumbnail, the four immutable current session references, shared public
navigation, all four case-study routes,390 px touch menu/library/heading focus and configured
width fit, plus nested Pages 404 recovery. Completed responses bind to the staged deployed
bytes; aborted navigation requests are separately labelled, never treated as successful
byte bindings. Screenshots and JSON are committed; the passing and first-recorder-failure browser traces remain under
`target/ui-release-626/published/`, authenticated by `target-SHA256SUMS`.

**Recorder qualification.** The first published run passed all13 product-flow checks but
failed strict byte capture for repeated cached font responses: the initial200 bodies
authenticated, while subsequent Chromium memory-cache responses had no CDP body. That
failed receipt/script/log and trace digests are retained separately. Only the recording
harness was repaired: HTTP cache is explicitly disabled before each watched page, with
no response fixtures or service-worker override, so every completed response body can be
captured. The identical-flow rerun passes the unchanged strict binding/error criteria.
No interface, deployment or runtime code changed for this evidence repair.

**Limits and closure.** Desktop Chromium and360/390 px touch emulation only: no physical phone,
GPU/RSS, measured bounce-rate or third-party Playground availability claim. Subsequent
claim/verifier commits change evidence and logs only; the shipped task snapshot remains
frozen at the published head rather than chasing its own hash. This is a coordinator claim,
not a new verifier verdict. Fresh evidence-only audit remains required before final native
draft submission. SHA256SUMS digest:
`0f916f08892997d2988d242013620213b05e08c6a6bb3ea2b2669f6c3e9ec87d`.

### 2026-10-30 — fresh verifier — final release evidence — VERDICT: verified

Audited claim `27e1f3acb369a4f9dd1ce5373b2727fb1530fbaa`, published source
`d6a3d9999f05e3e5ad7662b22f14ed95999ba2b4`, immutable preview
**https://9f071e86.wasm-vm.pages.dev**. Predictions were recorded before the published evidence:
successful isolated deployment, URL-only manifest staging, actual user/guest interactions,
strict completed-response bindings, cache-only recorder repair and evidence-only claim delta.
All hold. This closes the previously pending portability/publication proof; E0-T32 stays
`verified`. No implementation, build snapshot, status or queue was changed by this log entry.

- **Pristine/rebased identity — HELD.** Carried the completed static audit, with archived
  receipts now independently matching it exactly. The real nonshallow Git clone at
  `2d7b3414d0b16a744a246236f275870e51ba88a4` has all **31,970** tracked paths/index entries;
  recorded fresh-index full diff authenticates the APFS-materialized historical evidence.
  No ignored target/node_modules/pkg was copied; the script guards this before building.
  The log records fresh Rust/Wasm/session compilation and npm installation, then **73/73**
  checks (15+29+19+10; `pristine/cold-clone.log:1754/:6304/:7443/:7735`). Independently hashed
  all **780** rebuilt files against both the actual clone and frozen Git blobs. Final source
  retains all 780 paths, **778** byte-identical; only task catalog and corresponding SW differ.
  Frozen final SW **98ca70d276cd** reconstructs exactly; all 760 source/catalog contracts and
  statuses agree at that release. The only other implementation delta is the already verified
  braced shell log. All earlier A/B/C/D results, coverage waivers and consumed attacks carry.
- **External-input limits — HELD.** Independently authenticated all **22** staged release
  files against the actual clone and inventory; **10** are explicitly auxiliary/legacy files,
  so this is not described as an allowlist-only copy. Makefile/manifest recipes and successful
  browser GETs identify the three declared boot inputs; no OS-level complete read trace is
  claimed. The separate disk-full attempt failed during checkout before build/tests and is
  retained as an environment failure, never counted as a pass.
- **Actual publication/manifests — HELD.** `deploy-command.json` records exact source,
  `PAGES_BRANCH=ui-redesign-20261030`, exit 0 and the immutable preview returned by Wrangler.
  `deploy.log:52–54` contains the successful preview receipt; log SHA-256 is
  `36dd33cb484758b0a82c2898e5dd449d9373c985c3a16cc9179cfa9e21b9d144`.
  The guarded tool authenticated content-addressed R2 objects, including reupload/verification
  after a slow download, then published Pages. All five archived staged manifests preserve
  every role, size, digest and non-URL field; changed URLs have the exact R2 SHA/path binding.
  Production was not the command's target. After staging restoration, product→claim changes
  only declared evidence and this task log, with no product drift.
- **Recorded published behavior — HELD.** The passing smoke has **14** checks. Actual trace
  `published-smoke.zip` shows the homepage **Start Linux** click `call@545`, trusted keyboard
  `call@887` typing the `printf` command with `$((40+2))`, and a separate rendered terminal row
  **preview-42** in snapshot **before@call@895**, followed by the shell prompt. This is actual
  guest output, not a transcript fixture or programmatic serial helper. Ranked search lands
  at focused `continue-from-the-past` (`call@200`); actual Mermaid SVG/source pass at
  `call@242/:244`, the relative recording image/full view loads, and immutable current-reference
  provenance/Markdown passes at `call@284/:296/:298`. The phone trace records menu/library
  taps `call@409/:413/:441/:453`, overlay dismissal/heading focus and configured 390 px fit;
  all four case routes load with their shared nav. Nested Pages 404 recovery returns to home.
  Published screenshots agree with the carried interface and grades.
- **Byte bindings/recorder qualification — HELD.** All **25 fixed** hashes and **187 distinct
  requested-file** hashes match frozen final/staged bytes. Independently recomputed all 25
  fixed API response bodies and **29 distinct requested non-script bodies** from trace
  resources. Playwright 1.49.1 deliberately omits script bodies from trace HAR
  (`tracing.js:130`, `harTracer.js:273`); the remaining **158 script hashes** are strict live
  `response.body()` SHA results, matching frozen Git, with corresponding successful body-read
  events. The desktop/phone traces show **240/50** successful Buffer reads, no body-read or
  unresolved action errors, no aborts and no unexpected HTTP/page/console errors. The one console
  404 is the intentional nested missing route. This does **not** claim raw script-body archival.
  The first font/CDP failure remains preserved, correctly failed despite its completed flows;
  the only recorder diff disables HTTP cache before each watched page, without response
  fixtures/service-worker override. No product change or repeated attack was needed.
- **Evidence authentication — HELD.** All **46** committed evidence files and **4** passing/
  preserved-failure traces match their manifests. Worker manifest SHA-256:
  `0f916f08892997d2988d242013620213b05e08c6a6bb3ea2b2669f6c3e9ec87d`; target manifest:
  `aaf3af98a393646333422a4996941e30ca1320ef680563f14cc00e6314247b14`.
  Independent full audit receipts are committed under `evidence/ui-redesign/release-626-verifier/`
  (manifest `332e6026bcc888302bc3d34c85dacfc92e2c7a23860669a0808c03388423db7c`);
  offline inspection scripts/logs remain under `target/ui-verifier/release-626/`.

**Final seven grades carry:** typography **8.7**, restraint/product character **8.6**, mobile
**8.3**, homepage clarity/engagement **8.8**, starting/configuration ease **8.6**, concise honest
copy **8.5**, actual UI-library consistency **8.6**. Every dimension independently exceeds 8.
No regrading was needed for log/manifest metadata. Limits remain desktop Chromium and 360/390 px
touch emulation, with no physical-device, GPU/RSS, measured bounce-rate or third-party Playground
availability claim. **SUITE:** existing promoted regressions/acceptance remain the permanent
proof; no new test, attack, clone, browser run, deploy, push, merge or stack operation was performed
by this verifier. The shipped snapshot remains at the frozen published source; this is an
evidence/log-only commit. Native draft PR submission remains the coordinator's next step.
