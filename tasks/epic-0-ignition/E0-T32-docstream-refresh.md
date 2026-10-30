---
id: E0-T32
epic: 0
title: Docs reader on Docstream 1.33 and a current field guide
priority: 0.35
status: pending
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
