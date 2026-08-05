# Flamegraphs of the emulator itself (E4-T02)

A repeatable procedure for profiling the **host** cost of the emulator — where interpreter
dispatch, the memory/bounds-check path, device polling, and (in the browser) the wasm-bindgen
boundary actually spend host CPU — with **readable Rust frame names**, so the E4-T05 optimization
and E4-T06 JIT design work from measured hotspots, not guesses.

This is the host-side companion to E4-T01 (which profiles where the *guest* spends time) and to the
Level-3 baseline (`docs/perf/level3-interpreter-baseline.md`, the frozen throughput numbers).

> **The ticket's `docs/profiling.md` deliverable lives here** (`docs/perf/flamegraphs.md`) to sit
> beside the other `docs/perf/` baselines. Same content, one location.

---

## TL;DR

```sh
# one-time
cargo install samply

# build the emulator with readable symbols (opt-level 3 + full DWARF, == release codegen)
cargo build --profile profiling -p wasm-vm-cli

# capture a bounded, console-free boot (~2–6 min host wall, no interaction)
samply record --save-only -o evidence/e4-t02/boot-native.samply.json.gz -- \
  target/profiling/wasm-vm boot \
    --kernel releases/kernel/6.6.63/Image \
    --drive file=releases/rootfs/alpine-rootfs.ext4 \
    --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
    --ram-mib 256 --no-input --max-instrs 2500000000

# view the interactive flamegraph (opens the Firefox Profiler UI on localhost)
samply load evidence/e4-t02/boot-native.samply.json.gz
```

Committed reference profiles + the real top hotspots: `evidence/e4-t02/` (see
`hotspots-summary.md`). Read that file for the measured numbers; this doc is the *how*.

---

## 1. Native flamegraphs

### Which profiler, and why `samply`

On macOS Apple Silicon we use **`samply`**, not `cargo-flamegraph`/`perf`:

- `samply` drives the OS sampler (`task_for_pid` + a sampling thread) — **no `sudo`, no `dtrace`**.
  `cargo-flamegraph` on macOS shells out to `dtrace`, which needs elevated privileges / SIP
  concessions and does not run headlessly here.
- It exports the **Firefox Profiler JSON** (`.json.gz`) — a compact, committable, re-openable
  artifact. `samply load <file>` reopens it into the full interactive flamegraph + call tree +
  timeline offline. That is the format committed under `evidence/e4-t02/`.
- `--save-only` records without launching the browser UI (headless / CI-friendly).

`perf` + `inferno` is the Linux equivalent and is documented at the end for the CI box; the
committed profiles here were taken with `samply`.

### The `profiling` build profile — readable symbols without changing the numbers

Root `Cargo.toml` defines:

```toml
[profile.profiling]
inherits = "release"   # opt-level 3, same codegen-units / lto as the shipped release binary
debug = true           # full DWARF line tables + symbols
strip = false          # stripping is what produces anonymous [unknown] frames — never do it
```

Build with `cargo build --profile profiling -p wasm-vm-cli` → `target/profiling/wasm-vm`.

**Symbol-readability note (native).** Because it `inherits = "release"`, the optimizer pipeline is
identical to the shipped binary, so the profile is *representative* — the profiling build's CoreMark
score is **261.734 it/s, exactly the release baseline** (0% delta; well inside the ±15% AC). The
only difference is debuginfo, which does not affect codegen.

> On *this* repo you can even profile `target/release/wasm-vm` directly and still get named frames,
> because `.cargo/config.toml` already sets `[profile.release] debug = 2` workspace-wide (for
> rr/gdb). The explicit `profile.profiling` is the **portable guarantee** — it does not rely on that
> config, pins `strip = false`, and is the obvious place to add profile-only flags later. If you ever
> see `[unknown]`/anonymous frames in the top 10, the cause is a stripped binary: check that
> `strip` is unset and `debug` is on.

### Capture — the reference workload

