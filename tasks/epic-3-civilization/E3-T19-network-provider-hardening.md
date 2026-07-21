---
id: E3-T19
epic: 3
title: Tailscale/Headscale lifecycle and public-relay fallback hardening
priority: 319
status: in-progress
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

### 2026-07-20 — worker — submitted for verification

Commit under test: `f9cdb00` (implementation commits `38a4553` through `f9cdb00`, based on
`e7872e3`). Evidence: `evidence/e3-t19/README.md` and
`evidence/e3-t19/browser-demo-126-of-126.png` (SHA-256
`7773021d1c41debb1b0702a58815bd92d1053fba19134b89d8d521c947132bff`).

Commands run at the submitted head:

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors`
- `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`
- `cargo test -p wasm-vm-slirp --lib relay_security`
- `cargo test -p wasm-vm-slirp --lib secure_relay`
- `cargo test -p wasm-vm-cli --bin wvrelay`
- `bash tools/verify/e3-t19-deployment.sh`
- `bash tools/verify/e3-t19-live-proof.sh`
- `make web-build`
- `cd web && npx playwright test tests/e3-t17-provider-selection.spec.js tests/e3-t19-provider-security.spec.js tests/roadmap-oci.spec.js`
- `cd web && E3_T19_DEMO=1 npx playwright test tests/e3-t19-demo-proof.spec.js`
- From a pristine clone at `f9cdb00` with `RUSTFLAGS`, `CARGO_HOME`, `CARGO_TARGET_DIR`,
  `CARGO_BUILD_RUSTC_WRAPPER`, and `RUST_LOG` unset: `make web-build && make verify-E3-T19`.

All prescribed gates passed. The pristine-clone target rebuilt the wasm demo, reran the relay
unit/real-socket/CLI attacks, validated the deployment bundle, provisioned independent allowed and
denied Headscale browser identities, proved same-node restoration and logout flow reset, removed
all compose containers/networks/volumes, and finished with four passing browser policy tests and
`verify-E3-T19 (provider lifecycle + relay security): OK`. The demo proof reached 126 passed / 0
failed, reported zero application console errors, and showed the E3-T19 roadmap capability as
verified.

The implementation claims short-lived Origin-bound relay credentials; post-resolution protected
address rejection; shared per-token stream/rate/byte budgets with typed failures; secret-free
aggregate observability; explicit, non-fallback provider identity; and a reproducible Headscale,
fixture, exit-node, app, and optional-relay deployment whose one-shot keys and state are destroyed
on teardown. `cargo test --workspace --all-features` was also attempted, but its unsupported
`zicsr-stub`/`roundtrip_csr` feature combination fails a pre-existing CSR expectation; the
repository-prescribed workspace suite above passed and exercises the supported feature set.

### 2026-07-20 — verifier — VERDICT: refuted

- P1 duplicate stream IDs do not consume shared concurrency — **FAILED**. Predicted that after one
  valid stream and a duplicate `OPEN` for the same wire ID, a second distinct stream would still fit
  under `max_concurrent_streams = 2`. Observed structured state
  `active_streams=2, connects_accepted=2, rejected_concurrency=1` and
  `OpenFail { stream: 2, code: 2 }`: `reserve_quota_stream` reserves in the shared registry before
  `HashSet::insert` discovers the duplicate (`crates/slirp/src/ws_proxy/driver.rs:603-616`). The
  promoted real-WebSocket regression is
  `secure_relay_duplicate_open_does_not_leak_shared_concurrency`
  (`crates/slirp/src/ws_proxy/ws_adapter_tests.rs:274-313`). Reserve only after validating a new
  stream ID, or roll the registry reservation back when insertion fails, then rerun every gate.
- P2 the new clean-compose target proves both public egress identities — **NEEDS EVIDENCE**.
  Predicted `make verify-E3-T19` would select the composed exit node, observe a public HTTPS path,
  clear the exit without duplicating the browser node, then start the optional relay and repeat the
  public request. The target passed, but `tools/verify/e3-t19-live-proof.sh:22-39` supplies only the
  tailnet fixture host/port to the inherited Worker spec and never supplies `E3_T17_EXIT_NODE_ID`,
  `E3_T17_PUBLIC_HOST`, or relay configuration; `Makefile` runs no relay-profile lifecycle. Record
  these two promised public paths from the new bundle rather than citing unchanged parent evidence.
- P3 adversarial lifecycle/abuse coverage — **NEEDS EVIDENCE**. The exact-head target covers token
  signature/origin/expiry, mixed public/private DNS, one stream limit, one byte limit, same-node
  restoration, allowed/denied fixture ACLs, logout, and teardown. It does not execute the task's
  copied-state, hostname-collision, admin-revocation/control-outage, connect-rate, 500-stream, or
  configured-protected-range attacks. Add deterministic attacks for these changed policy/deployment
  boundaries; the deployment/config/docs-only hunks are otherwise waived as declarative once their
  behavior is exercised by the corresponding live proof.
- MOCK/ENV: the first real-socket run inside the restricted verifier sandbox failed at ephemeral
  `TcpListener::bind` with `EPERM`; rerunning outside that socket sandbox passed the repository target
  and is not a code finding. The compose fixture is real Headscale/Tailscale, not a mocked provider.
- SUITE: promoted the duplicate-`OPEN` real-WebSocket regression because it deterministically catches
  a cross-stream quota denial. Keep it and make it green during rework.

Commands: `env -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u
CARGO_BUILD_RUSTC_WRAPPER -u RUST_LOG make verify-E3-T19` (all existing gates passed outside the
socket sandbox); `cargo test -p wasm-vm-slirp --lib
secure_relay_duplicate_open_does_not_leak_shared_concurrency -- --nocapture` (failed as predicted).
