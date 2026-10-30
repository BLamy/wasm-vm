---
kind: "Field guide"
source: "web/docs-source/guides/explainers.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Portable docs and explainers

This reader uses `@brett_lamy/docstream` **1.33.0**, the official npm release checked on 2026-10-30 (source `github.com/BLamy/docstream` at `9ba2d11`). It renders the guides and technical reference pages as GitBook-flavored Markdown, with their sources available to inspect and copy.

## Features used here

| Docstream feature | What it does in this reader |
| --- | --- |
| `DocsRenderer` and `parseMarkdown` | Render the real Markdown document AST |
| `documentOutline` | Generate the page's table of contents; repeated headings get numbered anchors |
| `buildDocsTree` and `createDocsSearchIndex` (`/site`, new since 1.9) | Ranked title, section and text search with an excerpt that opens the matching section; loaded on first search |
| Mermaid through Pele (new since 1.9) | Draw diagrams such as the [recording flow](./docs.html?page=time-travel) from their source, beside that source |
| `AssetResolverProvider` (new since 1.9) | Resolve each page's own `./images/…` next to its Markdown file |
| Image thumbnails (new since 1.9) | Show a real capture small, with the full image on hover or focus |
| `DocPageActions` | Copy a portable page or view its Markdown |
| Native document properties | Expand **Properties** to inspect a guide's scope or a reference's exact source revision and SHA-256 |
| Eight native task states | Distinguish the repository's [verification states](./docs.html?page=verification#task-states) with named icons |
| Hints, tabs, steppers, expandables | Keep caveats near decisions and organize procedures |
| Titled code fences | Syntax highlighting, line numbers, and code copy |
| File-backed `{% demo %}` | Show the architecture example and its actual source file |
| Lazy heavy renderers | Load diagram and math renderers only when a page uses them |

Docstream's `ReplayPreview` replays recorded web pages (rrweb). It is unrelated to wasm-vm's machine recordings (`.wvsession`), which the [time-travel guide](./docs.html?page=time-travel) covers, and this reader does not use it.

The architecture demo is a normal bundled React component with source files exposed by a read-only resolver. This documentation page does not boot almost-node or execute arbitrary code from the reader's input.

Properties and task states are read-only here. The reader supplies no property-edit or task-state callback, and cannot change a repository task or its verification status. Frontmatter belongs to the portable document metadata; it is not rendered as a code block or counted as body headings. Copy, View Markdown and Download Markdown retain it.

## Minimal renderer

```jsx title="ReadOnlyDocument.jsx"
import { MarkdownContent } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";

export function ReadOnlyDocument({ markdown }) {
  return <MarkdownContent markdown={markdown} documentProperties={{ defaultOpen: false }} />;
}
```

## Hosted explainers

These existing Orly presentations are separate from emulator execution and verification evidence. Open them deliberately; the reader provides direct links if an embed is blocked.

- [Linux in a Tab](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-internals)
- [The wasm-vm Proof Loop](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-loop)

The original provenance note states that Orly is MIT-licensed but inspected generated MP3 metadata did not declare per-file attribution. This site links the hosted presentations and does not redistribute their MP3 assets.

## Official release sources

- [Docstream 1.9.1 on npm](https://www.npmjs.com/package/@brett_lamy/docstream/v/1.9.1)
- [Official registry metadata](https://registry.npmjs.org/@brett_lamy/docstream)
- [Package repository](https://github.com/BLamy/docstream)

The published npm README and declaration files define the release contracts used by this reader. The renderer, editor, visualization package, and guest runtime have separate ownership and dependency boundaries.
