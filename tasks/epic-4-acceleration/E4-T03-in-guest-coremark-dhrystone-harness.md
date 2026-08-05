---
id: E4-T03
epic: 4
title: Automated in-guest CoreMark and Dhrystone benchmark harness
priority: 403
status: partially-verified
depends_on: [E3]
estimate: M
capstone: false
---

## Goal
CoreMark and Dhrystone run *inside the guest* on demand, fully scripted end-to-end (boot →
run → parse score → emit JSON), reproducibly enough that a 10% performance change is
signal, not noise. This is the micro-benchmark half of the measurement backbone the whole
epic (and its capstone's "≥10x CoreMark") stands on.

## Context
The capstone threshold is defined against CoreMark; without an automated harness every
optimization task devolves into anecdotes. Benchmarks must be pinned binaries (fixed
compiler, flags, iteration counts) committed or reproducibly built — not `apk add`-ed at
run time, since mirror drift would silently change the workload. CoreMark's own run rules
(≥10 s runtime, reported iterations/sec) apply. Harness drives the native build directly
and the browser build via headless Chromium (Playwright or chromedriver), reusing the
Epic 3 boot automation.

## Deliverables
- `bench/guest/` with pinned riscv64 CoreMark and Dhrystone binaries (statically linked,
  `-O2`, build script + exact toolchain version recorded) baked into a small benchmark
  disk image/overlay.
- `tools/bench.py run coremark|dhrystone --engine native|browser`: boots the VM, executes
  the benchmark via serial console scripting, parses the score (iterations/s, DMIPS),
  runs 3 iterations, reports the median, and emits
  `{bench, score, runs, engine, commit, config, date}` JSON.
- Guest-side timing sanity: harness cross-checks guest-reported elapsed time against host
  wall clock and flags >5% disagreement (guards against guest clock lies inflating scores).
- README section in `bench/` documenting run rules and noise expectations.

## Acceptance criteria
- [ ] `tools/bench.py run coremark --engine native` completes unattended from a cold start
      and prints a JSON result; same for `--engine browser` in headless Chromium.
- [ ] Median-of-3 relative spread (max−min)/median ≤ 5% across two back-to-back invocations
      on an idle machine, for both engines.
- [ ] CoreMark run duration inside the guest is ≥ 10 s (iteration count tuned per rules).
- [ ] Rebuilding the guest binaries from the build script yields byte-identical ELFs
      (pinned toolchain container or checked-in binaries with recorded hashes).

## Adversarial verification
Refute by making the harness report a wrong or unstable number. Attack angles: (1) run the
harness 5 times and compute spread — >5% median spread on an idle host refutes the
reproducibility claim; (2) tamper check: patch the guest to report a fake elapsed time
(or artificially skew mtime) and confirm the host-wall-clock cross-check flags it — if a
2x guest-clock lie passes silently, refuted; (3) run with a deliberately throttled host
(e.g. `taskset`/low-power mode) and verify the harness reports the change rather than
caching stale results; (4) delete the benchmark overlay and rerun — the harness must fail
loudly, not silently benchmark a different binary from the base image.

## Verification log
- 2026-08-04 — **Design + phased plan.** Findings that reshape the premises:
  - **Docker is the repo's canonical reproducible-build path** (`tools/toolchain/`, `tools/build-rootfs.sh`
    + `tools/rootfs.Dockerfile`, `tools/build-initramfs.sh`, `tools/build-kernel.sh`), all pinned by Ubuntu
    digest. "No local cross-toolchain" is a non-issue — mirror that pattern.
  - The ticket's "~0.3-MIPS interpreter" is the DEBUG build; the **release** interpreter is ~27–35 MIPS
    (`docs/perf/level1-baseline.md`), so a ≥10s CoreMark run is practical — the harness MUST use
    `target/release/wasm-vm` (like `tools/boot-alpine.sh`). Never bench debug.
  - The existing `tools/toolchain` gcc is bare-metal **newlib** (wrong here); CoreMark/Dhrystone must be
    **riscv64-linux glibc/musl static ELFs** (Linux ABI, `clock_gettime`/`write`).
  - Console scripting reuses the boot CLI (`crates/cli/src/boot.rs` `--no-input` + stdin→UART); `bench.py`
    drives via the boot process's stdin/stdout — no emulator change (except possibly making `--drive` a
    `Vec` to attach the bench overlay as a 2nd drive — `boot.rs:44,527`).
  - Guest-vs-host timing check: honest framing — this is an instruction-stepped interpreter, so guest-
    elapsed vs host-wall diverge BY DESIGN; a 1:1 check would false-positive. Instead record both + their
    ratio and flag deviation from the baseline ratio (that's the real anti-cheat signal for adversarial #2).
  - **Phases:** (1) vendor CoreMark(EEMBC pinned)+Dhrystone source + PROVENANCE; (2) `bench/toolchain/`
    pinned Docker cross-gcc (mirror `tools/toolchain/`); (3) `bench/build.sh` → committed `coremark.rv64`/
    `dhrystone.rv64` + SHA256SUMS + MANIFEST (AC4 byte-identical via `SOURCE_DATE_EPOCH` + pinned apt);
    (4) `bench/mkimage.sh` → `bench.ext4` (reuse `tools/rootfs-inner.sh:204-253` mke2fs recipe) as a 2nd
    `--drive` (fails loudly if absent — adversarial #4); (5) `tools/bench.py run {coremark,dhrystone}
    --engine native` (median-of-3, CRC-validated parse, JSON schema `{bench,score,runs,engine,commit,
    config,date}`); (6) timing cross-check + tamper detection; (7) `bench/README.md` + Makefile target;
    (8) browser engine via Playwright — **reaping-deferred** to dev/nightly (Alpine browser boot OS-reaps
    here, see [[browser-alpine-boot-reaped-on-mac]]). Phases 1–7 are headlessly verifiable on release.
- 2026-08-04 — **Implemented (phases 1–7) + partially validated (commit `d49fec3`).** Delivered:
  `bench/guest/src/` vendored CoreMark(pinned)+Dhrystone+PROVENANCE; `bench/toolchain/` pinned Docker
  riscv64-linux glibc cross-gcc; `bench/build.sh` → committed static `-O2` `coremark.rv64`/`dhrystone.rv64`
  + `SHA256SUMS` + `MANIFEST`; `bench/mkimage.sh` → `bench.ext4`; `Machine::enable_virtio_blk_at` +
  `--drive Vec<String>` (2nd drive); `tools/bench.py run {coremark,dhrystone} --engine native` (CRC-
  validated parse, median-of-3, JSON + honest guest/host-ratio timing check); `bench/README.md` + Makefile
  targets. **Validated headlessly:** `shasum -c SHA256SUMS` OK for both ELFs; release CLI compiles + fmt
  clean; a native boot reaches virtio probe with BOTH drives — `virtio0 [vda] 768MiB` (rootfs) AND
  `virtio1 [vdb] 16MiB` (bench overlay) — so the multi-drive wiring is correct.
- 2026-08-05 — **DEBT CLEARED for the native Dhrystone path — and it turned up 3 REAL bugs (one in the
  emulator core), all fixed (commit `010446f`).** Insisting on a genuine score (no fabrication) exposed:
  (1) **CORE bug** — `Machine` serviced only a single virtio-blk (`self.blk`); the 2nd drive from
  `enable_virtio_blk_at` was attached but never serviced in the run loop, so the guest HUNG the instant it
  read `/dev/vdb` (boot froze right after the vdb probe — this is what looked like "machine load"). Fixed
  with an `extra_blk` list serviced at the same boundary (read-only → skipped by quiesce/snapshot). (2)
  harness mount path off by one dir (`/mnt` vs `/mnt/bench`). (3) `Console.expect` discarded the matched-
  and-earlier buffer so `run_text` was empty at parse time. **Now fully validated native-Dhrystone**
  (`evidence/e4-t03/dhrystone-native.json`): reproducible ELF (sha256 recorded) → boot with vda+vdb →
  login → mount → run → CRC-validated parse (`Int_Glob=5` ✓) → **189.717 DMIPS** (333333 dhry/s) → JSON.
  `timing_check` honestly reports the host/guest ratio (15.3× under load — score is guest-instruction-
  derived, so load-independent). AC1(native, dhrystone) ✓.
- **REMAINING (just needs CPU time on an idle box):** a CoreMark native run (AC3 ≥10s) and median-of-3
  (AC2 ≤5% spread) — each in-guest run is ~1.5 min guest but ~20+ min wall on THIS saturated machine
  (load 6, runaway `yes` procs); run on an idle machine / `dev`. Plus AC1(browser), the phase-8 reaping-
  deferred leg. The harness + the hard bugs are done; the rest is unattended runtime.
- **(superseded) VERIFICATION DEBT — the full boot-to-login score run is NOT yet achieved.** On THIS Mac the boot
  consistently reaches the virtio probe (~2.24s guest time) then goes quiet at the userland mount stage
  and the harness times out at `login:` (`BOOT_TIMEOUT=1200s`). Root cause here is **machine saturation**
  (load avg 6–10 on 8 cores, incl. two runaway 94%-CPU `yes` processes + many MCP/editor processes), so
  the release interpreter gets a sliver of CPU. NOT a fabricated score — no score is claimed. To close:
  run `python3 tools/bench.py run coremark --engine native` (and dhrystone) on an **idle** machine or the
  Linux `dev` box (which sustains full Alpine boots — see [[browser-alpine-boot-reaped-on-mac]]); that
  proves AC1(native)/AC2(≤5% spread)/AC3(≥10s). One open question a clean run also settles: whether the
  quiet-at-mount is purely load or a mount interaction with the RO 2nd drive (the standard single-drive
  Alpine boot reaches login normally, so a 2nd-drive interaction is possible but unconfirmed). AC1(browser)
  is the separately-deferred reaping leg (phase 8, stubbed).
