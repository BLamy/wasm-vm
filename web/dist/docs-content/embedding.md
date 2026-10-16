---
kind: "Field guide"
source: "web/docs-source/guides/embedding.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Embed the machine

Use the generated browser assets from a coherent web build. The Linux loader returns a controller; the bare-metal wrapper runs an ELF directly. These are two entry points to wasm-vm, with different callbacks and lifecycle boundaries.

## Linux controller

`startLinuxBoot` in `web/loader.js` fetches the manifest, reports download progress, checks artifact digests, constructs `WasmLinux`, and returns a controller. Output arrives in byte chunks.

```js title="Start a Linux guest"
import { startLinuxBoot } from "./loader.js";

const decoder = new TextDecoder();
const terminal = document.querySelector("#terminal");
const controller = await startLinuxBoot({
  manifestUrl: "./artifacts.json",
  ramMib: 256,
  onState: (state) => console.log("boot:", state),
  onOutput: (bytes) => {
    terminal.textContent += decoder.decode(bytes, { stream: true });
  },
  onError: (error) => console.error("wasm-vm:", error),
});

controller.sendInput(new Uint8Array([13]));
const finalState = await controller.whenDone;
```

The controller exposes `sendInput(bytes)`, `stop()`, and `whenDone`. The callback receives output chunks; do not assume a callback per character. Use the actual loader source for the complete options and cancellation/error boundary.

## Bare-metal ELF

```js title="Run an ELF"
import init, { WasmMachine } from "./pkg/wasm_vm_wasm.js";

await init();
const machine = new WasmMachine(64);
machine.setConsole((byte) => consumeByte(byte));
machine.loadElf(elfBytes);
const result = machine.run(100_000);
console.log(result.kind, machine.stateDigest());
```

`WasmMachine` also exposes stepping, registers, tracing, stats, and JIT counters. Read the generated declaration file for the exact build you consume. `run` can exit, trap, or stop at its instruction budget.

## Keep the package boundary clear

| Artifact | Runs where | Delivered by |
| --- | --- | --- |
| `WasmMachine` / `WasmLinux` | Browser WebAssembly | `make web-build`, relative `web/pkg` assets |
| `wasm-vm-file-agent` | RISC-V Linux guest | Cargo guest binary in selected root filesystems |
| `@agent-wasm/*` | Host-side browser tooling | Separate [agent-wasm repository](https://github.com/BLamy/agent-wasm) and npm releases |
| `@brett_lamy/docstream` | Host React documentation UI | The Docstream npm release |

{% hint style="warning" %}
An `@agent-wasm/core` install creates a separate browser Node runtime. It does not install this RISC-V machine. There is no verified `@wasm-vm/sdk` release in this checkout.
{% endhint %}

## Integrate deliberately

Start with the [loader source](https://github.com/BLamy/wasm-vm/blob/main/web/loader.js), [wasm-bindgen boundary](https://github.com/BLamy/wasm-vm/blob/main/crates/wasm/src/lib.rs), [storage guide](./docs.html?page=storage), and [network provider contract](./docs.html?page=networking). Do not combine glue, wasm, and manifests from unrelated builds.

The [full source integration reference](./docs.html?page=reference-docs-embedding-guide) retains the dated package snapshot and the presentation-package ownership notes.
