# Fuzz regression corpus (E1-T21)

This directory holds **real** divergences the differential fuzzer found against our
emulator — minimized `.S` reproducers, each with the seed and a one-line diagnosis in its
header. When a bug is fixed, its reproducer stays here as a permanent regression: `fuzz
run --seed <N>` for that seed must report `MATCH` forever after.

## Current status: empty (no real divergence found)

The initial fuzz campaign over RV64IM straight-line streams found **zero** architectural
divergences against Spike — expected, since this core already passes the curated
riscv-tests suites and RISCOF architectural compliance (E1-T20). That the rig *would* have
caught a bug is proven separately by the seeded-mutation experiment in
`tools/fuzz/sensitivity/` (a one-line div-by-zero mutation is caught on seed 0 and
minimized to 2 instructions).

Per the task's acceptance criterion, that is the honest outcome recorded here: the
campaign at the documented throughput surfaced fewer than the historically-expected ≥10
cases because the covered stimulus class is already compliant. Follow-on stimulus classes
(loads/stores, branches, F/D/C, U-mode+Sv39 with trap-event comparison — see the task log)
widen coverage into paths the curated suites test less densely, and any divergence they
turn up lands here automatically via `fuzz campaign`.
