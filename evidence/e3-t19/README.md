# E3-T19 provider hardening evidence

The exact-head worker run exercised the production relay security path, a clean local deployment,
both Headscale ACL identities, browser identity restoration/logout, and the complete browser ISA
suite. No reusable credential is stored here: the compose harness generated one-shot keys and the
relay secret inside a disposable volume, consumed the keys without printing them, and deleted all
containers, networks, volumes, node state, and remaining secrets on exit.

## Recorded results

- `cargo test -p wasm-vm-slirp --lib relay_security`: 5 passed. This covers signature tampering,
  expiry, Origin binding, the 15-minute lifetime ceiling, protected IPv4/IPv6 families, a mixed
  public/metadata DNS answer, and shared concurrency/connect/byte counters.
- `cargo test -p wasm-vm-slirp --lib secure_relay`: 3 passed over real WebSockets and real TCP.
  Missing/wrong Origin and forged HELLO credentials closed before OPEN. Concurrency and byte caps
  returned typed failures without disturbing the established stream. Structured events contained
  only reason classes and aggregate counters.
- `cargo test -p wasm-vm-cli --bin wvrelay`: 6 passed. Public bind configuration, exact origins,
  and exact development host mappings remain fail-closed.
- `bash tools/verify/e3-t19-deployment.sh`: passed with pinned images, valid Headscale policy, and
  no embedded credentials.
- `bash tools/verify/e3-t19-live-proof.sh`: passed from a clean compose state. The allowed browser
  node restored the same `100.64.0.3` identity without its auth key, resolved/reached the fixture,
  reset an active flow at logout, and rejected a post-logout open. The denied browser registered as
  the separate `100.64.0.4` identity but failed both fixture opens. Only `ready` and `relay.secret`
  remained before the trap removed every compose resource and volume.
- `cd web && npx playwright test tests/e3-t17-provider-selection.spec.js
  tests/e3-t19-provider-security.spec.js tests/roadmap-oci.spec.js`: 5 passed. Provider selection
  stays explicit, credentials do not cross providers or enter URL/browser storage, and failures do
  not silently change identity.
- `make web-build`: passed.
- `cd web && E3_T19_DEMO=1 npx playwright test tests/e3-t19-demo-proof.spec.js`: passed in 12.3s.
  The page reached 126 passed / 0 failed with zero application console errors and rendered the
  verified E3-T19 lifecycle/relay-policy row.

`browser-demo-126-of-126.png` is the resulting full-page screenshot. SHA-256:
`7773021d1c41debb1b0702a58815bd92d1053fba19134b89d8d521c947132bff`.

The already-verified parent E3-T17 evidence remains the oracle for unchanged full-guest exit-node
selection/clearing, public HTTPS via the exit, admin revocation, hostname/key failure matrices,
control-plane outage, 1 GiB bounded flow behavior, and the 100 MiB Alpine relay fallback. E3-T19
changes the deploy/security boundary around those paths and replays their permanent tests; it does
not replace the previously recorded multi-hour guest transfers with a new claim.

The final acceptance run repeated `make web-build && make verify-E3-T19` from a pristine clone of
`f9cdb00` with Rust/Cargo build overrides and `RUST_LOG` removed from the environment. It ended with
`verify-E3-T19 (provider lifecycle + relay security): OK`; the live-proof trap removed every
compose container, network, named volume, and generated one-shot secret before the browser policy
suite ran.
