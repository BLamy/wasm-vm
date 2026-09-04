---
id: E5-T16e
epic: 5
title: Publish measured display-server decision and T17 handoff
priority: 516.5
status: pending
depends_on: [E5-T16d]
estimate: S
risk: medium
capstone: false
---

## Goal

Turn the two inside-emulator finalist captures and package audit into a re-litigable display-server
decision, with winner variance, damage recomputation, revisit triggers, and an unambiguous T17 handoff.

## Boundary

This slice owns final evidence synthesis and `docs/decisions/display-server.md`. It does not build
the T17 desktop image or add a third candidate after the two finalists have been measured.

## Deliverables

- `docs/decisions/display-server.md` with a comparison table for labwc/pixman and weston/pixman,
  actual numbers for every required metric, the chosen server/WM/terminal/clipboard stack, package
  versions, config sketch, and concrete revisit triggers.
- Two fresh winner reruns and an independent recomputation of the 100-character damage bytes from
  the T09 counters, with evidence links and exact image/commit identities.
- A final package/config manifest explicitly handed to E5-T17 and a machine-readable summary for
  later performance and desktop tasks.

## Acceptance criteria

- The table contains at least two end-to-end inside-emulator finalist rows with no extrapolation;
  cold start, idle instructions, damage bytes, RSS, idle wakeups, cursorq use, and workload outcome
  are all visible for both.
- Winner run-to-run variance is measured twice and compared with the winning margin; if variance
  exceeds that margin, the command fails and the decision remains unpublished.
- Idle cost above 2% disqualifies a candidate or is explicitly justified, and the document cites
  the independently recomputed typing damage bytes.
- The selected server, WM, terminal, and clipboard tool are all backed by E5-T16d riscv64
  `apk search`/`apk add` evidence, with no ambiguous dependency left for T17.
- If labwc wins, cursorq traffic is present in the evidence; if another candidate wins, the reason
  for not relying on the cursor plane is recorded. Revisit triggers include a concrete rendering
  or package change such as virgl/WebGPU support.

## Verification command

`make verify-E5-T16e`

## Adversarial verification

Re-run the winner twice from cold state, compare variance to the runner-up margin, and recompute
typing upload bytes from raw T09 counters rather than the summary JSON. Inspect weston's pixman
proof, labwc's cursorq proof if applicable, and every selected package install on a clean E3-derived
riscv64 image. Any undocumented GL/fbdev substitution, stale evidence head, or ambiguous T17
manifest refutes the decision.

## Verification log

(empty)
