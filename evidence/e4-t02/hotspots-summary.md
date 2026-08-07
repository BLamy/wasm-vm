# E4-T02 — native host-side hotspots (real capture)

Grounded in two real `samply` captures on this host (Apple M-series, macOS 26.2), profiling
build `target/profiling/wasm-vm` (`--profile profiling`, opt-level 3 + full DWARF). Symbolicated
with `atos` against the profiling binary. **No numbers here are templated — every % is a leaf
(self-time) sample share read out of the committed `*.samply.json.gz` profiles.**

## Reference profiles (committed)

| File | Workload | Samples | What it is |
|------|----------|--------:|------------|
| `boot-native.samply.json.gz` | headless Alpine boot, `--no-input --max-instrs 2_500_000_000` | 323,687 | bounded, console-free, fully repeatable |
| `boot-native.folded` | (same) | 168 stacks | folded stacks — feed to `inferno-flamegraph` for an SVG |
| `coremark-native.samply.json.gz` | full `bench.py run coremark` (boot → login → CoreMark) via the profiling binary | 690,089 | whole-run; CoreMark score **261.734 it/s == release baseline** |

Open either in the Firefox Profiler (`samply load <file>`) for the interactive flamegraph.

## Top host-side self-time (leaf) — boot workload

| % host | Function | Bucket |
|-------:|----------|--------|
| 24.1% | `Machine::sync_plic` | device/interrupt sync |
|  9.8% | `mmu::translate_cached` | address translation |
|  9.5% | `Machine::run_traced_inner` (self) | dispatch loop |
|  7.7% | `dev::plic::IrqLine::set` | device/interrupt sync |
|  7.1% | `Machine::sync_clint` | device/interrupt sync |
|  5.1% | `mmu::mode_params` | address translation |
|  4.9% | `decode::decode` | decode |
|  4.4% | `decode_c::expand_c` | decode (C-ext) |
|  4.4% | `csr::Csrs::satp` | address translation |
|  4.3% | `Machine::sync_sbi_timer` | device/interrupt sync |
|  3.9% | `csr::Csrs::next_interrupt` | device/interrupt sync |
|  3.6% | `hart::Hart::execute` | dispatch/execute |
|  3.1% | `pmp::Pmp::check` | address translation |
|  2.4% | `mmu::finish_leaf` | address translation |
|  1.5% | `dev::virtio::blk::service` | device I/O |

## Findings — the top-5 host costs, bucketed (feeds E4-T06)

Bucketing the leaf samples (boot; the CoreMark whole-run agrees within ~1 pt per row):

1. **Per-quantum device / interrupt synchronization ≈ 47%** —
   `sync_plic` (24%) + `IrqLine::set` (8%) + `sync_clint` (7%) + `sync_sbi_timer` (4%) +
   `next_interrupt` (4%). This is the single largest host cost and it is **loop-structural, not
   workload-specific**: `run_traced_inner` re-syncs the whole interrupt/timer fabric every
   I/O-service quantum, so it costs the same during CoreMark's tight compute loop as during boot
   (see cross-check below). **This is the #1 lever for E4-T06** — the win is *not* re-deriving PLIC
   state every quantum (dirty-gating / larger quantum / edge-driven IRQ), not faster dispatch.
2. **Address translation / memory path ≈ 24%** —
   `translate_cached` (10%) + `mode_params` (5%) + `satp` (4%) + `pmp::check` (3%) +
   `finish_leaf` (2%). The TLB-cached walk + PMP check on every guest access. A JIT inline-TLB
   fast path (E4-T11) attacks this directly.
3. **Interpreter dispatch + execute ≈ 13–23%** —
   `run_traced_inner` self (10%) + `Hart::execute` (4%); with decode folded in, ~22%. The classic
   "dispatch overhead" suspect is real but is *out-weighed by device-sync* on these workloads.
4. **Instruction decode ≈ 9%** — `decode::decode` (5%) + `decode_c::expand_c` (4%). Re-decoding
   every instruction every execution → the predecoded block cache (E4-T05) removes most of this.
5. **Device I/O (virtio-blk / uart / rtc) ≈ 3%** — real but minor; `blk::service` leads it.

The wasm-bindgen boundary does **not** appear in the *native* profile (there is no bindgen in the
CLI); it is a browser-only cost to be characterized from the DevTools/Firefox capture (deferred —
see the doc).

## Cross-check: is dispatch really only ~13–23%? (adversarial #3)

Windowing the CoreMark whole-run profile to its tail 12% (the compute region) barely moved the mix:
`sync_plic` 24.7%, dispatch self 11.1%, `translate_cached` 7.4% — i.e. device-sync stays dominant
even in pure guest compute. That *confirms* the device-sync cost is a fixed per-quantum tax rather
than a boot artifact, and bounds the true "dispatch-loop" share of CoreMark host time at ~20–23%.
So any E4-T06 claim that "dispatch is the bottleneck" is refuted by this capture: on the Level-3
interpreter, **per-quantum device synchronization is the bottleneck**, dispatch is second-order.
