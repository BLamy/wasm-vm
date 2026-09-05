---
id: E5-T16e
epic: 5
title: Publish measured display-server decision and T17 handoff
priority: 516.5
status: implemented
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

### 2026-09-05 — worker — IMPLEMENTED

- Commit: `64abae1b813ea9eda66a3dee5887d5e93ec33d1e`.
- Command: `make verify-E5-T16e` (passed). This ran the CLI fmt/clippy/test/build gates, built a
  fresh signed Alpine v3.20 riscv64 Weston/Pixman image, replayed the frozen six-phase T16a
  workload twice from clean copies, synthesized the decision, and passed the variance/damage
  mutation self-test.
- Decision: Weston DRM/Pixman with foot and wl-clipboard. The prior end-to-end captures measure
  labwc idle ratio `0.4568175750%`, Weston idle ratio `0.3637762568%`, and a winning margin of
  `0.0009304131819650491` ratio (`0.0930` percentage points); both candidates are below the 2%
  idle budget. Labwc reports `cursorqEvents: 0` with a capability-gap status, so the selected
  stack does not rely on an unproven cursor plane.
- Independent T09 damage recomputation from raw `type-100` counters: labwc `0` bytes and Weston
  `36,864,000` bytes for 100 characters. Fresh Weston idle ratios were `0.0036462359033466426`
  and `0.0036463767176481247`; maximum deviation from their mean was
  `0.00000007040715074109125`, below the winning margin.
- Fresh source identity: image `27bbdc06f63fd611fbb2c071d56b5ec1bbfd696a8d9180c81c33a45e5ed5ed95`,
  package manifest `225b8d35f7375c084075ca60edac5ea8fbf7ef46f1fd09a7e3a5d40bb074aae1`, and file
  manifest `b2b4964035b5a348be808afddc83b91d007c5cb3e5fbfcf1854b6f85d5d51552`. Both reruns used
  that exact source image; their post-run image digests were distinct (`d1b726d49225b28511f378e1f581c27213c48c4481f9436bbdd3db53b8688e4a` and
  `7291ff674d6db690ff5eb7606dc2e5515065331865a44c65bb2e9849708230ee`).
- Evidence: `evidence/e5-t16e/winner-reruns.json` (SHA-256
  `5f7ad616a147eec62bbd0a609ad6fcdb3bbd7fd6a498851137299e5b20eab1d5`),
  `evidence/e5-t16e/display-server-decision.json` (SHA-256
  `d7e7c3b4a18f09af7d9132f7b75f1dfe0a6b3d191eed6e9db52182ca24029b18`), and
  `docs/decisions/display-server.md` (SHA-256
  `9e5ab89e22a8ff6f045919a4681d888388a2caff0cc6f4a5fdf8016f62ba3540`). The per-run console,
  guest-evidence, GPU-trace, stderr, and normalized run JSON files are listed and hashed in the
  rerun artifact. Independent-machine, WebKit, and host-rr legs are intentionally out of scope.
