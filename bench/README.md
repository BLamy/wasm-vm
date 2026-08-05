# In-guest micro-benchmarks: CoreMark + Dhrystone (E4-T03)

Automated, reproducible CoreMark and Dhrystone runs *inside the guest* on the release wasm-vm:
boot → run → parse → emit JSON. This is the micro-benchmark half of the measurement backbone the
capstone's "≥10× CoreMark" threshold stands on, so the workload is **pinned** (fixed compiler,
flags, iteration counts, committed ELFs) — never `apk add`-ed at run time, where mirror drift would
silently change what we measure.

## Layout

```
bench/
  toolchain/        pinned Docker cross-toolchain (riscv64-linux GLIBC static gcc)
    Dockerfile        mirrors tools/toolchain/ (digest-pinned Ubuntu + exact apt versions)
    versions.env      the pins (base digest, gcc/glibc versions, build platform)
  guest/
    src/              vendored CoreMark + Dhrystone C sources (+ PROVENANCE.md sha256s)
    coremark.rv64     committed, statically-linked riscv64 ELF (built by build.sh)
    dhrystone.rv64    committed, statically-linked riscv64 ELF
    bench.ext4        committed reproducible ext4 overlay holding both ELFs
    SHA256SUMS        sha256 of the two ELFs (the anti-drift record the harness enforces)
    MANIFEST.txt      image digest, gcc version, flags, SOURCE_DATE_EPOCH
  build.sh            compile the ELFs reproducibly inside the pinned image
  mkimage.sh          pack the ELFs into bench.ext4 (reuses the rootfs mke2fs -d recipe)
tools/bench.py        the harness (boot + console-drive + parse + JSON)
```

## Running

```
python3 tools/bench.py run coremark  --engine native            # median-of-3, JSON to stdout
python3 tools/bench.py run dhrystone --engine native --runs 3 --json out.json
python3 tools/bench.py run boot      --engine native --runs 3    # macro bench: cold-boot wall clock
make bench-coremark          # convenience targets
make bench-dhrystone
```

The harness builds `target/release/wasm-vm` if absent (**never** benchmark the debug build — it is
~100× slower), boots the pinned kernel + Alpine rootfs, attaches `bench.ext4` as a second
virtio-blk drive (`/dev/vdb`), mounts it read-only, runs the ELF bracketed by unique per-run
sentinels, scrapes the score, and powers off. Each cold run takes **minutes** on the
instruction-stepped interpreter (a full Alpine boot dominates); `--runs 3` triples that.

## Run rules & noise expectations

- **CoreMark run rules** apply: the timed region is ≥ 10 s of guest time (iteration count tuned),
  and the harness rejects any run whose CRC self-check did not print `Correct operation validated`
  or whose `seedcrc` is not the standard performance-run `0xe9f5`.
- **Dhrystone** score is DMIPS = dhrystones/sec ÷ 1757 (VAX-11/780 reference). The harness
  validates the benchmark's own end-of-run integrity values (`Int_Glob==5`, …) before trusting it.
- **Spread:** the harness reports median-of-N plus `(max−min)/median` and sets `noise_warning`
  when that exceeds 5 %. In practice the spread is tiny (see the honest-time note below): the score
  is derived from guest-elapsed, which is a *deterministic function of retired instructions*, so it
  barely moves run-to-run.

## Honest emulator-time framing (why the timing check is a ratio, not 1:1)

The guest CLINT `mtime` advances from the **retired-instruction count** (`clock_div=10`, 10 MHz
timebase), not from host wall-clock. So the guest's `clock_gettime`/`time()` — and therefore
CoreMark's "Total time" and Dhrystone's elapsed — are a deterministic function of *instructions
executed*, decoupled from how fast the host actually ran them. This is by design (it is what makes
native and wasm agree instruction-for-instruction).

Consequently:

- The **score** (iterations/sec, DMIPS) is essentially host-speed-independent and highly
  reproducible — good for detecting a real ≥10 % codegen/interpreter change.
- A naive "guest-elapsed vs host-wall must match within 5 %" check would false-positive constantly.
  Instead the harness records `guest_elapsed_s`, `host_elapsed_s`, and their **ratio**, and flags
  deviation from a per-benchmark *baseline ratio* (`BASELINE_RATIO` in `tools/bench.py`).

