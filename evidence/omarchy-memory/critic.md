# E5.5-T02a fresh-critic plan and pre-observation predictions

Date: 2026-09-09
Critic orientation baseline: `b85947075664e0510fbd92b59d7ffe654e46b572`
State: predictions fixed before any candidate runtime result, frozen diff, or final evidence was inspected. No test or boot command has been run by this critic. This is not a verdict.

## Scope and static orientation

- Review boundary: the shared scalar misaligned-memory path, its deterministic tests, exact JIT host-import result, guest digest, and one native boot confirmation. I will not modify or inspect the original VM/private source image. The accepted `release/rootfs/omarchy.ext4` image-only verification is an input assumption, not a claim reopened here.
- At orientation, `misaligned_ram_base` translated the first and last virtual bytes but admitted the access only when `pa_last == pa0 + len - 1`, one contiguous physical RAM range passed one PMP check, and stores then emitted byte writes. `jit_store_with_ram_phys` propagated that physical base as a continuation hint and invalidated a reservation only after success.
- The browser host import treats `None` from `jit_store_with_ram_phys` as a chain barrier. Therefore a two-fragment store must finish all physical byte writes and their code-write logging before returning `None`; the subsequent chain exit is what lets `Machine` drain the log before compiled execution continues.
- At orientation, the worker's only task-local change visible to this critic was an untracked `misaligned_virtual_pages.rs` containing the observed interpreter `LD` at page offset `0xffc`; runtime code was still unchanged. This is an orientation note, not a coverage finding against the eventual frozen submission.

## Falsifiable predictions

### P1 — complete scalar crossing matrix and independent byte oracle

For adjacent Sv39 virtual pages mapped to nonadjacent RAM frames, every genuinely crossing scalar shape will match an independently constructed little-endian byte model in both interpreter execution and the JIT host imports:

- `LH/LHU/SH` at page offset `4095`;
- `LW/LWU/SW` at offsets `4093..=4095`;
- `LD/SD` at offsets `4089..=4095`.

The matrix will hold with the second physical frame both above and below the first. Signed loads will sign-extend from their architectural width; unsigned loads will zero-extend. Expected bytes/values will be constructed separately rather than established by storing and loading through the same changed path. Any wrong byte, extension, trap, or interpreter/JIT discrepancy fails P1.

### P2 — two-fragment alias semantics

When both adjacent virtual pages alias the same physical frame, a crossing load will assemble the tail bytes followed by the frame's head bytes. A crossing store will write the low-order value bytes to the tail and the remaining high-order bytes to the head, with unrelated bytes unchanged. It will neither deduplicate nor linearize the two virtual fragments into an invented contiguous physical range. The exact JIT store result will be `None`, while the code-write log need name only the one physical frame actually modified. Any contiguous hint, wrong overwrite order, or mutation outside the two fragment ranges fails P2.

### P3 — full store preflight and precise second-page faults

Before the first data byte of a crossing plain store is written, both virtual fragments will have passed translation, whole-fragment RAM containment, and whole-fragment PMP write permission. Consequently:

- an unmapped second page yields `StorePageFault` (15);
- a valid but read-only/dirty-ineligible second leaf yields `StorePageFault` (15);
- a final-physical PMP denial on the second fragment yields `StoreAccessFault` (7).

In each case `tval` will be the first virtual byte of the failing second fragment (the next page boundary), not the instruction's original unaligned address, its last byte, or a physical address. Both data frames, the code-write log, device log/hit counts, and an existing LR/SC reservation will remain unchanged. Equivalent loads will report `LoadPageFault` (13) or `LoadAccessFault` (5) with the same first-failing-fragment `tval`. Any first-fragment data mutation or reservation loss on a faulting ordinary store fails P3.

### P4 — PMP checks preserve whole-access matching within each fragment

Each physical fragment will be submitted to PMP as one `(fragment_pa, fragment_len)` access, not as independent bytes. In a bounded attack using an `LD/SD` whose second fragment is six bytes, a lower-numbered PMP entry will match only the first four bytes while a later permissive entry covers the remainder. RISC-V's lowest-numbered matching-entry/whole-access rule predicts denial of the six-byte fragment: load cause 5 or store cause 7, second-fragment virtual `tval`, no store bytes written. A byte-wise PMP loop would incorrectly combine the entries and therefore fails P4 even if ordinary allow/deny tests pass.

