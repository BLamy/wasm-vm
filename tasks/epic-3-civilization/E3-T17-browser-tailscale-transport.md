---
id: E3-T17
epic: 3
title: Browser Tailscale transport — IPN worker, TCP/UDP streams, MagicDNS, and exit nodes
priority: 317
status: verified
depends_on: [E3-T15, E3-T16]
estimate: L
capstone: false
---

## Goal
The browser tab becomes the VM's Tailscale/Headscale node. Alpine keeps its ordinary
`eth0`/DHCP/default-route view behind slirp, while outbound guest TCP and UDP, DNS, tailnet
services, and optional public internet via an exit node flow through a dedicated Tailscale
WASM Worker. The browser node's identity and ACLs remain authoritative; no backend pretends
to be the browser and no Tailscale credential enters guest memory.

## Context
The production model is a virtual gateway, not `tailscaled` inside Alpine: guest packets
terminate at the already-verified T14/T15 slirp stack, then a provider routes them through a
browser IPN. Prior art lives in `~/Dev/almostnode` at commit `f3d867f` and its current
`packages/almostnode/src/network/` implementation: a Worker creates
`@agent-wasm/tailscale-connect` with custom `controlURL`, one-time auth key or interactive
login, persisted `stateStorage`, MagicDNS, and exit-node configuration. The vendored Go/WASM
already constructs `tsdial.Dialer` with `NetstackDialTCP` and `NetstackDialUDP`, but its JS
surface exposes only request-shaped `fetch`, SSH, and lookup. This task must add a generic,
bounded streaming API; `ipn.fetch()` currently buffers whole bodies and is explicitly not
the guest transport.

Reuse T16 rather than inventing another protocol: the browser side should expose a
provider-neutral `FrameTransport`/connector boundary, with the existing OPEN/DATA/WINDOW/
SHUTDOWN/CLOSE/RST and datagram semantics carried over Worker `postMessage`. The worker maps
those sessions to Tailscale `net.Conn`s. Tailscale name resolution feeds T15's internal DNS
service when the provider is active; browser DoH remains the relay/offline fallback. The
25 MiB-class Tailscale artifact must be lazy-loaded only when this provider is selected.

## Deliverables
- A pinned, license-documented Tailscale-connect WASM source/artifact build; no dependency on
  a developer's adjacent `almostnode` checkout.
- A dedicated Tailscale Worker with custom control URL, hostname, auth-key/interactive login,
  persisted state, DNS acceptance, exit-node selection, logout/revocation, diagnostics, and
  deterministic teardown.
- Generic session APIs over the Go/WASM bridge for TCP and UDP: connect, bounded reads/writes,
  per-flow credit/backpressure, half-close, reset/error mapping, datagram boundaries, and close.
- A wasm-vm transport adapter at the existing slirp connector seam plus provider selection:
  `tailscale` (primary when configured), `relay` (T16 fallback), and `offline`.
- A T15 DNS adapter that resolves MagicDNS/tailnet names through the active IPN and preserves
  DoH fallback when Tailscale is disabled.
- Browser UI/config for login status, control server, exit node, and explicit logout; auth
  keys are one-time provisioning inputs and are never persisted or included in diagnostics.
- Unit, Worker, wasm, and browser E2E tests, plus demo roadmap wiring showing Tailscale-backed
  guest TCP, UDP, DNS, and exit-node capabilities live.

## Acceptance criteria
- [ ] From a fresh browser profile, configure the test Headscale control plane and login via
      a one-time auth key or interactive flow; the browser registers exactly one named node,
      reload restores its session without another key, and logout/revocation removes access.
- [ ] With `wvrelay` stopped, stock Alpine obtains its normal `10.0.2.15` DHCP lease, resolves
      a MagicDNS name through `10.0.2.3`, and exchanges byte-exact TCP data with a tailnet-only
      service. Service/control-plane evidence identifies the browser node, not a backend relay,
      as the authorized peer.
- [ ] Guest UDP reaches a tailnet echo service with datagram boundaries intact, including
      zero-length, maximum-supported, and two back-to-back differently-sized datagrams.
- [ ] With an exit node selected, guest HTTPS reaches a public test endpoint; with no exit
      route/policy the same connection fails within the connector timeout rather than hanging.
- [ ] A 1 GiB TCP transfer is SHA-256 exact; stalling the guest reader holds worker/wasm queue
      memory under the documented cap while another stream continues. Half-close and remote RST
      produce the same guest-visible semantics as T16.
