---
id: E3-T20
epic: 3
title: Tailscale-backed `apk add` end-to-end with relay fallback
priority: 320
status: pending
depends_on: [E3-T11, E3-T15, E3-T16, E3-T17, E3-T19]
estimate: M
capstone: false
---

## Goal
`apk update && apk add <pkg>` works from the browser-hosted Alpine guest against a real HTTPS
mirror through the full primary stack: DHCP, Tailscale-aware DNS, TCP through the browser IPN,
and public internet through the configured exit node. Package signatures remain enforced and
QuickJS/Node.js install and run. The same workload is separately proven through T16's public
relay fallback; the optional E3-T18 HTTP fast path is not a correctness dependency.

## Context
This is the integration milestone for the networking arc and the delivery vehicle for Level 3's
named userland targets. T11 supplies the production image and `/etc/apk/repositories`; use a real
HTTPS Alpine riscv64 mirror so TLS stays opaque through generic TCP. The shipped primary provider
is T17 Tailscale with an explicitly selected exit node or equivalent allowed public route. Expect
apk concurrency, aggressive keep-alive closure, redirects, large indexes, slow links, and clock
skew. Add `apk-net-check` to report DHCP, DNS provider, active transport, tailnet node/session,
exit-route availability, HTTPS, and mirror health without exposing credentials.

Record provider-specific evidence. The Tailscale run must prove `wvrelay` was stopped and that
control/exit-node observations match the browser node. The relay run must force `relay` and prove
no Tailscale Worker/artifact loaded. Neither path may silently cross-fallback; otherwise a success
cannot establish which security and transport boundary carried the bytes.

## Deliverables
- Production T11 repositories configuration using a real HTTPS Alpine riscv64 mirror.
- Transport routing/default configuration: Tailscale primary, relay fallback only when selected or
  explicitly approved, and no dependency on E3-T18.
- `apk-net-check` diagnostic script baked into the image with secret-free layer-by-layer output.
- Scripted browser E2E: cold boot -> `apk update` -> `apk add ripgrep` -> `rg --version`, parameterized
  for `tailscale` and `relay` and asserting the selected provider's diagnostics/evidence.
- QuickJS/Node.js install-and-run extension plus wall-clock, byte, queue-memory, reconnect, tailnet,
  and relay metrics in the verification log.
- Any slirp/provider/image bugs exposed by the real flow, each with a deterministic regression test
  in its owning task area.

## Acceptance criteria
- [ ] Fresh profile + cold image: provision the T17 browser node, select the test exit node, stop
      `wvrelay`, then `apk update && apk add ripgrep`; both exit 0, signature checking remains on,
      and `rg --version` succeeds. Evidence identifies Tailscale as the only data provider.
- [ ] Force `relay` with Tailscale disabled/unloaded and repeat the same real-mirror flow through
      T16. The Tailscale WASM/Worker is absent from the browser network/runtime evidence.
- [ ] `apk add nodejs quickjs` succeeds through the primary path; `node --version`, a non-trivial
      Node script, and `qjs --help` run. `apk add python3` as an approximately 50 MiB dependency
      stress case completes under the declared five-minute budget.
- [ ] A deliberately corrupted package delivered by a tampering proxy is rejected by apk; no
      `--allow-untrusted`, HTTP interception, or disabled TLS/signature workaround is present.
- [ ] `apk-net-check` reports PASS on both providers and identifies the correct disabled layer when
      DHCP, DNS, Tailscale session/exit route, relay, and mirror access are independently broken.
- [ ] The Tailscale path survives session restoration after a tab reload without a new auth key;
      the relay path survives token refresh. Neither creates duplicate guest bytes or a partial apk
      database after a failed/retried transfer.
- [ ] The browser suite reaches its full pass total with zero application console errors and the
      roadmap shows live Tailscale networking plus verified apk/userland installation.

## Adversarial verification
Drop the Tailscale Worker/control connection during `apk add python3`: apk must fail normally and a
retry after session recovery must succeed without a new node or corrupt database. Revoke the node
and keep the relay available: automatic fallback is forbidden; only an explicit provider change may
use it. Repeat by dropping the relay WebSocket in forced-relay mode. Throttle each provider to 1 Mbps,
stall the guest reader, and inspect bounded queue memory. Run concurrent apk commands and verify apk's
lock serializes them without slirp/provider failure. Prove DNS passed through `10.0.2.3` and the active
provider, not a fixture backdoor. Finally repeat both runs from fresh browser profiles and cold caches;
any manual guest network configuration, hidden fetch path, silent cross-provider fallback, disabled
signature/TLS validation, or traffic attributed to the wrong tailnet node refutes.

## Verification log

### 2026-07-17 — planning rewrite
Makes the browser Tailscale node the primary `apk add` proof, keeps the existing public relay as an
explicit fallback, removes the fetch gateway dependency, and adds E3-T11/E3-T19 as real prerequisites.
