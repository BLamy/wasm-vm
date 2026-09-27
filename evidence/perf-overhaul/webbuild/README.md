# Browser (wasm) build configuration — A/B evidence

**Decision:** ship the browser module with **real fat LTO, 16 codegen units, opt-level 3, wasm-opt `-O3`**,
built from the new cdylib-only crate `crates/wasm-web` with `[profile.wasm-release]`
(`make web-build` → `wasm-pack build crates/wasm-web --target web --profile wasm-release --out-name wasm_vm_wasm`).
Native stays on `[profile.release]` (fat LTO, codegen-units = 1). Result, full browser suite, 3 interleaved
samples: **1.02–1.05x faster than the pre-overhaul web build on every throughput metric**. The previous
overhaul web build (`lto-head`) was 0.96–1.02x.

## Why the overhaul's LTO build was not faster in the browser

The overhaul's LTO commit **never applied LTO to the wasm module**. `crates/wasm` is
`crate-type = ["cdylib", "rlib"]` (its wasm-bindgen integration tests link the rlib), and cargo does
not run LTO for a unit that also emits an rlib. `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown --release -v`
with `lto = "fat"` passes `-C codegen-units=1` and no `-C lto` to `wasm_vm_wasm`. With
`cargo rustc --crate-type cdylib`, the same profile passes `-C lto=fat`. There is also a direct check: with
16 codegen units, the `lto = false`, `"thin"` and `"fat"` wasm-pack builds come out the **same size**
(1,980,337 bytes). Only symbol-hash bytes differ.

So the only change the overhaul made to the web build was **codegen-units = 1**, plus wasm-opt `-O3`
instead of `-O`. With or without LTO, codegen-units = 1 makes V8 run about 2.5% more host instructions
and 1.5–3% more host cycles (tables below). That matches the 0.94–0.97x slowdown recorded in
`../bench-baseline/README.md`. wasm-opt `-O` vs `-O3` is within noise.

## Method

1. **Builds.** `scripts/build_raw.sh` runs wasm-pack (`--no-opt`) with `CARGO_PROFILE_RELEASE_*` env and
   rustflags, so it covers the configs as they were actually built (no LTO applied). `scripts/build_real.sh`
   runs `cargo rustc --crate-type cdylib` + the wasm-pack-cached wasm-bindgen 0.2.126, so LTO does run.
   `scripts/make_root.sh` applies a wasm-opt 117 flag set and makes a servable web root: the worktree's `web/`
   with only `pkg/` swapped.
2. **Screening (node, host CPU counters).** The machine was shared with other builds (load average 6–60), so
   wall-clock alone could not separate configs that differ by about 3%. `scripts/nodebench.mjs` boots busybox in node 24
   (V8) on the fast interpreter, for exactly 331,989,037 guest instructions (identical in every run, so the
   guest work is identical). `scripts/rurun.c` reads the whole node process's `proc_pid_rusage` v4
   `ri_instructions` / `ri_cycles`. Configs are interleaved and the order is reversed every rep (`scripts/nodescreen2.sh`), 3 reps
   each. Host instruction counts repeat to about 0.1%, and cycle medians to about 1%.
3. **Browser confirmation.** `tools/perf/bench-browser.mjs` (headless Chromium 131, COOP/COEP, host clock).
   First the busybox JIT and `?jit=0` cases for 4 finalists (`browser-screen/`). Then the **full suite** (busybox and
   node-alpine, JIT and `?jit=0`) for base, the old overhaul build and the chosen build (`browser-final/`).

