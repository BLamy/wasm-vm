# T03h recording plan — unchanged R3 desktop

This is diagnosis, not a desktop fix. T03g was cancelled by user direction;
its LP0 timeout remains inconclusive. No runtime or image settings change.

The preliminary `latency-boundary-r1/` used the old headless diagnostic at
`e372fe8e`. Its physical `x` was sent at 03:01:56.387 UTC on 2026-09-14.
At 03:01:57.714 the recorded keyboard frames contained down/up, the emulator
queue had zero pending/dropped/rejected events, and two frames had arrived.
At 03:04:11.242, after another 428,998,040 retired instructions and 0.6703093
guest seconds, the frame count was still two. The coordinator inspected the
actual screenshot: unchanged Foot/bar pixels behind the real boot dialog.
The unrelated diagnostic `ps` RPC timed out after queueing; it provides no
completed process proof. The old helper did not retain full wire/served-body
identities, so this preliminary run is not the final evidence submission.

The final recording uses the new bounded process sampler and existing wire
observer on a fresh **headed** Chrome session. Record this host-mode change;
do not call a difference from the headless run a performance improvement.
The selected guest settings remain divider 64, JIT on, and the default
cache/admission policy, with no profiling instrumentation enabled.

## Frozen recipe

After freezing the helper and its tests, run:

```sh
node tools/verify/omarchy-input-diagnostic.mjs \
  evidence/omarchy-profile/latency-boundary-r2 64 1 \
  --pair-directory target/omarchy-sdr-r3-snapshot \
  --chunk-dir target/omarchy-profile-chunks-sdr-r3-256k --headed
```

1. Record actual restore, clock/JIT, served-body and harness identities. Take
   baseline controller stats and an actual screenshot. The restored picture
   alone does not prove compositor readiness.
2. Send one physical `x` through Playwright's real keyboard API while the
   canvas has focus. Record the trusted DOM events, worker calls/replies and
   counters. Do not issue an explicit diagnostic shell command during the
   next 120 seconds; the app's own readiness RPCs remain recorded and must be
   accounted for. Take final stats and screenshot after that observation.
   This single-key diagnostic is not the eventual nonce/readback acceptance.
3. Outside the timed input window, sample the historical R3 PID/TID hints
   417/462 (Hyprland/renderer worker), 503 (Foot) and 504 (shell bar). These
   are hints, not current identities: require the new raw comm, boot ID and
   starttime observations before attributing their counters. The sampler
   binds leader and per-thread identities before/after its sequential reads.
   Missing/changed identities remain unavailable. A completed pair of samples
   may establish CPU/runqueue deltas, not exact currently scheduled PID/PC.
4. Limit each process-sample request to 300,000 ms including queue time. If
   the first times out, retain that missing observation and do not repeat it.
   A host timeout does not cancel the guest command; do not describe later
   activity as sampler-free without a completed fence. If the first succeeds,
   take one further sample after a bounded host interval; no repeated polling.
5. Record final counters/screenshot and close this task's browser. Bind the
   final files, run focused helper tests and the deterministic receipt checks,
   and submit to the separate Daybreak Blue critic.

## Interpretation guardrails

An empty emulator input queue is not proof that Linux, Hyprland or Foot
consumed the input. Frame arrival and host presentation are distinct.
`/proc` reads are sequential, not atomic; report their guest uptime bracket
and actual host request/completion times. Zero optional schedstat counters
may mean accounting is disabled. Do not substitute aggregate interpreted-PC
regions for physical block entries or CPU ownership.

One source-supported hypothesis remains **unproven**: the bounded JIT
hotness table can reject a later hot block when full. The earlier eager
threshold trial also overflowed discovery's 4,096-entry FIFO (64,006 drops),
which is distinct from recovered compile-queue backpressure. If this
investigation cannot attribute the stall more precisely, the missing probe
is a recurring, translation-eligible physical block entry with a recorded
per-entry admission reason, generation, bytes and installation state—not
merely the aggregate `countsDropped` value. No remedy is selected yet.

Counter definitions were checked against the primary
[kernel schedstat documentation](https://docs.kernel.org/scheduler/sched-stats.html)
and [proc_pid_stat manual](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
Keep guest CPU ticks/nanoseconds separate from host wall time.