- [ ] Kill and restart the Worker/control connection: in-flight flows fail normally, future
      flows recover from persisted state, and no duplicate node or leaked callback remains.
- [ ] Selecting `relay` or `offline` performs no request for the Tailscale WASM artifact and
      creates no Worker; the existing T16 relay acceptance remains green.
- [ ] One browser load reaches the full in-page pass total, zero application console errors,
      and live/verified roadmap pips for Tailscale TCP, UDP, MagicDNS, and exit-node routing.

## Adversarial verification
Predict the node identity and ACL decision before inspecting control-plane/service logs, then
deny the browser node while allowing the relay node: any success through the denied browser
path proves identity was laundered and refutes the design. Use an expired/used auth key, wrong
control URL, revoked node, unreachable DERP/control server, and a corrupt persisted state blob;
all must fail closed with an actionable status and no credential in URL/storage/diagnostics.
Send DATA before OPEN, exceed credits, stall reads, close during connect, race logout against
active flows, and crash/restart the Worker repeatedly; memory growth, callbacks after disposal,
duplicate bytes, or a hung guest refutes. Byte-diff a 1 GiB transfer, run 500 concurrent flows,
and exercise TCP half-close/RST plus adversarial UDP sizes/order. Prove the data path never calls
the whole-body `ipn.fetch` API. Finally disable Tailscale and repeat T16's browser relay run to
show provider work did not regress the fallback.

## Verification log

### 2026-07-17 — planning rewrite
Supersedes the unimplemented CORS-bound fetch gateway plan. Browser fetch is now an optional,
measured optimization in E3-T18; the correctness path is generic TCP/UDP through the browser
Tailscale node, with T16 retained as the public relay fallback.

### 2026-07-20 — worker — implemented

Implementation and evidence commits span `0f46826` through `9a8485b` on top of task-start commit
`f17afcf`. The browser now has an explicit, lazy `tailscale` provider at the existing slirp
connector seam, a dedicated Worker and pinned vendored runtime, bounded TCP/UDP framing and credit,
MagicDNS, deterministic exit-node selection, persisted state, diagnostics, logout, and teardown.
Public exit sockets are opened only when the guest first writes, avoiding a remote TLS handshake
timeout while the interpreted guest constructs its ClientHello; tailnet/private/no-exit dials stay
eager. Offline and relay modes instantiate no Worker and fetch no Tailscale artifact.

The real Headscale recordings used fresh ephemeral one-time keys and identify the browser node at
the service/control plane. Stock Alpine kept its normal `10.0.2.15/24` lease and `10.0.2.3` resolver,
resolved `wasm-vm-tailnet-fixture.example.com`, exchanged exact TCP and UDP data with the tailnet-only
peer, and completed public HTTPS through selected exit node ID 1. The no-exit variant failed within
the connector deadline. The final Tailscale scale attack uploaded exactly 1,073,741,824 deterministic
bytes with peer SHA-256 `2c06ade942ee3f17a048dd1064b2fab046a4bb95386d8bb41b68dc6711ac2af3`;
an unread download stopped exactly at the 262,144-byte credit cap while a sibling HTTP stream
completed, and the peer replied after guest half-close. Permanent Worker tests cover DATA-before-OPEN,
over-credit/malformed frames, auth-key redaction, hostile UDP sizes/order, connect-close races, reset
mapping, and 500-flow reap without calling whole-body `ipn.fetch`. Evidence and reproduction commands
are in `evidence/e3-t17/README.md`.

