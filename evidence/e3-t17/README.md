# E3-T17 stock Alpine tailnet proof

`alpine-tailnet-terminal.txt`, `alpine-tailnet-summary.json`, and `alpine-tailnet.png` were
produced by the opt-in Playwright test `web/tests/e3-t17-alpine-tailnet.spec.js` on 2026-07-20.
The run used the isolated local Headscale lab and `tools/e3-t17-tailnet-fixture.go` with a fresh
ephemeral pre-auth key supplied only through `E3_T17_AUTH_KEY`.

The 16.1-minute run proved that the unmodified Alpine image:

- received one DHCP offer/ack and configured `10.0.2.15/24`;
- retained `10.0.2.3` as its ordinary guest resolver;
- resolved `wasm-vm-tailnet-fixture.example.com` through the browser IPN;
- fetched the fixture's exact TCP body; and
- received the exact `e3t17-guest-udp` datagram echoed by the tailnet peer.

The browser registered as `wasm-vm-alpine-tailnet-rerun.example.com` at `100.64.0.16`. The peer
fixture independently logged the guest UDP packet as arriving from `100.64.0.16:60844`, anchoring
the service-side identity to the browser node rather than a relay. The browser loaded the pinned
Tailscale artifact exactly once and reported no application console errors.

`alpine-exit-terminal.txt`, `alpine-exit-summary.json`, and `alpine-exit.png` are the later
19.6-minute exit-node proof. The same stock guest repeated DHCP, MagicDNS, tailnet TCP, and tailnet
UDP, then completed `wget https://1.1.1.1/` with exit code 0 through selected exit node ID `1`.
Headscale identified the browser as `wasm-vm-alpine-exit-fixed.example.com` at `100.64.0.24`.
The summary records zero console errors and exactly one Tailscale artifact request.

The preceding refuted recordings connected the real public socket before the interpreted guest
had constructed its ClientHello; the endpoint's 15-second handshake deadline expired first. The
passing run used the production fix that defers only public exit-node dials until the guest's first
write. Tailnet/private and no-exit dials remain eager.

`bulk-summary.json` and `bulk-peer.txt` record the real Tailscale bulk attack. The browser Worker
uploaded exactly 1,073,741,824 deterministic bytes in 722.474 seconds; the independent tsnet peer
computed SHA-256 `2c06ade942ee3f17a048dd1064b2fab046a4bb95386d8bb41b68dc6711ac2af3`.
In the same run, a download stopped exactly at the 262,144-byte receive-credit cap while a sibling
HTTP stream completed, and a peer response arrived after the client half-closed its write side.
The service-side addresses identify browser node `100.64.0.27`, not a backend relay.

`alpine-relay-summary.json`, `alpine-relay-terminal.txt`, and `alpine-relay-100m.png` are the
required E3-T16 fallback recheck after the Tailscale provider changes. With Tailscale disabled,
stock Alpine downloaded exactly 104,857,600 bytes through the production browser WebSocket relay
in 3,224 seconds. The guest SHA-256 was
`20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`, matching the independent
fixture, with exit code 0 and no console errors.

`logout-recheck.txt` records the post-refutation production recheck. A fresh Headscale browser node
at `100.64.0.30` reached the tailnet fixture, restored the same identity without its provisioning
key, then logged out while a real tailnet TCP flow remained open. The Worker emitted a reset for
that flow, Headscale deleted node 29, and a post-logout open failed without another service request.
The same-run control-plane and service excerpts correlate the named browser node with both accepted
requests.

`failure-matrix.txt` records production-Worker attacks using an expired key, reused one-time key,
wrong control path, unreachable control port, malformed persisted state, and an admin-revoked live
node. Every case fails closed without OPEN_OK or credential exposure. The revocation run correlates
Headscale node 35 with Worker address `100.64.0.35`, deletes that exact node, waits the declared
30-second peer-map bound, and proves a fresh tailnet flow cannot open.

`acl-identity.txt` is the separate identity-laundering falsification run. An exact Headscale policy
allowed `tag:relay` to reach `tag:service` on TCP 18000 while denying `tag:browser`. The relay node at
`100.64.0.3` succeeded before and after restart and was the only source in the independent service
log. The browser node at `100.64.0.4` failed both opens within 20 seconds and never reached the
service. `tools/e3-t17-acl-policy.hujson` is the exact policy used.

`remote-rst.txt` records the real tailnet reset at the production Worker boundary. The independent
patched peer logged browser source `100.64.0.45`, aborted the accepted TCP endpoint, and the Worker
emitted protocol opcode 7. `alpine-rst-terminal.txt`, `alpine-rst-summary.json`, and
`alpine-rst.png` extend that oracle through the stock Alpine guest: BusyBox `wget` must exit nonzero
and report a reset rather than treating the abort as orderly EOF. The passing 15.6-minute guest run
registered `wasm-vm-alpine-rst-final4` at `100.64.0.5`; the peer independently logged the TCP, UDP,
and RST connections from that same address, and the browser recorded zero console errors.

Reproduce with:

```sh
cd web
E3_T17_ALPINE=1 \
E3_T17_CONTROL_URL=http://127.0.0.1:8080 \
E3_T17_AUTH_KEY='<fresh ephemeral key>' \
E3_T17_HOSTNAME=wasm-vm-alpine-tailnet-rerun \
E3_T17_PEER_NAME=wasm-vm-tailnet-fixture.example.com \
E3_T17_PEER_PORT=18000 \
E3_T17_PEER_UDP_PORT=19000 \
npx playwright test tests/e3-t17-alpine-tailnet.spec.js
```

For the public HTTPS proof, add `E3_T17_EXIT_NODE_ID=1` and
`E3_T17_PUBLIC_URL=https://1.1.1.1/`.

For the guest-visible remote-reset proof, add `E3_T17_PEER_RST_PORT=18002` and run the peer with a
fresh ephemeral key through `tools/e3-t17-run-tailnet-fixture.sh`.

Repeat the relay fallback without overwriting E3-T16's original evidence with:

```sh
cd web
E3_T16_FULL=1 E3_T16_EVIDENCE_DIR=evidence/e3-t17 \
  npx playwright test tests/e3-t16-alpine-relay.spec.js --reporter=line
```
