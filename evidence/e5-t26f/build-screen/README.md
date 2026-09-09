# Whole-program WASM optimization screen — negative, non-acceptance

Frozen source: `8c892667be0da360af2329f2ae8bf7bf7ef6f10d`.
No candidate promotion or browser experiment is justified by this screen alone:
the reload-heavy benchmark regressed **23.32%**, while the early Linux-prefix
median decreased only **1.36%**, within the observed between-run spread. This is
not evidence that F's roughly five-second restored-desktop interaction can meet
its unchanged two-second cap. No F acceptance/status claim is made.

## Isolation and build

Owned scratch: `/private/tmp/e5-t26f-build-screen.h4HPPD`.
`source/` is a detached, clean local clone of the exact head above (shared Git
objects, separate checkout). `baseline-package/` archives the entire original
`web/pkg`, including snippets. `candidate-package/`, `cargo-target/`, and
`tool-cache/` are distinct scratch directories. The final [audit](audit.json)
compared every archived package file against its initial digest and the complete
live `web/pkg` against the archived baseline; all matched. No live source, served
package, dist, baseline ledger, task metadata, or branch was changed by this work.

The source release profile has Cargo's default `lto=false`, `codegen-units=16`,
`opt-level=3`; `.cargo/config.toml` adds `debug=2`. Candidate overrides only the
requested optimization settings while explicitly retaining opt3/debug2:

```sh
cd /private/tmp/e5-t26f-build-screen.h4HPPD/source
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS CARGO_BUILD_RUSTFLAGS
export CARGO_TARGET_DIR=/private/tmp/e5-t26f-build-screen.h4HPPD/cargo-target
export CARGO_PROFILE_RELEASE_LTO=fat
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
export CARGO_PROFILE_RELEASE_DEBUG=2
export CARGO_PROFILE_RELEASE_OPT_LEVEL=3
export CARGO_NET_OFFLINE=true
export WASM_PACK_CACHE=/private/tmp/e5-t26f-build-screen.h4HPPD/tool-cache
export PATH="$WASM_PACK_CACHE/wasm-bindgen-cargo-install-0.2.126:$WASM_PACK_CACHE/wasm-opt-50385c9e73ccee70/bin:$PATH"
wasm-pack --verbose build crates/wasm --target web --release --mode no-install \
  --out-dir /private/tmp/e5-t26f-build-screen.h4HPPD/candidate-package -- --locked
```

The [first build log](build.log) records successful Rust compilation followed by
`Operation not permitted (os error 1)` during packaging/tool installation. The
[successful retry](build-retry.log) reused that compilation and scratch copies of
the existing tools via PATH and `--mode no-install`. It **did run wasm-opt**;
neither `--no-opt` nor metadata disabling optimization was used. wasm-pack 0.15.0
uses its unchanged default release wasm-opt argument `-O`; Binaryen is version
117, the same local binary copied byte-for-byte into scratch. Toolchain:
rustc 1.96.0, wasm-bindgen 0.2.126, Node v24.20.0, Apple M4 Max/aarch64.
Full tool versions, package inventories, source/config hashes and tool hashes are
in [provenance.json](provenance.json) and [audit.json](audit.json).

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Baseline WASM | 1,545,383 | `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28` |
| Fat-LTO/codegen-1 WASM | 1,484,145 | `7780e9da58180d10c833c4f541d31b139be654fd747879fc13b4fc800463da43` |

## Actual exported benchmark

The scratch [harness](/private/tmp/e5-t26f-build-screen.h4HPPD/screen.mjs) imports
each full web package in a separate fresh Node process and initializes its actual
WASM bytes. It adds no APIs, browser globals, mocks, or altered guest code. After
one 5M-requested warmup, each process makes three `bench(20_000_000)` calls.

Important accounting limit: the existing `bench()` adds a constant 48 for each
ELF load/run; it does not itself assert the actual retirement count. A separate
`WasmMachine(1).loadElf(loops.elf); run(1000)` preflight in **each** process
returned `{kind:"exited",code:0,retired:48}`. Every measured benchmark result
reports **20,000,016** golden-accounted instructions; the warmup reports
5,000,016. This validates the pinned single-run golden, not every loop's internal
retirement. `bench()` measures with `Date.now()`; raw outer monotonic timings are
also retained.