Config names: `A` = no LTO, cu 16 (pre-overhaul). `B` = overhaul `[profile.release]` (in practice no LTO, cu 1).
`T` = `lto="thin"` via wasm-pack (not applied). `A1` = no LTO, cu 1. `F2` = B at opt-level 2. `As`/`A2` = A at
opt-level s/2. `*SIMD` = `+simd128`. `R*` = LTO really applied (`RFAT16` = fat, cu 16. `RFAT1` = fat, cu 1.
`RTHIN16`/`RTHIN1` = thin. `RFAT4`/`RFAT64` = cu 4/64. `RFAT16o2` = opt-level 2. `RCHK` = no LTO via the
`cargo rustc` pipeline, as a control). The suffix is the wasm-opt flags (`_O` = `-O`, the old default; `_raw` = no wasm-opt; `_O3c` =
`-O3 --converge`).

## Node screening (host cycles, median of 3; lower is better)

Full tables: `node-screen/screen{2,3,4}.txt` (raw JSONL alongside). Speedup is cycles(A_O) / cycles(cfg)
within the same run.

| config | what it is | Gcycles | Ginstr | vs A_O |
|---|---|---:|---:|---:|
| RFAT4_O3 | fat LTO, cu 4, -O3 | 75.11 | 444.1 | 1.044 |
| RFAT64_O3 | fat LTO, cu 64, -O3 | 75.46 | 444.3 | 1.039 |
| RFAT16o2_O3 | fat LTO, cu 16, opt-level 2, -O3 | 75.75 | 443.3 | 1.035 |
| **RFAT16_O3** | **fat LTO, cu 16, -O3 (chosen)** | 75.87 | 444.4 | 1.033 |
| RFAT16_O2 / _O / _O3c / _O4 | same, wasm-opt -O2 / -O / -O3 --converge / -O4 | 75.97 / 76.14 / 76.30 / 76.95 | ~444 | 1.032 / 1.030 / 1.027 / 1.019 |
| RFAT16SIMD_O3 | + simd128 | 76.07 | 442.9 | 1.031 |
| RFAT16_raw | fat LTO, no wasm-opt | 77.15 | 446.9 | 1.016 |
| A_O | pre-overhaul (no LTO, cu 16, -O) | 78.39 | 452.0 | 1.000 |
| B_O3 | overhaul head (no LTO in practice, cu 1, -O3) | 78.92 | 463.8 | 0.993 |

Screen 3 (a separate run: A_O = 77.04 Gcycles, 451.2 Ginstr):

| config | Gcycles | Ginstr | vs A_O |
|---|---:|---:|---:|
| RFAT16_O3 (fat, cu 16) | 74.82 | 444.1 | 1.030 |
| A_O3 / A2_O3 / RCHK_O3 (no LTO, cu 16) | 77.02 / 77.11 / 77.19 | ~451 | 1.000 / 0.999 / 0.998 |
| RTHIN16_O3 (real thin LTO, cu 16) | 77.48 | 449.9 | 0.994 |
| ASIMD_O3 | 77.83 | 450.0 | 0.990 |
| B_O3 | 78.20 | 462.7 | 0.985 |
| RFAT1_O (fat, cu 1, -O) | 78.33 | 457.3 | 0.984 |
| RTHIN1_O3 (thin, cu 1) | 78.94 | 460.6 | 0.976 |
| RFAT1_O3 (fat, cu 1) | 79.33 | 456.6 | 0.971 |
| As_O3 (opt-level "s") | 85.96 | 505.4 | 0.896 |

What the node screening shows:

- **Real fat LTO: about -3% cycles and -1.7% instructions**, with 4 to 64 codegen units (the differences among them are within about 1% noise).
- **codegen-units = 1 is worse**, with or without LTO: +1.5–3% cycles and +1–2.5% instructions. So the overhaul's
  web build was slower.
- Real thin LTO helps no more than no LTO. opt-level 2 is the same as 3. opt-level `s` costs 10%.
- Among wasm-opt settings, `-O3` is about as good as any, and `-O4` is slightly worse. Running no wasm-opt at all costs about 1.5%.
- `+simd128` gives nothing, since the interpreter is scalar. Rust 1.96's default wasm32 features already include
  bulk-memory, multivalue, mutable-globals, nontrapping-fptoint, reference-types and sign-ext. Tail-call
  changed only the target-features section (4 bytes) and was not pursued. We did not benchmark `-g` (keeping the name
  section): V8 does not use it for codegen, and it makes the file bigger (RFAT16 at `-O3 -g` is 1,779,746
  bytes, against 1,612,850 without `-g`, so +167 KB). It stays profiling-only
  (`[package.metadata.wasm-pack.profile.profiling]`).

