# Perf overhaul (2026-09)

The owner's complaints going in: everything too slow (~25 MIPS native, ~10–15 MIPS in the browser),
the JIT barely helping, and the Omarchy desktop not interactive. This overhaul attacked the
interpreter core, the JIT's coverage and per-call cost, the web build, and the Omarchy guest's
rendering behaviour. Every guest-visible claim is held to a byte-exact equivalence oracle.

## Results (host wall clock; baseline = `82978509`)

Full table: [`evidence/perf-overhaul/final/SUMMARY.md`](../../evidence/perf-overhaul/final/SUMMARY.md)
(`tools/perf/bench-all.sh`, Apple M4 Max, load avg ~3, headless Chromium 131).

| workload | baseline | now | speedup |
|---|---:|---:|---:|
| Native busybox boot, fast interpreter | 13.05 s | 3.39 s | **3.85x** (25 → 96 MIPS) |
| Native busybox boot, legacy interpreter | 35.16 s | 5.81 s | **6.05x** |
| Native Alpine ext4 boot to login | 175.9 s | 53.8 s | **3.27x** |
| Native CoreMark (6000 it) | 85.8 s | 20.9 s | **4.10x** |
| Browser busybox cold boot, JIT | 12.36 s | 4.73 s | **2.61x** |
| Browser busybox cold boot, `?jit=0` | 21.20 s | 5.33 s | **3.98x** |
| Browser shell loop, JIT / `?jit=0` | 10.26 / 14.29 s | 3.88 / 2.99 s | **2.65x / 4.78x** |
| Browser `node -e` compute, JIT | 32.9 s | 18.5 s | **1.78x** |
| Omarchy: typed command visible on screen (browser) | never within 900 s | 4.3–7.5 s | — |

The Omarchy row needs the responsive prepared pair (below) to be published; see
[`evidence/omarchy-responsive/README.md`](../../evidence/omarchy-responsive/README.md).

## What changed

- **Build** — `[profile.release]` fat LTO + `codegen-units = 1` for native. The browser module
  previously never got LTO at all: `crates/wasm` is `cdylib + rlib`, and cargo skips LTO for any
  unit that also emits an rlib. The new cdylib-only `crates/wasm-web` re-exports it and is built
  with `[profile.wasm-release]` (fat LTO, cu=16, `wasm-opt -O3`), chosen by an A/B screen of ~25
  configurations (`evidence/perf-overhaul/webbuild/`).
- **CSR** — the linear `Vec<(u16,u64)>` WARL store (satp read twice per memory access) became a
  dense slot array + presence bitmap with a byte-identical serializer; PMP decides accesses inside
  its lowest armed entry without the scan.
- **MMU** — a QEMU-style softmmu fast TLB (per access kind, 1024 direct-mapped entries holding
  `pa - va` for pages proven all-RAM and PMP-permitted) in front of the architectural TLB, as a
  strict cache of it (stamped slots), plus RAM-direct bus accessors. The architectural TLB indexed
  superpages by their aligned VPN, so every kernel 2 MiB/1 GiB entry landed in set 0; fixing that
  took busybox page walks from 1.84 M to 2 K and Alpine's from 52.7 M to 95 K.
- **Run loop** — O(1) mid-block cursor (the cursor holds the block), a tight replay loop with
  deferred retire accounting for pure integer ops, division-free clock, a quiescent-fabric fast
  path at boundaries (no device polling unless a device has work or MMIO touched a window),
  open-addressed discovery maps with per-block memoized decisions, second-chance block-cache
  eviction, and a code-page presence filter for store drains.
- **JIT** — every F/D op (inline bit ops; softfloat helpers for anything that rounds, so results are
  bit-identical), inline `fflags`/`frm`/`fcsr`, partial-block translation (compile up to the first
  unsupported op, resume the interpreter's cursor there so no sample point is added), a chain break
  after any device access, a native translation cache sized for wasmtime (it was 92% retranslation
  on Alpine), direct state marshalling into module memory, and a `--jit` coverage printout.
- **Omarchy** — measured, not guessed: the idle desktop kept the hart 100% busy because Quickshell's
  `omarchy.background` layer re-commits every frame (Hyprland damages the whole layer), and Foot's
  `ext-background-effect` object made every keystroke recomposite the full window. A responsive
  profile removes both, `LP_NUM_THREADS=0` fixes torn frames on virtio-gpu, and preparation injects
  one warm-up pointer click. `tools/image/prepare-omarchy-responsive-cold.mjs` builds a new prepared
  pair bound to the existing 4 GiB image.

## Correctness

`tools/perf/oracle.sh` boots busybox (legacy / block-cache / batched / native JIT) and Alpine from
ext4 (batched / JIT) with `--fixed-rtc-ns` pinning the only host-time input, and records a rolling
FNV of every retired instruction plus the final architectural-state SHA-256. The integrated branch
reproduces all six baseline digests byte-for-byte
([`evidence/perf-overhaul/final/oracle-digests`](../../evidence/perf-overhaul/final/oracle-digests)).
Snapshots written by the baseline binary resume identically on the new one, and shipped snapshot
CPU sections re-serialize byte-identically. Each track was checked by a separate adversarial
verifier (sabotage-checked regression tests were added for the fast-TLB SMC alias, partial-block
eviction, FS/frm transitions, quiescent-fabric unobservability and next_interrupt equivalence).

One intentional microarchitectural change: the larger architectural TLB keeps different stale
translations resident. A guest that edits a PTE without `SFENCE.VMA` may now see a stale mapping
where it previously re-walked — both behaviours are permitted by the privileged spec.

## Known gaps / follow-ups

- The **native** `--jit` is now slower than the fast interpreter (67 vs 96 MIPS on busybox): the
  wasmtime executor pays synchronous Cranelift compilation (~46% of the main thread on Alpine) and
  host-call loads/stores. In the **browser**, `?jit=0` also now beats the JIT on the integer shell
  loop (2.99 s vs 3.88 s) while the JIT still wins on boot and `node`. The next JIT round should be
  in-module chaining for native, inline RAM access, and cheaper JS-boundary entry in the browser.
- Browser JIT coverage is capped by the 256-module residency limit (cap-1024 gives ~25% more guest
  MIPS on Omarchy but compiles 57 MiB of code, over E4-T38's 32 MiB budget).
- The Omarchy responsive pair must be published (kernel `6.6.63-omarchy-evdev1024`, RAM snapshot to
  R2, overlay delta to Pages) before the live site benefits — commands in
  `evidence/omarchy-responsive/README.md`.
- Pre-existing macOS gate failures untouched by this work: `wvseccomp` does not build on macOS,
  `core_has_no_stdout_macros`, the `determinism` hazard scan (`Instant` in gpu/resources.rs), and the
  wasm leg of `make test-riscv` under `zicsr-stub`.