PMP permission for page-table reads remains independently enforced during both translations. A PTE-walk PMP denial will retain the original load/store access-fault class and the virtual address being translated.

### P5 — RAM-only support and device silence

If the second virtual page translates to an attached device window or any non-RAM physical range, the complete plan will reject the scalar access before invoking `load8`, `store8`, or any wider device operation. The result will be `LoadAccessFault` (5) or `StoreAccessFault` (7), with `tval` at the first byte of that non-RAM fragment. For stores, first-page RAM, device state/hit counts, code-write log, and reservation will be bit-identical to their pre-call values. Any device callback or first-fragment write fails P5.

### P6 — continuation hints and code-page tracking

Every successful two-fragment crossing store will return `None` from the exact `jit_store_with_ram_phys` call, including physically ascending, descending, physically adjacent, and same-frame-alias mappings. All physical frames modified by the store will already be represented in `SystemBus::code_write_log` before that return; an alias may collapse to one unique frame. The browser host import will therefore mark a chain abort, and the machine boundary will drain/invalidate all affected compiled pages before another compiled block can run.

A successful one-fragment misaligned RAM store will retain its existing `Some(pa0)` hint, and naturally aligned scalar behavior will remain unchanged. Returning `Some` for any two-fragment store, omitting a modified frame, or continuing a chain into stale code fails P6.

### P7 — reservation and atomic-alignment boundary

Faulting ordinary interpreter and JIT stores will preserve an existing reservation. Successful ordinary stores will keep the established behavior: overlapping stores invalidate it and nonoverlapping stores preserve it. `LR.W/LR.D`, `SC.W/SC.D`, and all AMOs remain naturally aligned only; a crossing/misaligned LR reports cause 4, while SC/AMO report cause 6, with `tval` equal to the original effective address and no memory/device operation. A misalignment trap occurs before SC consumes its reservation. Any newly admitted misaligned atomic or changed reservation lifecycle fails P7.

### P8 — exact-head regression and portability evidence

At the frozen head, the deterministic acceptance command `cargo test -p wasm-vm-core --test misaligned_virtual_pages` will pass from a scrubbed pristine clone and will exercise every changed behavioral hunk or identify a justified non-runtime waiver. No new test will be ignored, feature-disabled in the proving configuration, self-licking, or dependent on inherited `RUSTFLAGS`, `CARGO_*`, or `RUST_LOG`. A sabotage that restores the old physical-contiguity rejection will make the principal noncontiguous cases fail.

### P9 — guest evidence and native Omarchy confirmation

The final evidence will bind a regression guest-state digest and all cited outputs to the same frozen commit. A native boot of the already accepted image will pass the previous systemd failure point without the prior user load-access fault (`cause 5`, bad address ending `0xeffc`) or `systemd[1]: Caught <SEGV>`/`Freezing execution` at that point, and will show a later deterministic boot marker. This proves only removal of this boot blocker; it does not prove first-run configuration, a browser desktop, or a performance budget.

## Frozen-head verification sequence

After the coordinator supplies the frozen head and gates, and only then, the critic will:

1. inspect the exact task diff and classify every changed hunk as exercised, waived, dead, or needing evidence;
2. hash/cross-check the cited regression, guest digest, boot log, and commit identity before trusting outputs;
3. run the acceptance command read-only, then the bounded P4 whole-fragment PMP attack and targeted reservation/device/code-log checks without changing runtime code or task status;
4. perform the scrubbed pristine-clone run and one old-behavior sabotage check appropriate to this high-risk semantic change;
5. record `HELD`, `FAILED`, or `NEEDS EVIDENCE` per prediction. No task status or verification-log edit will occur until an authorized verdict phase.

## 2026-09-09 — frozen runtime review, provisional observations

Runtime/regression/ELF/dist head: `14e4acdc15d2e930fb614af1e9c5c230c4c8d4f3`
Parent: `b85947075664e0510fbd92b59d7ffe654e46b572`
Harness-only follow-up: `f4a90e3116b905f1bf63655d23969ee62af1d087`
Core-harness-only follow-up: `89e16a95b232941f27f5afbe449b1c80c535f512`
State: review complete with no refutation; no task-status change. The coordinator still owns the worker submission and transition to `implemented` before the verifier log/status phase.

