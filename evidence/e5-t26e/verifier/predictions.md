# E5-T26e verifier predictions — 2026-09-07

Frozen subject: submitted head `7fd0fa6df4361ba1835e1f151acce9fb506faef5`, runtime
implementation `74eb1eec3f19aeb510259f71b2f25eaac4e1dff9`.

Predictions written after reading the task and full implementation diff, before inspecting the
worker evidence contents or running verification:

1. A valid native-size restore calls GPU, input, sound, agent, viewport, and commit exactly once in
   that order, returns `Native`, and reports a full repair.
2. A changed valid host size calls the same sequence, returns `Letterbox`, passes the original guest
   scanout unchanged to viewport/commit reporting, and does not mutate the GPU-derived dimensions.
3. Refusal at GPU, input, sound, agent, viewport, commit, or missing-full-repair calls clear then
   cold fallback exactly once and never invokes any later callback.
4. Dropping the agent channel refuses before viewport and commit.
5. Missing sections, malformed envelopes, forward section versions, and invalid host dimensions
   refuse before the first prepare callback, then clear and cold fallback.
6. Guest scanout sizes of zero or greater than 4095 refuse after GPU preparation and before input.
7. A successful report is impossible without `commit` returning `Ok` with
   `full_repair_frame == true`.
8. Cleanup is transient-free on every ordinary refusal, and a subsequent valid attempt on the same
   coordinator/backend reaches a clean commit (bounded retry/cold-fallback attack).
9. Every changed coordinator branch is exercised by the submitted gate or verifier attack, or is
   explicitly classified as unproven/dead/waived.
10. Callback-contract prediction: no conforming callback outcome should permit the coordinator to
    return success while the full transaction was not published, or return failure while leaving a
    half-restored live state. In particular, preparation result fields belonging to the wrong tag,
    post-publication `commit` failure/`full_repair_frame == false`, and cleanup/cold fallback behavior
    must not create an unobservable contract hole.

Novel bounded attack: reuse one backend across a refused attempt and a second valid restore while
tracking all transient and live fields; additionally inject cross-tag preparation metadata to test
whether the coordinator can report repairs that were not prepared by the corresponding component.
