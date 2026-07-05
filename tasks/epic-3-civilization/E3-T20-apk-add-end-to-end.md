---
id: E3-T20
epic: 3
title: apk add end-to-end against a real Alpine mirror — install and run the userland targets (QuickJS, Node.js)
priority: 320
status: pending
depends_on: [E3-T15, E3-T16, E3-T17]
estimate: M
capstone: false
---

## Goal
`apk update && apk add <pkg>` works in the browser-hosted guest against a real Alpine
riscv64 mirror through the full stack — DHCP lease, DNS via the forwarder, TCP through the
configured transport, signature verification by apk, package installed and runnable. This is
the integration milestone the entire networking arc exists for — and the delivery vehicle
for Epic 3's **named userland targets**: `apk add` is how **QuickJS** (`quickjs`) and
**Node.js** (`nodejs`) arrive in the guest. Getting them installed here sets up E3-T28's
capstone, which proves they actually *run* (interpreted — correctness now, speed at E4).

## Context
This task is mostly integration debugging, so scope it as such: no new subsystems, but fix
what the real world exposes. Decisions to nail down: which mirror URL ships in
`/etc/apk/repositories` (coordinate with T11 — plain-HTTP mirror is acceptable since apk
verifies package signatures; document the integrity/privacy tradeoff) and which transport
carries it by default (relay via T16 is the general answer; a CORS-enabled or same-origin
mirror via T17 is the zero-infra answer — support both behind the T17 routing config and
state the shipped default). Expect and handle: apk's multiple concurrent connections,
mirrors that close keep-alive connections aggressively, large `APKINDEX.tar.gz` transfers
over a laggy relay, and clock skew (guest RTC — if Epic 2's time source drifts badly, TLS
and apk `--force` workarounds hide bugs; verify guest wall-clock is sane via SBI/RTC before
blaming the network). Add a boot-time smoke command `apk-net-check` (script in the image)
that curls the mirror and prints a diagnosis for support purposes.

## Deliverables
- Working default configuration: repositories file (T11 coordination), transport routing
  rules, and any slirp/transport bug fixes the integration surfaces (each fix gets a test
  in its home crate).
- `apk-net-check` diagnostic script baked into the image.
- A scripted browser E2E test (headless): boot → `apk update` → `apk add ripgrep` (small,
  has a binary) → run `rg --version`, asserting on terminal output.
- Timing numbers in the log: `apk update` and `apk add ripgrep` wall-clock over the relay
  on a normal connection.

## Acceptance criteria
- [ ] From a cold boot in the browser: `apk update` exits 0 with the real mirror's index
      fetched (no local mirror, no test doubles), then `apk add ripgrep` exits 0 and
      `rg --version` prints a version.
- [ ] The same flow succeeds with the transport forced to the relay (T16) and — if a
      CORS-viable mirror is configured — via the fetch gateway (T17); each run recorded.
- [ ] apk signature verification is actually on (`apk add` of a deliberately
      hash-corrupted package via a tampering test proxy fails with a signature/integrity
      error — proving we didn't ship `--allow-untrusted` anywhere).
- [ ] `apk add nodejs quickjs` (the capstone userland runtimes) completes over the network,
      `node --version` and `qjs --help` both run; wall-clock recorded. (`apk add python3` as
      an additional ~50 MB-with-deps stress case also completes in under 5 minutes.)
- [ ] `apk-net-check` prints PASS on a healthy stack and a specific failing layer (DNS /
      TCP / HTTP) when the verifier disables each in turn.

## Adversarial verification
Break the network mid-flight: drop the relay WebSocket during `apk add python3` — apk must
fail with a normal download error and a retry must succeed after reconnection; a hung apk
or corrupted partial install (`apk fix` needed) refutes. Run the tampering proxy (flip bytes
in a .apk body) and confirm signature rejection. Throttle to 1 Mbps and confirm no timeout
cascade kills the install. Run `apk add` twice concurrently in two guest shells — apk's own
locking should serialize; a slirp-level failure under the concurrent connection load
refutes. Verify DNS actually flowed through 10.0.2.3 (forwarder counters) and not some
test backdoor. Finally: fresh browser profile, cold cache, full flow once — any manual
guest network configuration step refutes the zero-config claim.

## Verification log
(empty)
