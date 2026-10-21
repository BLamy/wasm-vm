# Browser demo (E0-T23)

A static page that loads the `wasm-vm` core as a wasm ES module, instantiates
`WasmMachine`, and wires its per-byte console callback into an [xterm.js](https://xtermjs.org/)
terminal. Run/Reset controls, an ELF file picker, the embedded default `hello.elf`, and a
status line showing the exit code + retired-instruction count. The page also has an
`areweturboyet`-style riscv-tests heatmap that automatically runs every committed
`tests/riscv-tests-bin/*` ELF in the browser and turns each cell green or red as the run
finishes.

## Build & serve (cold-clone reproducible, offline)

```sh
make web-build     # wasm-pack build --target web + npm ci (pinned xterm.js) + copy ELFs
make web-serve     # python3 -m http.server on :8080
```

Then open **http://localhost:8080**. The compliance heatmap starts running the copied
`web/assets/riscv-tests/*` fixtures on load; hover or focus a cell to see the test name,
status, retired count, digest, and failure detail. The console panel can still run
`hello.elf`, where `Hello from RV64` renders in the terminal and the status line shows
`exited code=0 retired=83`.

Must be served over **HTTP** — wasm streaming and ES-module MIME rules break under
`file://`. There is **no CDN**: xterm.js is pinned in `package-lock.json` and installed
with `npm ci`, so builds are reproducible and work offline.

## Session timeline

The app's **Time travel · session timeline** panel opens completed software recordings
and admitted exact GPU histories from the local history store. **Record Linux sample** saves a real, bounded Linux boot
excerpt with three incremental keyframes. It uses a separate guest and pauses the live
guest. **Finish sample early** commits the completed prefix rather than inventing a
successful full boot. The excerpt ends before external disk or network requests.

Open a recording, scrub or enter an exact transition, step in either direction, play/pause,
or navigate saved keyframes and recorded events. The preview target is separate from the
active position. The serial console, full transition/event position and expandable state
digest update together only after the private replay is restored. Observation events
navigate to the next transition boundary. Exact GPU histories recorded in the explicit
1 GiB pure ICount/64 runtime also restore their physical canvas and recorded guest
results. Older paced GPU histories remain checkpoint-only in **Local saved sessions**.
Full desktop recording integration and performance remain E9-T22/E9-T24 work.

`make verify-E9-T19` records the built-page keyboard, mouse and touch paths, narrow layout,
independent from-start VM/console comparisons and 100 superseded seek requests. Build and
commit `web/dist` before recording the frozen-head acceptance.

## Browser support

Current **Chrome** and **Firefox** (both ship `WebAssembly`, ES modules, and
`application/wasm` streaming). The terminal is raw byte output at Level 0 — keyboard input,
resize, and full ANSI apps arrive with the real UART in Epic 2.

## Docs and media embeds

The in-app **Docs** tab loads [`docs.html`](./docs.html), a short documentation hub with
separate pages for the host boundary, guest boot/storage, containers, verification, and
explainers. The published `@agent-wasm/*__ libraries are documented on
[`docs-embedding.html`](./docs-embedding.html) as a separate host-side project; they are not
the wasm-vm guest. Hosted VizEngine/Orly frames and their fallback links live on
[`docs-explainers.html`](./docs-explainers.html). The source-side guide is
[`docs/embedding-guide.md`](../docs/embedding-guide.md). There is no standalone packages
route.

The public product pages are static and dependency-free:

- [`products.html`](./products.html) — browser Linux, encrypted volumes, peer delivery, work
  market, critics, and embedding surfaces.
- [`case-studies.html`](./case-studies.html) — case-study index, including the
  [in-progress RV-Phone OS plan](./case-study-riscv-os.html) and its proof boundary.
- [`case-study-ai-sandboxing.html`](./case-study-ai-sandboxing.html) — proposed hosted
  isolation stack: the agent in wasm-vm, a sandboxed browser, and Firecracker around
  the entire browser. Separates the current demo from the containment evidence still needed.
- [`case-study-deterministic-simulation.html`](./case-study-deterministic-simulation.html) —
  a proposed debugging workflow inspired by celld's deterministic simulation article;
  separates recorded investigation from simulation search and a still-unproven celld integration.
- [`work-market.html`](./work-market.html) — frozen tickets, builder submissions, critic quorum,
  challenge windows, and settlement economics.
- [`security.html`](./security.html) — passkey-owned volumes, key hierarchy, shard verification,
  and peer threat model.
- [`roadmap.html`](./roadmap.html) — the public-facing ProofMesh delivery roadmap.

Use `VizPlayer` for authored timeline scenes, `VideoEmbed` for direct or hosted
video, and Docstream's documented GitBook-style embed boundary for portable markdown. The
renderer/editor package APIs and hosted examples are maintained on the focused explainer page:
[`docs-explainers.html`](./docs-explainers.html).

```md
{% embed url="https://loop-qa.replay.io/projects/project-id/journeys/journey-id" /%}
```

## Files

- `index.html` — page + xterm.js UMD include + `main.js` module.
- `main.js` — wasm init, terminal wiring, Run/Reset, file picker, status line, and
  riscv-tests runner. Errors (bad ELF, trap) render **in the terminal**, not only the JS
  console.
- `console-capture.html` / `console-capture.js` — focused host-chrome surface with live Display /
  Serial tabs, the reserved `Ctrl+Alt+Backquote` switch, readback-checked PNG screenshots, and a
  bounded WebM recorder.
- `riscv-tests.js` — manifest for the committed browser-run riscv-tests binaries.
- `assets/*.elf`, `assets/riscv-tests/*` — generated by `web-build`.
- `pkg/`, `node_modules/` — build artifacts (gitignored; regenerate with `web-build`).

## Node system workload benchmark

[`bench-runtime-workloads.mjs`](./bench-runtime-workloads.mjs) is the one portable runner for the
Node surface. The current published campaign applies that exact script and fixture to native Node,
wasm-vm's worker-JIT, worker-interpreter, and main-interpreter modes, [WebContainers](https://webcontainers.io/api),
[almostnode](https://github.com/BLamy/almostnode), and [WebVM](https://webvm.io/). It records raw
samples for:

- `file-read` — `fs.promises.readFile` plus a SHA-256 check;
- `file-write` — `fs.promises.writeFile`, `stat`, and a SHA-256 check (the timed region does not
  include an `fsync`);
- `stream-read` — `createReadStream` with incremental hashing;
- `stream-copy` — `pipeline(readable, Transform, writable)` with size and hash checks;
- `server-lifecycle` — TCP server listen and close, with both sub-timings;
- `http-roundtrip` — a local server and sequential verified requests, with listen, request, and
  close sub-timings.

The defaults are seven measured samples, two warmups, a 1 MiB payload, a 64 KiB stream chunk, and
eight requests per HTTP sample. Use smaller values for a quick check:

```sh
node web/bench-runtime-workloads.mjs \
  --environment=native-node \
  --samples=7 --warmups=2 --payload-kib=1024 --http-requests=8 \
  --output=/tmp/native-runtime-workloads.json
```

Each output is schema `node-system-workload-benchmark-v1`. It includes runtime identity, the
fixture and its digests, the exact sampling policy, every sample, summary statistics, and the
verification result. Every measured sample checks its output digest. A runtime may be `partial`
when a specific Node API is unsupported; those cells contain an explicit reason and no timing.
An adapter that could not complete the exact run is listed in `notRun`, never as a guessed value.

Merge captures only when their fixture and policy match:

```sh
node tools/merge-runtime-benchmarks.mjs \
  --input=native-node=/tmp/native-runtime-workloads.json \
  --input=wasm-vm-worker-jit=/tmp/wasm-vm-worker-jit.json \
  --input=wasm-vm-worker-interpreter=/tmp/wasm-vm-worker-interpreter.json \
  --input=wasm-vm-main-interpreter=/tmp/wasm-vm-main-interpreter.json \
  --input=webcontainers=/tmp/webcontainers-runtime-workloads.json \
  --input=almostnode=/tmp/almostnode-runtime-workloads.json \
  --not-run=webvm="reason from the bounded browser run" \
  --output=web/runtime-benchmarks.json
```

The homepage's **Node system workload matrix** reads that raw comparison directly. The JSON preserves
the environment identity, browser adapter metadata, runner digest, fixture digests, all samples,
and verification results. To run the same capture in a guest, place this script in the guest and
use the corresponding `--environment` label for the execution mode (`wasm-vm-worker-jit`,
`wasm-vm-worker-interpreter`, or `wasm-vm-main-interpreter`). The browser adapters use their own
runtime APIs but do not change the script or timing contract; WebContainers requires cross-origin
isolation, almostnode uses its package-source bridge, and WebVM runs the script in its Alpine
terminal.

The current comparison has complete six-workload measurements for WebContainers. almostnode has
verified file read, file write, and server lifecycle timings; its stream and HTTP operations are
published as unsupported with the observed reasons. WebVM is published as `notRun` because the
exact 1 MiB run hit a loopback port collision and a fresh bounded retry did not finish. This keeps
the result honest while making the missing proof visible.

## Node steady-state compute benchmark

[`bench-runtime-compute.mjs`](./bench-runtime-compute.mjs) is a separate campaign for measuring
the part of the Node surface where a JIT can amortize translation and dispatch. It keeps one
long-lived process alive and times only deterministic compute loops, so process startup, module
loading, and typed-array reset are outside the timed region. It does not replace or average into
the system workload matrix above; the two suites answer different questions:

- `integer-mix` — dependency-heavy 32-bit arithmetic and `Math.imul` operations;
- `branch-mix` — deterministic data-dependent branches and rotates;
- `memory-mix` — indexed `Uint32Array` read/modify/write operations.

Every warmup and measured sample must produce a fixed checksum. The JSON retains each sample,
median, p95, standard deviation, work-unit rate, runtime identity, runner digest, and the exact
fixture constants. Run the native baseline with:

```sh
node web/bench-runtime-compute.mjs \
  --environment=native-node --samples=7 --warmups=2 \
  --output=/tmp/native-runtime-compute.json
```

The result kind is `node-steady-state-compute-benchmark-v1`. Use the same script, constants, and
sampling policy for wasm-vm JIT/interpreter, WebContainers, almostnode, and WebVM. The published
campaign is [`runtime-compute-benchmarks.json`](./runtime-compute-benchmarks.json); it is rendered
under a separate heading on the landing page alongside the native JIT handoff diagnostic. A fast
compute result must not be used to imply that filesystem or networking boundaries are fast, and
unmeasured environments remain explicitly unmeasured until the exact fixture completes.

The exact GPU event adapter is `session-gpu-journal.js` with
`session-gpu-replay.js` / `session-gpu-replay-worker.js`. Its explicit production
runtime admits 1 GiB pure ICount/64 histories; older paced GPU checkpoints retain
checkpoint-only controls. The timeline displays a physical GPU canvas when an
admitted saved GPU history is selected. `make verify-E9-T18c` records the RV64
readback/query/error workload, retained storage bytes, changed live results,
seek cancellation and context-loss probes; `make verify-E9-T18` includes its
native a/b result/keyframe checks. T22/T24 still own desktop budgets and final
live desktop recording integration.

The timeline's **Continue here** control creates a new recording from a selected
exact software or healthy GPU replay position. Each child owns its VM, input
queues, disk overlay and GPU worker. Saving a child preserves the parent's future;
discarding an unsaved child deletes that child's identity. Parent and child
histories retain their own authenticated assets and can be reopened independently,
including after deleting their relatives.

Continuations use retained local kernel, Wasm, renderer and disk chunks. Missing
local history is an error. Historical external connections remain permanently
offline in the child: **Go live** explicitly refuses them. A continuation never
reconnects or retransmits the parent's sends. Starting a separate live session is
the available policy; connection reset support is future work. Older paced GPU
histories and GPU checkpoints containing failed or unproved work keep their
existing continuation restrictions.

**Record file example** boots the pinned Linux kernel with a reproducible 8 MiB
ext2 filesystem and real RV64 BusyBox. It saves a position before `/state` changes
and records the parent's `P` write. Continue from that position and enter `A` or
`B` to write a different value in a private child. This second exact software
profile pins the kernel, image manifest and boot arguments; it does not admit
arbitrary images. Rebuild its bytes with
`bash tools/session-branch-fixture/build.sh OUTPUT_DIRECTORY` using the pinned
local rootfs builder, then package them with `tools/session-branch-fixture/package.py`.

`make verify-E9-T20` records real Linux file writes and reload/deletion order,
actual hardware GPU work in two children, raw native snapshots, an external
counter, ABI ownership attacks and publication/paint/storage fault injection.
Independent byte readers check the ext2 contents, COW sectors and GPU readback.
The full local wall runs once at a clean frozen head. A separate
`python3 -B tools/verify/e9-branch.py --output OUTPUT --cold-clone CLONE_DIRECTORY`
checks that same revision from a pristine checkout and fresh build directory.
These are correctness proofs; desktop performance budgets remain E9-T22.
