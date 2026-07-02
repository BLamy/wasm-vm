---
id: E6-T25
epic: 6
title: Serve from the guest — HTTP port-forwarding to the host browser
priority: 625
status: pending
depends_on: [E5]
estimate: M
capstone: false
---

## Goal
A guest process listening on a TCP port becomes reachable from the host browser at a
URL: a Service Worker proxies `/vm/{id}/{port}/*` fetches through the Epic 3 slirp stack
into guest TCP connections, streaming both directions — the plumbing that lets the
capstone's iframe load a child VM served by `busybox httpd` inside the parent guest.

## Context
Browsers can't accept TCP, so "port forward" means fetch interception: the Service
Worker matches the `/vm/` scope, opens a MessagePort hop to the page/worker running the
VM, which asks slirp to connect to the guest ip:port, writes the reconstructed HTTP
request, and pumps the response back as a `ReadableStream` body. Hard edges: SW lifetime
(browsers kill idle SWs — every intercept must re-establish the MessagePort via client
lookup, and a VM page reload must fail in-flight requests cleanly); header fidelity —
`Content-Type: application/wasm` passthrough so `instantiateStreaming` works on
guest-served wasm (SDK keeps an arraybuffer fallback for mislabeling guests); no
WebSocket upgrades through SW fetch (document it; offer a direct in-page fetch-adapter
for same-page consumers). The security consequence is severe and handled *in this task*:
guest-served content executes under the *host origin* within the SW scope — untrusted
guest code could serve script that steals host-origin storage. Default posture:
forwarded content loads only into sandboxed iframes (no `allow-same-origin`) with a
restrictive CSP + `X-Content-Type-Options` injected by the proxy; raw-tab access is
opt-in behind a scary flag.

## Deliverables
- SW proxy (`sw-proxy.js`) + VM-side connection broker: scope routing, port mapping
  table, request reconstruction (method, headers, body streams), response streaming,
  SW-restart re-handshake, per-request timeout with 504 synthesis.
- Forward management UX: `vmctl forward <port>` guest command (agent channel) and a
  host-UI toggle listing active forwards; forwards are per-VM-id, deny-by-default.
- Sandbox-by-default delivery: helper `vm.openForwarded(port)` returns a sandboxed
  iframe wired to the scope with injected CSP; documented raw-mode opt-in.
- `docs/port-forwarding.md`: architecture, limitations (no WS upgrade, SW eviction),
  origin-security analysis and the sandbox rationale.

## Acceptance criteria
- [ ] `busybox httpd -p 8080` in the guest serving a static tree is browsable at
      `/vm/{id}/8080/` in a host tab (via the sandboxed helper): HTML, CSS, and a
      PNG render; correct Content-Types observed in the network panel.
- [ ] A 50 MB file downloads through the proxy with constant memory (SW/page heap flat
      within 20 MB during transfer — streaming, not buffering) and matching sha256.
- [ ] A `.wasm` file served by the guest instantiates via `instantiateStreaming` in a
      host test page (MIME passthrough proven).
- [ ] Force-stop the SW (devtools) mid-session: the next request re-handshakes and
      succeeds; in-flight requests fail with a synthesized error, not a hang.
- [ ] With no forward configured, `/vm/{id}/8080/` returns 403 — deny-by-default;
      concurrent forwards on two ports work independently.

## Adversarial verification
Attack the origin boundary first: serve a malicious guest page attempting `localStorage`
read, `document.cookie`, `fetch('/', {credentials:'include'})`, and `window.top`
navigation — inside the default sandboxed iframe all must fail; any host-origin data
access refutes the security posture. Request the forwarded URL in a raw tab without the
opt-in flag — anything but refusal refutes deny-by-default. Attack the proxy with
hostile HTTP: chunked bodies with wrong lengths, `Transfer-Encoding`/`Content-Length`
smuggling conflicts, 100-continue, infinite bodies, resets mid-body — SW crash, hang, or
memory growth refutes. Attack lifetime: sleep the laptop mid-download, reload the VM
page while requests stream, open 50 concurrent requests through one forward — dangling
MessagePorts that permanently break the scope refute. Confirm the WS limitation by
actually attempting a WebSocket through the proxy and matching the failure to the docs.

## Verification log
(empty)
