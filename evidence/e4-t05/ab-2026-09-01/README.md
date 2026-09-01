# E4-T05 AC1 — CoreMark host wall-clock A/B, 2026-09-01 (verification-debt payoff)

Worker checkpoint measurement of the predecoded-block-cache + interrupt-batching uplift
(AC1 ≥ 1.3x), rerun locally per the 2026-09-01 policy update (rr waived, everything on this
Mac). Methodology follows the repo's own bench doctrine (bench/README.md): interleaved A/B,
median-of-5 per arm, ratios not absolutes.

- Machine: Apple M4 Max, 16 cores, 128 GB RAM, macOS 26.6.2 (25G83), rustc 1.96.0.
- Commit: (see summary.json — `git rev-parse HEAD` at measurement time; working tree clean
  for these runs except unrelated untracked evidence dirs).
- Binary: `target/release/wasm-vm` built at that commit (`cargo build --release -p wasm-vm-cli`).
- Harness: `tools/bench.py run coremark --engine native --runs 1 --json <sample>.json`,
  invoked 5x per arm, strictly alternating cache-OFF / cache+batching-ON, sequential, idle
  machine. The ON arm passes the E4-T05 flags through the harness's own passthrough:
  `WASM_VM_BOOT_EXTRA="--block-cache --interrupt-batching"`.
- Workload: the pinned CoreMark ELF (bench/guest/coremark.rv64,
  sha256 4db593b8110e588b4fba7e526d3b838365cc5ad50ae6cd1592be2dc483a08937, verified by the
  harness against the committed SHA256SUMS), 6000 iterations, 256 MiB guest RAM.
- Rootfs provenance (NOTE): `releases/rootfs/alpine-rootfs.ext4` is not committed and was
  absent on this machine; it was reassembled from the production R2 chunked base
  (`chunked-alpine`, 128 KiB content-addressed chunks, every chunk sha256-verified, whole
  image sha256 dfdb7b7ce950d8ff85489a27ce5313583d7ce555809eb3c1ea74f5ea50f78302,
  805306368 bytes, ext4 UUID a11ce000-0e2f-4c18-b007-f50000000018 = the pinned
  tools/build-rootfs.sh UUID). This differs from the sha pinned in web/artifacts-alpine.json
  (f1b544d4…, taken from a later local file state that was never uploaded whole); both arms
  of the A/B boot the SAME image, and the measured region is the sha-pinned CoreMark binary,
  so the ratio is unaffected.
- The guest CoreMark score is instruction-count-derived (guest mtime = retired
  instructions/10), so it is identical across configs (~261.6-261.7 it/s); the emulator
  uplift is the HOST wall-clock ratio of the sentinel-bracketed benchmark region
  (`timing_check.host_elapsed_s` in each sample JSON).

Files: `coremark-cacheoff-s[1-5].json`, `coremark-cache-batched-s[1-5].json` (raw harness
output per sample), `summary.json` (all samples, medians, computed uplift).
