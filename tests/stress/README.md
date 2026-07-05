# Stress validation (E2-T24)

A scripted battery that beats on the native Alpine system hard enough to surface bugs polite
boots never find, plus a crash-consistency ("kill mid-write") gate and a reproducibility harness.

## Cost — read this first
A single Alpine/OpenRC boot is **~5–7 min** in the interpreter (the `boot_alpine` integration test
is `#[ignore]`d for the same reason). Everything here scales linearly with boots:

| Invocation | Boots | Wall time |
|---|---|---|
| `RUNS=1 tools/run-stress.sh` (default, per-PR smoke) | 1 | ~10 min |
| `RUNS=10 DD_MB=256 tools/run-stress.sh` (full nightly) | 10 | ~1.5–2 h |
| `KILLS=5 tests/stress/kill-inject.sh` (crash gate) | 10 (2/kill) | ~1–1.5 h |

So the full 10×/256 MB battery and the ≥5-kill gate are **nightly / manual CI jobs**, not per-PR.
The scripts are parameterized so the same code runs the fast smoke and the full torture.

## Pieces
- **`battery.exp`** — one boot → login → disk integrity (`dd` write + `md5sum` round-trip),
  parallel writers, a safe fork/exec process storm (+ opt-in recursive fork bomb via
  `STRESS_FORKBOMB=1`), interactivity latency under `dd` load, clean `sync`+`poweroff`. Emits
  `RESULT <name> PASS|FAIL` lines; exits non-zero on any failure. Env: `STRESS_DD_MB`,
  `STRESS_WRITERS`, `STRESS_FORKBOMB`, `STRESS_BOOT_TO`, `STRESS_IMG/KERNEL/BIN`.
- **`../../tools/run-stress.sh`** — entry point. Runs `battery.exp` `RUNS` times from a **pristine
  image copy each run**, writes `out/summary.json`, and (for `RUNS>1`) checks reproducibility:
  identical `RESULT` sets **and** byte-identical normalized transcripts (kernel timestamps and hex
  addresses stripped) across runs. Exit 0 iff all runs pass and results are reproducible.
- **`kill-inject.sh`** — the crash-consistency gate. Per iteration: boot, start a sustained
  parallel write load, `SIGKILL` the emulator at a deterministic (seeded) random point mid-write,
  then reboot the **same dirty image** and require recovery: reaches login, no `ext4 error` /
  `remount read-only` / `JBD2 Error` in dmesg, and `/` still mounted `rw ext4`. Env: `KILLS`,
  `KILL_MIN/MAX`, `SEED` (reproducible kill points).

## Running
```sh
cargo build --release -p wasm-vm-cli
bash tools/build-rootfs.sh                    # if releases/rootfs/alpine-rootfs.ext4 is absent
tools/run-stress.sh                           # 1× smoke (~10 min)
RUNS=10 DD_MB=256 FORKBOMB=1 tools/run-stress.sh   # full nightly (~2 h)
SEED=1 KILLS=5 tests/stress/kill-inject.sh    # crash gate (~1.5 h)
```

## Baseline
`baseline.json` records the smoke-scope results (per-run pass + echo latency) checked in for
regression comparison. Timings are interpreter-speed-dependent; the invariant that must hold
run-to-run is the **PASS/FAIL set and the normalized transcript**, not the absolute milliseconds.
