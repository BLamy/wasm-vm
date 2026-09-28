# T03l frozen gate plan

The changed boundary is page-owned guest service lifecycle, not Rust, renderer,
image, clocks or JIT policy. No native rebuild/test claim is inferred from this
JavaScript fix; T03k's unchanged native findings carry forward.

Before recording, run the new source-driven IDE and agent lifecycle tests,
existing agent/desktop-restore and relevant boot/input/viewport tests, plus the
bounded recorder checks. Build the deployable bundle with `make web-dist` and
freeze changed sources, recorder and dist. Use the built ISA smoke and one real
BusyBox RPC/IDE regression to guard the CLI path. Do not accept an unrelated
server's source hashes as the local candidate.

Exactly one post-fix Omarchy observation:

```
node tools/verify/omarchy-desktop-services.mjs evidence/omarchy-profile/desktop-services-r1
```

This launches the unchanged physical-input recorder with the default recycling
setting OFF, actual R3 LP1, divider64, JIT on, cache4096/repack-off24, profiling
off. It retains the absolute300-second startup,60-second typing, Enter-anchored
120-second readback,20-second capture and bounded owned-browser cleanup. No
other browser boot or coordinator build runs concurrently with that observation.

Independently inspect report wire traffic and personally open the actual PNGs.
Absence of unsolicited agent traffic and hidden IDE commands proves the service
boundary, not desktop usability. Preserve a failed readiness or input result;
do not deploy a diagnostic-only change or claim the broader user issue fixed.
Daybreak's pre-result predictions and independent verdict remain required.
