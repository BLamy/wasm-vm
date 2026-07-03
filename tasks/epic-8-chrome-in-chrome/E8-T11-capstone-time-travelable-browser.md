---
id: E8-T11
epic: 8
title: "CAPSTONE: a nested, time-travelable browser — stock Chromium, rewound by the VM"
priority: 811
status: pending
depends_on: [E8-T07, E8-T08, E8-T09, E8-T10]
estimate: L
capstone: true
---

## Goal
The summit of the entire roadmap, demonstrated end-to-end from a cold start: in a fresh browser
tab, the VM boots to a desktop, launches **stock chromium-riscv64**, loads a real web page and
the operator interacts with it — and then **reverses execution**, scrubbing the whole machine
(browser included) backward and forward to any earlier point of the browsing session,
bit-identically, with **zero Chromium modifications**. A nested browser that is time-travelable
because the machine under it is deterministic. The closed loop: determinism in the emulator
replaces instrumentation in the application.

## Context
Integration of Layer G's full stack: stock Chromium (E8-T01) booted (E8-T02), a complete
nondeterminism inventory clamped (E8-T03), recorded (E8-T04) and replayed bit-identically
(E8-T05) with snapshot keyframes (E8-T06), driven by time-travel controls (E8-T07), hardened
under real Chromium load (E8-T08), with the network captured for offline deterministic replay
(E8-T09), and audited as genuinely stock (E8-T10). Per `tasks/README.md`, the capstone runs cold:
fresh clone, documented build/fetch of the desktop + chromium + trace artifacts, fresh browser
profile, no dev state. The demo and its automated variant are deliverables so a hostile verifier
runs it without the implementer. This is the ROADMAP's singularity condition for this project.

## Deliverables
- `docs/demos/level-8.md`: exact cold-start procedure — boot to desktop, launch stock Chromium,
  perform a scripted browsing interaction while recording, then time-travel (seek back, reverse-step,
  scrub) to named earlier points, with expected observations (including the rendered frame at each
  target time) and the stock-binary verification steps at each stage.
- An automated headless E2E: cold boot → launch stock chromium-riscv64 → load a real page +
  interact (recording on) → seek to ≥3 earlier points and assert bit-identical state (hashes) and
  correct reconstructed render → replay the session fully **offline** and assert identical result.
- A recorded demo (≤ 3 min) in release assets showing a live browse then a rewind.
- Integration fixes each with a home-task regression test.

## Acceptance criteria
- [ ] Fresh clone + documented commands → fresh browser profile boots to a desktop and launches
      **stock, unmodified** chromium-riscv64 (runtime hash matches E8-T01; E8-T10 attestation holds).
- [ ] A live browsing session (load a real page, click/scroll/type) is recorded; the operator then
      seeks/reverse-steps to arbitrary earlier points and each lands on bit-identical machine state
      (hash match vs from-start replay) with the correct browser frame reconstructed.
- [ ] The recorded session replays **fully offline** (network transport disabled) to an identical
      result (E8-T09), under SMP and JIT (E8-T08).
- [ ] The automated E2E passes 3/3 with fresh browser contexts; artifacts and demo carry the same
      commit hash; zero Chromium modifications anywhere in the pipeline.

## Adversarial verification
Cold-start rule is absolute — run `docs/demos/level-8.md` on a machine/profile that never built the
project; any undocumented step refutes. Prove *stock*: hash the running browser against the
upstream/distro build, confirm the E8-T10 marker scan is clean, and confirm nothing inside Chromium
participates in recording — an instrumented or forked browser refutes the entire epic. Prove
*time-travel*: seek to many random earlier points and reverse-step repeatedly, demanding
bit-identical state each time (drift refutes); vary all host nondeterminism (clock, RNG, scheduling,
host load) across replays and demand zero guest-state effect. Prove *offline*: physically disable the
network and replay the whole session — any network reach or divergence refutes. Prove *robustness*:
do it on a GPU-heavy and a JS-heavy page, under SMP; a nondeterministic divergence refutes. Compare
honestly against Replay.io's instrumented approach in the log — our claim is the *same stock binary*
made reversible by the VM, and the evidence must back exactly that.

## Verification log
(empty)
