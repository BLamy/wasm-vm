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
