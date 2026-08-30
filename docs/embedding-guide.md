# Embedding wasm-vm explainers and replays

The wasm-vm loader remains the runtime boundary: it boots the guest and returns the
controller that drives serial input/output. The presentation layer can be composed
from the docs package set:

## Published agent-wasm packages are a separate host-side layer

The published `@agent-wasm/*` packages come from the separate
[BLamy/agent-wasm](https://github.com/BLamy/agent-wasm) repository. They provide a
browser-native Node/agent workspace layer; they are not the RISC-V guest and they are
not the unpublished `wasm-vm-wasm` host module. The registry snapshot below was checked
on 2026-08-30:

| Package | Published version | Use |
| --- | --- | --- |
| `@agent-wasm/core` | `0.4.0` | Browser Node runtime, virtual filesystem, workers, package manager, and host bridges |
| `@agent-wasm/sdk` | `0.1.0` | Workspace, snapshots, agent sessions, adapters, and plugins over `core` |
| `@agent-wasm/react` | `0.1.0` | React workbench, chat, and UI components |

The namespace also publishes `@agent-wasm/chat-core@0.1.0`, `@agent-wasm/code@0.1.0`,
`@agent-wasm/vscode@0.1.0`, `@agent-wasm/keychain@0.1.0`,
`@agent-wasm/codex@0.1.0`, and
`@agent-wasm/tailscale-connect@1.39.98-t02582083d`. Use the
[agent package sidecar](../web/agent-packages.html) for their package pages, subpath
exports, exact registry artifact URL, and the current provenance/media note.

For a minimal host-side agent, the published README-backed shape is:

```tsx
import { createContainer } from "@agent-wasm/core"

const container = createContainer()
container.vfs.writeFileSync("/index.js", "console.log('hello from the browser')")
await container.run("node index.js")
```

Install through npm and pin the version in the consuming lockfile:

```sh
npm install @agent-wasm/core@0.4.0
```

No direct browser CDN URL is asserted here. The package's npm page and registry tarball
are the release/provenance URLs; a consuming app should resolve the package through its
package manager and bundler.

## The guest file agent and the host runtime are different artifacts

The guest-side `wasm-vm-file-agent` is a Cargo package in `crates/file-agent`, currently
reported as version `0.0.0` by Cargo metadata. `tools/build-file-agent.sh` compiles its
static `riscv64gc-unknown-linux-musl` binary, and the rootfs build installs it as
`/usr/libexec/wasm-vm/wvft-agent`, with `/usr/bin/vm-download` as the guest helper. It
speaks WVFT v1 on `10.0.2.2:10021` and uses the fixed guest transfer inbox/outbox. It is
not an npm dependency.

The host-side `wasm-vm-wasm` module is the `0.0.1` wasm-bindgen package defined by
`crates/wasm` and generated into `web/pkg`/`web/dist/pkg`. The demo imports its real
`WasmMachine` and `WasmLinux` exports from a vendored relative URL such as
`./pkg/wasm_vm_wasm.js`; a registry lookup does not find an npm release. A future
`@wasm-vm/sdk` is named by the E6-T19/E6-T27 roadmap tasks, but it is not published and
must be treated as a proposal rather than an installable package.

| Need | Package/API |
| --- | --- |
| Authored, seekable SVG/timeline scenes | `@brett_lamy/viz-engine` → `VizPlayer` |
| Direct `.mp4`, `.webm`, `.ogg`, or hosted video | `@brett_lamy/viz-engine` → `VideoEmbed` |
| Markdown rendering and editing | `@brett_lamy/docstream` + `@brett_lamy/docstream-editor` |
| Public Loop QA task, exploration, journey, or test-run preview | `@brett_lamy/docstream` → `ReplayPreview` |

## Install

These presentation packages are published; pin the versions in a React documentation app:

```sh
npm install @brett_lamy/viz-engine@0.2.1 @brett_lamy/docstream@0.3.7 @brett_lamy/docstream-editor@0.3.4
```

The viz engine is the only standalone player package. Replay preview is part of
Docstream, and the editor consumes Docstream's renderer rather than importing a
separate replay or video-player package.

## Author a `VizPlayer` scene

Use `VizPlayer` when the animation is authored as a declarative timeline—for
example, to explain the VM boot path, page tables, OCI layers, or a network
packet flow.

```tsx
import { Timeline, VizPlayer } from "@brett_lamy/viz-engine"
import "@brett_lamy/viz-engine/styles.css"

const timeline = new Timeline()
const opacity = timeline.channel("opacity", 0)
timeline.tween(opacity, 1, { at: 0, dur: 0.5 })

export function BootExplainer() {
  return (
    <VizPlayer
      scene={{
        timeline,
        render: (state) => (
          <circle
            cx="640"
            cy="360"
            r="80"
            opacity={state.get(opacity)}
          />
        ),
      }}
      loop
    />
  )
}
```

`VizPlayer` owns transport, seeking, looping, keyboard controls, and optional
narration synchronization. It is independent of the VM's guest clock.

## Put videos and Replay QA previews in markdown

Docstream keeps the document portable. Store an ordinary GitBook-style embed
block, and the renderer/editor select the appropriate component at runtime:

```tsx
import { GitbookStreamdown } from "@brett_lamy/docstream"
import { GitbookEditor } from "@brett_lamy/docstream-editor"
import "@brett_lamy/docstream/styles.css"
import "@brett_lamy/docstream-editor/styles.css"

const markdown = `# Boot trace

{% embed url="https://loop-qa.replay.io/projects/project-id/journeys/journey-id" /%}

{% embed url="https://cdn.example.com/wasm-vm-boot.mp4" /%}`

export function ReadOnlyDoc() {
  return <GitbookStreamdown markdown={markdown} />
}

export function EditableDoc({ onChange }: { onChange: (value: string) => void }) {
  return <GitbookEditor markdown={markdown} onChange={onChange} />
}
```

Direct `.mp4`, `.webm`, and `.ogg` URLs use `VideoEmbed` from the viz engine;
YouTube and other hosted players use an iframe. Public Loop QA project URLs are
converted to the chrome-free `/p/...` route automatically.

For a custom layout, use the video boundary directly:

```tsx
import { VideoEmbed } from "@brett_lamy/viz-engine"

export function BootRecording() {
  return <VideoEmbed src="./recordings/wasm-vm-boot.mp4" title="wasm-vm boot" />
}
```

## Render a replay directly

For a custom layout, use Docstream's built-in `ReplayPreview`:

```tsx
import { ReplayPreview } from "@brett_lamy/docstream"

export function RunPreview() {
  return (
    <ReplayPreview
      source="https://loop-qa.replay.io/projects/project-id/tasks/task-id"
      title="wasm-vm browser run"
    />
  )
}
```

The component also accepts an in-memory rrweb event array or a CORS-enabled
event endpoint. Public URL previews require a public, iframe-embeddable Loop QA
resource; private recordings and localhost assets are not made reachable by the
preview.

## Hosted VizEngine explainers

The [Linux in a Tab](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-internals)
and [The wasm-vm Proof Loop](https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-loop)
bundles are hosted VizEngine explainers from
[BLamy/orly at commit `7a00a5d`](https://github.com/BLamy/orly/tree/7a00a5dce8a2d8b5d55a36ab6324ff03e6b5cbf8/public/generated).
In a Docstream document, either can be embedded with the existing portable syntax:

```md
{% embed url="https://orly.brett-lamy.workers.dev/?bundle=wasm-vm-internals" /%}
```

The browser-side [package sidecar](../web/agent-packages.html#explainers) embeds both
with readable fallback text and direct links. Orly's repository is MIT-licensed, but its
inspected metadata does not declare a per-file license/attribution for generated MP3
narration, so this repository copies no audio and does not claim a standalone audio asset.

## Suggested wasm-vm flow

1. Boot wasm-vm with `startLinuxBoot()` and connect `onOutput` to the terminal or
   your own output subscriber.
2. Use `VizPlayer` for authored explanations of the boot/container pipeline and
   `VideoEmbed` for recorded demos.
3. Put the corresponding public Loop QA task, exploration, journey, or test-run
   URL in an `embed` block so the same document works in both the read-only
   renderer and the markdown editor.

The live version of this guide is also included in the browser docs page at
[`web/docs.html`](../web/docs.html).
The focused package map and hosted explainer cards live at
[`web/agent-packages.html`](../web/agent-packages.html).
