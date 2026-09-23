# tools/perf — perf-overhaul benchmark harness

Reproducible before/after numbers for wasm-vm, native CLI and browser, measured with the **host's
wall-clock**. Nothing here reads the guest's clock for speed: under the default icount clock
(`--icount-divider 10`, 10 MHz timebase) guest time is *derived from retired instructions*, so an
in-guest timer reports the same elapsed time however fast or slow the host ran. The earlier
"JIT 1.0x" browser compute result used in-guest timers and was invalid for exactly that reason.
(Guest uptime is used in one place, as an *instruction counter* for a busy region — see below.)

| script | what it measures |
|---|---|
| `bench-all.sh BASE CAND OUT` | both suites, A/B interleaved between two checkouts, plus `OUT/SUMMARY.md` (the PR table) |
| `bench-native.sh BIN OUT [BASELINE_BIN]` | native suite (wrapper for `bench_native.py`) |
| `bench-browser.mjs --root L=CHECKOUT ... --out OUT` | browser suite (Playwright + headless Chromium) |
| `summarize.py` | headline table from `native.json` / `browser.json` |
| `oracle.sh BIN OUT` | the equivalence oracle (guest-visible digests) — not a benchmark |
| `boot-ab.sh A B [N]` | the quick interleaved busybox boot A/B used while iterating |

The committed pre-overhaul numbers live in `evidence/perf-overhaul/bench-baseline/` (its README has
the table, the machine conditions, and the measured suite wall times).

## Prerequisites

Each checkout you benchmark must be built:

```sh
cargo build --release -p wasm-vm-cli     # target/release/wasm-vm (release = fat LTO on the overhaul branch)
make web-build                            # web/pkg, web/node_modules, web/releases (all gitignored)
```

Two inputs are gitignored and live only in a checkout that fetched/built them, so point `RELEASES`
at such a `releases/` directory (on the reference machine: `/Users/blamy/Documents/Codex/wasm-vm/releases`):

- `rootfs/alpine-rootfs.ext4` — the native Alpine boot (cloned per run with `cp -c`; the boot mounts it
  read-write, so the source image is never touched);
- `chunked-node-alpine/` — the browser node-alpine case (served same-origin via `?assetBase=`).

Kernel, initramfs, the busybox boot snapshot, the node-alpine RAM snapshot and `bench/guest/bench.ext4`
(the CoreMark overlay) are tracked and are taken from the checkout. Cases whose inputs are missing are
skipped with a message. Stdlib Python 3 and Node 18+ only; Playwright/Chromium come from any built
checkout's `web/node_modules`.

## Quick start

```sh
# A/B: pre-overhaul baseline vs a candidate checkout (the command behind the PR table)
RELEASES=/Users/blamy/Documents/Codex/wasm-vm/releases \
  bash tools/perf/bench-all.sh /Users/blamy/Documents/Codex/wasm-vm-base /path/to/candidate OUT
cat OUT/SUMMARY.md

# candidate only, compared against the committed baseline run (faster, but not interleaved)
RELEASES=... bash tools/perf/bench-all.sh - /path/to/candidate OUT
python3 tools/perf/summarize.py --native OUT/native/native.json --browser OUT/browser/browser.json \
  --ref-native evidence/perf-overhaul/bench-baseline/native/native.json \
  --ref-browser evidence/perf-overhaul/bench-baseline/browser/browser.json --ref-label baseline
```

The harness scripts can be run from any checkout — they take the checkouts to measure as arguments,
so the same harness revision measures both sides. `BUILD=1` makes `bench-all.sh` build the candidate
first (it never builds the base checkout). `SKIP_NATIVE=1` / `SKIP_BROWSER=1` run one half.

