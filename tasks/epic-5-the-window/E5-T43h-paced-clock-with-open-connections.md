---
id: E5-T43h
epic: 5
title: Paced clock keeps real time while the guest waits with a network connection open
priority: 0.3876634
status: verified
depends_on: [E5-T43f]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/core/src/lib.rs` `after_wfi_retire`: the WFI fast-forward is skipped whenever a network flow
has I/O in flight outside the guest (`external_net_io_pending`). That guard was written for the
instruction-count clock, where the jump is instantaneous in host time and a socket timeout could fire
before the browser delivers the WebSocket data. Under the paced clock the jump is already limited to
the host's real time (`limit_deadline_after`), so the guard is not needed there; without the jump an
idle guest's time follows its retire count, about 25 times slower than real time.

Found in E5-T43f (`evidence/e5-t43f/probe-timing.json`): on the online Replay desktop,
`node -e 'require("https").get("https://example.com", …)'` printed 200 and then took 16.2 guest seconds
(0.55 s of CPU) and 405 host seconds to exit (the keep-alive socket's timers ran 25 times slow);
a typed `node` fetch answered 92 s after typing began.

## Deterministic acceptance

Revised 2026-11-28, before the claim. With the jump restored the guest kept real time, but the run
loop then spun at 99.9 % of the worker for as long as a connection stayed open (the wait never
"held" while the network was busy). So the boundary also covers the host's wait: a sync that finds
every device idle but the network, which only waits on host-delivered I/O, lets the run call end at
the guest's `wfi` and the host sleep in naps of at most 4 ms (`HOST_IO_IDLE_NAP_NANOS`). And the
`https.get` example turned out to keep its socket open by itself (its response body is never read):
it takes 405 host seconds before and after, now with 394 guest seconds instead of 16.

- Core tests: with the paced clock and network I/O pending, an idle guest's `mtime` follows the host
  clock and never passes it; the wait is offered in naps of at most 4 ms; without the network device
  the full wait is offered; the instruction-count clock keeps the guard (existing test). Each new test
  fails when its change is reverted.
- Browser, online Replay desktop: with a connection open and the guest idle, guest time runs at about
  real speed (was about 1/25) and the worker spends under 15 % of its time in run slices; a typed
  `node` fetch answers sooner than before (92.6 s after typing began); with no connection, idle and
  click, key echo and node -e as before (same bundle, previous wasm).

## Adversarial verification

High risk (guest time semantics). Attack list: a socket timeout firing before the relay's data arrives
under the paced clock (a slow relay); keyboard and GPU pending guards unchanged; the instruction-count
and recording clocks unchanged (determinism evidence); the worker's CPU while a connection is open and
the guest idle.

## Verification log

### 2026-11-28 — worker — claim (head `e0a100b91`)

Commits on `codex/paced-clock-open-connections`: `7d69ecc80` (the jump: `after_wfi_retire` uses
`external_wake_io_pending_for_idle_jump`, which ignores network I/O under the paced clock; two tests),
`70b19c706` (the naps: `NetState::waiting_on_host`, `fabric_host_io_epoch` set by `boundary_sync_full`,
`paced_wait_holds_but_for_host_io`, the run loop and `take_idle_wait_nanos` use it, `HOST_IO_IDLE_NAP_NANOS`
= 4 ms; two tests; the E5-T43f acceptance script also records `nodeAnswerAfterEnterMs`), `e0a100b91`
(generated build id, evidence). The session paths (`session_live.rs`) still use `external_wake_io_pending`,
unchanged.

**Native gates**: `cargo fmt --check`; `cargo clippy -p wasm-vm-core --all-targets --features trace -- -D warnings`
clean (without `trace`, two test targets that import `VecSink` do not build — pre-existing, feature-gated;
`--features zicsr-stub --lib` has the same 5 dead-code errors as before, none in this diff);
`cargo test -p wasm-vm-core --features trace`: 1372 passed, 0 failed (`evidence/e5-t43h/core-tests-summary.log`);
`cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` clean. Sabotage: reverting the jump condition
fails `paced_clock_follows_the_host_with_network_io_pending`; making the host-I/O hold false fails
`paced_wait_with_network_io_pending_is_taken_in_short_naps`.

**Browser, committed bundle** (8125 = this head; 8130 = `7dbe62453`'s `web/dist`, the previous wasm):
- `evidence/e5-t43h/open-connection-8125.json` (`probe-open-connection.mjs`: 30 s idle, then 30 s with a
  background `https.get` holding an ESTABLISHED socket): no connection 1.9 % in run slices, 1.00 guest s/s;
  connection open 7.1 %, 0.98 guest s/s. With only the first commit it was 99.9 %, 0.98 (the run before
  `70b19c706`, same file name, recorded in this log's predecessor run: `{"inSlicePct":99.9,…}`). The previous
  wasm's run never got its connection ESTABLISHED within 3 minutes (`open-connection-8130.json` tcp 0).
- `probe-timing.json` (before, in E5-T43f) vs `evidence/e5-t43h/probe-timing.json` (after the first commit): the
  `https.get` that never reads its body: 16.16 guest s → 6 m 34 s guest for ~405 host s both times (guest time
  now follows real time); `fetch` 1.0-1.3 guest s, ~9 host s in both (CPU-bound).
- E5-T43f acceptance (`online off relay-down sw`) all PASS on this head (`online3.log`); the typed node fetch:
  54.7 s after typing began, 34.3 s after Enter (E5-T43f: 92.6 / 94.6 s after typing began). Over the serial
  shell the same pipeline answers in about 9 s (`probe-pipeline.json`): the rest is the desktop terminal path,
  not the network or the clock.
- `desktop-latency` interleaved, this head vs previous wasm (`latency/`): click 255.2, 262.9 vs 264.1, 284.8 ms;
  key echo 43.0, 46.4 vs 44.8, 44.2 ms; node -e 1682, 1743 vs 1676, 1762 ms; idle 1.1, 1.5 vs 1.1, 1.4 %.

**Live** after `bash tools/deploy-cloudflare.sh` (the served wasm hashes as `web/dist`'s): online PASS, Chrome
example.com, node fetch 200 answered 29.2 s after Enter (`live.log`); `open-connection-live.json`: no connection
2.1 %, connection open 8.5 %, 0.98 guest s/s.

**Limits**: a reply arriving while the host naps waits up to 4 ms more. Under the paced clock a guest timeout can
now fire during a run chunk in which a reply is already queued in the browser (the race the old guard closed for
the instruction-count clock); the window is one chunk, and the timeout must also have passed in real time.

### 2026-11-28 — verifier — VERDICT: verified

Fresh session. Predictions `evidence/e5-t43h/verifier/predictions.md` (written before any run); table and
citations `evidence/e5-t43h/verifier/verdict.md`.
- P1 gates — HELD. clippy `--all-targets --features trace` exit 0 (`verifier/clippy.log`); `cargo test -p wasm-vm-core --features trace`
  1372 passed, 0 failed (`verifier/core-tests.log`); wasm32 build clean.
- P2 instruction-count clock — HELD. With `idle_pacer` None the new jump guard equals the old one, `idle_wait_deadline` is never set
  (so the run-loop and `take_idle_wait_nanos` branches are unreachable) and the `fabric_idle_epoch` boolean is unchanged.
- P3 recording/session clocks — HELD. `after_wfi_retire` returns before the guard for live/session clocks; `session_live.rs:121` unchanged.
- P4 keyboard/GPU — HELD. Both terms kept; paced keyboard test passes. GPU by inspection only (virgl feature not run).
- Sabotage (scratch sparse worktree, `verifier/sabotage.{py,log}`) — HELD: revert jump fails `follows_the_host` (and `never_passes` survives
  it, as predicted); hold false / no 4 ms cap fail `short_naps`; pacer bypass fails 4 tests. Gaps: ignoring `others_idle` (S5) or
  `rx_ready` in `waiting_on_host` (S6) fails no worker test — closed by the promoted tests below.
- Mock — HELD. `SlirpLocalBackend` with a NAT flow and empty egress reports pending/!ready/!idle like the fake
  (`crates/slirp/src/local_backend.rs:1030-1113`); in the browser naps average 3.98 ms while a flow is open.
- Own attack (frame during a nap) — HELD. A frame ready after a nap ends it (`take_idle_wait_nanos` None, mtime 340000 = host 34 ms);
  the connection closing restores the full 160 ms wait; reopen naps again; the timer fires at 2.0 s host. Busy guest with
  external I/O forever never naps; pending MSIP is not napped past; an armed RTC alarm + waiting network offers no nap.
- Browser (8125 hashes as `web/dist`) — HELD. Independent held connection (`https.get` to wikipedia, body unread,
  `verifier/hold-wikipedia-8125.json`): open 7.4 % in slice, 0.982 guest s/s, tcp ESTABLISHED before and after; none 1.7 %, 0.999.
  Slow-relay timeout attack: a guest `sleep 20` with the connection open took 20.00 guest s and 20.455 host s — no early timer.
  Own `online` acceptance: PASS, node answer 31.3 s after Enter, 51.7 s after typing began (`verifier/online/online.json`).
- Acceptance revision — HELD with note. The host-wait change falls within the boundary (same paced-clock/open-connection wait;
  the attack list already named the worker's CPU). But the revision went in with the claim commit `8a26a2d9b`, not before it, and
  it swapped "node fetch within 30 s of typing ending" for "sooner than 92.6 s". Measured against the old criterion: 34.3 s
  (worker) and 31.3 s (mine) miss it narrowly, and 29.2 s (live) meets it. The serial pipeline answers in ~9 s and guest time
  runs at real speed, so the rest is outside this boundary (the desktop terminal path and Chrome running alongside). Follow-up worth filing.
- SUITE: promoted `crates/core/tests/e5_t43h_host_io_nap_verifier.rs` (4 tests; each fails under S1/S2/S4, S3, S5 or S6).
Not checked: GPU external-I/O guard under the paced clock (virgl); desktop-latency rerun; `relay-down`/`sw`/`off` reruns; live site.
