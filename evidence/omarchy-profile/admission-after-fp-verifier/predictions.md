# T03aa independent verifier predictions

Written 2026-09-16T01:18:26Z, before either browser arm. Reviewed task at
`70c75998`, prior verified FDIV task at `53103e76`, and the unchanged A/B
driver and policy guards. These are acceptance predictions, not forecasts
that the candidate will improve responsiveness. No browser is launched by
this verifier.

- **A1 — identity and scope.** Both arm reports will identify the same frozen
  committed HEAD and recorder, clean scoped runtime status, and served WASM
  SHA-256 `1bc7285239db053abdaaafe4c5869a5a2495c7c149d01a239ec020e1fedbf88d`.
  Every observed source/served-artifact identity will match the pinned R3
  pair, base chunks and verified T03z runtime. No task diff changes runtime,
  guest bytes, defaults, renderer selection or timing limits.
- **A2 — one policy difference.** Actual runtime samples will select recycling
  false for control and true for candidate, with threshold 512, capacity
  65,536, decoded cache 4096, repack-off cap 24, icount divider 64, 1280×800
  guest display, LP1 inherited from the exact R3 pair, admission observation,
  profiling and admission timing off. Changing counters are observations;
  they are not additional selected policies.
- **A3 — one bounded pair and cleanup.** The batch will launch control once,
  then candidate once, in different fresh Chrome processes/contexts. The
  first owned browser/process will be confirmed closed before the next starts.
  No watchdog termination, arm retry, additional warm-up after readiness,
  probe/tuning sweep or unbounded shutdown will count as a completed trial.
- **A4 — readiness.** An arm that types will first record restored=true, a
  real application layers-plus-pixels desktop-ready event, personally inspected
  visible Foot and canvas focus. Carry T03m's unchanged input-trial path:
  recorder-only clients/activewindow RPCs stay omitted; separate capture and
  attestation paths retain their checks. All startup work will consume one
  navigation-anchored 300,000 ms budget. Failure to qualify remains
  startup-failed-input-not-tested, without an input success or negative claim.
- **A5 — physical input causality.** For each qualified arm, independently
  reconstructing the command from its nonce and independently named guest
  file will exactly match ordered trusted, nonrepeat DOM key down/up events,
  their focused canvas, and actual keyboard/sync RPC calls and acknowledgements.
  The filename will not embed the nonce. No serial writer or command echo may
  supply nonce evidence. Host acknowledgement is not proof of guest consumption.
- **A6 — deadline and readback.** Typing, including focus checks, will finish
  within 60,000 ms at the unchanged 40 ms key delay. Enter completion anchors
  exactly 120,000 ms for all later focus/queue/readback work. Raw framed guest
  replies must independently yield the correct nonce with exit 0 before that
  deadline for nonce success. Missing, wrong, stale, future, incomplete or
  exit-75 reads cannot pass. Pending reads at failure remain visible.
- **A7 — visible response and honest result.** Positive desktop acceptance
  additionally requires a real fresh guest presentation and personally viewed
  screenshot containing the actually typed terminal command/output. Capture
  and cleanup allowances remain 20,000 and 30,000 ms. An unchanged/empty Foot,
  no nonce, or frame count 2→2 fails responsiveness regardless of JIT share,
  compilation, refusals or startup speed. Failed arms remain preserved.
- **A8 — proof sufficiency and novel attack.** Unchanged policy, user-path
  recorder and FDIV proof carry forward only with matching code/dependency
  boundary and evidence hashes. The new raw reports, wire events, identities,
  captures, counters and cleanup will support every new experiment claim.
  One offline mutation of a copied report (stale artifact hash or a claimed
  success lacking an on-time independent nonce) must be rejected without a
  browser or runtime change. Verification certifies the experiment outcome,
  not default promotion or desktop success absent A5–A7.

Source anchors read before recording: `tools/verify/omarchy-recycling-ab.mjs`,
`tools/verify/omarchy-input-trial.mjs`, and physical/readback timing paths in
`tools/verify/omarchy-desktop-live.mjs`. Prior task sources are T03k, T03m and
T03z. Remaining source and digest audit will finish before the sealed result
is adjudicated. The reviewer will not edit implementation or repeat an arm.

Pre-arm clarification after reading T03m fully (2026-09-16, before results):
T03aa's phrase "current actual mapped-Foot/active-window readiness path"
contradicts its instruction to carry T03m unchanged. Actual source omits those
two recorder RPCs in input-trial. A4 above explicitly preserves T03m, and the
coordinator was notified to correct that documentation before source freeze.
This does not change a readiness predicate or weaken a result after seeing it.
