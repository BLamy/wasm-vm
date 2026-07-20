---
id: E3-T17
epic: 3
title: Browser Tailscale transport — IPN worker, TCP/UDP streams, MagicDNS, and exit nodes
priority: 317
status: implemented
depends_on: [E3-T15, E3-T16]
estimate: L
capstone: false
---

## Goal
The browser tab becomes the VM's Tailscale/Headscale node. Alpine keeps its ordinary
`eth0`/DHCP/default-route view behind slirp, while outbound guest TCP and UDP, DNS, tailnet
services, and optional public internet via an exit node flow through a dedicated Tailscale
WASM Worker. The browser node's identity and ACLs remain authoritative; no backend pretends
to be the browser and no Tailscale credential enters guest memory.

## Context
The production model is a virtual gateway, not `tailscaled` inside Alpine: guest packets
terminate at the already-verified T14/T15 slirp stack, then a provider routes them through a
browser IPN. Prior art lives in `~/Dev/almostnode` at commit `f3d867f` and its current
`packages/almostnode/src/network/` implementation: a Worker creates
`@agent-wasm/tailscale-connect` with custom `controlURL`, one-time auth key or interactive
login, persisted `stateStorage`, MagicDNS, and exit-node configuration. The vendored Go/WASM
already constructs `tsdial.Dialer` with `NetstackDialTCP` and `NetstackDialUDP`, but its JS
surface exposes only request-shaped `fetch`, SSH, and lookup. This task must add a generic,
bounded streaming API; `ipn.fetch()` currently buffers whole bodies and is explicitly not
the guest transport.

Reuse T16 rather than inventing another protocol: the browser side should expose a
provider-neutral `FrameTransport`/connector boundary, with the existing OPEN/DATA/WINDOW/
SHUTDOWN/CLOSE/RST and datagram semantics carried over Worker `postMessage`. The worker maps
those sessions to Tailscale `net.Conn`s. Tailscale name resolution feeds T15's internal DNS
service when the provider is active; browser DoH remains the relay/offline fallback. The
25 MiB-class Tailscale artifact must be lazy-loaded only when this provider is selected.

## Deliverables
- A pinned, license-documented Tailscale-connect WASM source/artifact build; no dependency on
  a developer's adjacent `almostnode` checkout.
- A dedicated Tailscale Worker with custom control URL, hostname, auth-key/interactive login,
  persisted state, DNS acceptance, exit-node selection, logout/revocation, diagnostics, and
  deterministic teardown.
- Generic session APIs over the Go/WASM bridge for TCP and UDP: connect, bounded reads/writes,
  per-flow credit/backpressure, half-close, reset/error mapping, datagram boundaries, and close.
- A wasm-vm transport adapter at the existing slirp connector seam plus provider selection:
  `tailscale` (primary when configured), `relay` (T16 fallback), and `offline`.
- A T15 DNS adapter that resolves MagicDNS/tailnet names through the active IPN and preserves
  DoH fallback when Tailscale is disabled.
- Browser UI/config for login status, control server, exit node, and explicit logout; auth
  keys are one-time provisioning inputs and are never persisted or included in diagnostics.
- Unit, Worker, wasm, and browser E2E tests, plus demo roadmap wiring showing Tailscale-backed
  guest TCP, UDP, DNS, and exit-node capabilities live.

## Acceptance criteria
- [ ] From a fresh browser profile, configure the test Headscale control plane and login via
      a one-time auth key or interactive flow; the browser registers exactly one named node,
      reload restores its session without another key, and logout/revocation removes access.
- [ ] With `wvrelay` stopped, stock Alpine obtains its normal `10.0.2.15` DHCP lease, resolves
      a MagicDNS name through `10.0.2.3`, and exchanges byte-exact TCP data with a tailnet-only
      service. Service/control-plane evidence identifies the browser node, not a backend relay,
      as the authorized peer.
- [ ] Guest UDP reaches a tailnet echo service with datagram boundaries intact, including
      zero-length, maximum-supported, and two back-to-back differently-sized datagrams.
- [ ] With an exit node selected, guest HTTPS reaches a public test endpoint; with no exit
      route/policy the same connection fails within the connector timeout rather than hanging.
- [ ] A 1 GiB TCP transfer is SHA-256 exact; stalling the guest reader holds worker/wasm queue
      memory under the documented cap while another stream continues. Half-close and remote RST
      produce the same guest-visible semantics as T16.
- [ ] Kill and restart the Worker/control connection: in-flight flows fail normally, future
      flows recover from persisted state, and no duplicate node or leaked callback remains.
