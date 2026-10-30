---
kind: "Field guide"
source: "web/docs-source/guides/graphics.md"
scope: "Authored explanation; verification belongs to the named evidence"
---

# Guest graphics

The accelerated Omarchy path sends the guest's VirGL commands to WebGL2 in the production Linux worker. Mesa chooses OpenGL ES 3.0; Hyprland retries that API after its GLES 3.2 request. Frames reach the visible canvas through retained, fenced scanout and a page presentation receipt.

The command, shader, dimensional depth, transform-feedback and native multisample resolve prerequisites have been independently verified. Recorded production runs cover the real Mesa probe, 1,000 cube frames, Hyprland/Foot scanout and stock desktop typing. Final production deployment and context-loss recovery have separate verification records on the roadmap.

## Launch the desktop

In the [machine](./app.html#ide), open **Desktop settings**, keep **Desktop graphics** on **GPU**, and choose **Start** next to **Omarchy desktop** under **Other machines**. The worker checks actual WebGL2 limits, texture roles, native renderability and nonzero sampled results before advertising VirGL. An unsupported host produces a visible error; it does not justify positive guest capabilities.

The accelerated image uses a pinned Mesa 26.2.2 build with VirGL and the GLES API exposed through EGL. Its small, recorded source patch makes both border-clamp extension names independently configurable, and rejects desktop OpenGL contexts while retaining GBM's internal buffer-mapping context. It separates multisample renderbuffer support from multisample texture sampling: only qualified two-dimensional color/depth attachment queries can use the measured sample count and format mask. Unsupported border-clamp and sRGB-decode extensions are disabled in both legacy and indexed queries. The software DRI entrypoints are removed.

GPU rendering restores an authenticated Omarchy warm checkpoint on compatible hosts. RAM, the complete disk overlay, the selected guest clock and the original GPU command/DMA journal belong to one pinned artifact. A fresh worker rebuilds actual GPU resources and physically presents the restored display in its new renderer epoch. Readiness also requires new CPU execution; a static desktop can then accept the input that requests another draw. Acceptance checks new guest GPU work after startup. Repeat launches restore an independent copy of the same factory desktop.

The accelerated factory captures a clean session after the original wallpaper and Apps menu have initialized, startup jobs have finished, and disk requests have settled over a measured interval. Preparation opens the stock Apps menu, searches for LibreOffice Writer, closes it and checks the desktop again before freezing RAM, disk and GPU state together.

Use `?guest=omarchy&desktop=1&noSnapshot=1` on the machine's URL for an explicit GPU cold boot. **Software** (the other **Desktop graphics** choice) retains its paired RAM snapshot and disk delta; since E5.5-T07 the expanded snapshot streams into the machine's memory instead of first being held as one 605 MiB JavaScript buffer. That change does not measure total browser-process memory, and a physical iPhone remains unverified. BusyBox, Alpine and Alpine + Node keep their fast-boot paths. A corrupt or incompatible GPU checkpoint produces a visible error; it cannot silently become a cold boot or a software session.

{% hint style="info" %}
An accelerated cold boot starts with instruction-based time. Before its first original keyboard make, including a lock-state repair, it selects host-paced idle. A warm boot preserves the checkpoint's selected mode and exact guest time, then re-anchors its host clock; time spent offline is excluded. Busy execution and JIT timing follow retired instructions, while idle timer jumps are bounded by elapsed host time. Explicit pauses exclude paused time. The software snapshot retains its existing clock policy. The accelerated timing policy is independently verified in E6-T11d72 and E6-T11d73; paired clock restoration is covered by E6-T11d74c.

During instruction-based execution, tickless idle pauses its timer jump while a qualified GPU request awaits the browser, so guest time cannot skip past a pending host fence or presentation receipt. Original keyboard host waits are also guarded. Normal idle advancement resumes when those requests settle.
{% endhint %}

## What is offloaded

Guest shader translation uses the pinned VirGL TGSI frontend. Admitted commands create retained GPU storage, configure native rendering state and issue actual browser GPU draws. The renderer supports the proven dimensional color/depth views and layer surfaces, uniform buffers, multiple render targets, instancing, stencil operations and original transform-feedback targets.

The production profile has bounded resources and work: 32 MiB per resource or transfer, 128 MiB aggregate GPU storage, one pending queue job, 256 draws and 262,144 index/instance work units per submission. Older isolated proof profiles keep their original limits. Unsupported commands return explicit errors.

Capabilities are typed Rust fields serialized to the pinned 1,408-byte VirGL capset ABI. Reported formats and limits come from host qualification. A feature bit is not inferred from a successful allocation or from the browser's extension string alone.

The page shows completed jobs, draws and transfers for the real guest. The homepage cutaway is a host illustration; it is unrelated to these counters.

## Loss and snapshots

GPU context loss revokes qualification and fails uncertain pending work. Existing CPU display and cursor state remain separate. Restart the accelerated session, or use **Restart with software graphics** to open the warm desktop.

The accelerated factory checkpoint reconstructs GPU resources from original work; it never serializes native WebGL handles. Its identity includes the runtime, kernel, disk image, host capability profile, complete overlay and component digests. General software snapshot/import APIs still reject accelerated sessions. GPU warm boots currently use an ephemeral disk; persistent software sessions retain their existing snapshot behavior.

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
