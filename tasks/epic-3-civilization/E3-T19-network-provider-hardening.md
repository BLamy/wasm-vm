---
id: E3-T19
epic: 3
title: Tailscale/Headscale lifecycle and public-relay fallback hardening
priority: 319
status: pending
depends_on: [E3-T16, E3-T17]
estimate: M
capstone: false
---

## Goal
Both shipped network providers are deployable without confusing identity or creating an open
proxy. Tailscale/Headscale is the primary path with explicit provisioning, persisted node state,
ACL/exit-node policy, revocation, and credential hygiene. T16 remains a public WebSocket fallback
with signed tokens, origin checks, destination policy, and bounded abuse. Provider status and
failure are visible; fallback never silently changes the caller's security identity.

## Context
The primary provider inherits Tailscale's node model: the browser tab joins a tailnet, and its
node identity—not a backend impersonating it—must be what peer ACLs authorize. Support either
Tailscale's control plane or an operator-owned Headscale URL. Provision with a one-time auth key
or interactive login; persist only the IPN state needed to restore the node, never the auth key.
Define node expiry, logout, admin revocation, hostname collision, exit-node selection, and
control-plane outage behavior. Local development needs a reproducible Headscale/test-service
bundle and teardown that removes test nodes.

The relay fallback is still an abuse surface. Its WebSocket hello token is a short-lived HMAC
blob `{expiry <= 15 min, origin, random id}`. Resolve destinations then reject loopback,
link-local, RFC1918/4193, metadata, and configured protected ranges unless an explicit development
allowlist applies. Bound streams, connect rate, and bytes per token. The UI may offer fallback,
but an ACL denial, revoked node, or explicit Tailscale-only policy must not automatically route
through the relay and bypass that decision.

## Deliverables
- Tailscale/Headscale provisioning service and browser flow: one-time keys or interactive login,
  stable hostname, custom control URL, session restoration, logout/revocation, expiry, and exit
  node selection, with secrets scrubbed from storage, URLs, logs, and diagnostics.
- Tailnet policy fixtures and tests proving browser-node identity, MagicDNS access, allow/deny
  ACLs, exit-node routing, node revocation, and no backend impersonation.
- Relay token issuer and verification, post-resolution destination policy, per-token rate/
  concurrency/byte limits, origin allowlist, metrics, and structured secret-free logs.
- Explicit provider/fallback policy: `tailscale`, `relay`, `offline`, and optional user-approved
  fallback; security failures never trigger an automatic identity-changing retry.
- `docker-compose.yml` and deployment docs for static app + test Headscale/control provisioning +
  tailnet-only fixture service + optional relay fallback, with a production checklist for both.

## Acceptance criteria
- [ ] A fresh profile provisions one browser node, reload restores it without replaying or storing
      the auth key, and logout/admin revocation prevents new guest flows within the declared bound.
- [ ] ACL evidence shows an allowed browser node reaching the fixture and a denied browser node
      failing; allowing the relay node does not rescue the denied Tailscale flow unless the user
      explicitly changes provider.
- [ ] Selecting an exit node makes a public fixture observe that exit path; clearing it restores
      the documented no-exit behavior without duplicating the browser node.
- [ ] Relay connections with absent/expired/wrong-origin tokens are closed before OPEN; protected
      and DNS-rebinding destinations are refused after resolution; caps yield typed guest failures
      without disturbing existing streams.
- [ ] `docker compose up` from a clean checkout yields a browser VM that resolves/reaches the
      tailnet fixture and reaches a public HTTPS endpoint via the configured exit node; forcing
      `relay` repeats the public test with the T16 fallback.
- [ ] A storage/log/URL/diagnostics audit finds no reusable auth key, relay token, guest payload,
      or tailnet state secret; node teardown leaves no orphan test nodes.

## Adversarial verification
Act as both tailnet attacker and proxy abuser. Reuse a one-time key, copy persisted state to a
second profile, collide hostnames, revoke during active traffic, deny via ACL while the relay is
available, and take the control server offline. Any silent relay fallback around an ACL/revocation
is a critical refutation. Forge relay token origin/expiry/signature, exceed all limits, resolve a
public hostname that flips to metadata/private space, open 500 streams, and abruptly disconnect;
leaked sockets or unbounded memory refute. Search browser storage, service-worker caches, network
URLs, metrics, and diagnostics for credentials. Run compose from a cold clone and verify teardown
removes nodes, containers, sockets, and persisted test secrets.

## Verification log

### 2026-07-17 — planning rewrite
Expands the former relay-only deployment ticket. Tailscale/Headscale lifecycle and ACL identity are
the primary security boundary; public-relay token/rate/SSRF hardening remains required for fallback.
