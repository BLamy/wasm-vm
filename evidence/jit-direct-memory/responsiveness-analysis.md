# Throughput and desktop responsiveness

Analysis dated 2026-10-02. The engine already exceeds 300 MIPS on favorable
compiled loops. Sustaining that rate on real work, and reducing the work needed
to produce a visible response, are separate problems. E5.5-T03bg removes one
costly import boundary; it does not establish 300 MIPS on BusyBox or Omarchy.

| Measured workload | Browser throughput | Evidence and interpretation |
|---|---:|---|
| Tight JIT integer loop | 640.46 and 647.72 MIPS | T03bf final batches [1](../mips-integer-replay/micro-final-1/report.json) and [2](../mips-integer-replay/micro-final-2/report.json), `/browser/4`: 40 million instructions divided by candidate medians 62.455 and 61.755 ms. |
| JIT memory loop with InlineTLB hits | 395.45 MIPS before direct imports | [T03bg screen](screen-1/report.json), `/workloads/3/baselineMips`; candidate 403.75. This is a favorable memory-cache control, not the interpreter's decoded cache. |
| Earlier BusyBox boot / shell loop | About 86 / 45 MIPS | [T03bf final browser record](../mips-integer-replay/browser-final/browser.json), `/summary/busybox-jit/candidate`: 85.69 boot and 45.43 shell. |
| Current BusyBox JIT boot / shell loop | 83.78 / 42.92 MIPS | [T03bg final five-pair matrix](browser-final/browser.json), `/summary/busybox-jit/candidate`. Host elapsed time is the useful end-to-end comparator. |
| Historical responsive Omarchy r7 | About 20 MIPS | [Omarchy evidence](../omarchy-responsive/README.md), lines 18–24: 19.0 idle / 19.9 typing, 4.2–4.5 seconds from Enter to coherent output. These older runs used a loaded host and a different build/workload. |

These are workload-specific measurements, not interchangeable machine ratings.
The BusyBox browser runs use live RTC and variable boot work, so they are host
timing comparisons rather than deterministic guest equivalence. None is a
same-host, same-application comparison with v86 or WebVM, and no 300-MIPS result
for either competitor is established here. Instructions from different ISAs do
different amounts of useful work; x86 MIPS and RISC-V MIPS cannot rank application
performance directly.

Omarchy currently rasterizes its desktop through llvmpipe on the emulated CPU:
[guest configuration](../../tools/image/configure-omarchy-demo.py), lines 89–107,
forces software rendering and already disables animations, blur, shadows and
color management. The recorded full-screen repaint intervals cost roughly
**400–900 million retired guest instructions** ([raw frame costs](../omarchy-responsive/native/full-repaint-frame-costs.txt),
notably r3 frames 3–5/8–11 and LP0 frames 3–5/7–9). At a sustained 300 million
instructions/second, that unchanged work alone takes approximately **1.3–3.0
seconds**. This division is an extrapolation, not a measured 300-MIPS desktop.

Browser WebGL currently presents completed pixels: it stages BGRA bytes, uploads
a texture and draws a quad ([webgl.js](../../web/src/sink/webgl.js), lines
104–111 and 198–243). Selecting it does not move the guest's OpenGL rasterization
onto the host GPU. An older isolated [presentation benchmark](../e5-t06c/present-bench-2026-09-04.json),
lines 64–93, measured Canvas2D full-frame p50 1.74 ms / p95 3.025 ms and 64×64
damage p50 0.01 ms. That benchmark does not measure the entire desktop pipeline,
but it does not support attributing multi-second stalls to pixel presentation.

