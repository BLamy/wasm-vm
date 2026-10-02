# E5.5-T03bf worker evidence — October 2, 2026

The compact integer executor increases cached interpreter throughput while sharing
integer semantics with the general executor. The repeated measured gain is about
**20% native and 10% browser** for the cached integer loop. Real workloads show
smaller, workload-dependent gains; legacy execution and JIT shell results include
small regressions. This guide records worker evidence. Publication succeeded. A fresh verifier independently accepted the scoped claim
in commit `99a51c5b`; see [the final verdict](verifier/verdict.md) and
[publication audit](verifier/publication-audit.json).

## Identity and evidence map

- Parent: `a6ae84fd1c71c76ecadcff9000c40ed6319ef4b5` ([baseline.json](baseline.json)).
- Frozen runtime/acceptance checkout: `9123bc06cec84f4c581aa877b1126babff245a99`.
  [frozen.json](frozen.json) binds the source, fixture, dependency, native CLI and
  shipped wasm hashes. Later report heads include evidence/metadata commits;
  identify the tested implementation by these hashes, not the report head alone.
- Native candidate CLI SHA-256:
  `48989812b5c1207d121c3c68a9c6c463e879cba3c33041564c98c354e6f09a7a`.
  Candidate wasm SHA-256:
  `70de75fd1a2cfb6b51893773a394c0276189a1e54fe9a57dca1fbc47dea1f873`.
- [performance-acceptance.json](performance-acceptance.json) recalculates the
  medians and paired ratios from the final raw records. Its `passed` field applies
  to the performance criteria only. [final-benchmark-commands.json](final-benchmark-commands.json)
  preserves exact command arrays and exit codes.
- `screen-1/` and `browser-screen/` are preliminary exploration; use
  `micro-final-1/`, `micro-final-2/`, `native-final/` and `browser-final/` for claims.
- [gates/diagnostics.json](gates/diagnostics.json), [gates/SUMMARY.md](gates/SUMMARY.md)
  and their complete logs record successes and failures. Frozen acceptance is in
  [gates/frozen-acceptance.log](gates/frozen-acceptance.log); pristine-clone commands
  and results are in [cold-clone/receipt.json](cold-clone/receipt.json).

## Performance and limits

Host: Apple M4 Max, 16 CPUs; Rust 1.96.0; headless Chrome 154.0.8037.93.
Samples alternate baseline/candidate order. Speedup below is baseline median
host duration divided by candidate median host duration. The raw files retain
individual pairs, warmups, load averages and instruction counts.

| Cached integer loop, divider 64 | Baseline MIPS | Candidate MIPS | Throughput change |
|---|---:|---:|---:|
| Native, final batch 1 | 134.64 | 162.10 | +20.40% |
| Native, final batch 2 | 135.84 | 163.24 | +20.17% |
| Browser, final batch 1 | 88.78 | 97.29 | +9.58% |
| Browser, final batch 2 | 88.85 | 97.68 | +9.94% |

Each batch has five alternating pairs per configuration. Native times cover
8 million instructions; browser interpreter times cover 4 million. Divider 1
and 1024 controls also improve. Full state/counter comparisons are outside timing;
192-instruction canonical parent/candidate traces match. See the raw
[micro batch 1](micro-final-1/report.json) and [micro batch 2](micro-final-2/report.json).

| Real workload | Baseline seconds | Candidate seconds | Speedup |
|---|---:|---:|---:|
| Native BusyBox, cached/batched boot | 3.4086 | 2.9534 | 1.1541x |
| Native shell loop, cached/batched | 2.3280 | 2.2789 | 1.0216x |
| Native CoreMark, cached/batched | 20.6282 | 17.1271 | 1.2044x |
| Native BusyBox, legacy boot | 5.8226 | 5.9620 | 0.9766x |
| Browser BusyBox, interpreter boot | 5.0097 | 4.6717 | 1.0723x |
| Browser shell loop, interpreter | 2.8431 | 2.7941 | 1.0175x |
| Browser BusyBox, JIT boot | 4.6943 | 4.6437 | 1.0109x |
| Browser shell loop, JIT | 3.5972 | 3.6542 | 0.9844x |

