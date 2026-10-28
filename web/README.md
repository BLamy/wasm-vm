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
Full Omarchy cold-boot qualification and the original two-profile performance campaign are deferred and unproven. The [unified time-travel guide](docs-source/guides/time-travel.md) describes the bounded software Linux/GPU integration, local transfer and recovery controls. `make verify-E9-T24` records that accepted scope.

`make verify-E9-T19` records the built-page keyboard, mouse and touch paths, narrow layout,
independent from-start VM/console comparisons and 100 superseded seek requests. Build and
commit `web/dist` before recording the frozen-head acceptance.

The **Owned device completion recording** probe also runs a small RV64 guest
that submits a 1,179,648-byte split-descriptor block write and read through
the session COW adapter. Its source and deterministic ELF builder are in
`tools/verify/build-e9-block-transfer-guest.py`; `make verify-E9-T22t` checks
the built browser proof and the independent guest trace oracle.

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

## Local recording files

The timeline's **Export recording** downloads one complete `.wvsession` file.
**Import recording file** checks that file before publishing a local session;
it selects a preview without replacing the displayed guest. **Open replay** is
still explicit. A recording's ID and manifest remain unchanged; an existing ID
is a conflict, not an overwrite. Parent and sibling recordings are not included
unless their immutable objects are actually required by the chosen recording.

Version 1 transfers finished exact software (256 MiB, ICount/10) and exact GPU
(1 GiB, pure ICount/64) recordings admitted by the installed VM build. Partial
input captures, checkpoint-only histories and foreign builds are refused. The
archive includes the manifest, log, payloads, kernel/Wasm/renderer identity,
base-image descriptor, complete historical COW pages, full keyframes and all RAM
delta ancestors/pages. Recorded read results supply historical disk I/O; replay
does not fetch the original guest asset URLs. A matching installed app provides
host JavaScript and validates the bundled Wasm; this is a recording archive,
not a standalone copy of the website. GPU import also runs the existing hardware
qualification and saved-profile checks in a separate disposable WebGL context.
In these exact runtimes, private COW pages are serialized inside the native owned
device snapshot. The separately referenced disk root must be the accepted empty
base binding; legacy overlay profiles are not admitted by version 1.

`WVBUND01` uses a 16-byte prefix, a canonical JSON header and concatenated raw
objects sorted by SHA-256. There are no entry paths, compression or scripts.
Limits are 8 MiB of header, 65,536 entries, 640 MiB per object, and 4 GiB total
uncompressed object data, with the existing smaller manifest, log, frame and
renderer limits also enforced. Duplicate archive entries or header/witness fields, unsupported versions,
extra or missing objects, mismatched digests, invalid native sections and foreign
runtime identities fail before any destination publication. Hashing and staging
use bounded 1 MiB chunks. A private native decoder candidate validates the
state at every keyframe, including reconstructed delta RAM, without retiring
guest instructions.

Recording files contain guest memory/files, typed input and network payloads.
Transfers are explicit local file operations with no upload. **Cancel local
transfer** revokes an unfinished import, including its final transaction's
authorizer; an already durable commit wins. Storage failure can leave unreachable
staging objects, but cannot make that unfinished recording playable or overwrite
another recording. **Delete local recording** removes its row and reclaims only
unshared reachable data. Unknown or malformed surviving extension metadata stops
reclamation. Known witness v1 metadata must round-trip as canonical JSON, so a
duplicate inner member cannot hide an unknown value during reclamation.
Exported files remain on the user's device after local deletion.

`make verify-E9-T21` records real UI export/import across fresh Chrome profiles,
Linux and physical-GPU state witnesses, actual guest-I/O URL denial, archive
mutation/refusal tests, duplicate IDs, quota, both sides of cancellation, and
reclamation while preserving other recordings.
Independent byte readers check the ext2 contents, COW sectors and GPU readback.
The full local wall runs once at a clean frozen head. A separate
`python3 -B tools/verify/e9-bundles.py --output OUTPUT --cold-clone CLONE_DIRECTORY`
checks that same revision from a pristine checkout and fresh build directory.
These are correctness proofs; desktop performance budgets remain E9-T22.


### Owned local HTTP and replay check (E9-T22b)

The demo's **Live HTTP and offline replay check** boots the pinned full Alpine
image with recording OFF and ON, fetches `/e9/1` through `/e9/10` at guest
`10.0.2.2:9191`, closes the live service, and compares a fresh replay's complete
native machine bytes. Each response is 1024 copies of byte `17 + INDEX`. The
service runs inside Slirp's real TCP stack; it opens no outbound connector.
This is functional provider evidence. The full scheduled desktop workload and
performance campaign remain T22c/d.

