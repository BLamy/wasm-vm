# Read the measurements

The homepage publishes two independent Node workload campaigns and a separate native JIT handoff diagnostic. Preserve that separation when comparing a result or proposing an optimization.

## System workloads

`web/bench-runtime-workloads.mjs` measures file read, file write, stream read, stream copy, server lifecycle, and local HTTP round trips. The recorded policy uses seven measured samples, two warmups, a 1 MiB payload, 64 KiB stream chunks, and eight HTTP requests per sample.

Each measured sample verifies its output digest. File-write timing does not include `fsync`. A cell carries median, p95, and throughput where bytes were transferred; runtimes can have different storage and network isolation.

[Raw system comparison](./runtime-benchmarks.json) preserves runtime identity, the runner digest, fixtures, policy, individual samples, and unsupported or unmeasured reasons. almostnode's unsupported stream/HTTP cells and WebVM's failed bounded capture remain visible.

## Steady-state compute

`web/bench-runtime-compute.mjs` keeps one process alive and times deterministic integer, branch, and typed-array loops. Process startup, module loading, and memory reset are outside the timed region. Every warmup and measured sample must match a fixed checksum.

[Raw compute comparison](./runtime-compute-benchmarks.json) retains the publication scope. The main-thread control run is unmeasured because its browser interaction logged a re-entrant `WasmMachine` error, even though its samples had valid checksums.

## Native JIT diagnostic

The six-op loop tests dispatch-bound behavior; the 64-op loop tests hot-block amortization. Their release-only native MIPS results remain separate from comparable browser measurements. A high hot-loop rate cannot establish a complete guest application rate, file I/O speed, or GUI budget.

{% expandable title="Reproduce a small native capture" %}
```sh title="System workload pre-check"
node web/bench-runtime-workloads.mjs \
  --environment=native-node --samples=7 --warmups=2 \
  --payload-kib=1024 --http-requests=8 \
  --output=/tmp/native-runtime-workloads.json
```

```sh title="Compute pre-check"
node web/bench-runtime-compute.mjs \
  --environment=native-node --samples=7 --warmups=2 \
  --output=/tmp/native-runtime-compute.json
```

A new native capture is a new result. It does not refresh the older browser campaign by inference.
{% endexpandable %}

## Detailed investigations

The reference library preserves dated interpreter baselines, presentation-path measurements, flamegraphs, JIT register handoff, and the E4-T34 retrospective. Their numbers belong to the host, revision, workload, and mode recorded in each document.

- [Benchmark harness](./docs.html?page=reference-tools-perf-readme)
- [In-guest microbenchmarks](./docs.html?page=reference-bench-readme)
- [JIT register handoff](./docs.html?page=reference-docs-perf-jit-register-handoff-2026-10)
- [JIT retrospective](./docs.html?page=reference-docs-perf-e4-t34-jit-retrospective)
