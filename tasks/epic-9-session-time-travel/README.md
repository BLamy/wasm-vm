# Epic 9 — Session Time Travel

Status: **started**, created 2026-10-15 at the user's request. Implementation started
2026-10-17 at the user's direction with T01. The execution priority
band is 524.901–524.924 (originally 901–924), ahead of the optional userspace runtime.
Other task statuses are unchanged.

## Outcome

Record full-system VM sessions locally in the browser, reopen previous recordings, and
use a timeline to play, pause, seek, step backward/forward and continue from a past point
on a new branch. Revisited CPU/RAM/device state and guest files must agree with the
recording; a screenshot is a preview, not proof that the VM has returned to that state.

Use IndexedDB for session metadata and chunked binary history. Reuse existing snapshot,
overlay and browser storage code; OPFS may be evaluated as a compatible bulk-data backend
in a separately scoped slice if measurements justify it. Literal localStorage holds only
small preferences. Named sessions remain local by default, with explicit export/import,
retention, deletion, quota feedback and compatibility checks.

This revives the full-system record/replay ideas archived in E8-T03–T09 as a standalone
product goal. Epic 8 remains cancelled; stock Chromium is not a prerequisite for the first
milestone. Epic 6.5 is a separate userspace ABI runtime: share codec/clock abstractions
where appropriate, but do not make whole-machine session storage depend on completing
that runtime. Recording cannot reconstruct events from before it was enabled.

## Delivery milestones

1. **Saved checkpoints (T01–T08):** a real local session library, coherent machine/disk
   restore points, rename/open/delete, quota handling and a recorded reload demonstration.
   These controls initially expose checkpoint restore, not arbitrary-time replay.
2. **Exact software replay (T09–T16):** capture guest-visible inputs at an exact execution
   boundary, replay offline with divergence detection, incremental keyframes and precise
   cancellable seeking/reverse-step.
3. **Desktop time travel (T17–T20):** coherent GPU history, recorded GPU results, accessible
   timeline controls and isolated branches from the past. The timeline can first ship for
   software recordings while accelerated sessions remain explicitly gated.
4. **Durable release (T21–T24):** portable local bundles, measured performance/storage,
   recovery and corruption attacks, then independently verified production integration.

## Execution contract

T01 establishes the [frozen full-system contract](../../docs/design/session-replay.md),
including the adapter inventory, fixture pins and numeric budgets. Task frontmatter is
authoritative for implementation/verification status; asset pins alone do not qualify a
runtime profile for recording or accelerated replay.

- Start with the existing full-system, single-hart RV64 Linux profile. Unsupported SMP,
  userspace ABI mode, RP2350 or unrecorded devices must be refused explicitly; extending
  them requires separate work and proof. This is not a claim of cross-host arbitrary-race
  replay or bit-identical presentation pixels on every physical GPU.
- Use exact guest execution positions plus ordered event sequences. Record only required
  external observations and payloads; do not stream every retired instruction as the
  production recording format. Retain instruction traces/state digests as evidence.
- Host callbacks stage results. One owned delivery boundary applies recorded payloads,
  DMA effects, interrupts, clock updates and completions. The JIT cannot overshoot it.
- A keyframe binds machine state, disk root, event cursor, clock policy and any GPU state
  atomically. Keep historical overlay roots immutable; retain referenced content and
  compatible VM/assets, or show a non-destructive compatibility refusal after updates.
- Reverse execution restores an earlier keyframe and runs forward to the exact target.
  Previews may update immediately; the UI separately reports actual restore/replay progress
  and only publishes the latest completed seek. Never load a later keyframe to hide drift.
- Replay uses recorded network/device observations and cannot send new external actions.
  Continuing live is an explicit new branch with a defined fresh-connection policy; seeking
  does not trigger reconnection, upload a recording or modify the source session.
- For GPU sessions use the accepted production RAM/disk/GPU pair and fresh resource epochs.
  Record guest-visible readbacks, query/error/fence results and completion order; rendering
  the same commands alone does not prove identical guest-visible observations.
- Expect large snapshots: the pinned production GPU pair is 204,057,731 bytes
  (about 195 MiB). Use bounded chunk streaming, incremental RAM pages, shared immutable
  content and safe reference-aware GC rather than a full snapshot at every timeline tick.
  T01 freezes measured workload identities and numeric budgets before tuning begins.

## Verification and scheduling

