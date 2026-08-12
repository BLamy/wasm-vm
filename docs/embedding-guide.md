# Embedding wasm-vm explainers and replays

The wasm-vm loader remains the runtime boundary: it boots the guest and returns the
controller that drives serial input/output. The presentation layer can be composed
from the docs package set:

| Need | Package/API |
| --- | --- |
| Authored, seekable SVG/timeline scenes | `@brett_lamy/viz-engine` → `VizPlayer` |
| Direct `.mp4`, `.webm`, `.ogg`, or hosted video | `@brett_lamy/viz-engine` → `VideoEmbed` |
| Markdown rendering and editing | `@brett_lamy/docstream` + `@brett_lamy/docstream-editor` |
| Public Loop QA task, exploration, journey, or test-run preview | `@brett_lamy/docstream` → `ReplayPreview` |

## Install

After the package releases are available, install them in a React documentation app:

```sh
npm install @brett_lamy/viz-engine @brett_lamy/docstream @brett_lamy/docstream-editor
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
