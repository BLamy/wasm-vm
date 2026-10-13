# Portable docs and explainers

This reader uses `@brett_lamy/docstream` **1.8.0**, the official npm `latest` release checked on 2026-10-13. It renders the guides and technical reference pages as GitBook-flavored Markdown, with their sources available to inspect and copy.

## Features used here

| Docstream feature | What it does in this reader |
| --- | --- |
| `DocsRenderer` and `parseMarkdown` | Render the real Markdown document AST |
| `documentOutline` | Generate the page's table of contents |
| `DocPageActions` | Copy a portable page or view its Markdown |
| Hints, tabs, steppers, expandables | Keep caveats near decisions and organize procedures |
| Titled code fences | Syntax highlighting, line numbers, and code copy |
| File-backed `{% demo %}` | Show the architecture example and its actual source file |
| Lazy heavy renderers | Load diagram, math, and replay renderers only when needed |

The architecture demo is a normal bundled React component with source files exposed by a read-only resolver. This documentation page does not boot almost-node or execute arbitrary code from the reader's input.

## Minimal renderer

```jsx title="ReadOnlyDocument.jsx"
import { MarkdownContent } from "@brett_lamy/docstream";
import "@brett_lamy/docstream/styles.css";

export function ReadOnlyDocument({ markdown }) {
  return <MarkdownContent markdown={markdown} />;
}
```

## Hosted explainers

These existing Orly presentations are separate from emulator execution and verification evidence. Open them deliberately; the reader provides direct links if an embed is blocked.

- [Linux in a Tab](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-internals)
- [The wasm-vm Proof Loop](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-loop)

The original provenance note states that Orly is MIT-licensed but inspected generated MP3 metadata did not declare per-file attribution. This site links the hosted presentations and does not redistribute their MP3 assets.

## Official release sources

- [Docstream 1.8.0 on npm](https://www.npmjs.com/package/@brett_lamy/docstream/v/1.8.0)
- [Official registry metadata](https://registry.npmjs.org/@brett_lamy/docstream)
- [Package repository](https://github.com/BLamy/docstream)

The published npm README and declaration files define the release contracts used by this reader. The renderer, editor, visualization package, and guest runtime have separate ownership and dependency boundaries.
