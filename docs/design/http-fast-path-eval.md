# E3-T18 HTTP fast-path evaluation

Status: evaluation in progress. This document fixes the decision rule before the 1 GiB run.
The spike is test-only: `web/http-fast-path-eval.js` is not imported by `web/main.js` or any
production module.

## Question and decision rule

The generic E3-T17 Tailscale TCP transport is the correctness baseline. This evaluation asks
whether either an allowlisted browser `fetch` path or a streaming HTTP/1.1 layer over the same
Tailscale `dialTCP` primitive is valuable enough to justify a separate implementation task.

The result is **adopt** only when all of these precommitted conditions hold:

1. The candidate completes three byte-exact 1 GiB runs, including a 250 ms stalled consumer,
   with no delivered chunk above the 256 KiB queue budget and less than 16 MiB incremental JS
   heap in every run.
2. Fixed-length, chunked/trickled, redirect, 404, HEAD/no-body, duplicate-header, and keep-alive
   behavior is explicit and passes the semantic suite. Request `Content-Length` or
   `Transfer-Encoding`, conflicting response framing, oversized headers, and HTTPS interception
   are rejected before forwarding.
3. Median throughput is at least 1.25 times the normal T17 TCP path and the candidate's p99
   inter-chunk gap is no worse than T17's. A browser-fetch result applies only to origins in the
   CORS matrix; it must never be described as general networking.
4. The measured path streams bytes directly. `io.ReadAll`, whole-body base64, a whole-response
   `ArrayBuffer`, or another body-sized allocation is an automatic reject regardless of speed.

A candidate that is correct and bounded but misses the performance threshold is **defer**. A
candidate that violates framing honesty, bounded streaming, or the routing boundary is
**reject**. Adoption files a new task; E3-T18 never changes the default transport.

## Threat and semantics model

An HTTP accelerator creates a parser boundary that ordinary Tailscale TCP does not have. The
spike therefore accepts only `GET` and `HEAD`, only after an explicit dev flag, and only for an
exact-origin allowlist. It forbids request body framing and validates header names and line
breaks before dialing. The Tailscale candidate supports cleartext HTTP only; HTTPS remains
opaque end-to-end TCP. Response parsing caps headers at 64 KiB and the pending/delivered queue at
256 KiB, preserves duplicate headers, and rejects `Content-Length` plus `Transfer-Encoding`,
conflicting lengths, folded headers, unsupported encodings, and malformed chunks.

Browser fetch uses `redirect: "manual"`, `credentials: "omit"`, `cache: "no-store"`, and an
awaited chunk consumer. These settings prevent cache asymmetry, ambient cookies, automatic
cross-origin redirect following, and an unbounded producer from being hidden by the benchmark.

## CORS matrix

| Case | Expected browser-fetch result | Scope represented |
|---|---|---|
| Same origin | Streams successfully | App-owned origin only |
| Cross-origin with `Access-Control-Allow-Origin: *` | Streams successfully | Explicit CORS-enabled origin |
| Cross-origin without CORS | Fetch rejects explicitly | Not general/public networking |
| Manual cross-origin redirect | Opaque redirect (`status 0`), no body | No implicit redirect expansion |
| Credential-bearing origin | Request succeeds without cookie | Deliberately anonymous fetch only |

The Playwright semantic suite runs this matrix in real Chromium with two loopback origins. The
live benchmark fixture also serves the exact same deterministic endpoint through a loopback
CORS listener and a Tailscale peer, eliminating endpoint and payload asymmetry.

## Benchmark protocol

- One Chromium page and one ephemeral browser Tailscale node per benchmark invocation.
- Three rotated orders: TCP/fetch/Tailscale-HTTP, fetch/Tailscale-HTTP/TCP, and
  Tailscale-HTTP/TCP/fetch.
- One deterministic body where byte `n` is `n & 255`; every byte is checked while streaming and
  never retained as a whole body.
- Default body is 1 GiB. Every run stalls the consumer for 250 ms after the first 256 KiB.
- Report elapsed throughput, p50/p99 inter-chunk gap, maximum delivered chunk, and incremental
  `performance.memory.usedJSHeapSize`. The same no-store endpoint serves all paths.

## Results

The final evidence table and decision are added only after the full recorded run. A 1 MiB smoke
run is used solely to validate the harness and is not decision evidence.
