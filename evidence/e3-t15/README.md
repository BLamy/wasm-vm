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

Result: `1 passed; 0 failed` in 915.17 seconds. The stock guest acquired `10.0.2.15/24`, installed the
default route through `10.0.2.2`, wrote `nameserver 10.0.2.3`, resolved
`dl-cdn.alpinelinux.org` through the native OS resolver, returned NXDOMAIN promptly, retained the lease
through T1, and powered off with `Exited(0)`.

Guest evidence (`native-alpine.evidence`):

```text
trace fnv64=9948a06638286510
trace retired=4158532862
state sha256=d45f529a69fd266c5bbf4507baba0240b0bd9eacf758d6638556c22606e8ace1
outcome=Exited(0)
```

## Browser stock-Alpine run

Commands (three terminals, from the repository root):

```sh
make web-build
python3 tools/e3-t15-doh-fixture.py 8053
bash tools/serve-dev.sh 8124
node tools/e3-t15-browser-evidence.mjs
```

The final runner used Chrome through Playwright because the in-app browser bootstrap failed before page
creation with `Cannot redefine property: process`. The fallback still enforced the repository's single
load-and-assert rule: `coldLoads: 1`, no reloads, and no browser-side state injection.

Result: PASS after 980.4 seconds (`login:` at 846.1 seconds while DoH was deliberately hung). The run
proved:

- automatic DHCP address `10.0.2.15/24`, default gateway `10.0.2.2`, DNS `10.0.2.3`, and 60-second lease;
- DoH unavailable during boot did not hang OpenRC; guest `nslookup` returned failure in 0 seconds and
  `wget -T 5` returned failure in 5 seconds;
- successful browser DoH resolution after fixture recovery and two `cache.test` lookups with one upstream
  fetch;
- a 40-A-record response set TC in UDP (`flags=8380`), then the same stock guest sent the framed TCP query
  and received the complete 670-byte response ending in `192.0.2.40` (`c0000228`);
- NXDOMAIN returned in 0 seconds, and the 60-second lease renewed at T1 without losing the address or
  gateway reachability;
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
cargo test
cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown
```

All exited 0. The full suite ran with normal macOS loopback access because the restricted command sandbox
returns `EPERM` for the repository's existing socket-backed tests. The focused DHCP integration has three
passing cases: full handshake, wrong-address NAK followed by client recovery to the static lease, and
60-second T1 renewal with a parseable pcap. Existing deterministic tests also cover malformed DHCP/DNS
fuzz cases, TTL expiry and cache reuse, bounded resolver failure, and UDP truncation/TCP DNS framing.

## SHA-256

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  browser-console-errors.txt
37066e2574e3f29c7dca8fcd644dc4e756ca19cda6e4db385b6c00a9d902d574  browser-roadmap.png
c0862d0f9d4269d8df3a127b2356bf6af73b4dd34e420a7083235f46f14f415b  browser-suite.png
438df4e0f536d8b56c14ac1ce55089fc7b0d82e4ce14cb3551ff162b62a32dfd  browser-summary.json
f12bf756eb3e27e9b0a74b925f0b9f6ef0796fc3e532b97a21e1c2e901874f76  browser-terminal.png
043a9fae242e8c799367e6204e6209d9b01a84f5e961c237a0fd42e6e0555916  browser-terminal.txt
8a92ec7db1585fa166a433c9c006acc971b755f4e927f2ee02d7bc6a3e33076e  native-alpine-transcript.txt
02c8a16fd82909f9f01f250e4730e3405b2bcaf8eb6d4047db176af432deddb0  native-alpine.evidence
```
