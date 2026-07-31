---
id: E3-T20a
epic: 3
title: Production apk network contract and diagnostics
priority: 320.1
status: pending
depends_on: [E3-T11, E3-T15, E3-T16, E3-T17, E3-T19a]
estimate: S
risk: high
capstone: false
---

## Goal
Freeze the production Alpine repository and provider-observation contract so later apk proofs can
identify every network layer without exposing credentials or using a hidden fetch path.

## Deliverables
- Signature-enforcing HTTPS repository configuration in the reproducible rootfs.
- `apk-net-check` reporting DHCP, DNS, selected provider, node/session or relay state, exit route,
  HTTPS, and mirror health with no reusable secret.
- Provider evidence hooks that prove Tailscale, relay, or offline selection without fallback.

## Acceptance criteria
- [ ] `make verify-E3-T20a` builds the image twice with identical config bytes and exercises PASS
  plus one typed failure for each diagnostic layer.
- [ ] Package signatures and TLS remain enabled; diagnostics contain no auth key, token, payload,
  URL credential, or alternate download mechanism.
- [ ] Provider observations distinguish Tailscale-only, relay-only, and offline states.

## Adversarial verification
Break each layer independently, inject secrets into provider state, alter repository protocol and
signature flags, and attempt to make one provider masquerade as the other. Any false PASS, leaked
credential, HTTP/signature bypass, or hidden host fetch refutes.

## Verification log
(empty)