Native CoreMark has three pairs; the other real workloads have five. Native
BusyBox profile MIPS increase from 95.70 to 110.53 in cached/batched mode.
CoreMark host iterations/second increase from 290.86 to 350.32. Shell/CoreMark
`mips_est` values use guest uptime only to estimate retired instructions; their
reported duration is host time. Prefer region duration and host iterations/second
for those workloads. See [native raw data](native-final/native.json) and
[browser raw data](browser-final/browser.json).

The slower results remain part of the claim: native legacy BusyBox takes **2.39%
longer**, and browser JIT shell takes **1.58% longer** by ratio of medians. The
latter's paired median is 1.0091x, so it does not establish a JIT speedup. Native
uncached integer throughput is 2.02% and 3.55% lower in the two micro batches;
browser JIT micro results range from 0.9903x to 1.0124x. No measured real-workload
median exceeds the task's 5% time-regression bound. These measurements do not
establish a desktop latency improvement.

Native workload timing pins RTC to `1790000000000000000` ns. Browser boot/shell
measurements use the normal live RTC and host `performance.now()`; retired counts
and boot work vary slightly across samples. They are host-timing comparisons,
not deterministic guest-equivalence evidence.

The final browser performance records retain two raw console errors, one on the
first `busybox-jit` navigation for each origin:
`Failed to load resource: the server responded with a status of 404 (Not Found)`.
Their URLs were not captured. The same run's server inventories have
`notFound: []`; the harness excludes only paths ending in `favicon.ico` from that
inventory. **Favicon attribution is therefore an inference**, not a captured URL.
Do not remove those errors or describe this performance run as error-free.
The separate [demo capture](demo-frozen/demo-suite.json) does capture its favicon
URL and records **127 passed, 0 failed**, the integer capability **54/54 live**,
zero unexpected errors, and [a screenshot](demo-frozen/demo-suite.png).

## Architectural equivalence and regression coverage

[oracle-parity.json](oracle-parity.json) records six byte-identical parent/candidate
fixed-RTC evidence files. Every pair has the same final state SHA-256 and outcome
`MaxInstrs`; compare each mode to its own parent, since batching changes sampling.

| Fixed-RTC pair | Retired instructions | Evidence mode |
|---|---:|---|
| BusyBox legacy | 399,973,130 | Retirement-record FNV + final state |
| BusyBox cache | 399,973,130 | Retirement-record FNV + final state |
| BusyBox cache/batching | 399,972,858 | Retirement-record FNV + final state |
| BusyBox JIT | 399,972,858 | Retired counter + final state only |
| Alpine cache/batching | 1,999,855,301 | Retirement-record FNV + final state |
| Alpine JIT | 1,999,855,301 | Retired counter + final state only |

The JIT `fnv64=cbf29ce484222325` is the empty FNV seed: it is **not** a per-instruction
JIT trace. Four interpreter pairs supply retirement-trace digests; two JIT pairs
supply counter/state equality. The oracle script tolerates process exit statuses,
so the evidence is the present, matching digest contents, not merely script exit 0.
Full console logs and digest files remain under `oracle-baseline/` and `oracle-candidate/`.

