# Independent frozen performance review

P8 is **HELD** for the scoped cached-integer throughput claim and the stated real
workload regression budget. This does not establish desktop interaction latency.
P9/P10 artifact/gate portions are held; P11 still awaits the publication handoff.
This is not the final task verdict.

The verifier read the harnesses and independently computed raw-record medians,
paired ratios, schedule order, guest work/accounting equality, input and binary
hashes using `verifier/audit-final.py`. This script does not import or run the
worker's analyzer. Its results are in `verifier/final-audit.json`.

## Repeated integer throughput

Both batches contain five alternating baseline/candidate pairs per configuration.
The native task case retires 8,000,000 instructions; the browser task case retires
4,000,000 after an identical 20,000-instruction warmup. Host `Instant` and
`performance.now` are the timing sources. Clocks, registers, RAM/CPU/CLINT state,
and instruction accounting are equal across each pair. All ten paired cached
ICount/64 samples improve on both targets.

| Batch | Target | Baseline MIPS | Candidate MIPS | Ratio of medians | Median paired ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Native cached, ICount/64 | 134.635 | 162.102 | 1.204010 | 1.204010 |
| 2 | Native cached, ICount/64 | 135.838 | 163.237 | 1.201703 | 1.201453 |
| 1 | Browser cached, ICount/64 | 88.780 | 97.288 | 1.095829 | 1.088679 |
| 2 | Browser cached, ICount/64 | 88.849 | 97.680 | 1.099390 | 1.099718 |

The other recorded controls are not omitted from the audit. Native cache-disabled
micro throughput is lower (0.979837x and 0.964486x). Browser JIT micro ratios are
0.990313x and 1.012388x, which do not show a repeated gain. Cache-disabled browser
ratios are also noisy, including disagreement between ratio-of-medians and paired
ratios. No broad JIT or uncached improvement is claimed.

## Real workloads

Native boot/shell cases have five alternating pairs; CoreMark has three. All ran
sequentially, use the same arguments/assets and fixed RTC, and reported success.
Boot instruction counts match exactly between native arms. Shell MIPS estimates
are derived from guest uptime, so acceptance uses measured host region time.

Browser cases each have five alternating pairs. Both use the whole-machine worker,
same JIT/interpreter policy and quantum, no snapshot requests, and successful boot
and shell completion. Browser RTC remains live `Date.now()` in both arms; these
runs are host-clock regression evidence, not fixed-RTC instruction-identical proof.
Separate native fixed-RTC oracle digests establish that deterministic claim.

| Target/case | Host metric | Baseline median | Candidate median | Speed ratio | Candidate time change |
| --- | --- | ---: | ---: | ---: | ---: |
| Native legacy boot | seconds | 5.822633 | 5.961981 | 0.976627 | +2.393% |
| Native cached boot | seconds | 3.408640 | 2.953404 | 1.154139 | -13.355% |
| Native cached shell loop | seconds | 2.328047 | 2.278918 | 1.021558 | -2.110% |
| Native cached CoreMark | seconds | 20.628240 | 17.127073 | 1.204423 | -16.973% |
| Browser JIT boot | milliseconds | 4694.310 | 4643.650 | 1.010910 | -1.079% |
| Browser JIT shell loop | milliseconds | 3597.230 | 3654.210 | 0.984407 | +1.584% |
| Browser no-JIT boot | milliseconds | 5009.710 | 4671.720 | 1.072348 | -6.747% |
| Browser no-JIT shell loop | milliseconds | 2843.145 | 2794.135 | 1.017540 | -1.724% |

The legacy native boot and median browser JIT shell results are slower. Both are
within the task's maximum 5% time regression; neither is called a gain. Browser
JIT shell paired median is 1.009069x, reinforcing that this small result is mixed.
All other headline raw and paired medians pass the same regression bound.

## Recorded console and artifact boundaries

The final browser timing inventory records 840 successful requests per arm and
empty non-favicon `notFound` arrays. The server records every missing local path
except a `favicon.ico` suffix (`tools/perf/bench-browser.mjs:178`). Each arm's first
JIT sample retains one generic 404 console message, and no other console errors
occur. Inference: these are the allowed favicon misses, based on this run's own
inventory; this is not a claim of literally zero console messages. The separate
built-demo suite records the exact `/favicon.ico` URL and zero unexpected errors.

The baseline wasm digest is exactly the parent commit's tracked artifact:
`f8b40d93039a9bb454250df40592e8c1d62144cac600bdcd82ea74098d7bb516`.
The candidate digest in both micro batches and real browser runs equals frozen
dist: `70de75fd1a2cfb6b51893773a394c0276189a1e54fe9a57dca1fbc47dea1f873`.
Actual native executable hashes equal their metadata, and baseline metadata maps
its retained binary to parent `a6ae84fd`. Every source/build digest in `frozen.json`
was independently recalculated. Later verifier-fixture/metadata commits did not
change either runtime source file.

Raw native logs independently recount 1,294 passes, one pre-existing stdout-hygiene
failure and 16 ignored tests across 248 summaries. All five files implicated by
that failure, macOS-only seccomp build failures and the determinism source scan
are byte-identical to the parent. Frozen acceptance records seven native and five
wasm tests passing, without ignored tests. Strict affected clippy and all six
feature-build combinations passed. `make ci` was attempted and its existing
platform failure remains explicit; it is not reported as green.
