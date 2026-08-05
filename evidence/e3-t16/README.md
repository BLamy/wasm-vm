# E3-T16 worker evidence

Source commits: `58e7c5b`, `85971db`, `bfeea1d`.

## Recorded claims

- `alpine-relay-summary.json` and `alpine-relay-terminal.txt`: stock browser Alpine completed
  `wget` through the production browser WebSocket connector and `wvrelay`; exit 0, exactly
  104,857,600 bytes, SHA-256
  `20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`, zero console errors.
- `full-attack.typescript`: one real WebSocket carried one 1 GiB stream held unread for five
  minutes plus ten concurrent 2 MiB siblings. Every sibling completed during the stall; the large
  stream and every sibling then passed byte-pattern and SHA-256 comparisons. Runtime: 533.39 s.
- `real-ws-100m.typescript`: default three-stream 100 MiB multiplexing acceptance.
- `mass-reap.typescript`: dropping one transport reaped 500 real backend TCP sockets.
- `browser-demo-126-of-126.png`: rebuilt demo reached 126 passed / 0 failed and displayed the
  E3-T16 network evidence with zero console errors.

The first full browser run falsified the implementation: BusyBox reported `connection closed
prematurely` after 104,791,922 bytes. The trace localized a close-time drain race in
`SlirpLocalBackend`: a staged tail could empty after connector draining was skipped, causing guest
FIN while the connector retained a final DATA frame. `85971db` adds a close-time drain probe and
`remote_fin_waits_for_connector_bytes_buffered_behind_a_staged_tail`. Removing only the probe makes
that test fail at 65,536 / 131,072 bytes; restoring it passes 131,072 / 131,072. The rebuilt browser
run above then passed the original full-chain test.

## Commands

```text
cargo fmt --check
cargo clippy -p wasm-vm-slirp --all-targets --all-features -- -D warnings
cargo clippy -p wasm-vm-cli --test ws_connector_over_real_ws -- -D warnings
cargo test -p wasm-vm-slirp
cargo test -p wasm-vm-cli --test ws_connector_over_real_ws
E3_T16_FULL_ATTACK=1 cargo test -p wasm-vm-cli --test ws_connector_over_real_ws one_websocket_multiplexes_a_stalled_stream_and_a_100mib_transfer -- --exact
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown
make web-build
E3_T16_FULL=1 npx playwright test tests/e3-t16-alpine-relay.spec.js --reporter=line
E3_T16_DEMO=1 npx playwright test tests/e3-t16-demo-proof.spec.js --reporter=line
```

The broader workspace command `cargo build --target wasm32-unknown-unknown` is not a valid gate for
this workspace: native CLI dependencies compile `getrandom` without its browser `js` feature. The
scoped wasm package command above and `make web-build` are the browser build gates; both pass.

## Artifact SHA-256

```text
3d85791393d7e24835e362783bbfb6e5960b7e94d07b3d189038f239d57d1849  alpine-relay-100m.png
ee325a0580a33c3404275309007867d67aec76a3ecca02204f1a5897e979f8b4  alpine-relay-summary.json
88338e1100d6a3dc205308c368e6f34a299dc1c0bbc089f41bd00ede69c23d6d  alpine-relay-terminal.txt
75d988123315d6973a304439042ab3ee556f793152a2a0cf0e04c1d527c4850a  browser-demo-126-of-126.png
5070fbc05fce6431764c1a3e45a28f19fb1a426c6786abd5875892d03c24be0b  full-attack.typescript
b3a0129b62790e06d4f6c7feba8320e9626a9061a839898e02cd069399875670  mass-reap.typescript
f8e8455f3ef8371f9edaa3365489ec0d482b51e2a6d16e55294d13ab9ad46c53  real-ws-100m.typescript
```
