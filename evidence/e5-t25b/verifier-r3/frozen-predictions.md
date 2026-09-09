# E5-T25b verifier r3 — frozen predictions

Frozen at head `6fca89a7463ee5bb932a615d62986fafadb26068` after reading `AGENTS.md`
and the complete task file, but before inspecting implementation diffs, source, dist, prior
verifier evidence, or retained browser artifacts.

1. **P1 — displacement helper.** A pure displacement check will reject unchanged geometry,
   horizontal motion smaller than 100 CSS px, and motion opposite the requested direction. It
   will accept motion of at least 100 CSS px in the requested direction and return/retain a
   finite signed horizontal displacement.
2. **P2 — browser integration ordering.** Every real baseline drag will sample the Foot
   titlebar/window geometry immediately before pointer movement and again afterward, then invoke
   the displacement check before per-run summary acceptance or five-run aggregation. A failed
   geometry check will abort the run instead of allowing plausible FPS output.
3. **P3 — retained geometry.** Successful post-fix JSON production will retain pre/post geometry,
   signed horizontal displacement, and absolute displacement for every run, with the values
   matching the checked geometry.
4. **P4 — deterministic regression.** Focused Node tests will exercise both stationary and
   wrong-way failures (and the valid direction/minimum boundary), while existing null-sink,
   no-damage, attribution, sequence, and aggregate tests continue to pass.
5. **P5 — source/dist/release parity.** The built source and `web/dist` copies of the performance
   module, page/terminal integration, and verification runner will be byte-equivalent where the
   release audit requires parity. The release audit will explicitly require the pre/post geometry
   acquisition, displacement assertion before aggregation, retained geometry fields, and timeout
   policy, rather than passing on token names alone.
6. **P6 — old artifact invariants and provenance.** The retained DPR-1 artifact and PNG will match
   the claimed `8cd005bf...` and `d81ba53c...` hashes. Its five raw runs will still satisfy all
   record, attribution, pointer, summary, and CV invariants, and their changing damage ranges will
   be consistent with real movement. Its producer head will remain `a14bf545...`: therefore it is
   valid evidence for unchanged producer/analyzer behavior but cannot execute or prove the later
   geometry-assertion integration hunk.
7. **P7 — readiness-only head delta.** Relative to the post-fix commit, head `6fca89a7...` will
   change only the Foot readiness wait from a fixed 60 seconds to the configured browser timeout,
   without weakening displacement rejection or altering aggregation. Static audit can cover this
   wiring; a timed-out browser attempt does not prove successful readiness.
8. **P8 — bounded headed run.** If local Foot readiness completes within the configured bound, a
   current-head baseline will complete five 300-move runs, retain checked geometry, report CV under
   15%, positive real-drawn attribution, and null-sink rejection. If readiness times out before any
   drag, I will classify the attempt as environment-limited and claim no post-fix browser coverage.
9. **P9 — sufficiency decision.** The pure helper/test can prove displacement semantics and static
   inspection can prove the browser call site's ordering and dataflow. However, if no post-fix
   browser run executes the call site, the integration hunk remains unexecuted task behavior under
   the repository's changed-hunk coverage rule. In that case the expected verdict is
   `needs-evidence`, not `verified`, unless another deterministic executable test demonstrably
   exercises the production browser-loop integration itself.