- [ ] Selecting `relay` or `offline` performs no request for the Tailscale WASM artifact and
      creates no Worker; the existing T16 relay acceptance remains green.
- [ ] One browser load reaches the full in-page pass total, zero application console errors,
      and live/verified roadmap pips for Tailscale TCP, UDP, MagicDNS, and exit-node routing.

## Adversarial verification
Predict the node identity and ACL decision before inspecting control-plane/service logs, then
deny the browser node while allowing the relay node: any success through the denied browser
path proves identity was laundered and refutes the design. Use an expired/used auth key, wrong
control URL, revoked node, unreachable DERP/control server, and a corrupt persisted state blob;
all must fail closed with an actionable status and no credential in URL/storage/diagnostics.
Send DATA before OPEN, exceed credits, stall reads, close during connect, race logout against
active flows, and crash/restart the Worker repeatedly; memory growth, callbacks after disposal,
duplicate bytes, or a hung guest refutes. Byte-diff a 1 GiB transfer, run 500 concurrent flows,
and exercise TCP half-close/RST plus adversarial UDP sizes/order. Prove the data path never calls
the whole-body `ipn.fetch` API. Finally disable Tailscale and repeat T16's browser relay run to
show provider work did not regress the fallback.

## Verification log

### 2026-07-17 — planning rewrite
Supersedes the unimplemented CORS-bound fetch gateway plan. Browser fetch is now an optional,
measured optimization in E3-T18; the correctness path is generic TCP/UDP through the browser
Tailscale node, with T16 retained as the public relay fallback.

### 2026-07-20 — worker — implemented

Implementation and evidence commits span `0f46826` through `9a8485b` on top of task-start commit
`f17afcf`. The browser now has an explicit, lazy `tailscale` provider at the existing slirp
connector seam, a dedicated Worker and pinned vendored runtime, bounded TCP/UDP framing and credit,
MagicDNS, deterministic exit-node selection, persisted state, diagnostics, logout, and teardown.
Public exit sockets are opened only when the guest first writes, avoiding a remote TLS handshake
timeout while the interpreted guest constructs its ClientHello; tailnet/private/no-exit dials stay
eager. Offline and relay modes instantiate no Worker and fetch no Tailscale artifact.

The real Headscale recordings used fresh ephemeral one-time keys and identify the browser node at
the service/control plane. Stock Alpine kept its normal `10.0.2.15/24` lease and `10.0.2.3` resolver,
resolved `wasm-vm-tailnet-fixture.example.com`, exchanged exact TCP and UDP data with the tailnet-only
peer, and completed public HTTPS through selected exit node ID 1. The no-exit variant failed within
the connector deadline. The final Tailscale scale attack uploaded exactly 1,073,741,824 deterministic
bytes with peer SHA-256 `2c06ade942ee3f17a048dd1064b2fab046a4bb95386d8bb41b68dc6711ac2af3`;
an unread download stopped exactly at the 262,144-byte credit cap while a sibling HTTP stream
completed, and the peer replied after guest half-close. Permanent Worker tests cover DATA-before-OPEN,
over-credit/malformed frames, auth-key redaction, hostile UDP sizes/order, connect-close races, reset
mapping, and 500-flow reap without calling whole-body `ipn.fetch`. Evidence and reproduction commands
are in `evidence/e3-t17/README.md`.

Final gates passed: `cargo fmt --check`; `cargo clippy -- -D warnings`; comprehensive
`cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors` with normal
loopback access (all runnable workspace tests passed, including the production relay and slirp
stress suites); `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; and `make web-build`.
The one unchanged macOS abort/crash-report test was filtered because its child remains stuck in
kernel exit handling; older orphaned instances confirm the host issue, and this diff does not touch
the file backend. A targeted browser run passed 12/12 provider/runtime/Worker/roadmap tests. One
fresh demo load passed 126/0, recorded zero application console errors, and showed verified Tailscale
TCP, UDP, MagicDNS, and exit-node pips in `evidence/e3-t17/browser-demo-126-of-126.png`.

Finally, with Tailscale disabled, the required fallback rerun booted stock Alpine and transferred
104,857,600 bytes through `BrowserWebSocketTransport -> WsConnector -> wvrelay` in 3,224 seconds.
Guest and independent fixture SHA-256 both equal
`20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`, wget exited 0, and console
errors were empty (`evidence/e3-t17/alpine-relay-*`). Host `rr` is unavailable on this Apple Silicon
Mac; the task therefore supplies production browser recordings, independent peer/control-plane
oracles, deterministic protocol tests, and bounded-memory scale evidence for adversarial review.
