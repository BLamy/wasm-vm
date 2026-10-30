---
id: E0-T32
epic: 0
title: Docs reader on Docstream 1.33 and a current field guide
priority: 0.35
status: implemented
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

