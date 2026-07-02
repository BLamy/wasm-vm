---
id: E3-T17
epic: 3
title: Fetch-based HTTP gateway transport for plain-HTTP guest flows
priority: 317
status: pending
depends_on: [E3-T14]
estimate: M
capstone: false
---

## Goal
A relay-free transport for the traffic that doesn't need one: guest TCP flows to port 80 are
terminated in slirp, parsed as HTTP/1.1, replayed via browser `fetch()`, and the response is
re-serialized to the guest. Where CORS permits, the VM reaches HTTP endpoints with zero
server infrastructure — and the task documents precisely where CORS does not permit.

## Context
Be honest about the physics: browser `fetch` is CORS-bound, so an arbitrary origin (e.g.
`dl-cdn.alpinelinux.org`, which sends no `Access-Control-Allow-Origin`) is unreachable this
way — those flows must route via T16's relay or a same-origin mirror. This transport still
earns its keep: same-origin resources, CORS-enabled APIs, and any operator-provided mirror
work with no proxy dependency. Implementation: an `HttpInterceptor` in slirp claims flows to
port 80 (config: intercept list / fallthrough to the default connector), parses the request
(status line, headers, Content-Length/chunked bodies — use `httparse`; reject pipelining by
processing serially per connection), maps to `fetch` with `redirect: "manual"` (pass 3xx
through to the guest curl/wget, don't follow silently), streams the response body back
through the slirp socket as it arrives (ReadableStream reader → socket send with
backpressure), and re-serializes status/headers — synthesizing `Transfer-Encoding`/
`Content-Length` correctly since fetch normalizes framing. Failure taxonomy: CORS/network
`TypeError` from fetch → HTTP 502 synthesized to the guest with a body naming the cause, so
`curl -v` shows a diagnosable error, not a dead connection.

## Deliverables
- `HttpInterceptor` in the slirp crate + wasm `fetch` executor; native executor via
  `reqwest` for harness tests.
- Routing config: which destinations use the gateway vs. the default connector (per-port
  and per-host rules, overridable at page init).
- Header re-serialization rules documented in `docs/design/fetch-gateway.md`, including the
  hop-by-hop header strip list and the CORS reality section.
- Tests: native round-trips against a local server (fixed-length, chunked, 3xx, 404, slow
  streaming body); browser test against the dev origin.

## Acceptance criteria
- [ ] Guest `wget -O- http://<dev-origin-host>/testfile` returns byte-identical content via
      the gateway (verified by sha256), with zero relay-server involvement (relay stopped).
- [ ] A chunked-encoded streaming response reaches the guest progressively (guest `curl`
      shows bytes before the response completes; test with a 10 s trickle endpoint).
- [ ] 301/302 responses pass through unfollowed: guest `curl -v` shows the 3xx and the
      Location header; `curl -L` then succeeds through a second request.
- [ ] Fetch to a CORS-blocked origin synthesizes a 502 with a diagnostic body within the
      timeout; the TCP flow closes cleanly (no guest hang).
- [ ] HTTP/1.1 keep-alive: two sequential requests on one guest connection both succeed
      (serial handling), and a pipelined burst is handled or cleanly refused per the doc.

## Adversarial verification
Attack the parser and the framing re-synthesis. Fuzz guest-side requests (folded headers,
huge header blocks, Content-Length mismatch with body, smuggling-shaped `Content-Length` +
`Transfer-Encoding` pairs) — the interceptor must reject cleanly; any request forwarded
with ambiguous framing refutes. Download a file whose exact size is a chunk-boundary
multiple and byte-diff. Stall the guest reader mid-stream and confirm the ReadableStream
reader pauses (memory bounded) rather than buffering the whole body. Verify hop-by-hop
headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`) are never copied from fetch
metadata verbatim. Route an HTTPS (port 443) flow at the gateway config — it must refuse
and fall through to the relay path, never attempt TLS-in-fetch nonsense.

## Verification log
(empty)
