# E5-T26e fresh-verifier predictions

Frozen before inspecting `native-remediation2.json` or
`worker-remediation2-gate.log`. Review range: `8c931481..41871b80`; submitted
evidence head: `ac35d1d8`.

1. **Valid production restore.** With the real virtio-console channel ready, a
   valid GPU/input/sound/agent envelope will return success only after the GPU,
   input, sound, agent re-handshake, viewport plan, and full repair are ready.
   The console generation will advance, stale application bytes will be fenced,
   close/open controls will be queued, and the Machine-owned host state will
   retain the new generation, viewport disposition, and one repair frame.
2. **Changed host viewport.** Restoring a 1280x720 guest scanout into a different
   host viewport will deterministically retain 1280x720 as the guest scanout and
   publish the expected letterbox disposition in persistent host state.
3. **Component/version refusal.** A malformed or forward-version GPU/input/sound
   section will refuse before publication, clear transient state and the live
   presentation sink, restore power-on device snapshots, reset host state, and
   restart the agent port into a bounded non-ready cold state.
4. **Missing/dropped production agent.** A Machine whose GPU/input/sound are live
   but whose production console is absent or loses readiness will refuse and
   enforce the same cold-fallback postcondition. In particular, a pre-existing
   host frame must be cleared even when refusal occurs before backend construction.
5. **Post-GPU failure.** The injected failure after live GPU publication will
   leave the retained sink empty, all devices at true power-on snapshots, host
   state defaulted, and the agent restarted rather than half re-handshaken.
6. **Coverage and portability.** The prescribed scrubbed native gate will pass at
   exact submitted head. Evidence or fresh attacks will execute every behavioral
   production hunk: real Machine/console success, changed viewport, live sink
   clearing across the wasm/worker/presentation route, component refusal, early
   agent refusal, and post-publication rollback; declarative/generated hunks may
   be waived with an explicit classification.
