---
kind: "Field guide"
source: "web/docs-source/guides/overview.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# A field guide to wasm-vm

wasm-vm executes a RISC-V computer in Rust and WebAssembly. An unmodified Linux kernel runs above its CPU, memory, interrupt controllers, and virtual devices. Start with the browser demo, then follow the boundary you need to understand.

## Pick a starting point

| You want to… | Start here |
| --- | --- |
| Boot a guest and use its console | [Get started](./docs.html?page=quickstart) |
| Put the machine inside your application | [Embed the machine](./docs.html?page=embedding) |
| Understand CPU, memory, and devices | [Architecture](./docs.html?page=architecture) |
| Keep changes across reloads | [Storage and persistence](./docs.html?page=storage) |
| Rewind execution or branch a recording | [Record, rewind, and branch](./docs.html?page=time-travel) |
| Connect the guest to a network | [Networking](./docs.html?page=networking) |
| Use the display and input paths | [Desktop and input](./docs.html?page=desktop) |
| Understand admitted guest graphics work | [Graphics boundary](./docs.html?page=graphics) |
| Reproduce a result or contribute a change | [Verification](./docs.html?page=verification) |
| Interpret the published measurements | [Performance](./docs.html?page=performance) |

## Current scope

The public demo loads generated WebAssembly assets and named guest artifacts. The Level 1 report records 395 Sail architectural tests with zero exclusions. Storage, networking, display, JIT, and container work have their own acceptance criteria and evidence; a passing architectural baseline does not make every product surface complete.

{% hint style="info" %}
The `@agent-wasm/*` packages belong to a separate host-side project. This repository builds `WasmMachine` and `WasmLinux` as relative browser assets. There is no verified `@wasm-vm/sdk` npm release in this checkout.
{% endhint %}

## Read beyond the guides

The reference library contains the detailed technical documentation from this repository, including device contracts, renderer boundaries, build runbooks, and dated measurements. Every page exposes its original source and Markdown. Search matches titles, paths, and page content; the Reference section also supports a subject filter.

[Documentation coverage](./docs.html?page=coverage) accounts for every prose file at its pinned migration revision. Current field guides identify newer evidence separately. Task logs, evidence, operating policy, protocols, legal text, and upstream specifications keep their authoritative source intact.

## Product direction

Passkey-encrypted volumes, peer distribution, and the ProofMesh work market are [proposed product work](./docs.html?page=proofmesh). Their specifications are readable here with that scope stated explicitly.
