# E5-T43h verifier — VERDICT: verified

Head under test `8a26a2d9b` (code `e0a100b91`); predictions in `predictions.md` (written before any run).

| # | Prediction | Result | Citation |
|---|---|---|---|
| P1 | clippy/tests/wasm build clean | HELD | `clippy.log` (exit 0); `core-tests.log` 1372 passed 0 failed (`test exit 0`); `wasm-build.log` |
| P2 | ICount clock unchanged | HELD | lib.rs `external_wake_io_pending_for_idle_jump` == old guard when `idle_pacer` is None; `idle_wait_deadline` only set in the pacer arm of `wfi_fast_forward`; `idle` boolean identical; `external_network_io_suppresses_wfi_deadline_jump` ok |
| P3 | session/recording clocks unchanged | HELD | `after_wfi_retire` returns early for `live_unrecorded`/`session_clock`; `session_live.rs:121` still `external_wake_io_pending`; live work requires ICount (`session_live.rs:106`) |
| P4 | keyboard/GPU guards unchanged | HELD | both terms kept unconditionally; `production_keyboard_host_wait::paced_idle_still_honors_original_keyboard_waits_and_transport_reset` ok in `core-tests.log`. GPU (virgl feature) by inspection only |
| S1 | revert jump -> follows FAILS, never_passes PASSES | HELD | `sabotage.log` S1 |
| S2 | host-io hold false -> naps FAILS | HELD | `sabotage.log` S2 |
| S3 | drop 4 ms cap -> naps FAILS | HELD | `sabotage.log` S3 |
| S4 | bypass pacer -> never_passes FAILS | HELD | `sabotage.log` S4 (4 worker tests fail) |
| S5 | ignore `others_idle` -> no worker test fails | HELD (gap) | `sabotage.log` S5: worker tests 10/10 pass; closed by promoted `busy_other_device_with_network_waiting_is_not_napped` |
| S6 (extra) | ignore `rx_ready` in `waiting_on_host` | gap | worker tests pass; closed by promoted `frame_during_nap_ends_the_nap_and_closing_restores_full_wait` |
| M1 | SlirpLocalBackend open flow = (pending, !ready, !idle) like the fake | HELD | `crates/slirp/src/local_backend.rs:1030-1113`; browser naps average 3.98 ms with a flow open (`hold-wikipedia-8125.json`) |
| A1 | frame during nap ends nap; close restores full wait | HELD | promoted test, `A1 nap1=Some(4000000) mtime=300000 / nap2=None mtime=340000 / full=Some(160000000)` |
| A2 | no stale epoch nap | HELD (inspection + test) | cleared at run entry (lib.rs:7541), checkpoint drain (3662); session_network clears only `fabric_idle_epoch` but those paths never have a pacer and the same iteration's full sync recomputes it; busy guest never naps (promoted test) |
| B1 | 8125 = web/dist | HELD | wasm sha1 `18a57040…` both |
| B2 | held conn: 0.9-1.1 guest s/s, <15 % in slice | HELD | `hold-wikipedia-8125.json`: open 7.4 %, 0.982 s/s, tcp 1 before/after; none 1.7 %, 0.999 |
| B3 | guest timer not before real time with conn open | HELD | same file: `sleep 20` guest uptime +20.00 s, host 20.455 s |
| R | acceptance revision honest / one boundary | HELD with note | see log entry |

Own acceptance run: `online/online.json` online PASS, node answer 31.3 s after Enter / 51.7 s after typing began.
First probe run `tls-hold-8125-run1-connection-closed-early.json` discarded as evidence: the raw TLS socket closed inside the window (tcp 0 after).