The committed reference is a **bounded, console-free boot** (`--no-input --max-instrs`): it drives
the interpreter dispatch loop, the MMU/PMP memory path, and the per-quantum device/interrupt sync
hard, needs no console interaction, and is fully deterministic/repeatable. `--max-instrs 2.5e9` runs
a few minutes of host wall under the sampler.

```sh
cargo build --profile profiling -p wasm-vm-cli
samply record --save-only -o evidence/e4-t02/boot-native.samply.json.gz -- \
  target/profiling/wasm-vm boot \
    --kernel releases/kernel/6.6.63/Image \
    --drive file=releases/rootfs/alpine-rootfs.ext4 \
    --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
    --ram-mib 256 --no-input --max-instrs 2500000000
```

**Profiling a CoreMark run instead.** The E4-T03 harness (`tools/bench.py`) honours a
`WASM_VM_BIN` env override, so you can run the *symbolicated* binary through the full boot →
console-drive → CoreMark pipeline under `samply`:

```sh
WASM_VM_BIN=$PWD/target/profiling/wasm-vm \
  samply record --save-only -o evidence/e4-t02/coremark-native.samply.json.gz -- \
    python3 tools/bench.py run coremark --engine native --runs 1 --json /tmp/cm.json
# /tmp/cm.json's score must be within 15% of the release baseline (it was identical: 261.734)
```

`samply` follows child processes, so the wasm-vm child is captured even though the launched process
is `python3`. Because the whole run is boot-dominated, the leaf mix ≈ the boot profile; the CoreMark
compute region is the tail ~12% of the timeline (window it in the Firefox Profiler timeline).

### View / export

- **Interactive:** `samply load evidence/e4-t02/boot-native.samply.json.gz` → Firefox Profiler UI
  (flamegraph, inverted call tree, timeline). Invert the call stack to read leaf/self time — that is
  what the hotspots table is built from.
- **SVG (optional):** a folded-stacks file is committed for offline SVG generation:
  ```sh
  cargo install inferno   # or: brew install inferno
  inferno-flamegraph < evidence/e4-t02/boot-native.folded > boot-native.svg
  ```

### Reading it — real hotspots

See `evidence/e4-t02/hotspots-summary.md` for the measured top-15 leaf functions and the bucketed
findings. Headline (boot; CoreMark agrees within ~1 pt): **per-quantum device/interrupt sync ≈ 47%**
(`sync_plic`/`sync_clint`/`IrqLine::set`/`sync_sbi_timer`/`next_interrupt`) dominates, **address
translation ≈ 24%** (`translate_cached`/`mode_params`/`satp`/`pmp::check`), **dispatch+execute
≈ 13–23%**, **decode ≈ 9%**. Dispatch is *second-order* to device-sync on the interpreter.

### Linux CI variant (`perf` + `inferno`)

```sh
perf record -F 997 --call-graph dwarf -o perf.data -- \
  target/profiling/wasm-vm boot --kernel … --no-input --max-instrs 2500000000
perf script -i perf.data | inferno-collapse-perf | inferno-flamegraph > boot-native.svg
```
`--call-graph dwarf` + the `profiling` build's DWARF gives the same named frames without frame
pointers.

---

## 2. In-browser flamegraphs (Chrome + Firefox)

