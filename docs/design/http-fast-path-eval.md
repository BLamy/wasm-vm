# E3-T18 HTTP fast-path evaluation

Status: complete — reject both transparent guest HTTP fast-path candidates.
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

The full run completed in Chromium in 1.8 hours. Every path transferred and validated exactly
1,073,741,824 bytes three times and completed the consumer stall. Raw evidence is in
`evidence/e3-t18/benchmark.json` (SHA-256
`a47da90dcf2914c7486fd961fe18d9d30288f5c6b38f914ff5a3d95a154669be`).

| Path | MiB/s, three runs | Median MiB/s | Median p99 gap | Max incremental JS heap |
|---|---:|---:|---:|---:|
| Normal T17 TCP | 1.126, 0.969, 0.875 | 0.969 | 40.850 ms | 124,000,000 B |
| Browser fetch | 283.461, 340.445, 282.811 | 283.461 | 1.985 ms | 0 B reported |
| Tailscale HTTP | 1.018, 0.927, 0.967 | 0.967 | 42.430 ms | 103,400,000 B |

The incremental-heap field is a coarse Chromium `performance.memory` observation, not total RSS.
It is useful as a rejection signal when it crosses the precommitted budget, but a reported zero
does not mean the browser allocated nothing. The queue itself remained capped at 256 KiB and all
delivered chunks respected that bound.

The same fixture's live semantic matrix is in `evidence/e3-t18/live-semantics.json` (SHA-256
`9f6480ea1aa2c384c47f63bceb7d71f88d85ce07128cb2873660c83b679ae5aa`). Both candidates returned
byte-exact fixed and trickled bodies, explicit 404s, and empty HEAD bodies. Tailscale HTTP exposed
the 302 and preserved two `X-E3-T18-Duplicate` fields. Browser fetch returned an opaque status 0
for the manual cross-origin redirect and its CORS-filtered `Headers` omitted the unexposed
duplicate header. Even when exposed, Fetch combines duplicate header values and does not expose
forbidden response headers such as `Set-Cookie`; it therefore cannot reconstruct a transparent
guest HTTP response.

## Decision

**Reject both candidates; keep normal E3-T17 TCP as the only guest networking path.**

- Browser fetch exceeds the throughput and measured-memory thresholds by a wide margin, but it
  fails the semantic-honesty condition. CORS blocks arbitrary origins, manual redirects become
  opaque, credentials are deliberately omitted, and response-header filtering/combining loses
  guest-visible protocol information. Its 292x same-machine speedup is valid only for an
  app-owned anonymous Fetch API, not transparent guest networking.
- Tailscale HTTP is semantically more faithful, but its 0.967 MiB/s median is effectively equal
  to T17's 0.969 MiB/s rather than 1.25x faster, its median p99 gap is slightly worse, and its
  maximum measured incremental heap exceeds the 16 MiB threshold by more than 6x. Adding an
  HTTP parser/smuggling surface for no transport benefit is unjustified.

No implementation task is filed because neither candidate is adopted. Reopen the decision only
if a browser API can expose raw ordered response headers and redirects without CORS distortion,
or if a Tailscale streaming HTTP primitive bypasses the current per-byte bridge and demonstrates
at least 1.25x T17 throughput under this exact 1 GiB protocol while staying below 16 MiB.