The shared native/wasm fixture checks 43 opcodes and 25 edge cases against literal
arithmetic expectations. Both first-op and prefixed interior-op variants expose
an observable destination value; thus every deferred integer result is checked
with and without tracing. It also covers x0, sliced budgets, division edge cases,
compressed lengths, traps, reservations, code replacement and wrapping virtual PC.
Canonical fixtures are in `guest/`; `.states` entries hash
`serialized_hart || SHA256(RAM)`, covering FP state, CSRs and reservations.
[gates/integer-replay-parity.json](gates/integer-replay-parity.json) binds all six
native/wasm digest groups and 12 exported artifacts. Frozen acceptance passed
**7 native tests** (including two independent alias attacks) and **5 actual wasm32
tests**. The pristine clone at `9123bc06` passed format and the original five-native /
five-wasm acceptance target with `RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and
`CARGO_*` scrubbed. The two subsequently promoted alias/wrap tests ran in the
fresh verifier checkout and again in the final seven-native acceptance run.

Broad affected native suites completed with **1,294 passed, 1 pre-existing failure,
16 ignored**, across 248 binary/doc summaries. The failure is
`core_has_no_stdout_macros`, which finds unchanged macros in test/GPU files.
Strict affected-crate clippy, format, six native/wasm feature builds and the
no-host-float scan passed. `make ci` stopped on unchanged Linux-only `wvseccomp`
clippy/build errors on macOS; the determinism-hazards scan also reports existing
GPU-test host-time calls. The affected files are byte-identical to the parent.
Therefore the full local gauntlet did **not** pass. Broad binaries preceded the
final fixture correction; frozen acceptance and the cold clone cover that
correction, and recorded production source hashes match the frozen runtime.

## Reproduction

Run from the repository root with the recorded toolchain and release assets.
The original absolute invocations are in `final-benchmark-commands.json`; these
commands use a fresh output directory to preserve the submitted recordings.
The preserved `/tmp/wasm-vm-mips-baseline` must contain the parent CLI, core rlib,
wasm package and `baseline.json` with the recorded hashes. The browser baseline
checkout must remain at `a6ae84fd`. Do not silently replace missing baseline
artifacts with candidate builds.

```sh
repro="$PWD/target/mips-integer-reproduction"
mkdir -p "$repro"
INTEGER_REPLAY_EVIDENCE_DIR="$repro/guest" make verify-E5.5-T03bf
cargo fmt --all --check
cargo clippy -p wasm-vm-core -p wasm-vm-jit-runtime -p wasm-vm-jit-translate -p wasm-vm-wasm --all-targets -- -D warnings
cargo test -p wasm-vm-core -p wasm-vm-jit-runtime -p wasm-vm-jit-translate -p wasm-vm-wasm --no-fail-fast
make features
bash tools/ci/no-host-float.sh
bash tools/ci/determinism-hazards.sh
make ci
```

Expected platform/hygiene failures are described above. For another pristine
proof, use `bash tools/verify/cold_clone.sh --keep verify-E5.5-T03bf` from a checkout
of the frozen commit; the recorded clone's exact command arrays are in its receipt.
`INTEGER_REPLAY_EVIDENCE_DIR` must be absolute because Cargo tests run in the crate
directory.

```sh
node tools/verify/clock-fast-path-benchmark.mjs "$repro/micro-1" /tmp/wasm-vm-mips-baseline
node tools/verify/clock-fast-path-benchmark.mjs "$repro/micro-2" /tmp/wasm-vm-mips-baseline
python3 tools/perf/bench_native.py --out "$repro/native" \
  --bin baseline=/tmp/wasm-vm-mips-baseline/wasm-vm \
  --bin "candidate=$PWD/target/release/wasm-vm" \
  --cases busybox-legacy,busybox-fast,compute-fast,coremark-fast \
  --reps 5 --slow-reps 3 --slow-parallel 1
node tools/perf/bench-browser.mjs \
  --root baseline=/Users/blamy/.codex/worktrees/emulator-speed-next/wasm-vm \
  --root "candidate=$PWD" --out "$repro/browser" --samples 5 \
  --cases busybox-jit,busybox-nojit \
  --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
RELEASES=/Users/blamy/Documents/Codex/wasm-vm/releases \
  bash tools/perf/oracle.sh /tmp/wasm-vm-mips-baseline/wasm-vm "$repro/oracle-baseline"
RELEASES=/Users/blamy/Documents/Codex/wasm-vm/releases \
  bash tools/perf/oracle.sh target/release/wasm-vm "$repro/oracle-candidate"
diff -ru "$repro/oracle-baseline/digests" "$repro/oracle-candidate/digests"
```

Keep performance samples separate from builds, tests and the concurrent oracle
boots. New runs should report their own artifact hashes and raw errors. Publishing
and the verifier verdict are tracked in the task's Verification log; neither is
implied by the performance acceptance JSON or this worker guide.


## Publication receipt

`bash tools/deploy-cloudflare.sh` published deployment
<https://32d61ee9.wasm-vm.pages.dev> to <https://wasm-vm.pages.dev> after exact
local and public R2 artifact checks. [deploy-worker.log](deploy-worker.log) records
the command output; [live-worker-artifacts.json](live-worker-artifacts.json)
confirms the live wasm, roadmap and task inventory match the tested dist.
The [live capture](demo-live-worker/demo-suite.json) passes **127/127**, shows
**67/67 I+M cases live** for the capability, and has zero unexpected console or
HTTP errors. Its favicon 404 is explicitly URL-attributed and retained. The
[screenshot](demo-live-worker/demo-suite.png) records the page. The live task still
shows the worker's in-progress state from the first runtime publication; a final
metadata publication follows the verifier verdict.