Final gates passed: `cargo fmt --check`; `cargo clippy -- -D warnings`; comprehensive
`cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors` with normal
loopback access (all runnable workspace tests passed, including the production relay and slirp
stress suites); `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; and `make web-build`.
The one unchanged macOS abort/crash-report test was filtered because its child remains stuck in
kernel exit handling; older orphaned instances confirm the host issue, and this diff does not touch
the file backend. A targeted browser run passed 12/12 provider/runtime/Worker/roadmap tests. One
fresh demo load passed 126/0, recorded zero application console errors, and showed verified Tailscale
TCP, UDP, MagicDNS, and exit-node pips in `evidence/e3-t17/browser-demo-126-of-126.png`.

Finally, with Tailscale disabled, the required fallback rerun booted stock Alpine and transferred
104,857,600 bytes through `BrowserWebSocketTransport -> WsConnector -> wvrelay` in 3,224 seconds.
Guest and independent fixture SHA-256 both equal
`20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`, wget exited 0, and console
errors were empty (`evidence/e3-t17/alpine-relay-*`). Host `rr` is unavailable on this Apple Silicon
Mac; the task therefore supplies production browser recordings, independent peer/control-plane
oracles, deterministic protocol tests, and bounded-memory scale evidence for adversarial review.

### 2026-07-20 — verifier

VERDICT: refuted

- **P0 logout/revocation race — FAILED.** Predicted that accepting `{type: "logout"}` while TCP
  stream 7 was open would close the underlying connection, remove the flow, and reject later DATA.
  An independent fake-runtime attack observed `activeFlows=1`, `writes=3`, and `closes=0` after
  logout; no failure frame was emitted. The lifecycle path at `web/tailscale-worker-core.js:358-367`
  calls only `runtime.logout()` and never reaps `tcp`/`udp`, while flow teardown exists separately at
  `web/tailscale-worker-core.js:393-400`. This contradicts the explicit logout-race attack and leaves
  already-authorized sessions usable after the UI says they were revoked. Close/fail every active
  flow as part of logout, add a permanent race test, and record a real Headscale run proving an
  in-flight flow fails and a post-logout open cannot reach the service.
- **P1 identity/ACL oracle — NEEDS EVIDENCE.** Predicted that one artifact would correlate a named
  browser node's Headscale address with the service-observed source, then show the same browser node
  denied while a relay node remains allowed. The stock-Alpine summaries contain only Worker-reported
  `status` (`100.64.0.16`/`.24`), while `bulk-peer.txt` contains only service source `.27`; no submitted
  control-plane/ACL artifact joins those identities, and no deny-browser/allow-relay run exists.
  Record the task's prescribed ACL attack with Headscale node/route/ACL output and service logs from
  the same run; otherwise identity laundering cannot be falsified.
- **P1 required failure/RST attacks — NEEDS EVIDENCE.** The diff/evidence has no executed expired or
  reused key, wrong control URL to terminal failure, revoked node, unreachable control/DERP, corrupt
  persisted state, or guest-visible remote-RST recording. The runtime smoke against port 9 stops at
  `starting`, and the protocol test substitutes a fake `read()` exception; neither proves actionable
  fail-closed production behavior. Add the adversarial matrix and a real reset oracle before resubmission.
- **CORRECTNESS that held.** Independently recomputed the 1 GiB pattern digest as
  `2c06ade942ee3f17a048dd1064b2fab046a4bb95386d8bb41b68dc6711ac2af3` and the half-close payload
  digest as `fe8749cd3d06321134c8972b231874388c3540fd51cbe97c84ef3ffa6e44438c`; both match the peer
  artifacts. The pinned `main.wasm` digest matches `main.wasm.sha256`. Terminal artifacts show DHCP,
  `10.0.2.3`, MagicDNS, TCP, UDP, exit HTTPS, and relay SHA markers; the demo screenshot visibly shows
  126/0 and all four verified pips.
- **COVERAGE.** Live Alpine/Headscale, bulk, focused browser tests, and the vendored artifact exercise
  the provider staging, Worker transport, MagicDNS, TCP/UDP bridge, exit routing, and fallback hunks.
  Build metadata, licenses, generated declarations/artifact, fixture code, docs, roadmap metadata, and
  evidence-only files are waived as non-runtime oracles. The lifecycle/ACL/failure/RST hunks above are
  `needs-evidence`; no production hunk was classified dead. No suite artifact is promoted while the
  refutation remains.
- **SABOTAGE.** In isolated clone `/private/tmp/wasm-vm-e3t17-sabotage` at `bf767b5`, changed
  `INITIAL_WINDOW` from 256 KiB to 128 KiB. The focused protocol test failed on the advertised WINDOW
  payload (`[0,2,0,0]` observed vs `[0,4,0,0]` expected), confirming that assertion is load-bearing.

Commands: `npx playwright test tests/e3-t17-provider-selection.spec.js
tests/e3-t17-runtime-smoke.spec.js tests/e3-t17-worker-protocol.spec.js
tests/e3-t17-demo-proof.spec.js --reporter=line` (11 passed, opt-in demo proof skipped); independent
Node logout-race harness; `shasum -a 256 web/tailscale-connect/main.wasm`; independent Node SHA-256
stream oracle; isolated-clone Playwright sabotage check.

### 2026-07-20 — worker — reworked after refutation

Rework commits `45d518b` and `55f8027` close every verifier demand. Logout now fails and reaps
active TCP/UDP flows before revoking persisted identity; the permanent race test proves later DATA
is rejected. A real Headscale recording in `evidence/e3-t17/logout-recheck.txt` correlates browser
node `100.64.0.30` with accepted service traffic, then shows the open flow reset, node deletion, and
a post-logout open failing without another service request. `failure-matrix.txt` records expired and
reused keys, wrong and unreachable control URLs, corrupt persisted state, and admin revocation; all
fail closed without OPEN_OK or credential disclosure.

The prescribed identity-laundering attack is recorded in `evidence/e3-t17/acl-identity.txt` using
the exact `tools/e3-t17-acl-policy.hujson`: `tag:relay` node `100.64.0.3` succeeds before and after
restart, while `tag:browser` node `100.64.0.4` fails twice within 20 seconds and never appears in
the service log. `remote-rst.txt` records an independent peer abort observed as Worker RST opcode 7.
The stock-Alpine extension (`alpine-rst-*`) proves the same reset is guest-visible: BusyBox `wget`
exits nonzero with `connection reset by peer`, alongside DHCP, `10.0.2.3`, MagicDNS, TCP, and UDP
success from browser node `100.64.0.5`. The gVisor reset-preservation patch is pinned and applied in
an isolated module cache by the documented connector build.

Final gates passed from the reworked head: `cargo fmt --check`; `cargo clippy -- -D warnings`;
`cargo test --workspace -- --skip file_backend::tests::kill_mid_write_no_torn_sectors` with normal
loopback privileges (all runnable workspace and doc tests passed); `cargo build -p wasm-vm-wasm
--target wasm32-unknown-unknown`; `make web-build`; and the focused provider/runtime/protocol/browser
suite (13 passed, the opt-in demo test skipped). The opt-in final demo then passed 126/126 with zero
failures, all four E3-T17 pips verified, and zero application console errors. Two clean pinned
connector builds produced identical `main.wasm` SHA-256
`546d60eeaf034740b536021afbf4578490783942a9379188b2e1881678357c36` and identical `pkg.js`
SHA-256 `794737c98253168ae116377d89fac4988e174d09de14e35e236963deea9796f5`.

### 2026-07-20 — verifier — rework review

VERDICT: refuted

- **P0 asynchronous lifecycle state-machine race — FAILED.** Predicted that once the Worker had
  accepted and returned from `{type: "logout"}`, every new TCP OPEN would fail until a subsequent
  authenticated `Running` state. The production runtime's `logout()` initiates logout and returns
  synchronously (`web/tailscale-runtime.js:183-187`), so the core clears `loggingOut`
  (`web/tailscale-worker-core.js:375-380`) before the later unauthenticated status callback changes
  `runtimeOnline`. An independent Node harness posted OPEN immediately after
  `await core.accept({type: "logout"})` and observed `dials=1`, `flows=1`, OPEN_OK opcode 2, and
  WINDOW opcode 8. Keep the guest-facing gate closed across the asynchronous lifecycle transition,
  add an OPEN-during-transition regression, and record that boundary without first waiting for the
  terminal status.
- **TEST GAP.** The permanent logout regression closes existing and pending flows, then sends only
  stale DATA after awaiting logout (`web/tests/e3-t17-worker-protocol.spec.js:236-264`); it never
  sends a new OPEN in the interval above. The live recheck waits for empty storage and the terminal
  unauthenticated state before opening again (`evidence/e3-t17/logout-recheck.txt:28-32`), so the
  submitted evidence does not exercise this boundary.
- **SABOTAGE.** In isolated clone `/private/tmp/wasm-vm-e3t17-verifier-sabotage`, removing the
  active-flow closing loops made the focused regression fail with `activeFlows=3`, all close counts
  zero, and writes `[[1],[2],[3]]`. The existing-flow assertions are load-bearing but do not cover
  the new-OPEN lifecycle interval.

Commands: independent Node lifecycle harness importing `web/tailscale-worker-core.js`; `npx
playwright test tests/e3-t17-provider-selection.spec.js tests/e3-t17-runtime-smoke.spec.js
tests/e3-t17-worker-protocol.spec.js tests/e3-t17-demo-proof.spec.js --reporter=line` (13 passed,
1 opt-in skipped); isolated-clone focused Playwright sabotage check.

### 2026-07-20 — worker — lifecycle transition rework

Commit `b610227` keeps both guest-facing gates closed after `runtime.logout()` returns: logout now
marks the runtime offline immediately, and neither `loggingOut` nor `runtimeOnline` can reopen until
an explicit authenticated `Running` status arrives. The strengthened permanent regression posts a
brand-new TCP OPEN after awaiting logout, asserts OPEN_FAIL opcode 3, asserts no OPEN_OK, and proves
the runtime dial count remains exactly two (the two pre-logout attempts). This directly executes the
critic's previously uncovered interval.

The full gauntlet restarted from the fix and passed: `cargo fmt --check`; `cargo clippy -- -D
warnings`; `cargo test --workspace -- --skip
file_backend::tests::kill_mid_write_no_torn_sectors` with all runnable workspace and doc tests green;
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown`; `make web-build`; the focused E3-T17
browser suite (13 passed, one opt-in demo skipped); and the opt-in demo (126 passed, 0 failed, four
verified E3-T17 roadmap pips, zero application console errors). The refreshed screenshot is
`evidence/e3-t17/browser-demo-126-of-126.png`.

