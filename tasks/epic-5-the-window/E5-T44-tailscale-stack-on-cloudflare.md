---
id: E5-T44
epic: 5
title: Tailscale for the Replay desktop — own DERP relay, Headscale control plane and exit node on Cloudflare, as an opt-in provider
priority: 0.38767
status: pending
depends_on: [E5-T43f]
estimate: L
risk: high
capstone: false
---

## Why this exists

The user's second choice, after the public relay (E5-T43): visitors' browsers join the user's
own tailnet and reach the internet through the user's exit node. A DERP relay alone carries
only traffic between nodes of one tailnet; internet access also needs a control plane everyone
joins and an exit node. The browser side exists (E3-T17 Tailscale worker; `headscale` provider).

## Planning container

Split before start into S tasks, roughly: a DERP server reachable from browsers (WebSocket DERP)
on Cloudflare; Headscale as a Cloudflare Container with persistent state; an exit node
(tailscaled) as a Container; per-visitor pre-auth keys and ACLs that keep visitors apart; the
page's opt-in provider and a browser proof.

## Verification log
