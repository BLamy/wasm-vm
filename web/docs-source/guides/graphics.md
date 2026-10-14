# Guest graphics

The accelerated Omarchy path sends the guest's VirGL commands to WebGL2 in the production Linux worker. Mesa chooses OpenGL ES 3.0; Hyprland retries that API after its GLES 3.2 request. Frames reach the visible canvas through retained, fenced scanout and a page presentation receipt.

This integration is undergoing final independent verification. The command, shader, dimensional depth and transform-feedback prerequisites have already been independently verified. See the current roadmap and task records for the final production verdict.

## Launch the desktop

Choose **Omarchy** in the [launcher](./app#ide), with **GPU rendering** selected. The worker checks actual WebGL2 limits, texture roles, native renderability and nonzero sampled results before advertising VirGL. An unsupported host produces a visible error; it does not justify positive guest capabilities.

The accelerated image uses a pinned Mesa 26.2.2 build with VirGL and the GLES API exposed through EGL. Its small, recorded source patch makes both border-clamp extension names independently configurable, and rejects desktop OpenGL contexts while retaining GBM's internal buffer-mapping context. Unsupported border-clamp and sRGB-decode extensions are disabled in both legacy and indexed queries. The software DRI entrypoints are removed.

GPU rendering starts from a cold boot. The existing **Software rendering** option restores the paired Omarchy RAM snapshot and disk delta. BusyBox, Alpine and Alpine + Node retain their existing fast-boot paths.

{% hint style="info" %}
Both desktop paths use the instruction-based clock. Tickless idle pauses its timer jump while a qualified GPU request awaits the browser, so guest time cannot skip past a pending host fence or presentation receipt. Normal idle advancement resumes when the request settles.
{% endhint %}

## What is offloaded

Guest shader translation uses the pinned VirGL TGSI frontend. Admitted commands create retained GPU storage, configure native rendering state and issue actual browser GPU draws. The renderer supports the proven dimensional color/depth views and layer surfaces, uniform buffers, multiple render targets, instancing, stencil operations and original transform-feedback targets.

The production profile has bounded resources and work: 32 MiB per resource or transfer, 128 MiB aggregate GPU storage, one pending queue job, 256 draws and 262,144 index/instance work units per submission. Older isolated proof profiles keep their original limits. Unsupported commands return explicit errors.

Capabilities are typed Rust fields serialized to the pinned 1,408-byte VirGL capset ABI. Reported formats and limits come from host qualification. A feature bit is not inferred from a successful allocation or from the browser's extension string alone.

The page shows completed jobs, draws and transfers for the real guest. The homepage cutaway is a host illustration; it is unrelated to these counters.

## Loss and snapshots

GPU context loss revokes qualification and fails uncertain pending work. Existing CPU display and cursor state remain separate. Restart the accelerated session, or use **Restart with software graphics** to open the warm desktop.

Accelerated GPU snapshots and restores reject explicitly: native WebGL objects cannot be saved into guest RAM. Software sessions retain their snapshot and persistence behavior.

## Reproduce the checks

`make verify-E6-T11d` records the actual VirGL-only Mesa probe, 1,000-frame cube, Hyprland client, original GPU command families and visible scanout. `make verify-E6-T11e` covers queue lifetimes, deterministic protocol properties and real context loss. Run the named target at its recorded source revision and inspect its evidence digest.

{% content-ref url="./docs.html?page=verification" %}
How worker evidence and independent verification work
{% endcontent-ref %}

{% content-ref url="./docs.html?page=reference-renderer-virgl-command-readme" %}
Original command framing and renderer contracts
{% endcontent-ref %}

{% content-ref url="./docs.html?page=reference-renderer-virgl-shader-readme" %}
Shader frontend and admission contracts
{% endcontent-ref %}

GPU offload does not establish a 300-MIPS or frame-rate claim. CPU throughput and responsiveness require their own browser measurements in the [performance guide](./docs.html?page=performance).
