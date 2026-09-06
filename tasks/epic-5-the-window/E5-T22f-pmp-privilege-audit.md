---
id: E5-T22f
epic: 5
title: Avoid redundant cached-code PMP audits across S/U transitions
priority: 522.29
status: in-progress
depends_on: [E5-T22e]
estimate: S
risk: high
capstone: false
---

## Goal

Remove the measured full-cache execute-permission audit when only supervisor
versus user privilege changes and PMP state is unchanged. The pinned desktop's
maximum-mode resize spends about 30% of sampled CPU here; this is a prerequisite
optimization, not a claim to satisfy the complete two-second resize target.

## Boundary

Own only the unchanged-PMP S/U equivalence shortcut in cached-code permission
synchronization and its deterministic proof. Keep every PMP access check,
M-mode distinction, effective-revision invalidation, MMU permission check,
interpreter/JIT policy, snapshot format, guest image and kernel unchanged.

## Acceptance criteria

- [ ] With an unchanged PMP revision, S/U transitions retain cached code without
      inspecting cached instructions. Deterministic audit counters prove zero
      work for repeated transitions across different populated cache sizes.
- [ ] Transitions involving M retain the existing per-instruction permission
      audit and fail/flush on a changed permission. A PMP revision change still
      invalidates before a cached interior instruction can execute, including
      when revision and S/U mode change at the same boundary.
- [ ] Cache-on/off guest instruction traces and final architectural state agree
      through guest SRET/trap transitions and host-directed boundary changes;
      deterministic native and actual-Wasm tests cover the selected boundary.
- [ ] Frozen local acceptance, one pristine-clone run, and a real browser resize
      recording on the unchanged v7 desktop image demonstrate the optimization
      without losing client/mode/EDID/canvas agreement. Report actual timings,
      keeping the separate E5-T22c performance requirement unmodified.

## Verification command

make verify-E5-T22f

## Adversarial verification

Combine a privilege transition with PMP X revocation inside an already decoded
block; vary locked/unlocked maps, TOR boundaries and M/S/U directions. Exercise
guest SRET and trap entry within a run, not only host mutation between chunks.
Include effective versus ignored locked writes, snapshot restore and reset in
the affected regression set. The shortcut must never weaken page-table U/X
permissions or enable M-mode bypass in S/U. Invent one bounded mode/map sequence
with an independent seed; sabotage the revision guard once and require a denied
interior-instruction test to catch it. Carry unchanged C GPU/client proof forward.

## Verification log

### 2026-09-06 — coordinator — measured prerequisite

The unchanged release module's CPU profiles at `9b656c7f` assign 30.71% and
30.06% of two maximum-mode resize windows to cached-code PMP synchronization.
Evidence: `evidence/e5-t22c/iteration-solid-v7-cpu/cpu-summary.json`, with raw
profiles and a section-identity-checked offline name map. C remains blocked on
this isolated engine boundary. Do not mark C verified after this task without
rerunning its own complete acceptance.

### 2026-09-06 — worker — in-progress

Activate the top eligible S prerequisite above C's preserved `03fdfb24`
checkpoint. First instrument the existing slow audit in native unit tests and
record the zero-work regression failing. Then add only an unchanged-revision
S/U shortcut, preserving the slow M-mode audit and all invalidation logic.

### 2026-09-06 — worker — narrow regression and implementation

The old synchronization audits 128 instructions on the first S-to-U transition
of a one-block cache (`evidence/e5-t22f/red-audit.log`); predicted work was zero.
A test-only counter observes the existing audit loop and never controls a
runtime decision. The shortcut requires both an unchanged effective PMP
revision and exactly S-to-U or U-to-S. M-mode keeps the original audit; any
revision change still takes full invalidation before the shortcut can apply.