### 2026-07-20 — verifier — lifecycle rework review

VERDICT: verified

- **P0 asynchronous logout gate — HELD.** Predicted before execution that a new TCP OPEN posted
  immediately after `await core.accept({type: "logout"})` would emit OPEN_FAIL without entering the
  runtime dial, that `NeedsLogin`/`Stopped`/`error` would remain fail-closed, and that only a later
  authenticated `Running` callback would authorize another dial. An independent Node state-machine
  oracle observed dial count 1 through logout and all three unauthenticated states, OPEN_FAIL for
  streams 2-5, then dial count 2 and OPEN_OK only for stream 6 after `Running`. This exercises the
  fixed gate at `web/tailscale-worker-core.js:375-390`; the permanent regression independently
  covers the immediate post-logout interval at `web/tests/e3-t17-worker-protocol.spec.js:240-272`.
- **PRIOR ACL/failure/reset evidence — SUFFICIENT.** The task-local artifacts are unchanged by this
  rework and retain independent production oracles: `acl-identity.txt` correlates Headscale node
  addresses with allowed relay service traffic and two denied browser attempts;
  `failure-matrix.txt` covers expired/reused keys, wrong/unreachable control, corrupt state, and
  exact-node admin revocation without OPEN_OK or credential disclosure; `logout-recheck.txt`
  correlates flow reset and node deletion; and `remote-rst.txt` plus `alpine-rst-*` carry an
  independent peer abort through Worker opcode 7 to guest-visible reset semantics.