| Arm | Three raw benchmark times (ms) | Median (ms) |
| --- | --- | ---: |
| [Baseline](bench-baseline-1.json) | 699, 700, 679 | 699 |
| [Candidate](bench-candidate-1.json) | 862, 867, 857 | 862 |

[Summary](bench-summary.json): candidate elapsed time is **23.319% higher**.
This interpreter/ELF-reload workload is not the restored desktop or its JIT path.

## Actual early Linux prefix

Six fresh processes ran in order baseline/candidate/candidate/baseline/baseline/
candidate, sequentially after the build finished. Main held off concurrent
browser/CPU-heavy work during measurement. Each constructed actual
`WasmLinux(256, kernel, emptyInitrd, "console=ttyS0 earlycon=sbi", output, false)`,
selected ICount, enabled JIT at 512 with default `repack-off`, enabled production
dynamic/static chaining, and called `runChunk` with at most 500,000 instructions.
The harness yields with Node `setImmediate` between chunks. The kernel SHA-256 is
`af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`.

| Arm | Three raw prefix times (ms) | Median (ms) |
| --- | --- | ---: |
| Baseline | [1619.981](linux-prefix-baseline-1.json), [1635.761](linux-prefix-baseline-4.json), [1650.874](linux-prefix-baseline-5.json) | 1635.761 |
| Candidate | [1613.479](linux-prefix-candidate-2.json), [1621.691](linux-prefix-candidate-3.json), [1605.856](linux-prefix-candidate-6.json) | 1613.479 |

[Summary](linux-summary.json): candidate median is **1.362% lower**, with
overlapping ranges. Every run completed 101 chunks and **exactly 50,000,000 actual
retirements**, summing the returned `runChunk().retired` deltas and using the
remaining budget for the final chunk. Every complete after-JIT scalar object,
clock object, RAM digest, and console output matched in the final read-only audit:

- `guestRetired=50000000`, `retiredViaJit=37586250`, `compiledBlocks=87`,
  `executedBlocks=969187`, `jitResidencyPolicy="repack-off"`, cap 24;
  dynamic and static chaining both true, entry-cost timing disabled.
- Guest `mtime`: decimal string `"0" → "5000000"`; ICount, timebase 10 MHz,
  clock divisor 10 in all six runs.
- RAM SHA-256: `b4deb22077826e86b444325f56d14ac8339886f57a4cfc77350a0ab63476f1f1`.
- Console: 5648 bytes, SHA-256
  `85bd4fd27a910f70f4eb903efce71ea49c38f9d19661d8649ba38f11dbafb8bf`.

These are fresh **no-disk/no-initrd early-kernel** prefixes, not completed boots,
resume workloads, or desktop interaction. Construction, initial WASM loading and
final digest collection are outside the prefix timing. Real entropy/RTC were not
replaced. `stateDigest()` is a RAM hash, not register/device equivalence. Matching
these observations does not establish full candidate correctness, and the small
timing difference is not extrapolated to F's cap.

## Retained commands and records

Completed commands: `bash build.sh` (successful retry), `node --check screen.mjs`,
`node --check retain.mjs`, `bash -n build.sh`, `node screen.mjs bench`,
`node screen.mjs linux`, and `node retain.mjs`. All eight measured child processes
exited 0. Each has its own raw result, `.process.json` command/PID context,
`.stdout.log`, and `.stderr.log`; aggregate transcripts are [bench-run.log](bench-run.log)
and [linux-run.log](linux-run.log). No workload was rerun after these results.

Evidence copies were created only after an exclusive new-directory check and use
non-overwriting copy operations. [artifact-sha256.json](artifact-sha256.json)
lists the copied record hashes. The full baseline/candidate packages, target
artifacts, exact checkout and apply-patch-authored scripts remain in scratch.
Script hashes (also in the audit):

```text
792c3e6a0a85e8ae86e8079e5156141c0d8c8a3a64eb5d5ad14d74dbcb571a70  build.sh
fbe7c1959403758e2530b9fc00275cbf2c67bd12d7fb01aee24ecbe27412df00  screen.mjs
383dd89b5cab2f7a96e6ae5ebd22e60202a7fc206738d549c6ee8a69dfc6eeeb  retain.mjs
```

**Disposition: negative screen; stop here.** No production change, promotion,
cold browser run, acceptance rerun, task/status update, or commit was performed.