Each task is an S boundary with one `make verify-E9-Tnn` acceptance entry point.
T01's direct contract check exists; later targets must be implemented with their slices.
No runtime replay behavior is declared verified by the plan or contract.
Use AGENTS.md's risk-tier gates, original guest/browser recordings, exact source/content
identities, state digests and a fresh adversarial verifier during implementation. Carry
unchanged accepted evidence incrementally; no new GitHub Actions or external service is
required. The final release follows the existing local build and Cloudflare deployment
process, not an automatic deployment caused by adding this epic.

The GPU slice names the verified E6-T11d74c/d production worker/accelerated warm-boot
successors (including their native/renderer predecessors). The original E6-T11 container
is cancelled. Integrate this accepted RAM/disk/GPU/clock pair; its renderer reconstruction
journal is not proof of a complete session replay engine.

## Task index

| Task | Boundary | Dependencies | Risk |
|---|---|---|---|
| E9-T01 | [Freeze the full-system session replay contract](E9-T01-execution-contract.md) | E0-T16, E3-T12d | low |
| E9-T02 | [Define bounded session manifests and compatibility checks](E9-T02-session-manifest.md) | E9-T01 | high |
| E9-T03 | [Persist multiple session logs with atomic publication](E9-T03-session-store.md) | E9-T02, E3-T12d | high |
| E9-T04 | [Preserve immutable disk state for historical checkpoints](E9-T04-historical-disk-roots.md) | E9-T02, E3-T12c3 | high |
| E9-T05 | [Capture and restore coherent software session checkpoints](E9-T05-coherent-software-checkpoints.md) | E9-T03, E9-T04 | high |
| E9-T06 | [Add the local saved-session library and checkpoint controls](E9-T06-session-library.md) | E9-T05 | medium |
| E9-T07 | [Manage session quotas retention and shared-data deletion](E9-T07-retention-and-quota.md) | E9-T03, E9-T04, E9-T06 | high |
| E9-T08 | [Prove the saved-checkpoint experience across reload](E9-T08-checkpoint-milestone.md) | E9-T06, E9-T07 | medium |
| E9-T09 | [Place recorded events at exact guest execution boundaries](E9-T09-event-clock.md) | E9-T01, E9-T02 | high |
| E9-T10 | [Record user and host-control inputs at delivery](E9-T10-user-input-recording.md) | E9-T09 | high |
| E9-T11 | [Record guest-visible time and entropy observations](E9-T11-clock-and-entropy-recording.md) | E9-T09 | high |
| E9-T12 | [Record asynchronous device payloads and completion order](E9-T12-device-completion-recording.md) | E9-T09 | high |
| E9-T13 | [Capture network sessions and replay them with zero live egress](E9-T13-network-capture.md) | E9-T09, E9-T03 | high |
| E9-T14 | [Replay recorded sessions and detect the first divergence](E9-T14-deterministic-replay.md) | E9-T05, E9-T10, E9-T11, E9-T12, E9-T13 | high |
| E9-T15 | [Add incremental RAM keyframes with bounded storage work](E9-T15-incremental-checkpoints.md) | E9-T05, E9-T14 | high |
| E9-T16 | [Seek and reverse-step with cancellable replay-forward](E9-T16-seek-controller.md) | E9-T14, E9-T15 | high |
| E9-T17 | [Restore historical accelerated desktop checkpoint pairs](E9-T17-gpu-session-checkpoints.md) | E9-T05, E9-T16, E6-T11d74c, E6-T11d74d | high |
| E9-T18 | [Replay guest-visible GPU results and completion ordering](E9-T18-gpu-result-replay.md) | E9-T17, E9-T09, E9-T14 | high |
| E9-T19 | [Build the session timeline and accessible time-travel controls](E9-T19-timeline-ui.md) | E9-T06, E9-T16 | medium |
| E9-T20 | [Continue from the past on an isolated recording branch](E9-T20-branch-from-history.md) | E9-T19, E9-T04, E9-T14 | high |
| E9-T21 | [Export and import complete bounded local session bundles](E9-T21-session-export-import.md) | E9-T07, E9-T16, E9-T18 | high |
| E9-T22 | [Measure recording storage and seek overhead on real guests](E9-T22-replay-performance.md) | E9-T15, E9-T16, E9-T18, E9-T19 | medium |
| E9-T23 | [Harden recording and seeking against crashes and corrupt history](E9-T23-recovery-hardening.md) | E9-T07, E9-T18, E9-T20, E9-T21, E9-T22 | high |
| E9-T24 | [CAPSTONE locally saved replayable VM sessions with a time-travel UI](E9-T24-capstone-local-time-traveler.md) | E9-T08, E9-T13, E9-T18, E9-T19, E9-T20, E9-T21, E9-T22, E9-T23 | high |