## Browser, finalists (busybox, 5 samples, `browser-screen/`)

Paired speedup vs A_O (pre-overhaul config built from this branch):

| metric | B_O3 (overhaul head) | A_O3 | RFAT16_O3 |
|---|---:|---:|---:|
| JIT cold boot to prompt | 0.99x | 0.98x | **1.02x** |
| JIT shell loop | 0.99x | 0.99x | **1.05x** |
| `?jit=0` cold boot | 0.98x | 1.01x | **1.01x** |
| `?jit=0` shell loop | 0.98x | 1.00x | **1.03x** |

## Browser, full suite (3 samples, `browser-final/`)

`base` = the actual pre-overhaul `web/pkg` from `wasm-vm-base` (1.61 MB). `lto-head` = B_O3 (1.53 MB).
`wasm-release` = `make web-build` in this worktree at `6a5428f4` (wasm sha256 `43d1dae42a10…`, 1.61 MB).
All 36 samples ok. Load average 4–8.

| case / metric | base | lto-head | wasm-release | lto-head vs base (paired) | **wasm-release vs base (paired)** |
|---|---:|---:|---:|---:|---:|
| busybox JIT: cold boot to prompt | 12.85 s | 12.93 s | 12.30 s | 0.99x | **1.05x** |
| busybox JIT: boot MIPS | 28.8 | 28.5 | 30.1 | 0.99x | **1.04x** |
| busybox JIT: shell loop | 10.75 s | 10.54 s | 10.23 s | 1.02x | **1.05x** |
| busybox `?jit=0`: cold boot | 21.43 s | 22.12 s | 21.05 s | 0.96x | **1.02x** |
| busybox `?jit=0`: shell loop | 14.44 s | 14.88 s | 13.93 s | 0.97x | **1.04x** |
| node-alpine JIT: snapshot restore | 1.25 s | 1.25 s | 1.28 s | 1.00x | 0.98x (noise, ±0.05 s) |
| node-alpine JIT: `node -e` script | 33.94 s | 34.64 s | 32.77 s | 0.98x | **1.04x** |
| node-alpine `?jit=0`: snapshot restore | 1.27 s | 1.34 s | 1.28 s | 0.94x | 0.99x |
| node-alpine `?jit=0`: `node -e` script | 51.44 s | 53.56 s | 50.23 s | 0.98x | **1.02x** |

The gain is small (2–5%). A build flag cannot fix the real bottleneck: the fast interpreter spends about 1,300 host
instructions per guest instruction (`prof/node-fast-interpreter-self-time.txt`). `Machine::run` has 25% self
time, and **5% is `u128_div_rem` (a software 128-bit division inlined into `Machine::run`)**. Per-step device
`service` polls (virtio input/rng/snd/net/gpu/console) take about 9%. Those belong to the interpreter tracks.

## Size

`web/pkg/wasm_vm_wasm_bg.wasm` is 1,612,682 bytes, against 1,605,093 for base and 1,528,385 for lto-head. That is far below Cloudflare's
25 MiB per-file limit. The pkg's exported API (`wasm_vm_wasm.d.ts`) and the `snippets/` tree are the same as the
crates/wasm build's, except for the hash suffixes of wasm-bindgen closure shims.

## Reproduce

```sh
make web-build                      # the chosen config
RELEASES=/path/to/releases node tools/perf/bench-browser.mjs --root base=/path/to/base-root \
  --root wasm-release=. --samples 3 --out OUT
# screening: see scripts/ (paths point at the session scratch dir. Edit S= to rerun.)
```
