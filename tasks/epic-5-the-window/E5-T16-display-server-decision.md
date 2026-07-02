---
id: E5-T16
epic: 5
title: Display server decision — Wayland (labwc/weston) vs X11 under emulation, measured
priority: 516
status: pending
depends_on: [E5-T07, E5-T13, E5-T14]
estimate: M
capstone: false
---

## Goal
A written, measured decision on the guest display server for the flagship desktop image:
candidates evaluated *inside the emulator* on CPU cost, damage quality, memory, cursor
plane use, clipboard tooling, and Alpine riscv64 package availability — ending in one
committed choice and a recorded rationale others can re-litigate with data.

## Context
The candidates: (1) **labwc** (wlroots stacking WM) with `WLR_RENDERER=pixman` —
software rendering, honest Wayland damage tracking, uses the DRM cursor plane, openbox
Feel; (2) **weston** with its pixman renderer — the reference compositor,
`weston --backend=drm`, very predictable; (3) **sway** — wlroots but tiling (UX mismatch
for webvm-parity); (4) **X11**: Xorg + modesetting driver (glamor off → software) with
a light WM (openbox/jwm), mature clipboard/tools but X's full-damage tendencies and an
extra process hop; (5) TinyX/Xfbdev on fbdev as a minimal fallback. What matters under
an interpreter/JIT at tens-of-MIPS: pixels drawn per interaction (damage discipline
dominates), resident memory (image budget), whether the compositor drives our cursor
plane (T15) and RandR/wlr-output hotplug (T22), and whether Alpine riscv64 ships current
packages of it. Measure, don't vibe: each candidate gets the same scripted workload.

## Deliverables
- Throwaway bring-up of ≥2 top candidates (labwc + one other) on a scratch image —
  ugliness fine, measurements honest.
- Scripted workload per candidate: cold start to idle, open foot/xterm, type 100 chars,
  drag the window 300px, close — capturing: guest CPU (instr count via E4 counters),
  host bytes-uploaded (T09 stats), peak RSS in guest, idle wakeups/s.
- `docs/decisions/display-server.md`: comparison table, the decision, revisit triggers
  (e.g. "if virgl/WebGPU lands in E6, revisit").
- Chosen candidate's package list + config sketch handed to T17.

## Acceptance criteria
- [ ] At least two candidates measured end-to-end inside the emulator with numbers in
      the table (no extrapolated rows for the finalists).
- [ ] Idle CPU measured: a candidate burning > 2% of guest instructions at idle is
      disqualified or the exception justified in writing.
- [ ] Damage discipline measured: bytes uploaded during the 100-char typing test
      recorded per candidate; the decision cites it.
- [ ] The decision names one server + WM + terminal + clipboard tool stack, all
      confirmed present in Alpine riscv64 main/community repos (apk search output
      captured in the doc).
- [ ] Decision doc merged; T17 blocked on nothing ambiguous.

## Adversarial verification
Refute the methodology: re-run the winner's workload twice — if run-to-run variance
exceeds the winning margin over the runner-up, the decision is unsupported (refuted;
needs more runs or a bigger margin). Check the losers were not sabotaged: weston must
be run with pixman renderer (not failing GL then measured), Xorg with modesetting not
fbdev unless documented. Verify package claims: `apk add` every listed package on a
clean E3 image against real riscv64 mirrors — a missing/broken package refutes.
Spot-check the damage numbers by independent recomputation from the T09 counters during
a manual session. If labwc wins, confirm it actually used the cursor plane (cursorq
traffic observed) — a claimed feature that never fired is a refutation of the table.

## Verification log
(empty)
