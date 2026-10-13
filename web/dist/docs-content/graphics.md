# Guest graphics: the admitted boundary

The workbench can present guest-rendered pixels and route keyboard and pointer input. Guest GPU offload is a separate, partial implementation. The default public demo keeps production acceleration disabled; an attractive browser-rendered scene does not establish guest acceleration.

## Display is not GPU offload

The 2D display path uploads pixels rendered by the guest CPU. The VirGL path interprets guest commands, owns resources and state, translates admitted shaders, and issues browser graphics work. Each of those boundaries has its own acceptance criteria.

The homepage cutaway is a Three.js illustration running directly in the host browser. It never passes through the guest's VirGL device. Use it to understand execution layers, not to measure the guest renderer.

## What the recorded work establishes

The implementation has independently verified slices for command framing, guest DMA, retained scanout, selected resource formats, typed dimensional shader compilation, and selected native sampler views. These are bounded fixture and contract results. The source roadmap marks guest GPU offload **partial**, with production acceleration disabled.

The unchanged nineteen-body shader corpus has its own [closure task and evidence](https://github.com/BLamy/wasm-vm/blob/2691b24e6c00478f8d69f81180b6827761de246a/tasks/epic-6-transcendence/E6-T12f6-original-shader-closure.md). Its successful translation, compile/link, and bounded execution do not admit arbitrary shaders or establish complete compositor rendering. Loop, numeric, resource, state, and draw-time contracts still matter.

{% hint style="warning" %}
The historical graphics decision opens with an earlier v5 profile: twelve of nineteen shaders, CONST indices through 45, PRECISE rejection, and an old Chrome qualification. Later tasks extend that work. Those older paragraphs remain readable as provenance; they are not the current API limit table.
{% endhint %}

## Choose the exact reference

Read the relevant resource, state, shader, or draw contract together with its named task and evidence. A source hash identifies the implementation under test. A successful compile does not prove a draw; a correct isolated draw does not prove a complete guest workload or a frame-rate budget.

{% content-ref url="./docs.html?page=reference-renderer-virgl-command-readme" %}
Command renderer and selected acceptance targets
{% endcontent-ref %}

{% content-ref url="./docs.html?page=reference-renderer-virgl-shader-readme" %}
Shader frontend, contracts, and admission
{% endcontent-ref %}

{% content-ref url="./docs.html?page=reference-docs-gpu-3d-decision" %}
Historical graphics decision and proof notes
{% endcontent-ref %}

## Reproduce a claim

Use the [verification guide](./docs.html?page=verification) to select the named acceptance command and frozen evidence. The [pinned source roadmap](https://github.com/BLamy/wasm-vm/blob/2691b24e6c00478f8d69f81180b6827761de246a/web/roadmap.js) describes the publication baseline; current task and verifier records determine later status. This reader neither enables acceleration nor refreshes historical measurements.

There is no general GPU-compatibility, complete desktop-offload, or 300-MIPS claim here. The [performance guide](./docs.html?page=performance) keeps native diagnostics, browser measurements, and unmeasured results separate.