**Status: reaping-deferred capture, verified build mechanics.** A live browser capture needs the
Alpine wasm boot, which OS-reaps on this dev mac (see the E3 memory note; same deferral as
E4-T03/T04's browser legs). The build-flag mechanics below — the actual hard part, and the ticket's
core concern — **were verified on this host** (see §3). Run the capture on a machine that can hold
the browser boot.

### Build the wasm with a name section (this is the whole game)

Symbolicated wasm profiles require the wasm **`name` custom section** to survive to the browser.
**A plain `wasm-pack build --profiling` does NOT keep it on this repo** — `wasm-pack` runs
`wasm-opt`, whose default strips `name`. You must tell `wasm-opt` to preserve it with `-g`. That is
configured in `crates/wasm/Cargo.toml`:

```toml
[package.metadata.wasm-pack.profile.profiling]
wasm-opt = ['-O', '-g']    # -g = keep the name section through optimisation
```

Then:

```sh
wasm-pack build crates/wasm --target web --profiling --out-dir web/pkg
# VERIFY the name section shipped (adversarial #1) — must print a "name" Custom section:
wasm-objdump -h web/pkg/wasm_vm_wasm_bg.wasm | grep -i name
```

- **Never** re-run a stripping `wasm-opt`/`--strip-debug` over the packaged `.wasm` afterward — the
  gen-web-manifest / web-build path must ship the `-g` output as-is.
- The default **release** web build (`make wasm`) deliberately strips `name` (smaller download);
  only the `--profiling` output above is symbolicated. Do not ship the profiling wasm to prod.

### Capture in Chrome DevTools

1. Serve the `--profiling` build (`make web-serve`, or any static server over `web/`) and open the
   VM page.
2. DevTools → **Performance** → gear → ensure profiling is on; Record; drive the workload (boot to
   login, or run CoreMark in the guest shell); Stop.
3. Enable **"Show native functions"** in the flamechart context menu so wasm frames aren't hidden.
   With the `name` section present, frames read as `wasm_vm_core::hart::Hart::execute …` instead of
   `wasm-function[1234]`.
4. Export: **"Save profile…"** → a `.json` (commit it under `evidence/e4-t02/` once captured).

### Capture in Firefox (do not skip — the AC names both browsers)

1. Open `about:profiling` / the Firefox Profiler toolbar; preset **JavaScript**, then add the
   **WebAssembly** feature; Record; drive the workload; Capture.
2. Firefox symbolicates wasm from the `name` section automatically — same demangled Rust frames.
3. **"Upload / Save to file"** → committable `.json.gz`, reopenable with `samply load` too (same
   format as the native captures).

### Symbol-readability note (wasm)

| Build | `name` section? | Browser frames |
|-------|:---------------:|----------------|
| `wasm-pack build --target web` (release) | **no** (wasm-opt strips) | `wasm-function[N]` (anonymous) |
| `wasm-pack build --target web --profiling` *without* the `-g` metadata | **no** (wasm-opt strips) | anonymous |
| `--profiling` **with** `wasm-opt = ['-O','-g']` (this repo) | **yes** (123 KB, 208 named `wasm_vm_core::*` funcs) | demangled Rust |

The wasm-bindgen boundary cost (JS↔wasm crossings) is a **browser-only** line item — it does not
appear in the native profile and is what the browser capture is *for*. Characterizing its % is part
of the deferred capture.

---

## 3. Verification performed on this host (2026-08-05)

- **Native, real capture:** both `evidence/e4-t02/*.samply.json.gz` were recorded with `samply` on
  the `profiling` binary and symbolicated with `atos`; top-10 frames are all named `wasm_vm_core::*`
  (zero `[unknown]`). Numbers in `hotspots-summary.md` are read from those profiles.
- **Representativeness (AC):** profiling-build CoreMark = **261.734 it/s**, identical to the release
  baseline → 0% delta (< 15%).
- **wasm name section (AC / adversarial #1):** verified empirically — a bare `--profiling` build
  ships **no** `name` section (wasm-opt strips it; byte-identical to the release build); adding
  `wasm-opt = ['-O','-g']` restores it (`wasm-objdump -h` shows a 123 KB `name` section with 208
  demangled `wasm_vm_core::*` functions).

### Deferred (honest)

- **Live browser capture (Chrome + Firefox):** reaping-deferred — the Alpine wasm boot OS-reaps on
  this mac. The build mechanics that make the capture *symbolicated* are verified above; the capture
  itself needs a host that can hold the boot. No browser `.json` is committed yet.
- **CoreMark-isolated dispatch %:** the harness run is boot-dominated, so the committed CoreMark
  profile's leaf mix ≈ boot. Windowing its tail (the compute region) confirms device-sync stays
  dominant, bounding dispatch at ~20–23% — but a pure-compute-only capture (a bare-metal CoreMark
  that doesn't boot Linux) is not built here.