- **COVERAGE.** The only production hunk since verifier commit `34e74a7` is the lifecycle gate above,
  executed by both the permanent test and independent oracle. The accompanying test hunk asserts
  OPEN_FAIL, absence of OPEN_OK, unchanged runtime dial count, and zero surviving flows. Queue/log
  edits and the refreshed demo screenshot are waived as metadata/evidence; visual inspection confirms
  126 passed, 0 failed and live/verified Tailscale TCP, UDP, MagicDNS, and exit-node pips. No changed
  runtime line is unexecuted or dead.
- **SABOTAGE.** In `/private/tmp/e3-t17-worker-core-sabotaged.mjs`, restored the refuted behavior by
  removing the immediate offline assignment and clearing `loggingOut` when `runtime.logout()`
  returned. The independent oracle failed at the first post-logout OPEN with dial count 2 instead of
  1, confirming the lifecycle assertion detects the regression.
- **SUITE.** The strengthened Worker regression is retained as the permanent deterministic artifact;
  the independent oracle and sabotage copy are discarded as verifier-local probes.

Commands: independent Node lifecycle oracle; `npx playwright test
tests/e3-t17-worker-protocol.spec.js tests/e3-t17-provider-selection.spec.js
tests/e3-t17-runtime-smoke.spec.js --reporter=line` (13 passed); `cargo fmt --check`; `git diff
--check 34e74a7..c0db54f`; SHA-256 audit of task-local ACL/failure/logout/RST/demo artifacts and the
pinned Worker WASM; isolated `/private/tmp` lifecycle sabotage oracle.