By default `bench-all.sh` runs the native and browser suites **concurrently** (each suite interleaves
its own A/B samples, so the other suite's load lands on both sides alike); that keeps a full A/B near
20-25 minutes at pre-overhaul speed (less as the candidate gets faster). `SEQUENTIAL=1` runs them one
after the other (roughly twice as long) for a quiet-machine headline.

## Native suite (`bench_native.py`)

All cases pin the goldfish RTC (`--fixed-rtc-ns 1790000000000000000`, same as the oracle) so both
binaries do identical guest work, and the retired-at-marker counts are cross-checked between
binaries (a mismatch is printed as a WARNING — it means guest-visible divergence). A binary whose
`boot --help` lacks `--fixed-rtc-ns` (a checkout older than the overhaul oracle) runs with the host
RTC and is flagged in the table header.

| case | workload | metrics |
|---|---|---|
| `busybox-legacy` / `-fast` / `-jit` | busybox initramfs boot to the `userland up` marker (`--profile-boot --no-input`); fast = `--block-cache --interrupt-batching` | process wall s, process CPU s (rusage), MIPS = retired / profiled wall |
| `compute-fast` / `-jit` | boot busybox, type `i=0; while [ $i -lt 10000 ]; do i=$((i+1)); done` at the prompt; timed from Enter to the done marker (~165M guest instructions; `[` and `$((..))` are ash builtins, so no fork/exec) | region wall s, region CPU s, MIPS estimate |
| `coremark-fast` / `-jit` | CoreMark (6000 iterations, ~2.2G instructions) from `bench/guest/bench.ext4` (read-only `/dev/vda`) run at the busybox prompt; CRC self-check (`seedcrc 0xe9f5`, "Correct operation validated") enforced | region wall s, region CPU s, CoreMark iterations/s on the host clock, MIPS estimate |
| `alpine-fast` / `-jit` | Alpine ext4 disk boot to getty `login:` (~3.07G instructions), 256 MiB, fresh rootfs clone per run | wall s, CPU s, MIPS, JIT-retired fraction |
| `microbench` | `crates/core/tests/perf_baseline.rs` (`report` + `perf_fast_interpreter_does_not_trail_legacy`) built in the checkout that owns each binary (`<checkout>/target/release/wasm-vm`) | ALU/branch/memory/fp MIPS (legacy), ALU MIPS (fast) |
| `compute-legacy` (opt-in) | the compute loop on the legacy interpreter | as compute |

MIPS estimate for a timed region: the command brackets itself with `/proc/uptime` (CoreMark reports
its own "Total time"); while the guest is busy, one icount guest second is exactly 1e8 retired
instructions, so `guest seconds x 1e8 / host region seconds` is the throughput. (Cross-checked with
`--stats`: a 20000-iteration loop retired 330.57M instructions by differential vs 331M estimated.)
JIT-retired fraction comes from the CLI's `=== E4-T29 JIT summary ===` (`retired_via_jit /
total_retired`).

Scheduling: the quick cases (busybox, compute) run `REPS` rounds, A and B back to back with the order
flipped every round. The slow cases (CoreMark, then Alpine) run `SLOW_REPS` samples per binary in
**waves** of `SLOW_PARALLEL` (default 4) concurrent processes; each wave holds whole A/B pairs, so the
A and B samples of a case start together and share the machine's load for their whole multi-minute
run. `SLOW_PARALLEL=1` makes them sequential (and ~4x slower). The microbench runs `MICRO_REPS`
rounds after the quick cases.

Env / flags: `REPS` (3), `SLOW_REPS` (1; `ALPINE_REPS` is accepted as an alias), `SLOW_PARALLEL` (4),
`MICRO_REPS` (3), `CASES` (comma list; default is every non-opt-in case), `COMPUTE_ITERS` (10000),
`RELEASES`, `BENCH_FIXED_RTC_NS`, `TMPDIR` (where the Alpine clones go). A sample whose emulator is
killed by a signal (a stray `pkill wasm-vm` on a shared box) is recorded as discarded and retried
once. Per-sample console logs land in `OUT/logs/`.

## Browser suite (`bench-browser.mjs`)

Serves each root's `web/` from its own local HTTP server (own origin → no shared caches) with
`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (the worker
JIT needs cross-origin isolation; every sample asserts `crossOriginIsolated` and the page's
`data-jit-policy`: `enabled` for jit, `forced-off` for `?jit=0`). Each sample is a fresh Chromium
context; service workers are blocked. `/releases/*` falls back from `web/releases` to the checkout's
`releases/` (tracked snapshots) to `RELEASES` (chunked images). `/artifacts.json` is served *without*
its `bootSnapshot` entry so the busybox boot is a real cold boot instead of a snapshot restore; the
server logs every request, and a busybox sample that fetched any `*.snap*` / `boot-snapshot/` file
fails (as does a node sample that did not).

| case | what is timed (page `performance.now()`, host clock) |
|---|---|
| `busybox-jit` / `busybox-nojit` | (a) navigation start → the page's `wvm:guest-ready` event at the busybox prompt (includes page load, wasm compile, the page's fixed 400 ms autoboot delay, kernel fetch, boot); boot MIPS from the worker's `retiredInstructions` over the boot span and over time inside `runChunk`; (b) the same shell loop as the native compute case typed at that prompt, Enter → done marker (stamped inside the console callback), MIPS = retired-counter delta / region time, plus the JIT-retired fraction of the region |
| `node-jit` / `node-nojit` | (c) the shipped node-alpine snapshot restored (navigation → prompt), then `node -e '<3M-iteration Math.imul loop>'` typed and timed Enter → done marker; the script's checksum is verified. This is the first Node run after restore, so it includes Node startup and faulting Node in from the lazily fetched disk (~0.47G instructions in total) |

Flags: `--samples` (3, env `SAMPLES`), `--cases` (env `BROWSER_CASES`), `--compute-iters`,
`--releases`, `--chrome PATH` (default: Playwright's bundled Chromium from `web/node_modules`),
`--headless false`. Samples are interleaved across roots, order flipping every rep.

## Reading the numbers on a shared machine

Medians of interleaved samples cancel slow drift but not heavy oversubscription. Every sample records
the 1-minute load average (shown under each table); native samples also record CPU time (rusage for
whole-process cases, `proc_pid_rusage` deltas for timed regions), which is far less sensitive to
being descheduled than wall-clock. When load average exceeds the core count, trust ratios of CPU
seconds over ratios of wall seconds, and rerun on a quiet machine for the headline. The `paired`
figure in each speedup cell is the median of per-rep ratios (A and B adjacent in time) and is usually
the steadiest number in the table.
