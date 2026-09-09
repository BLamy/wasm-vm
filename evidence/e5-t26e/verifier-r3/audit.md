# E5-T26e remediation-2 adversarial audit

Review range: `8c931481..41871b80`; submitted head: `ac35d1d8`.

## Predictions

- **P1 valid production transaction — PARTIAL / FAILED at the host boundary.** The fresh exact-head
  gate executes the real Machine/virtio-console test and retains the expected 1280x720 → 1024x768
  letterbox tuple and one repair count. It does not execute the T23d application `Channel` or a
  HELLO exchange. `ConsoleState::agent_ready_for_restore` checks only virtio device/port flags, and
  `restore_rehandshake` returns immediately after queuing unconsumed PORT_OPEN close/open controls.
  The implementation then records `host.agent_ready = true`. The task's existing T23d contract
  says Channel readiness exists only after HELLO intersection, so a port-control request is not a
  completed agent re-handshake.
- **P2 changed viewport — PARTIAL / FAILED at canvas application.** Coordinator and Machine tests
  preserve the 1280x720 guest scanout and retain a deterministic letterbox tuple. Exact-head grep
  finds `desktop_restore_host_state` only in core and tests; neither wasm nor web consumes it, and
  the restore path never calls T22's `PresentationController.setViewport`. The tuple therefore
  does not resize/letterbox the production canvas as the acceptance criterion requires.
- **P3 staged refusal — HELD.** The exact gate exercises malformed/missing/forward sections plus
  GPU/input/sound/agent/viewport/repair/commit refusal. The fresh staged-agent attack observed two
  sink clears and default host state.
- **P4 early production-agent refusal — FAILED.** The fresh public-API attack starts with one
  retained host frame and a Machine with live GPU/input/sound but no console. The Machine returns
  `commit_refused` before constructing the backend, so the retained frame remains 1 and the sink
  records zero clear calls. This contradicts the worker's cold-baseline claim and the task's
  no-stale-host-state requirement.
- **P5 post-GPU rollback — HELD.** The exact gate executes the injected failure and asserts an empty
  TestSink, unbound scanout, 1280x800 power-on display, power-on input/sound snapshots, and default
  host state. The changed rollback clears before and after restoring the GPU snapshot.
- **P6 portability — HELD; coverage — INSUFFICIENT.** The scrubbed prescribed gate and both source
  JS clear tests pass. Source/dist JS mirrors are byte-identical. The build compiles the wasm sink,
  but no run executes `JsFrameSink::clear`; no run executes the CLI `DisplaySink::clear`; and no
  production hunk connects restore success to T23d Channel HELLO or T22 viewport application.

## Changed-hunk classification

- `Makefile`: executed by the fresh gate.
- `crates/core/src/desktop_restore.rs`: detached component staging, power-on baselines, live-console
  guard, host retention, and post-GPU rollback execute in the focused unit/integration suite. The
  impossible coordinator-only missing-stage guards remain structurally waived from the prior audit.
- `crates/core/src/dev/virtio/console.rs`: device/port readiness and close/open queueing execute, but
  this is not the application HELLO layer named by the task.
- `crates/core/src/lib.rs`: construction, success, and early missing-console paths execute. The
  early path is refuted because it only resets metadata.
- `crates/core/src/dev/virtio/gpu/mod.rs` and tests: TestSink/NullSink behavior executes; test-only
  cursor clear is compile-covered and outside the desktop claim.
- `crates/wasm/src/lib.rs`: `JsFrameSink::clear` is compile-only — needs a wasm/Chromium execution
  that originates from an actual failed restore, not merely a direct JS clear test.
- `web/linux-worker-protocol.js`, `web/src/sink/presentation.js`, and their tests: direct clear
  controls execute in Node and dist mirrors compare equal. The source test does not connect them to
  Machine restore or T22 viewport ownership.
- `crates/cli/src/boot.rs`: `DisplaySink::clear` is compile-only; either execute a native restore
  through it or explicitly narrow/delete this unclaimed host behavior.
- generated `web/dist/pkg/*` and `web/dist/sw.js`: waived as generated build outputs; the exact
  wasm32 build passed, but runtime coverage remains missing as above.

## Verdict demands

1. Route all production pre-backend refusal branches through a common cold fallback that clears a
   live sink and resets devices/agent/host state; promote the dirty-sink missing-agent regression.
2. Bind restore to the actual T23d host Channel and do not attest `agent_ready` until a fresh HELLO
   intersection completes, with bounded failure/retry evidence.
3. Apply the restored host viewport through the retained T22 owner (`setViewport`/equivalent), then
   record the actual wasm → worker → presentation clear and viewport paths in Chromium. Pixel CRC
   and reload round-trip remain E5-T26f scope; WebKit, independent machines, and host rr remain
   waived.
4. Re-record evidence against the real exact implementation hash; the submitted JSON names a
   nonexistent object.