### Diff and specification audit

- `git diff --check b8594707..14e4acdc` passed. The runtime diff is confined to the misaligned scalar plan in `crates/core/src/hart/mod.rs`; LR/SC/AMO implementation paths are unchanged. The remaining changes are task-specific tests, guest regression/build inputs, browser manifest/roadmap/test wiring, generated dist, and task text.
- The plan at `hart/mod.rs:505-551` computes one or two virtual-page fragments, translates and validates each complete physical fragment before data access, retains the original whole-range PMP check when the fragments are physically contiguous, and rejects address wrap. Loads/stores at lines 558-599 consume only the validated plan; a cross-page store returns `None` after all byte writes.
- The RISC-V Supervisor ISA 1.13 `stval` rule says that when a misaligned load/store causes an access/page/hardware-error fault, the nonzero trap value identifies the virtual address of the portion that caused the fault. This supports the second-page-boundary expectations used by the task and tests: <https://docs.riscv.org/reference/isa/v20260120/priv/supervisor.html#_supervisor_trap_value_stval_register>.
- The harness follow-up `14e4acdc..f4a90e31` changes only `web/tests/e5.5-t02a-page-memory.spec.js:21`, from a `/verified/` class expectation to the actual promoted `live` class. `git diff --check` passed. Core/pristine results below carry forward unchanged.

### Prediction results so far

- **P1 — HELD.** `crossing_load_matrix_interpreter_and_jit` and `crossing_store_matrix_preserves_other_bytes_and_logs_all_frames` cover every crossing offset for 2/4/8-byte scalar accesses, both load signedness forms, interpreter/JIT host paths, ascending/descending/sequential physical frames, and an independent explicit tail/head byte oracle. All passed.
- **P2 — HELD.** The same matrices include both virtual pages aliasing `FIRST`; exact bytes and untouched RAM matched the oracle, JIT stores returned `None`, and the deduplicated physical write log contained the one aliased frame.
- **P3 — HELD.** Missing, read-only, and dirty-ineligible second leaves returned causes 13/15 at `VA+0x1000`; final-physical PMP denial returned causes 5/7 at the failing fragment. Tests compare all RAM, write log, PC/registers, and reservation before/after each failure. Updated RAM-end expectations in `hart_memory` also passed.
- **P4 — HELD.** The committed six-byte second-fragment NA4 attack proves PMP is not checked byte-by-byte. The physically contiguous two-fragment case proves the additional whole-range PMP rule remains enforced. An independent disposable-clone attack denied only the second leaf PTE's 8-byte physical read after the first translation was cached; the JIT store returned cause 7 with `tval=VA+0x1000`, and RAM, write log, and reservation were unchanged.
- **P5 — HELD.** Device-backed and just-past-RAM second mappings returned causes 5/7 at `VA+0x1000`; complete RAM and the recording device's read/write callback logs remained unchanged for interpreter and JIT load/store paths. Static control flow rejects at `ram_contains` before any bus data accessor.
- **P6 — HELD for the changed boundary.** Every two-fragment mapping, including physically adjacent and aliased pages, returned `None`; all modified physical frames were already in `SystemBus::code_write_log`. One-page aligned/misaligned stores retained `Some(pa)`. The unchanged browser host import converts `None` to a chain abort, so the changed core result reaches the existing drain boundary. Final 127-test browser output remains part of P8/P9 evidence collection.
- **P7 — HELD.** All LR/SC/AMO operation variants and all crossing offsets retained causes 4/6 ahead of missing-page translation, without RAM/log/reservation mutation. Successful ordinary crossing stores invalidated only overlapping reservations in both interpreter and JIT paths; faulting stores preserved them.
- **P8 — HELD.** Shared-worktree acceptance passed 10/10 in 0.12 s. A no-hardlink pristine clone at exact runtime head `14e4acdc`, with inherited `RUST_LOG` and `RUSTFLAGS` removed and no `CARGO_*` variables present, rebuilt and passed 10/10 in 0.12 s. The affected `hart_memory` suite passed 13/13. A single disposable sabotage reintroduced the old physical-contiguity rejection; `ld_crosses_noncontiguous_physical_pages` turned red with `LoadAccessFault` at `0x4ffc`, proving the regression is load-bearing. The final recorded acceptance at the unchanged runtime head passed 10/10 and reproduced digest `1a3a00366b7abe8a47f9b62507b03dc88e62787db5a16e5c392d6a1e25f2333c`. At harness head `f4a90e31`, Playwright passed in 9.5 s with 127 done, 127 passed, 0 failed, suite complete, capability class/text `live`, and an empty page/console-error array. The trace's embedded 29,656-byte regression ELF hashes to the reviewed `ed135b…7339` binary.
- **P9 — HELD.** The final regression trace printed two correct retirement records and deterministic digest `1a3a00366b7abe8a47f9b62507b03dc88e62787db5a16e5c392d6a1e25f2333c`. The checked-in native, dist, and browser-trace guest ELFs are byte-identical with SHA-256 `ed135bffa02a7503393d4c48a52d9e6a567ad19dd6492a78590dfe2663437339`. The coordinator identifies the interpreter run as a rebuilt binary from frozen runtime head `14e4acdc`; the independently reviewed `14e4acdc..f4a90e31` diff is selector-only. `native-boot-final.log` reaches `Welcome to Arch Linux`, `Started Journal Service`, and `Finished Flush Journal to Persistent Storage`, then stops only at the configured 3-billion-instruction bound. It contains none of the baseline's cause-5/badaddr-`effc`, `Caught <SEGV>`, or `Freezing execution` signatures. Its 2,999,858,716 retirement count exactly matches `native-digest-final.txt`, which records full retirement mode, FNV64 `a0dc0ca98eb86d1c`, state SHA-256 `a25a1e0540a4a9799710128b1efa8a3caad04f0dc5897b3012419642dd4ff398`, and `outcome=MaxInstrs`. This proves the scoped boot-blocker claim only; no image, production, desktop, or performance claim is inferred.