**Tamper case (adversarial #2).** Suppose someone patches the guest (or the emulator's
`clock_div`) so `mtime` advances twice as fast — the guest then *reports* half the elapsed time and
the score doubles. Guest-elapsed halves while host wall-clock is unchanged, so the host/guest ratio
**doubles** and trips `RATIO_TOLERANCE_PCT` → `timing_check.flagged=true`. A silent 2× clock lie
cannot pass. Symmetrically, a throttled host (adversarial #3) raises host-wall-clock, moving the
ratio the other way — the harness reports the change rather than caching a stale number.

To set the baseline: run once on an idle reference machine, read `timing_check.ratio`, and put it in
`BASELINE_RATIO`. It is an anti-cheat signal only — it never alters the reported score.

## Reproducible builds (AC4)

```
bench/build.sh              # build the ELFs (builds the pinned image if absent)
bench/build.sh --no-cache   # from-scratch image rebuild, then compare SHA256SUMS
```

Byte-identical rebuilds come from: the digest-pinned Ubuntu base + exact apt gcc/glibc versions +
fixed build platform (amd64, regardless of host arch), plus `SOURCE_DATE_EPOCH`,
`-ffile-prefix-map` (no build-path leaks), `-g0`, and `strip`. The committed ELFs + `SHA256SUMS`
are the durable artifact; the image is how you reproduce them. `mkimage.sh` packs them into
`bench.ext4` with the reproducible `mke2fs -d` recipe (fixed UUID + hash seed, `E2FSPROGS_FAKE_TIME`,
`^metadata_csum`, normalized mtimes) borrowed from `tools/rootfs-inner.sh`.

The harness enforces the pins at run time: it refuses to run unless each ELF's sha256 matches
`SHA256SUMS` and `bench.ext4` exists (**adversarial #4** — a deleted/tampered overlay fails loudly
instead of silently benchmarking a different binary from the base rootfs).

## Boot macro benchmark (E4-T04)

`run boot` wall-clocks a cold boot with **byte-pattern-defined endpoints** (not eyeballed):

- **t0** = the genuine **first UART byte** written by the guest. This VM's SBI prints **no OpenSBI
  banner** (SBI impl ID `0x574d` = "WM"), so the first console output is the kernel's `earlycon`
  line — captured by `Console.wait_first_byte`, the engine-identical start endpoint.
- **t1** = the getty **`login:`** regex on the serial console. `boot_wall_s = t1 − t0`.

It boots with **no** second drive and `--profile-boot`, which halts the VM at the login marker (no
shell interaction / kill needed) and prints a `PROFILE_JSON {…}` line on stderr. Its `total_retired`
is recorded as **`boot_retired_instrs`** — the retired-instruction count *at* getty-login (median of
the runs). It is a **near-deterministic, host-noise-free anchor**: honestly it is **not bit-exact** —
it jitters ~0.2% because the profiler stamps the retired count in the console-feed quantum where
`login:` is first *seen*, a boundary not instruction-aligned to the exact login byte (the boot
execution itself is instruction-count deterministic by design). The harness asserts the anchor is
stable **within 1%** across runs; more movement would signal real nondeterminism. `boot_wall_s` is
the only host-noisy metric →
median-of-3 with the same `spread` / `noise_warning` reporting as the micro-benches. Schema fields:
`unit:"seconds"`, `higher_is_better:false`, plus `boot_retired_instrs`.

## Ledger — append-only, hash-chained baseline history (E4-T04)

`bench/ledger.json` accumulates every recorded baseline/measurement. It is **append-only** and
**tamper-evident** via a per-entry `prev_sha256` **hash chain**.

```
python3 tools/bench.py run boot --engine native --ledger --baseline level3-interpreter
python3 tools/bench.py record out.json --baseline level3-interpreter   # append an existing result
python3 tools/bench.py report                                          # per-bench history + speedup
python3 tools/bench.py report --bench boot                             # one bench
python3 tools/bench.py report --verify                                 # walk chain; nonzero on break
```

**Schema.** `{"schema_version": 1, "entries": [ … ]}`, written back with
`json.dumps(ledger, indent=2, sort_keys=True)`. Each entry:

```
{ bench, engine, score, unit, higher_is_better, spread,
  commit,            # emulator git HEAD at measurement time
  vm_build,          # "release"
  baseline,          # e.g. "level3-interpreter" (null for ad-hoc runs)
  config,            # the run's config block (flags, iterations, kernel/rootfs, …)
  date,              # ISO-8601 UTC
  prev_sha256 }      # sha256 of the PREVIOUS entry's canonical JSON (json.dumps(entry, sort_keys=True))
```

The first entry's `prev_sha256` is a fixed **genesis** constant (64 zeros). `record`/`run --ledger`
**never** reorder or rewrite existing entries — they only append. `report --verify` recomputes the
chain and validates the required keys, exiting nonzero on any break: **mutating one historical entry
breaks the next entry's `prev_sha256` link and is detected** (adversarial #4).

## Browser engine — reaping-deferred

`--engine browser` is intentionally **not** run here. The Alpine browser boot OS-reaps on the
development mac (see the E3 memory note "Browser Alpine boot reaped on mac"), so the browser path is
deferred to dev/nightly on a machine that can sustain the ~40-minute boot. The harness raises
`SystemExit` for `--engine browser` unless `--allow-browser` is passed. Phases 1–7 (the native
path) are fully headlessly verifiable on release.
