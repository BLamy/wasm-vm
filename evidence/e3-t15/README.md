# E3-T15 worker evidence

This directory freezes the final native and browser happy runs for E3-T15. The native run records the
guest instruction-trace digest and final architectural-state digest. The browser run is one cold page
load that boots an unmodified Alpine rootfs, attacks the unavailable-DoH path during boot, restores the
fixture, checks DHCP/DNS behavior from the stock guest, powers the guest off, runs the browser ISA suite,
and captures the roadmap state. Host `rr` evidence is unavailable on this Apple Silicon Mac and is not
required for this non-concurrency task.

## Native stock-Alpine run

Command (from the repository root):

```sh
WASM_VM_E3_T15_EVIDENCE_DIR=evidence/e3-t15 \
  cargo test --release -p wasm-vm-cli --test boot_alpine_dns -- --ignored --nocapture
```

Result: `1 passed; 0 failed` in 831.06 seconds. The stock guest acquired `10.0.2.15/24`, installed the
default route through `10.0.2.2`, wrote `nameserver 10.0.2.3`, resolved
`dl-cdn.alpinelinux.org` through the native OS resolver, returned NXDOMAIN promptly, retained the lease
through T1, and powered off with `Exited(0)`.

Guest evidence (`native-alpine.evidence`):

```text
trace fnv64=2055fdb40425bcb7
trace retired=4125455605
state sha256=5818d71379d664103ea256bb270ca04494e3f515029a4eef21192f30b932610c
outcome=Exited(0)
```

## Browser stock-Alpine run

Commands (three terminals, from the repository root):

```sh
make web-build
python3 tools/e3-t15-doh-fixture.py 8053
python3 -m http.server 8124 --directory web
node tools/e3-t15-browser-evidence.mjs
```

The final runner used Chrome through Playwright because the in-app browser bootstrap failed before page
creation with `Cannot redefine property: process`. The fallback still enforced the repository's single
load-and-assert rule: `coldLoads: 1`, no reloads, and no browser-side state injection.

Result: PASS after 737.5 seconds (`login:` at 635.8 seconds while DoH was deliberately hung). The run
proved:

- automatic DHCP address `10.0.2.15/24`, default gateway `10.0.2.2`, DNS `10.0.2.3`, and 60-second lease;
- DoH unavailable during boot did not hang OpenRC; guest `nslookup` returned failure in 0 seconds and
  `wget -T 5` returned failure in 5 seconds;
- successful browser DoH resolution after fixture recovery and two `cache.test` lookups with one upstream
  fetch;
- a large answer set TC in UDP (`flags=8380`), then an ordinary stock-guest `ping large.test` lookup
  resolved `large.test` to `192.0.2.1` through the resolver's automatic TCP retry; the evidence summary
  records `scriptedTcpQuery: false`, and the fixture saw exactly one upstream `large.test` lookup;
- NXDOMAIN returned in 0 seconds, and production DHCP counters directly observed stock-client renewal:
  `renewRequests`/`renewAcks` advanced from `7/7` before the T1 wait to `10/10` afterward, with no NAK,
  address loss, or gateway-connectivity loss;
- clean guest `Exited(0)`, browser suite `126 passed, 0 failed`, the E3-T15 roadmap pip marked `verified`,
  and zero console/page errors (favicon 404 ignored by policy).

The local DoH fixture is deterministic: `dl-cdn.alpinelinux.org` and ordinary success names map to the
documentation address `192.0.2.42`; it exposes request counts, a hanging mode, NXDOMAIN, and a large answer
set. The production browser code still uses the configurable RFC 8484 wire-format endpoint supplied via
`slirpDoh`.

## Permanent and adversarial gates

Final commands after the last test change:

```sh
cargo fmt --all -- --check
node --check tools/e3-t15-browser-evidence.mjs
python3 -m py_compile tools/e3-t15-doh-fixture.py
cargo clippy -- -D warnings
cargo test -p wasm-vm-slirp --test local_backend_dhcp
cargo test -- --skip file_backend::tests::kill_mid_write_no_torn_sectors
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown
make web-build
```

All exited 0. The comprehensive workspace run skipped only the unchanged
`file_backend::tests::kill_mid_write_no_torn_sectors`: an earlier unfiltered run reached that test after
the rework, but its macOS crash child became unkillable in kernel exit handling. That same test had
passed in the prior full E3-T15 run, and this task does not touch the file backend. Every networking
test ran, including 214 slirp tests; the verifier-promoted
`full_dns_queue_returns_immediate_servfail_over_tcp` regression is green. The suite used normal macOS
loopback access because the restricted command sandbox returns `EPERM` for existing socket-backed tests.
The focused DHCP integration has three passing cases: full handshake, wrong-address NAK followed by
client recovery to the static lease, and 60-second T1 renewal with a parseable pcap. Existing
deterministic tests also cover malformed DHCP/DNS fuzz cases, TTL expiry and cache reuse, bounded
resolver failure, and UDP truncation/TCP DNS framing.

## SHA-256

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  browser-console-errors.txt
37066e2574e3f29c7dca8fcd644dc4e756ca19cda6e4db385b6c00a9d902d574  browser-roadmap.png
47aede2b3ea3596316e31de07b3aad8da09beb9ede686763d6f4cc03833aeeda  browser-suite.png
c07bc246985fac49c2b9d1d858fa135b6d1d75cf4c661f5da45b5a8506d5a34e  browser-summary.json
1ede43439604307efe4fd8342709c624ce33b6882914e6a6fab4824f97f9c8a6  browser-terminal.png
c9778695a6a2758f6762a1f3dd84bdb6f344a7b10fc7a635b57515a48227d940  browser-terminal.txt
f6e41b644966e5fdf168de1f0719146cd29035111ee64a91359c38aef2ac92c8  native-alpine-transcript.txt
3d74e35c884a32da5390d281c40f18cd0f7eb1ed98d7d32acb64072c78977718  native-alpine.evidence
```
