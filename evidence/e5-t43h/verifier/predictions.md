# E5-T43h verifier predictions (written before running anything or opening the worker's result files)

Head under test: `8a26a2d9b` (claim), code head `e0a100b91`. Base: `7dbe62453` (E5-T43f verified).
Read so far: task file, AGENTS.md, the diff (crates/ + tools/verify), surrounding code in
crates/core/src/{lib.rs,time.rs,session_live.rs,session_network.rs,turbo.rs}, crates/core/src/dev/virtio/net.rs,
crates/slirp/src/local_backend.rs (NetBackend impl), web/idle-sleep.js, web/loader.js runChunk loop.

## Core / determinism
- P1 gates: `cargo clippy -p wasm-vm-core --all-targets --features trace -- -D warnings` clean;
  `cargo test -p wasm-vm-core --features trace` 0 failed; wasm32 build of wasm-vm-wasm clean.
- P2 instruction-count clock unchanged: with `idle_pacer == None`, `external_wake_io_pending_for_idle_jump`
  equals `external_wake_io_pending`; `idle_wait_deadline` stays u64::MAX (set only in the pacer arm of
  `wfi_fast_forward`), so the new run-loop and `take_idle_wait_nanos` branches are unreachable; the
  `idle` value written to `fabric_idle_epoch` is the same boolean as before (`idle &= service(..)` ==
  `others_idle && net_busy.is_none()`). The existing `external_network_io_suppresses_wfi_deadline_jump` passes.
- P3 recording/session clocks unchanged: `after_wfi_retire` returns before the changed guard when
  `live_unrecorded` or `session_clock` is set, and `prepare_live_work` still calls `external_wake_io_pending`
  (and live_unrecorded requires ICount). No session test changes outcome.
- P4 keyboard/GPU guards unchanged under the paced clock: a paced machine whose keyboard awaits a host
  key release (or GPU external I/O) still does not jump. Inspection: the two terms are kept unconditionally.
  I will add a scratch test for the keyboard case if a constructor is reachable from integration tests.

## Sabotage (scratch copy, never the working tree)
- S1 revert the jump condition (use `external_wake_io_pending`) -> `paced_clock_follows_the_host_with_network_io_pending`
  FAILS; `paced_clock_never_passes_a_stalled_host_with_network_io_pending` PASSES (it cannot discriminate this revert).
- S2 `paced_wait_holds_but_for_host_io` -> false -> `paced_wait_with_network_io_pending_is_taken_in_short_naps` FAILS.
- S3 drop the `.min(HOST_IO_IDLE_NAP_NANOS)` cap -> the short-naps test FAILS (nap ~90 ms).
- S4 bypass the pacer in the jump (jump straight to `d` under the paced clock) -> `never_passes_a_stalled_host` FAILS.
- S5 set `fabric_host_io_epoch` ignoring `others_idle` -> I predict NO new test fails (coverage gap; a second
  busy device is not exercised). Severity depends on whether another busy device could then be napped past.

## Mock hunt
- M1 `SlirpLocalBackend` with a connector and >=1 NAT flow and empty egress reports
  external_io_pending=true, rx_ready=false, idle=false — the same triple as the fake `ExternalIoPending`
  (whose `idle()` defaults to false). With egress non-empty, rx_ready=true -> waiting_on_host=false.

## Own bounded attack (frame arrives during a nap)
- A1 In a paced machine with idle yield and a backend that is "waiting on host", the first run call offers a
  nap in (0, 4 ms]. If the backend then gets a frame ready (rx_ready=true) before the next run call, that
  run call does NOT end with a host-I/O nap (`take_idle_wait_nanos()` returns None): the full sync at run entry
  sees rx_ready and `waiting_on_host` is false. Likewise once external_io_pending goes false with the backend
  idle, the full wait (> 4 ms) is offered again.
- A2 Stale epoch: an MMIO notify (kick) between the host-io sync and the wfi bumps `fabric_epoch`, so the wait
  does not hold at the loop top; run entry and the checkpoint drain clear the marker. session_network clears
  only `fabric_idle_epoch` but those paths run with session clocks (no pacer) and are followed by a full sync
  in the same loop iteration -> no stale nap. (Inspection.)

## Browser (8125 = this head's web/dist; must hash-match)
- B1 8125 serves bytes identical to web/dist's wasm.
- B2 Own independent probe on 8125: a different held connection (a raw TLS socket opened with node `tls.connect`
  to example.com:443 and never closed), guest idle: guest seconds per real second in [0.9, 1.1] and worker
  in-slice time < 15 %; with no connection in-slice < 5 %.
- B3 Slow-relay timeout attack: under the paced clock, a guest timer armed for T seconds while a connection is
  open fires no earlier than T real seconds (guest `sleep`/`setTimeout` measured against host wall clock): ratio
  of host elapsed / guest-requested >= 0.95 and <= 1.3.
