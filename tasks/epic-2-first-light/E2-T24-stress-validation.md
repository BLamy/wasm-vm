---
id: E2-T24
epic: 2
title: Stress validation — disk torture, fork bombs, interactivity, 10x reproducible boots
priority: 224
status: pending
depends_on: [E2-T17, E2-T19]
estimate: M
capstone: false
---

## Goal
A scripted stress battery that beats on the full native Alpine system hard enough to
surface the bugs polite boots never find — and a repeatability harness proving the machine
boots identically ten times in a row.

## Context
The battery (each an expect-scripted scenario against E2-T19's boot, plus in-guest
scripts staged onto the image or typed): (1) *disk*: `dd if=/dev/zero of=/big bs=1M
count=256 conv=fsync`, then `dd` read-back with `md5sum`; parallel writers (`for i in 1 2
3 4; do dd ... & done; wait`); `rm` + `sync` + fsck-after-poweroff; (2) *fault injection*:
SIGKILL the emulator at a random point during the parallel-write phase, then boot again —
journal recovery must succeed (this is the "kill mid-write" gate); (3) *process storm*:
a bounded fork bomb `:(){ :|:& };:` under `ulimit -p 64` in a subshell — system must stay
alive, storm-detector (E2-T20) silent, and `kill`-cleanup restore interactivity; also
`for i in $(seq 200); do /bin/true; done` timing as a fork/exec micro-benchmark; (4)
*interactivity under load*: with `dd` running, `vi` editing and `top` refreshing must stay
usable (scripted: keystroke-to-echo latency < 200 ms sampled via expect timestamps);
`less` through a 10 MB file, `G`/`g` seeks; (5) *reproducibility*: 10 consecutive cold
boots from a pristine image copy, normalized dmesg + battery results diffed pairwise —
zero variance in pass/fail, bounded variance in timings. Everything runs in CI-able form
(native; the browser variant of a subset lands in T26).

## Deliverables
- `tests/stress/` harness: scenario scripts, image-reset logic, timing capture, a single
  `tools/run-stress.sh` entry point with a JSON results summary.
- Kill-injection helper (random-delay SIGKILL wrapper) + post-mortem fsck/remount check.
- A results baseline file (timings, counters) checked in for regression comparison.

## Acceptance criteria
- [ ] Full battery green: all md5s match, fsck clean after every clean shutdown, journal
      recovery succeeds after every injected kill (≥ 5 random-point kills).
- [ ] Fork bomb scenario: guest survives, load drains, subsequent `vi` session works;
      emulator memory (host RSS) returns to within 10% of pre-bomb level.
- [ ] Interactivity: measured keystroke-echo latency under `dd` load < 200 ms at p95.
- [ ] 10/10 boots reach login; normalized dmesg identical across all 10; battery timing
      variance < 20% relative std dev.
- [ ] `/proc/interrupts` after the battery shows plausible counts (no line > 10^7).

## Adversarial verification
Re-run the battery with different RNG seeds for the kill points (at least 10 kills) — any
unrecoverable image refutes. Escalate beyond the listed load: `count=1024` dd (4x), 8
parallel writers, fork bomb with `ulimit -p 256` — the *harness* passing while an
escalated-but-reasonable variant hangs means the thresholds were tuned to pass, which
refutes the robustness claim (document the actual ceiling instead). Run the whole battery
under `--trace-last` + storm detection enabled — any detector dump refutes. Compare two
battery runs' guest-visible outputs (not timings) byte-for-byte; nondeterminism in
outputs (not attributable to documented time/RTC sources) refutes reproducibility. Verify
the baseline file matches a fresh run on the verifier's machine within stated tolerances.

## Verification log
(empty)
