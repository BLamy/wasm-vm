---
id: E6-T23
epic: 6
title: First self-compilation — build the core crate natively inside the guest
priority: 623
status: pending
depends_on: [E6-T09, E6-T22]
estimate: L
capstone: false
---

## Goal
Inside the browser-hosted guest, clone the wasm-vm repository and `cargo build` the core
crate to a native riscv64 binary, run its unit tests in-guest, and record honest memory
and time budgets — the first turn of the self-hosting loop and the workload that proves
the JIT+SMP stack under a real compiler.

## Context
This is Level 4's payoff cashing out: an interpreter at ~100 MIPS would take many hours
to build the core crate; the JIT's 10–50x plus smp=4 (`cargo build -j4`) brings it into
tens of minutes. Memory is the second wall: rustc peak RSS on the heaviest core-crate
unit can exceed 1.5 GiB — the machine needs ≥ 3 GiB guest RAM (mind the wasm32 4 GiB
address-space ceiling for total guest RAM + emulator overhead) plus zram swap in the
guest (`CONFIG_ZRAM`, swap-on-zram sized ~1 GiB) to absorb peaks; codegen-units and
`--profile dev` vs `release` tradeoffs should be measured, not guessed. Clone comes
through the Epic 3 network stack from the real public remote (`git clone --depth 1`);
a 9p-mounted local mirror is the offline fallback but the acceptance path is the real
network. Incremental builds on the persistent overlay (Epic 3) make the second run the
developer-experience number that matters.

## Deliverables
- `docs/self-hosting.md` (part 1): the exact runbook — machine config (RAM, harts,
  image), clone command, build commands, expected wall times and peak memory on the
  reference host, cold vs incremental.
- Guest tooling: zram swap enabled in the dev image's boot defaults (amend E6-T22
  image); a `vmstat`-based peak-RSS capture script committed to the image.
- Any core-crate build fixes discovered (e.g. build.rs assumptions, host-arch cfg
  mistakes) — the crate must build unmodified from a clean clone at the pinned commit.
- Benchmark record in `bench/self-host/`: cold build, warm rebuild, test-run times at
  smp=1/2/4, JIT on/off (interpreter number can be extrapolated from 10% completion —
  documented method).

## Acceptance criteria
- [ ] From a freshly booted dev image: `git clone --depth 1 <public repo URL>` succeeds
      over the guest network stack in < 5 min on the reference connection.
- [ ] `cargo build -p wasm-vm-core --release -j4` (vendored, offline) completes in-guest
      with zero source modifications; wall time < 45 min at smp=4 with JIT on the
      documented reference host.
- [ ] `cargo test -p wasm-vm-core --release -- --test-threads=2` passes in-guest for the
      non-ignored native test set (any excluded tests listed with reasons in the doc).
- [ ] Warm incremental rebuild after `touch` of one leaf module: < 5 min.
- [ ] Peak memory evidence captured: guest never OOM-kills rustc at the documented RAM
      config (dmesg clean of oom-killer), zram usage recorded.

## Adversarial verification
Re-run the entire flow from a *cold start*: fresh browser profile, freshly streamed
image, real network clone — implementer numbers from warm runs don't count; exceeding
any documented budget by > 25% refutes the budget claims. Attack correctness of the
built artifact, not just its existence: run the in-guest-built core binary's test suite
*and* diff a sample of its instruction-trace output (Epic 0 harness) against a
host-built binary of the same commit — divergence means our CPU miscompiled or
misexecuted rustc, which is exactly what this task exists to catch; any divergence
refutes. Attack the memory story: rerun the build at the documented minimum RAM minus
512 MB — it should fail *gracefully* (oom-killer takes rustc, build fails with an
error), machine stays alive; a wedged machine refutes. Interrupt the build (close the
tab) at ~50% and resume from the persistent overlay — a corrupted target/ dir that
poisons subsequent builds refutes the persistence claim. Verify `-j4` actually uses 4
harts (per-hart counters) — a serialized build hitting the time budget by luck refutes
the SMP claim.

## Verification log
(empty)
