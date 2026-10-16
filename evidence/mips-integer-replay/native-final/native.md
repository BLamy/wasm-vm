# Native benchmark (2026-10-02T20:23:35+00:00)

Host: arm64 · Apple M4 Max · reps=5 (alpine/coremark reps=3, up to 1 concurrent) · medians · interleaved=True

- **baseline**: `/tmp/wasm-vm-mips-baseline/wasm-vm` rev `?` sha256 `b1e12a326477`
- **candidate**: `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/target/release/wasm-vm` rev `ee7ed352da` sha256 `48989812b5c1`

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-legacy | wall s | 5.82 [5.77–5.85] | 5.96 [5.95–6.05] | 0.98x (paired 0.98x) | 5/5 · 5/5 |
| busybox-legacy | MIPS (profile) | 56.2 [55.9–56.7] | 54.9 [54.0–54.9] | 0.98x (paired 0.98x) | 5/5 · 5/5 |
| busybox-legacy | cpu s | 5.81 [5.76–5.84] | 5.95 [5.95–6.05] | 0.98x (paired 0.98x) | 5/5 · 5/5 |
| busybox-fast | wall s | 3.41 [3.40–3.43] | 2.95 [2.93–2.98] | 1.15x (paired 1.15x) | 5/5 · 5/5 |
| busybox-fast | MIPS (profile) | 95.7 [95.2–96.1] | 110.5 [109.5–111.4] | 1.15x (paired 1.15x) | 5/5 · 5/5 |
| busybox-fast | cpu s | 3.40 [3.39–3.42] | 2.95 [2.92–2.97] | 1.15x (paired 1.15x) | 5/5 · 5/5 |
| compute-fast | region wall s | 2.33 [2.31–2.35] | 2.28 [2.26–2.28] | 1.02x (paired 1.02x) | 5/5 · 5/5 |
| compute-fast | region cpu s | 2.33 [2.31–2.34] | 2.28 [2.26–2.28] | 1.02x (paired 1.02x) | 5/5 · 5/5 |
| compute-fast | MIPS (icount est.) | 70.5 [69.9–71.0] | 72.0 [71.8–72.5] | 1.02x (paired 1.02x) | 5/5 · 5/5 |
| coremark-fast | region wall s | 20.63 [20.60–20.67] | 17.13 [17.01–17.20] | 1.20x (paired 1.20x) | 3/3 · 3/3 |
| coremark-fast | region cpu s | 20.61 [20.58–20.65] | 17.12 [17.00–17.19] | 1.20x (paired 1.20x) | 3/3 · 3/3 |
| coremark-fast | MIPS (icount est.) | 105.5 [105.3–105.6] | 127.1 [126.5–128.0] | 1.20x (paired 1.20x) | 3/3 · 3/3 |
| coremark-fast | CoreMark iterations/s (host clock) | 290.9 [290.3–291.2] | 350.3 [348.8–352.7] | 1.20x (paired 1.20x) | 3/3 · 3/3 |

Median 1-minute load average during the runs: busybox-legacy/baseline=4.4, busybox-legacy/candidate=4.6, busybox-fast/baseline=4.2, busybox-fast/candidate=4.3, compute-fast/baseline=4.1, compute-fast/candidate=4.6, coremark-fast/baseline=4.4, coremark-fast/candidate=4.7

Cells: median [min–max over reps]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back; alpine/coremark pairs ran side by side when concurrent).

wall s = host wall-clock of the whole process; cpu s = its user+sys rusage; MIPS (profile) = retired-at-marker / profiled wall; region wall s = host time from Enter to the done marker; region cpu s = emulator user+sys CPU inside that region; MIPS (icount est.) = guest-uptime delta x 1e8 / region wall (guest time is used only as an instruction counter, never as a clock).
