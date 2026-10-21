---
id: E9-T17
epic: 9
title: Restore historical accelerated desktop checkpoint pairs
priority: 524.917
status: in-progress
depends_on: [E9-T05, E9-T16, E6-T11d74c, E6-T11d74d]
estimate: S
risk: high
capstone: false
---

## Goal

Use coherent RAM/disk/GPU checkpoint pairs as accelerated session keyframes.

## Boundary

Integrate the accepted production GPU checkpoint path, renderer/profile identity, physical scanout and fresh epoch ownership with the session store. Reuse verified predecessor work; no raw WebGL handles are serialized.

## Acceptance criteria

- [ ] Capture two real accelerated desktop positions and restore the matching guest state, disk root, GPU resources and physical scanout from each.
- [ ] Require actual post-restore guest rendering/input and current-epoch scanout; old screenshots, retained readiness messages and software fallback do not prove accelerated restore.
- [ ] Reject incompatible host/profile/build or lost-context captures cleanly. Reuse the verified E6-T11d74a/b/c/d native/renderer/worker/publication path; the cancelled E6-T11 container is not an executable prerequisite. Retain the authenticated clock policy and fresh epochs.

## Deterministic acceptance

`make verify-E9-T17`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Cross-wire RAM/disk/GPU components, change the host profile, lose context while capturing and send stale epoch completions. Require explicit refusal and preservation of the original session.

## Verification log

### 2026-10-21 — worker — development failures retained; final proof pending

The session-store integration binds one production WVGPAIR1 tuple to its exact
position, disk root, renderer build and host profile. The public library can save
and reopen accelerated points, including navigation from the ordinary demo to
the desktop. This entry is a development record, not an implemented/verified claim.

- `target/evidence/e9-t17-gpu-browser-dev-r6/report.json` passed the original
  supervisor-MMIO GPU workload, two stored colors, fresh-worker restoration,
  post-restore input, crosswired native/renderer refusal, foreign profile/build,
  stale presentation completion, GC, and context-loss capture refusal. This is
  supplementary coverage, not the required Linux/Mesa desktop proof.
- Cold runs `e9-t17-real-dev02` and `dev04` exposed page chrome covering the
  physical canvas. Desktop mode now keeps the canvas visible and the library
  in a collapsed drawer; `e9-t17-demo-navigation` passed 127/0 and hit-testing.
  `dev05` stopped on a transient R2 transport failure for an existing hash-pinned
  chunk. The recording server now retries bounded transport failures while
  retaining hard failure for a missing object or digest mismatch.
- `target/evidence/e9-t17-real-dev06/e9-gpu-session-desktop.json` failed the
  package-bar pixel deadline before capture (SHA-256
  `0c8ff5b10847b2855158106fef8051d30ef5a28a02042ff057050c7840df60c9`).
  Its retained owned-page retry used trusted Ctrl+C to select the declared
  paced-on-keyboard policy, then passed actual bar pixels and input. The final
  harness prepares this normal interaction before capturing.
- The supplementary CDP-driver run captured a real first point but its later
  typing failed. The original driver subsequently passed live input. A manual
  per-character diagnostic after restore visibly repeated characters; the
  final functional-input proof uses brief trusted taps and makes no typing
  latency or key-repeat claim. Both failures remain in
  `e9-t17-real-dev06-supplement-r2` and `e9-t17-live-core-dev`.
- The original cold desktop did restore both actual saved positions with
  qualified current-epoch scanout and the expected older/newer disk contents.
  Original-driver brief input and clock pause/resume passed after each restore:
  `e9-t17-real-dev06/control-input-restored-brief-input.json` SHA-256
  `eada49e4633865f5a03cc6746fae2c827b91ed5902a8fa41dc0244d330d83d1f`;
  `target/evidence/e9-t17-second-restore-dev.json` SHA-256
  `f30bf87d65484f7c02cf452ef9354f96921b4bc8819e9ecd87e741a108bb271e`.
  These adaptive development runs do not replace the frozen acceptance command.

Native GPU epoch values are scoped to a worker: restoring two pairs captured at
epoch 2 can yield epoch 3 in two different workers. The final assertions bind
the saved-to-fresh native epoch change to the unique page controller owner and
current physical scanout, and challenge the retired controller. They do not
mistake a repeated worker-local number for shared ownership.

The final `make verify-E9-T17`, exact-head cold proof, public publication and
fresh independent verifier are still required. Status remains `in-progress`.