Three native unit tests now pass: 1000 transitions each at 1/16/128/2048 cached
blocks do zero audit work; all four M-to/from-S/U directions inspect 2048 ops;
simultaneous revision and S/U changes flush. Shared guest fixtures run genuine
SRET/user-ECALL/delegated-trap cycles with byte-identical cache-on/off records,
full hart snapshots and frozen pre-change trace hashes on native and actual
Wasm. Revision revocation permits the entry but faults at 0x80000004 before
x6 changes. A 1000-transition dirty-target restore sequence has matching traces.
The additional actual-Wasm BrowserExecutor case requires compiled execution
and identical full hart/RAM state after 1000 guest privilege cycles.

Local scoped fmt/clippy and affected native/actual-Wasm suites pass. The wider
browser-JIT suite passes 34 tests with its pre-existing long externref-churn
test ignored; this task does not change handle lifetime or eviction. The first
plain native lib invocation hit the known unrelated missing gpu-trace method;
`precheck-missing-gpu-trace.log` preserves it and the prescribed feature-enabled
run is used. Runtime/browser proof and final cold clone are still pending.

### 2026-09-06 — worker — respond to source review; measured cost removed

The fresh source reviewer identified two proof gaps, not a runtime refutation.
Add a cache-disabled comparator to the host/restore sequence with full CPU/RAM
and trace equality. Add a batched mid-block case that yields with a decoded
cursor at 0x80000004, changes both S/U mode and PMP revision, and requires zero
retirements/x6=0 on the next access fault. This prevents a second boundary audit
from hiding an entry-sync guard regression. The verifier retains the isolated
revision-guard sabotage for its final attack. Effective-address and ignored
locked-TOR cfg/own-address/neighbor-address observations are now explicit.
The five native audit tests and five actual-Wasm fixture/JIT tests pass.

Diagnostic browser run `evidence/e5-t22f/iteration-pmp-shortcut/` uses unchanged
v7 image and new Wasm `360646c69fd0be878d47acfe212fc63353fdd80ccd5d690bd6e2bfc5da8f28bb`.
The recorder started before the runtime commit, so its head field is the earlier
activation `eea8a2c9`; its actual Wasm bytes match committed `41d9ce2c` exactly.
Preserve that fact rather than relabeling it as frozen-head acceptance. Both
profilers are enabled and some deterministic fixture builds overlap the boot.
Seven real mode/EDID/canvas/client/marker checks pass, zero browser errors.
Maximum full repaint is 10203 ms; 640x480 is 1709 ms and 802x601 is below 2000 ms.
The independently section-bound CPU name map puts cached-PMP synchronization at
0.35% for the maximum-mode window, down from 30.71% in the old diagnostic. The
remaining C timing gap is not waived. Final acceptance will use no profiler and
a frozen source tree in one pristine local clone.

### 2026-09-06 — worker — cold-clone container mount correction

The first pristine run at `fd58010a` passed the scoped native, actual-Wasm,
clippy and engine-harness checks, then failed rebuilding the pinned image.
`evidence/e5-t22f/cold-clone-mount-failure.log` preserves the full failure.
Colima cannot see the default macOS `/private/var/folders/...` scratch path:
an explicit Docker bind mount rejects it as absent, whereas the identical
137-line package input under `/Users` mounts as a regular file. No image or
browser acceptance was produced, and this is not counted as a passing clone.

Add `cold_clone.sh --parent DIR` to choose an existing shared scratch parent,
while retaining the default path and environment scrub. Positional shell
arguments keep spaces and quotes literal, and one validated make target cannot
inject shell code or make flags. Deterministic fixture tests cover both path
modes, committed-versus-dirty input, environment scrubbing, retained evidence,
owned-child-only cleanup, invalid arguments and nonzero make propagation.
The broader historical `self_check.sh` still flags pre-existing Makefile
cleanup and multiline-option recipes; this task does not change those paths.
The engine/runtime and immutable desktop fixture are unchanged. Repeat final
acceptance from the new committed head in a shared `/Users` scratch child.
