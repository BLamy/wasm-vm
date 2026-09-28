# E5.5-T03x integer-to-float worker evidence

## Boundary

Compile FCVT.S.W/WU/L/LU through the existing integer-only software conversion
backend. The pure helper receives the complete integer source, decoded width
and validated rounding mode, and returns packed raw f32 bits and new flags.
Generated code uses the existing FS/rm fault guards, integer register handoff,
FPR boxing/dirty mask and sticky fflags publication. Optional imports use their
actual allocated indices: conversion at 5 alone, or 6 after arithmetic at 5.
The arithmetic result-publication sequence is factored without changing its
emitted operations. No software arithmetic backend or dependency changes.

The worker fixtures execute 21,504 cases across all four widths and all static /
dynamic rounding selections, including FS-Off and invalid modes. They compare
every integer/FPR register, PC, trap parcel, flags, frm, FS and reservation with
the interpreter. Independent literal rows cover zero, signed extrema, high
unsigned values, ignored upper words for W/WU, even/odd ties and writable f0
versus constant x0. The register/flags FNV is `55175ee7c3836290`; it is not a
full-machine digest. A further 384 cases perform real interpreted CSR writes,
integer source updates and later memory/illegal faults. Three real machine
run-loop cases retain the exact completed prefix and trap information.

These pre-freeze self-checks passed native and private/shared WASM, with normal
process exit. Final recorded commands and artifact identities are added below
after the implementation and independent promoted tests are frozen.

## Built guest and actual desktop are distinct checks

The built-page guest converts signed/unsigned 32/64-bit inputs, performs an
arithmetic operation in the same loop, spills real FPR results and reads fcsr.
Its interpreter comparison and direct literal assertions establish execution
through the production browser surface. The existing live conversion ELF is
surfaced in the roadmap; the entire live suite must pass with zero errors.

The actual Omarchy physical-keyboard trial keeps the existing R3 snapshot,
display mode and execution settings and the 120-second independent readback
deadline. Passing instruction tests alone does not establish responsiveness.
No serial nonce injection, synthetic readiness or fabricated pixels are used.

## Frozen focused submission

Source, promoted independent fixtures and built artifact are committed at
`b587faf6f1bee5db45c5c9368d0a748f9badaff4`. WASM SHA-256 is
`0ce4a5a304d82574b5f4118725bcffc2547121605e49304d280153eae4a5d312`
(1,597,268 bytes), with service-worker version `9677a995ed3c`.
`record-submission.py affected` ran from 22:31:41 to 22:35:27 UTC. Every command
exited 0: production Clippy, core handoff, existing FP/fault regressions, all
23 native F/D ISA ELF verdicts, native WASM-library tests, no-host-float scan
and `make verify-E5_5-T03x`. Exact commands and exits are retained in
`affected-commands.json`; complete outputs are adjacent.

The independent native and private/shared WASM fixtures retain 12,672 literal
states (FNV 11332523716468034169), 3,584 seeded states including 1,736 illegal
exits (FNV 8412752937936467894), and 12 control cases (FNV 5904181122689446553).
They add 3,072 instrumented pure-helper cases with 1,620 legal calls and zero
illegal calls, a real integer → conversion → arithmetic → conversion chain
with exports 7/8/9/10, same/cross-module budget checks and actual memory growth
with fault variants. The isolated wrong literal fails and its restoration
passes. Critic predictions, logs, initial fixture correction and coverage
classification are retained in the sibling verifier directory.

`browser/report.json` records the production built guest: 4,000 retired
instructions, 3,611 via JIT, 30 host entries, 1,469 direct entries and 1,439
links. Actual FPR spills, X registers, fflags/frm/FS and retired counts agree
with the interpreter and the literal checks. The RAM-only SHA-256 is
`5df84ec4c17598ab2c56293bb5b78338947ce9991af18e0ef795aa4a07d2df44`;
it is not a full architectural-state digest. The full live suite passes 127/127
with zero page/console/HTTP errors, the conversion pip is live 1/1, and the
T03x detail is visible. Root inspected all three screenshots. The explicit
legacy capability inspection only reveals its existing container; no such
hook is used in the physical desktop trial. All acceptance processes exited
normally without an intervention.

## Physical desktop result: failed