### Commands and bounded attacks

```text
cargo test -p wasm-vm-core --test misaligned_virtual_pages -- --nocapture
  -> 10 passed, 0 failed, 0 ignored; digest 1a3a0036...f2333c

cargo test -p wasm-vm-core --test hart_memory
  -> 13 passed, 0 failed

env -u RUST_LOG -u RUSTFLAGS cargo test -p wasm-vm-core --test misaligned_virtual_pages
  -> pristine exact-head clone: 10 passed, 0 failed

env -u RUST_LOG -u RUSTFLAGS cargo test -p wasm-vm-core --test misaligned_virtual_pages critic_second_fragment_pte_read_pmp_denial_is_atomic -- --exact
  -> disposable-only novel attack: 1 passed

# After disposable-only sabotage restoring the old PA-contiguity rejection:
env -u RUST_LOG -u RUSTFLAGS cargo test -p wasm-vm-core --test misaligned_virtual_pages ld_crosses_noncontiguous_physical_pages -- --exact
  -> expected failure; Trap { cause: LoadAccessFault, tval: 20476 }
```

### Coverage classification

- `MisalignedRam::byte_address`, one/two-fragment planning, checked-add failure, both translations, first/second RAM and PMP denials, partial PMP matching, contiguous whole-range PMP pass/fail, load assembly, store decomposition, `Some` one-page hint, and `None` cross-page hint all executed in the committed acceptance matrix.
- The post-preflight `bus.load8/store8` error-mapping arms are **waived defensive paths**: for the production `SystemBus`, a successful `ram_contains` over each complete fragment proves every following byte accessor is in RAM and cannot route to a device or range-fault. The mappings remain fail-closed for a nonconforming custom `Bus`.
- Task text and generated manifest/cache-version changes are declarative. The new guest assembly, dist wasm, live capability selector, browser suite behavior, and native Omarchy integration are covered by the final artifacts below.
- **SUITE:** no test promoted in this pass. The novel PTE-read PMP attack held and changed no product conclusion; retain it as disposable verifier evidence unless the final artifact review reveals a recurring gap.

### Final browser artifact audit

