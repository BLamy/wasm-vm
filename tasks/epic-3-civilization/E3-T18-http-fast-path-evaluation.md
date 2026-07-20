---
id: E3-T18
epic: 3
title: Optional browser HTTP fast-path evaluation after Tailscale
priority: 318
status: implemented
depends_on: [E3-T17]
estimate: S
capstone: false
---

## Goal
A measured go/no-go decision on an HTTP-specific guest fast path after the generic Tailscale
and relay transports work. Compare browser `fetch`, a streaming Tailscale HTTP API, and the
normal guest TCP path; integrate nothing unless it is streaming, bounded, semantically honest,
and materially better. This task is optional optimization, not an `apk add` or capstone gate.

## Context
The retired T17 design terminated port-80 guest TCP in slirp, parsed HTTP/1.1, replayed it
through browser `fetch`, and reconstructed the response. That adds an HTTP parser/smuggling
surface, is CORS-bound for arbitrary public origins, and cannot carry TLS or non-HTTP protocols.
T17 now supplies general TCP/UDP through a browser Tailscale node, removing the correctness
need for interception. There may still be a useful same-origin/CORS-enabled fast path, or a
Tailscale `ipn.fetch` path that avoids per-byte stream bridging, but the current almostnode Go
bridge uses `io.ReadAll` and base64 and therefore fails the memory/backpressure bar.

Evaluate three paths on the same page and endpoint: normal T17 TCP, same-origin browser fetch,
and a prototype streaming Tailscale HTTP response if the underlying bridge can expose chunks.
Keep routing explicit and per-host; HTTPS must always remain opaque end-to-end TCP unless the
operator deliberately enables interception. WebTransport is deferred: Tailscale plus the T16
WebSocket fallback cover production transports, and a future performance result may file a
fresh WebTransport task with objective trigger conditions.

## Deliverables
- `docs/design/http-fast-path-eval.md`: threat/semantics analysis, CORS matrix, benchmark and
  memory tables, and an unambiguous adopt/defer/reject decision with trigger conditions.
- A non-production spike behind a dev flag, using a strict routing allowlist and streaming
  response chunks; no whole-body buffering or base64 expansion in the measured path.
- Same-machine comparison against T17 for fixed-length, chunked/trickled, redirect, 404,
  keep-alive, and a 1 GiB body, with throughput, p50/p99 latency, and peak memory.
- If adopted, a separately filed implementation task. This evaluation itself does not change
  the shipped default transport or become a dependency of E3-T20/E3-T28.

## Acceptance criteria
- [ ] The 1 GiB case is byte-exact and peak incremental memory stays below the documented
      bounded queue budget; any `io.ReadAll`, whole-body base64, or equivalent buffering in the
      candidate path is an automatic reject.
- [ ] The CORS matrix includes same-origin, permissive CORS, blocked public origin, redirects,
      and credentials; failures are explicit and never represented as general networking.
- [ ] HTTP framing semantics are checked for chunked/trickled bodies, 3xx, HEAD/no-body status,
      duplicate headers, and keep-alive. Ambiguous request framing is rejected before forwarding.
- [ ] Benchmark results include at least three runs per path and show the candidate's benefit
      against T17; “adopt” requires a stated, precommitted threshold and must meet it.
- [ ] With the dev flag off, browser behavior, bundle loading, CSP, and T17/T16 E2E evidence are
      unchanged; E3-T20 has no dependency on this task.

## Adversarial verification
Try to make the evaluator bless a vacuous optimization: inspect the implementation for hidden
whole-body buffers, warm-cache asymmetry, a local endpoint used only by the candidate, or CORS
conditions that do not match deployment. Fuzz request framing with Content-Length/Transfer-
Encoding conflicts and oversized headers; any ambiguous forwarded request refutes adoption.
Stall the guest reader during a 1 GiB response and inspect memory/backpressure. Disable the
candidate and prove all capstone networking still works through T17/T16. Reproduce the benchmark
from the doc; >2x unexplained deviation or a decision that ignores its declared threshold refutes.

## Verification log

### 2026-07-17 — planning rewrite
Replaces the WebTransport spike and the former E3-T17 fetch gateway as a deliberately optional
post-Tailscale evaluation. It is no longer on the Level 3 capstone dependency chain.

### 2026-07-20 — worker — implemented

Implementation head `8bce08b`. **Decision: reject both candidates and keep normal E3-T17 TCP.**
The opt-in spike is not imported by the shipped demo. Three rotated runs per path transferred and
validated exactly 1 GiB each with a 250 ms stalled consumer and a 256 KiB queue. Browser fetch was
fast (283.461 MiB/s median versus T17's 0.969 MiB/s) but failed transparent semantics: CORS hid the
duplicate response header and a manual cross-origin redirect became opaque status 0. Streaming
Tailscale HTTP preserved duplicate headers and redirect status but achieved only 0.967 MiB/s,
had a worse 42.430 ms median p99 gap, and reached 103,400,000 bytes measured incremental heap,
exceeding the precommitted 16 MiB limit. No implementation task was filed.

Evidence:

- `evidence/e3-t18/benchmark.json`, SHA-256
  `a47da90dcf2914c7486fd961fe18d9d30288f5c6b38f914ff5a3d95a154669be` — nine byte-exact
  1 GiB runs; Playwright passed in 1.8 hours.
- `evidence/e3-t18/live-semantics.json`, SHA-256
  `9f6480ea1aa2c384c47f63bceb7d71f88d85ce07128cb2873660c83b679ae5aa` — live fixed,
  trickled, redirect, 404, HEAD, duplicate-header, and keep-alive behavior through the same
  loopback/tailnet fixture.
- `evidence/e3-t17/browser-demo-126-of-126.png` — rebuilt demo at this head: 126 passed,
  0 failed, four E3-T17 roadmap capabilities verified, zero console errors.

Commands and gates:

- `cargo fmt --check` and `cargo clippy -- -D warnings` — pass.
- `cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors` — all
  runnable workspace tests pass. The excluded pre-existing test cannot complete on this Mac:
  its deliberate `abort()` children remain in kernel `UE` crash-reporting state, including
  multiple orphan processes predating this task; disabling core dumps did not change that host
  behavior. All native socket tests passed with loopback permissions.
- `cargo build -p wasm-vm-core --no-default-features --target wasm32-unknown-unknown` and
  `wasm-pack build crates/wasm --target web` — pass. The unscoped workspace wasm build is not the
  repository's supported command because CLI-only `getrandom` lacks its JS feature.
- `make web-build` — pass.
- `npx playwright test tests/e3-t18-http-fast-path.spec.js tests/e3-t18-http-benchmark.spec.js
  --reporter=line` without live credentials — 5 passed, live benchmark skipped as designed.
- Live 1 MiB semantic/transport rerun with ephemeral Headscale credentials — 1 passed in 15.3 s.
- `E3_T17_DEMO=1 npx playwright test tests/e3-t17-demo-proof.spec.js --reporter=line` — pass,
  126/0 and zero console errors.
