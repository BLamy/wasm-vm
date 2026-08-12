# Network provider deployment

E3-T19 ships five explicit browser policies: `tailscale`, `headscale`, `websocket`, `relay`, and `offline`. Selection is
fail-closed. An ACL denial, expired/revoked node, or unavailable Tailscale control plane is shown as
that provider's failure; it never retries through the relay under a different identity. An operator
may expose separate user actions that explicitly select a private `relay` or a configured `websocket`
endpoint and supply a fresh token where required.

The browser UI names the transports deliberately:

- **Public Tailscale (DERP)** (`tailscale`) uses the official Tailscale control plane when the
  control-server field is blank. The in-browser Tailscale client then uses Tailscale's public DERP
  map for its transport; this is the public relay path, not `wvrelay`.
- **Private Headscale** (`headscale`, also `private-relay`) uses the same in-browser Tailscale client with an operator-owned
  Headscale control URL. It is the private-tailnet equivalent of the public Tailscale mode and requires
  `slirpTailscale.config.controlUrl`.
- **Private wvrelay** (`relay`) uses an operator-owned authenticated `wvrelay` endpoint. It is an
  advanced compatibility transport for the historical `?slirpRelay=...` path, not a Headscale network.
- **WebSocket** (`websocket`) uses the ordinary browser WebSocket connector against the endpoint
  entered in the WebSocket field. It is the default transport when an endpoint is configured. It is
  intentionally not guessed from the page origin: static Pages has no socket listener, so a missing
  endpoint fails closed instead of silently becoming a private or Tailscale connection.
- **Offline** (`offline`) keeps the guest's local slirp stack but provides no outbound transport.

Provider selection is applied at guest boot. The guest always talks to the same virtio-net device:
the core owns a stable `SwitchableNetBackend` adapter and the host may replace the concrete backend
at a quiescent run boundary without changing the guest's MAC, queues, or negotiated features. A
handoff deliberately drops the old backend's in-flight socket state; it never silently combines two
identities or replays stale frames. The browser UI still uses stop/reboot as its conservative
operator workflow, while native/embedded hosts can call `Machine::replace_virtio_net_backend` when
they have explicitly quiesced the machine. Tailscale login state itself is persisted and the login
popup can be reopened without entering a key again.

## Local Headscale proof bundle

Build the browser assets first (`make web-build`), then run `docker compose up --build`. The bundle
serves the app at `http://localhost:8123`, Headscale at `http://localhost:18080`, a MagicDNS fixture
at `fixture.wasm-vm.test:5678`, and an approved exit node. Provisioning generates one-hour,
single-use keys inside the `ephemeral-keys` named volume. Fixture and exit containers consume and
delete their key files. Browser and denied-browser keys remain available only inside that volume
for the acceptance harness; they are never printed, stored in the checkout, or put in a URL.
The committed one-region DERP map prevents Headscale startup from depending on a live control-plane
map fetch; the browser still reaches the pinned public DERP node named in that map.

The browser flow uses:

- control server `http://localhost:8123` for the browser (the same-origin nginx routes `/key` and
  `/ts2021` to Headscale); native nodes use `http://headscale:8080` inside compose;
- stable hostname `wasm-vm-browser` (Headscale resolves collisions, while persisted IPN state
  restores the original node rather than registering a duplicate);
- the one-time browser key for the first registration only;
- persisted IPN state on reload, with the auth-key field cleared as soon as provisioning begins;
- explicit exit-node ID `exit` when public routing is wanted, and a cleared ID with `routeAll=false`
  to restore no-exit behavior.

`docker compose --profile relay up --build` also exposes `wvrelay` at `ws://localhost:18081`. Mint a
credential inside the relay container with `wvrelay issue-token http://localhost:8123 RANDOM_ID 900`
and paste it into the password field. Tokens are HMAC signed, Origin-bound, expire in at most fifteen
minutes, and are carried only in the binary HELLO. The public relay resolves every destination and
rejects the whole answer if any address is loopback, link-local, RFC1918/4193, CGNAT, metadata,
multicast, or a documentation range. The compose-only exact fixture rewrite is the explicit local
development exception. Operators can add comma-separated CIDRs to `WVRELAY_PROTECTED_RANGES`; an
invalid CIDR aborts startup, and any matching DNS answer is refused. Relay security events are
newline-delimited JSON. They expose only event and
reason names plus aggregate authenticated-session, active-stream, accepted-connect, rejected-limit,
and byte counters; token IDs, origins, destinations, payloads, and state never enter those records.

## Production checklist

- Put TLS in front of the static app, Headscale, and relay; browsers must use `wss://` for relay.
- Generate relay secrets in a secret manager and rotate them; never put secrets or tokens in image
  layers, environment dumps, metrics, URLs, access logs, or diagnostics.
- Set an exact `WVRELAY_ALLOWED_ORIGINS`; wildcards are rejected. Keep `WVRELAY_HOST_MAP` empty.
- Set `WVRELAY_PROTECTED_RANGES` for organization-owned public CIDRs that the relay must not reach.
- Review Headscale ACLs, node expiry, exit-node approvers, DERP, DNS, and revocation propagation.
- Keep provider selection explicit in the UI. Never implement automatic Tailscale-to-relay retry.
- Monitor structured provider state and aggregate counters only; never log guest payloads.
- Exercise logout and `headscale nodes delete`/`expire`, then confirm new guest opens fail inside the
  declared 30-second propagation bound.

Teardown is `docker compose --profile relay down --volumes --remove-orphans`. Removing volumes is
load-bearing: it deletes Headscale nodes/state, Tailscale identities, generated auth keys, and the
relay secret. `docker compose ps -a` and `docker volume ls` must show no resources with the
`wasm-vm-e3-t19` project prefix afterward.