`node tools/verify/omarchy-desktop-services.mjs
evidence/omarchy-profile/fp-from-integer-r1/physical-input` exited 1 normally.
The unmodified R3 snapshot reached readiness in 127,993 ms. The browser delivered
128 trusted input events, with no pending, dropped or rejected device events.
Enter completed at `2026-09-15T22:38:14.941Z`; the unchanged 120,000 ms deadline
expired at `22:40:14.941Z`. Thirteen completed independent file reads returned
75 and one remained pending; none found the nonce. These counts come from
`observations[].exec`, not the serial-command intent records.

Frames remained 2→2. Root and the independent critic inspected the real Foot
screenshots: the terminal stayed at its initial empty prompt, and baseline and
failure images are byte-identical. Guest retirement advanced from 1,631,487,925
to 2,880,438,802. The final cumulative JIT share was 0.4382985349743945; this is
not a controlled speedup measurement. No task-owned build or heavy test ran
during this trial. Cleanup closed the browser normally. The raw desktop report
SHA-256 is `29b15c67cd97e1d8daac22b4bf449ba7bd35f3ec5fd6703e8a1e8054fdd7f1fa`.
`physical-summary.json` retains the deadline, input and clock receipts. T03q
remains pending. T03y plans the next measured word-conversion boundary without
treating instruction support as responsive-desktop acceptance.

## Public artifact

`bash tools/deploy-cloudflare.sh` exited 0. Deployment
`https://d3e13537.wasm-vm.pages.dev` and alias `https://wasm-vm.pages.dev` both
serve the frozen WASM, glue, roadmap and application assets: all eight HTTPS
fetches returned 200 with exact local SHA-256 matches. The independent critic
also fetched and hashed these eight assets. The deployment manifests are
committed at `5f759ef9`; runtime and frozen test files are unchanged since
`b587faf6`. `cloudflare-public.json` and `cloudflare-deploy.log` retain the
publication receipts. This publishes conversion support, not a claim that the
desktop is responsive.

## Full local gauntlet

At source `5f759ef96773b93e2b1faff27183bf6e66213fea`,
`record-submission.py ci` ran `make -k ci` from 22:44:01 to 22:51:45 UTC.
The command exited 2, and `ci-commands.json` correctly retains `allPassed:false`.
The failures are the inherited macOS `wvseccomp` libc/syscall build errors
(`ci.log:5–113`), all-feature dead-code errors for `live_blocks` and `fetch_phys`
(46–68), the default-WASM resume fixture's stale assertion (590–638), the
zicsr-stub test build's unavailable `boot_supervisor` / `enable_builtin_sbi`
methods (714–742), and the determinism scanner rejecting the pre-existing
test-only `Instant` clock (769–773). The relevant source/dependency boundaries
are carried unchanged; `unchanged-boundaries.json` records exact comparisons.

The feature builds passed. The native ISA regression wall passed 128/128,
corpus FNV `12ffd571f24eb40e` (`ci.log:764`). The final uncontended performance
smoke passed at 25.3 MIPS against the 15 MIPS floor (`ci.log:780`). Neither
these successes nor the focused conversion acceptance relabel full CI as green.

## Final pristine clone

`run-cold.py` cloned exact head `5f759ef96773b93e2b1faff27183bf6e66213fea`
into `/private/tmp/wasm-vm-fp-from-integer-cold-u7q5211i/repo`, confirmed an
empty initial worktree, and removed RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG and all
CARGO_* environment variables. All four commands exited 0. `make web-dist`
reproduced the committed WASM SHA-256 exactly; `make verify-E5_5-T03x` passed
the unsupported-family contrast, worker and critic native tests, both WASM
memory modes and the actual built-page guest. Acceptance finished at
`2026-09-15T23:01:04Z`. `cold/report.json` records every command and timestamp.

The cold browser repeats 3,611/4,000 JIT retirements and the same RAM digest,
127/127 live ISA tests and zero errors. Root inspected all three cold images:
the suite is green, the conversion pip is live 1/1 and the correct T03x detail
is visible. Its task status remains the honest in-progress value frozen with
the artifact; final verifier status is recorded separately in the task file.
No runtime, promoted fixture or artifact changed after the frozen submission.
