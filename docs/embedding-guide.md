# Embedding wasm-vm

This is the source-side integration note for the browser machine. The web presentation is split
into focused pages at [web/docs.html](../web/docs.html):

- [Embed](../web/docs-embedding.html) — the loader/controller boundary and the published
  host-side @agent-wasm/* libraries.
- [Guest](../web/docs-guest.html) — manifests, boot modes, chunked storage, and persistence.
- [Containers](../web/docs-containers.html) — the OCI pipeline and the bounded wvrun scope.
- [Verification](../web/docs-verification.html) — evidence, gates, and current status.
- [Explainers](../web/docs-explainers.html) — VizEngine, Docstream, and hosted Orly bundles.

## The boundaries

There are three different artifacts that are easy to conflate:

1. wasm-vm-wasm is the wasm-bindgen crate in crates/wasm. make web-build generates its
   JavaScript glue and .wasm into web/pkg; the browser imports it through a relative URL.
2. wasm-vm-file-agent is a guest-side Cargo binary built for riscv64gc-unknown-linux-musl
   and installed into selected guest root filesystems. It is not an npm dependency.
3. @agent-wasm/* is a published, host-side package family from the separate
   [BLamy/agent-wasm](https://github.com/BLamy/agent-wasm) repository. There is no verified
   @wasm-vm/sdk npm release in this checkout.

## Start a Linux guest

The browser-facing entry point is startLinuxBoot in web/loader.js. It fetches the manifest,
streams artifacts with progress callbacks, checks their SHA-256 values, constructs WasmLinux,
and returns a controller.

```
import { startLinuxBoot } from "./loader.js";

const controller = await startLinuxBoot({
  manifestUrl: "./artifacts.json",
  ramMib: 256,
  onState: (state) => console.log("boot:", state),
  onProgress: (role, loaded, total) => showProgress(role, loaded, total),
  onOutput: (bytes) => terminal.write(bytes),
  onError: (error) => reportBootError(error),
});

controller.sendInput(new Uint8Array([13]));
await controller.whenDone;
```

The controller exposes sendInput(bytes), stop(), and whenDone. The callback receives
output chunks, not a promise for one character at a time. See [web/loader.js](../web/loader.js)
for the complete option set.

The loader has three base storage modes, with persistence as a chunked-only combination:

| Mode | Behavior |
| --- | --- |
| initramfs | Default. Passes the manifest's initramfs to new WasmLinux. |
| disk | Downloads the whole rootfs and passes it to WasmLinux.newDisk. |
| chunked | Fetches a chunk manifest and retrieves disk chunks only when reads need them. |
| chunked + persist: true | Adds an image-namespaced IndexedDB copy-on-write overlay. |

The public web/artifacts.json is the small kernel/initramfs/boot-snapshot path. The large
Alpine disk and chunked manifests are local-only artifacts in this checkout; use
bash tools/serve-dev.sh for those development paths.

## Use the bare-metal wrapper

For a bare-metal RV64 ELF, import the generated wrapper instead of the Linux loader:

```
import init, { WasmMachine } from "./pkg/wasm_vm_wasm.js";

await init();
const machine = new WasmMachine(64);
machine.setConsole((byte) => consumeByte(byte));
machine.loadElf(elfBytes);
const result = machine.run(100_000);
console.log(result.kind, machine.stateDigest());
```

WasmMachine also exposes step, registers, canonical tracing, stats, and JIT counters in
the generated declaration file. The generated module is a build artifact, not a registry release.

## Published host-side agent packages

The following registry snapshot was checked on 2026-08-30. Use the linked npm record for the
current version and the package README for the current API; these are not guest or emulator
packages.

| Package | Version | README-backed role |
| --- | --- | --- |
| @agent-wasm/core | 0.4.0 | Browser Node runtime: createContainer, virtual filesystem, runtime/sandbox workers, package manager, and Vite/Next dev-server bridges. |
| @agent-wasm/sdk | 0.1.0 | Workspace lifecycle and agent harness APIs: createWorkspace, snapshots, AgentAdapter, AgentSession, templates, and plugins. |
| @agent-wasm/react | 0.1.0 | React workbench, chat, and UI components. |
| @agent-wasm/chat-core | 0.1.0 | Dependency-free chat domain, tool-call, and session APIs. |
| @agent-wasm/code | 0.1.0 | Claude Code incremental JSONL transcript integration. |
| @agent-wasm/vscode | 0.1.0 | VS Code-shaped shell and React integration. |
| @agent-wasm/keychain | 0.1.0 | WebAuthn-PRF-backed AES-GCM vault and credential mirror. |
| @agent-wasm/codex | 0.1.0 | Browser Codex agent compiled to WebAssembly with worker bridges. |
| @agent-wasm/tailscale-connect | 1.39.98-t02582083d | Published Tailscale Connect browser package; its current README is sparse. |

For example, the package README's minimal core shape is:

```
import { createContainer } from "@agent-wasm/core";

const container = createContainer();
container.vfs.writeFileSync("/index.js", "console.log('hello from the browser')");
await container.run("node index.js");
```

Install through the package manager used by the host app:

```
npm install @agent-wasm/core@0.4.0
```

The published host libraries and the wasm-vm Linux guest can be composed in one application, but
they are different runtimes and have separate release/proof boundaries.

## Presentation packages

The explainers use separate published packages:

```
npm install @brett_lamy/viz-engine@0.2.1 \
  @brett_lamy/docstream@0.3.7 \
  @brett_lamy/docstream-editor@0.3.6
```

Use the verified VizEngine primitives for authored SVG timelines and media boundaries:

```
import { Camera, Player, Timeline, VideoEmbed, VizPlayer } from "@brett_lamy/viz-engine";
import "@brett_lamy/viz-engine/styles.css";

export function Explainer({ scene }) {
  return <VizPlayer scene={scene} loop />;
}
```

Use Docstream for GitBook-style markdown rendering and its documented visualization embed
boundary, and Docstream Editor for TipTap editing:

```
import { GitbookStreamdown } from "@brett_lamy/docstream";
import { VizEmbed } from "@brett_lamy/docstream/viz";
import { GitbookEditor } from "@brett_lamy/docstream-editor";
```

The hosted examples and the provenance note live on the [Explainers page](../web/docs-explainers.html).

## Build and verify

```
make web-build
make web-dist
```

Serve the generated directory over HTTP. Do not use file://: WebAssembly modules and ES modules
need the HTTP serving path used by the repository. Browser-facing changes also require a built-page
check and a Cloudflare Pages deploy; the exact evidence policy is in [AGENTS.md](../AGENTS.md).

For the deployment artifact, use:

```
bash tools/deploy-cloudflare.sh
```