Several large latency bugs are already addressed. With the same emulator build,
the responsive guest recipe reduced recorded output latency from 291–377 seconds
to 4.2–4.5 seconds by stopping continuous wallpaper recomposition, limiting Foot
damage, correcting software-renderer flush behavior and preparing the first
pointer event ([attribution](../omarchy-responsive/README.md), lines 18–24 and
46–78). The worker also caps execution slices at 500,000 instructions and uses
`scheduler.postTask` where available ([loader.js](../../web/loader.js), lines
930–995); the [frame scheduler](../../web/src/sink/frame-scheduler.js), lines
21–26, retains at most one pending frame. These facts do not prove scheduling is
free, but enlarging worker slices can worsen input latency. Faster guest-clock
settings previously advanced guest time without producing a new response
([timer diagnostic](../omarchy-profile/timer-sensitivity-r1/RESULT.md)); repeating
that change is not a throughput remedy.

The architectural comparison offers hypotheses, not comparative measurements.
[CheerpX's primary overview](https://cheerpx.io/docs/overview), checked on the
analysis date, describes an interpreter plus a hot-code x86-to-Wasm JIT and a
focus on user-mode execution over a Linux-compatible syscall interface. That
higher-level boundary can avoid work that our full-system guest kernel and
devices execute; its contribution to the user's observed difference has not been
measured. [v86's implementation description](https://github.com/copy/v86/blob/master/docs/how-it-works.md)
describes hot-page compilation including reachable pages and an inline TLB fast
path, with slow paths for faults, MMIO and code invalidation. We already have JIT
chaining and an inline TLB; the useful comparison is how much real work remains
inside efficient compiled execution, not whether a JIT exists.

Concrete next investigations, not activated tasks or promised speedups:

1. **Keep more useful work inside compiled execution and reduce host handoffs.**
   The BusyBox screen reports roughly 3.7–4.2 logical blocks per engine call
   ([raw counters](browser-screen/browser.json), e.g. lines 212, 399 and 876),
   versus about 32 in the tight integer loop. Profile exits, memory misses,
   interpretation and compile pauses on the actual workload before selecting a
   boundary. Preserve interrupt sampling, precise faults and input slice limits.
2. **Reduce or offload guest graphics work.** A genuine guest graphics acceleration
   path could remove substantial software rasterization work; this is a larger
   architectural project than choosing the browser presentation backend. A lighter
   compositor/desktop or lower-resolution guest is a smaller experiment. Fewer
   pixels alone do not guarantee proportional speedup.
3. **Judge desktop changes by visible response.** Use the existing
   [trusted-input/glyph/nonce harness](../../tools/verify/omarchy-responsive-latency.mjs),
   lines 2–25, to record coherent echo and output latency with MIPS separately.
   Its geometry is currently specific to 1280×800 (line 41), so a lower-resolution
   experiment needs an appropriately validated fixture.

The two final direct-import microbenchmark batches show why scoped gains matter:
AMO throughput rose 1.195–1.206×, LR/SC 1.366–1.378× and forced InlineTLB-collision
work 2.500–2.521×, while hit/integer controls moved only slightly ([batch 1](micro-final-1/report.json),
[batch 2](micro-final-2/report.json)). Both batches ran at the frozen implementation
head with exact guest-state checks. These are ratios of median host durations;
paired medians also clear the declared gain threshold in both batches.

The [final five-pair real matrix](browser-final/browser.json) is approximately
neutral: JIT boot takes 4.8691 → 4.7844 seconds and shell 3.9198 → 3.8679 seconds
(roughly 1–2% faster); interpreter boot is 0.89% slower and shell 0.41% slower.
[Performance acceptance](performance-acceptance.json) passes all predeclared
budgets, with exact commands and unchanged artifact hashes in
[final-timing-receipt.json](final-timing-receipt.json). Candidate JIT throughput is
83.78 MIPS at boot and 42.92 in the shell region; the same shell workload reaches
57.86 MIPS with JIT disabled. This is evidence to investigate JIT/tier/handoff
overhead on mixed work, not proof of one particular cause. The initial
three-pair [screen](browser-screen/browser.json), including its 3.24% slower shell,
remains recorded separately. Publication and the final verifier verdict remain
pending; none of these measurements establishes a broader desktop speedup.