- `evidence/omarchy-memory/browser-final.log` — SHA-256 `7c207971373855f82ab6d59fd90a62030a4a179f9161542f452db885d360db4f`; records the new guest asset returning HTTP 200 and Playwright `1 passed (9.5s)`.
- `evidence/omarchy-memory/browser-final-trace.zip` — SHA-256 `b112e8410c6d588580a418e9e067b45626b65c698f48ebde4ecac4c1c49b13b5`; replay metadata shows every assertion completed without error: `127`, `127`, `0`, `complete`, `live` class/text, and `errors == []`. Embedded guest ELF SHA-256 is `ed135b…7339`.
- `evidence/omarchy-memory/browser-127-of-127.png` — SHA-256 `0ddec98641a87bd220e223a3281aea57a7fb8b3e98aa6bfb20f7abbab102a794`; visual inspection is consistent with the completed 127-test dashboard and live capability row.
- `evidence/omarchy-memory/regression-final.log` — SHA-256 `8c636209830bae09051a9391e4d97a67ae3b56e78e6f377e36fb8e9e17d8caa2`; 10/10 and digest `1a3a0036…f2333c`.

### Final native interpreter artifact audit

- `evidence/omarchy-memory/native-boot-final.log` — SHA-256 `7ac2edaea1a4b9795d6b6b5cb5a7f5b1553a64de61d5cdc40facbdb3dac08a7f`; `Welcome to Arch Linux` at line 33, `Started Journal Service` at line 96, persistent-journal flush complete at line 103, and 2,999,858,716 retirements at line 107. The run ends at its configured instruction bound, not a guest fault.
- `evidence/omarchy-memory/native-digest-final.txt` — SHA-256 `6fcac885f2817403337ef16eff9ba13922c95f55bb8bb6ca5a371aea83f5e8ee`; full-retirement count agrees exactly with the boot log and carries the final architectural-state digest.
- `evidence/omarchy-memory/native-gpu-final.txt` — SHA-256 `1982e68474ecf2d6221bf27a429dde04d67475cb9d3e19f786b0705c843caa7a`; 89 records, zero dropped, with successful virtio-gpu responses. This is supplemental only and is not used to infer an out-of-scope desktop or production result.

### Final core-harness follow-up audit

- `f4a90e31..89e16a95` changes only two core test expectations and their explanatory comments; `git diff --check` passes. `riscv_tests_suite` raises the pinned `rv64mi-p-` count from 17 to 18 for the newly checked-in task guest. `verifier_e0t08_attacks` updates the RAM-end crossing expectation from the original misaligned effective address to `RAM_END`, the first failing fragment; for width one both values remain identical.
- `evidence/omarchy-memory/corpus-and-boundary-final.log` — SHA-256 `0ab7dde99d4c9869d4ae3b2f80fd7bda287477bf9c89d1b2a263377c7ee54b61`; the corpus suite passes 5/5 (including all 127 allowlisted guests and the 18-entry `rv64mi` manifest) and the verifier boundary suite passes 6/6. Because this follow-up changes no runtime, regression guest, ELF/dist, or browser asset, P1–P9 and the one-time pristine/sabotage results carry forward under the repository's incremental re-verification rule.

### Review conclusion

All P1–P9 predictions held through final test-harness head `89e16a95`. Acceptance, the task's adversarial matrix, the independent second-fragment PTE-read PMP attack, the pristine exact-runtime-head clone, one load-bearing sabotage, browser evidence, and the bounded native interpreter boot reveal no contradiction or uncovered required behavior. No verifier test is promoted: the committed matrix already covers the semantic boundaries, while the novel PTE-walk case is retained as disposable adversarial evidence. The fresh-verifier verdict is ready to be recorded as `verified` after the worker submission sets the task to `implemented`; this file intentionally makes no status, task-log, queue, or commit change.

### Final verifier authorization

Worker submission head `b0f9d0c3d9d405ec60d81cb103b25dbf1a57876a` sets the task to `implemented` and records the exact native command, accepted image digest, frozen runtime identity, and evidence paths. The current `crates/core/src/hart/mod.rs` SHA-256 is `afd114e3ba7968d8ee9efffa807d2cd8fedc8848ce5f8a9db312d46dfbd7d21c`, matching the worker receipt; changes after runtime head `14e4acdc` remain test/evidence/lifecycle-only. The full-core result's two task-related stale harness expectations pass 11/11 at `89e16a95`; the sole remaining failure is the disclosed pre-existing `no_stdout_in_core` scan of untouched files and does not refute this task. Final verdict: `verified` with no evidence gap and no promoted verifier test.