`WasmLinux.openOwnedLocalHttp()` installs one provider owned by that VM. Open it
after Linux initializes virtio-net: a guest device reset revokes old ownership.
Call `pumpOwnedLocalHttp()` around bounded CPU chunks and drain its `more` flag
before running again. A `blocked` result retains in-flight outcomes for retry;
draining recording receipts or guest RX capacity must precede further live
work. The demo fails explicitly if that capacity does not settle. The pump
uses guest ICount-derived milliseconds in both OFF and ON modes.

`ownedLocalHttpState()` returns aggregate pump/server counters, and
`cancelOwnedLocalHttp()` settles pending sends and closes the backend. Dropping
the VM also retires its sockets. The service has four sockets, a 4 KiB header
limit, 128 lifetime connections, a 30-second guest-time lifetime, and finite
frame/byte queues. There are no caller-supplied destinations, ports or network
callbacks. Legacy network callback methods refuse while this provider owns the
VM; replay refuses its factory before construction.

Run `make verify-E9-T22b` on a clean committed tree. Evidence includes the full
immutable image identity, actual guest body bytes and hashes, per-index server
counts, independently reconstructed TCP streams, complete original/replay
machine files, the event tape, a native guest instruction trace, the visible
built-page check, and the local high-risk regression wall. The runner's
`--cold-clone PATH` option performs the final independent-build proof without
repeating the primary regression wall.


### Paged native witness storage (E9-T22i)

The **Paged state witness storage check** records 130 actual native GPU machine
state witnesses through bounded content-addressed pages, preserves every
checkpoint, and checks cleanup and a storage-only local archive round trip.
The check takes several minutes. Complete browser playback is exercised by E9-T22h.

Explicit paged recording uses the required `e9-exact-witness-pages-v2` extension;
older clients refuse it before cleanup. The default v1 writer/readers and their
limits are unchanged. New storage archives use the distinct
`wasm-vm-witness-storage-v2` header with `scope: "storage-only"`; importing one
does not admit it for playback or claim installed-runtime portability. The
existing playback archive schema and native checks remain separate.
See [the format and closure rules](../docs/design/session-witness-pages.md).
`make verify-E9-T22i` is the scoped native/Wasm/browser submission, with literal
byte authentication in `tools/verify/e9-witness-pages-files.py` and a fresh
Daybreak critic. Original workload and performance qualification stays open.

### Complete bounded GPU history reads (E9-T22f)

`SessionGpuHistoryReader.withOpen` authenticates finished v2 GPU recordings before
exposing one-use receipt and witness cursors. It preserves all original positions
and content identities beyond the old whole-history 4096-receipt/64-MiB limits,
while retaining those limits for each window. The reader itself performs storage
authentication only; E9-T22h consumes it through private native replay. The demo's
**Complete GPU history read check** exercises both real long histories. See [the reader contract](../docs/design/session-gpu-history-reader.md)
and `make verify-E9-T22f` for the frozen local proof and adversarial checks.

### Complete GPU browser replay (E9-T22h)

The timeline now opens paged GPU histories. Its private worker regroups bounded
storage pages at committed state witnesses and continues the same native machine
through each admissible interval. A history whose witness gap exceeds native row,
receipt-byte, or GPU-body limits is refused before any partial selection is
published. Archive export/import authenticates the entire paged graph and checks
every saved native keyframe; garbage collection retains that graph.

The demo's GPU history check records and replays the two long native input/block
histories. `make verify-E9-T22h` adds the physical GPU readback fixture, full
original-versus-replay machine-state and renderer checks, zero-egress browser
capture, corrupted-middle and incompatible-archive attacks, and cancellation
checks. Cold Omarchy workload and fixed performance budgets remain E9-T22c/d.

### Full GPU keyframes with parked owned block reads (E9-T22j)

The live long-journal disk probe now takes a full GPU keyframe immediately after
an authenticated base-chunk completion while its virtio-blk descriptor remains
parked. The exact native session frame retains the resident chunk, read pin and
descriptor until the next device service publishes DMA and the used ring once.
`make verify-E9-T22j` exercises native full/delta capture, restore, replay and
malformed-state refusal, then runs the built physical-GPU browser and demo
suite. The browser reopens its bounded paged history and replays from that
specific full keyframe to the post-service and final witnesses. Complete
Omarchy workload qualification remains E9-T22c.
