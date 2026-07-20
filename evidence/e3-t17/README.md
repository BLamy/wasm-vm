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
