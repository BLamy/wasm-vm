---
id: E1-T24
epic: 1
title: "Capstone: Level 1 threshold — riscv-tests and RISCOF green, native and WASM"
priority: 124
status: in_progress
depends_on: [E1-T13, E1-T14, E1-T18, E1-T20, E1-T21, E1-T22, E1-T23, E1-T25, E1-T26, E1-T29]
estimate: L
capstone: true
---

## Goal
The Level 1 exit gate from ROADMAP.md, demonstrated end-to-end from a cold start: the
complete RV64GC machine passes riscv-tests — rv64ui, rv64um, rv64ua, rv64uf, rv64ud,
rv64uc (both -p and -v variants), rv64mi, rv64si — AND a full RISCOF architectural
compliance run, in the native build and the wasm32 build, with zero allowlist/exclusion
entries. After this, a Linux misbehavior is never silently a CPU bug.

## Context
T19 built the riscv-tests wall and T20 the RISCOF flow, each tolerating a documented
allowlist during development. The capstone burns both allowlists to zero and freezes the
result as the epic's demonstrable threshold. Per tasks/README.md, a capstone must be
demonstrated from a cold start: fresh clone, fresh browser profile, no development
residue. The reward waiting on the far side of this gate is the first real OS kernel:
**xv6-riscv** needs only this Layer-A machine plus a minimal slice of Epic 2's platform
(UART, virtio-blk, a timer), so xv6 straddles the E1/E2 boundary and is Epic 2's opening
milestone (E2-T15). The demo is one command plus one page: `tools/level1_gate.sh` runs native
riscv-tests, native RISCOF, the wasm riscv-tests job, and the wasm signature-equivalence
check, and writes a single consolidated report; a static page shows the wasm leg running
live in a browser tab (the ROADMAP's "in both native and WASM builds", made visible).

## Deliverables
- `tools/level1_gate.sh`: clean-tree check → provision pinned deps → run all four legs →
  emit `target/level1-report.md` with per-suite counts, RISCOF summary, git revs, and
  sha256 of the wasm artifact.
- Empty `tests/riscv-tests-allowlist.txt` and empty `compliance/EXCLUSIONS.md` (files
  present, zero entries) — with the T19/T20 CI diffs now enforcing emptiness.
- Browser demo page (`www/compliance.html`): loads the wasm module, runs the full
  riscv-tests set with a live per-test pass/fail table, finishing with a green/red
  verdict banner.
- CI: the gate script as a required workflow; README badge row for Level 1.
- A tagged release commit `level-1` once verified.

## Acceptance criteria
- [ ] From a fresh clone on a machine that has never built the project (recorded:
      host, OS, toolchain provisioning log), `tools/level1_gate.sh` exits 0.
- [ ] riscv-tests: every discovered test in rv64ui/um/ua/uf/ud/uc{-p,-v}, rv64mi-p,
      rv64si-p reports PASS in both native and wasm legs; discovered count matches the
      pinned upstream manifest count.
- [ ] RISCOF: 0 failed signature comparisons across I/M/A/F/D/C/Zicsr/Zifencei/privilege
      suites against the pinned Sail reference; exclusion file empty.
- [ ] wasm leg signatures byte-identical to native leg signatures (T22 machinery).
- [ ] `www/compliance.html` in a fresh browser profile (Chrome and Firefox) completes
      the suite with the green banner in ≤ 10 minutes on the recorded reference machine.
- [ ] The consolidated report is committed alongside the `level-1` tag and contains all
      pins (riscv-tests, riscv-arch-test, sail, toolchain shas).

## Adversarial verification
This is the epic gate — assume the implementer's environment is lying. Re-run the entire
gate from a fresh clone on a DIFFERENT machine and a fresh browser profile; any leg
failing refutes. Verify the wasm leg is real: hash the wasm artifact the browser fetched
(DevTools network tab) against the report's sha256, and mutate one instruction
implementation to confirm both native AND wasm legs go red independently (a wasm leg
that proxies native results would only redden once). Verify count integrity:
independently enumerate the pinned riscv-tests and riscv-arch-test suites and match the
report's discovered counts — missing tests refute. Verify allowlist emptiness in the
enforcing CI code, not just the files (a runner flag skipping the diff refutes). Spot-
audit five RISCOF signatures by hand against Sail logs. Then go beyond the gate: run the
T21 fuzzer for a fresh 100M-instruction nightly against this exact rev — a new divergence
does not automatically refute the capstone (the gate is the suites), but any divergence
traced to a spec violation of a suite-tested behavior does. Finally, kill the browser tab
mid-run and reload: the demo must restart cleanly (no wedged state), else the cold-start
claim is refuted.

## Verification log

### 2026-07-04 — increment 1: honest Level-1 gate built; caught a real no_std regression
Per the "build gate now, sequence features" plan, this increment lands the measurement
harness — NOT the green threshold (which requires burning 45 documented deferrals to zero;
those are sequenced as E1-T25..T29 below). The gate is deliberately honest: it never reports
a Level 1 it did not earn.

**`tools/level1_gate.sh` (+ `make level1-gate`)** — runs four legs and emits one consolidated
report (`target/level1-report.md`); exits 0 ONLY when every leg is green AND both deferral
lists are empty:
- **Leg A — native riscv-tests**: PASS (in-crate `riscv_tests` suite + `run_riscv_tests.sh`;
  2 allowlisted, deferred).
- **Leg B — native RISCOF vs Spike**: runs `run_riscof.sh` when provisioned (venv + Docker
  `wasm-vm-toolchain:local`); green (0 unexcused), 43 EXCLUSIONS entries deferred. SKIPs
  honestly (→ INCOMPLETE, never green) when unprovisioned.
- **Leg C — native==wasm equality**: PASS — `determinism_check.sh` proves native and wasm32
  builds match the frozen T22 golden fingerprints (`pinned_fingerprints_match_golden` native
  AND `..._on_wasm`).
- **Leg D — wasm artifact identity**: PASS — sha256 of `web/pkg/*_bg.wasm` recorded in the
  report pins for the browser leg.

The report records git rev, per-leg status, the **deferral accounting** (allowlist N +
EXCLUSIONS N → total; must reach zero), and reproducibility pins.

**A REAL REGRESSION the gate caught (the gate's first payoff):** E1-T20's `Machine::signature()`
(the RISCOF signature dump) used the bare prelude `format!`/`String`, which resolve under
`std` but NOT under the `no_std` wasm build — so `make wasm` (and the wasm determinism leg)
had been **broken since T20 landed**. The T20 critic only ran native `cargo test --workspace`,
which is why it slipped through. Fixed in `crates/core/src/lib.rs` by fully-qualifying
`alloc::string::String` / `alloc::format!` (compiles in both configs). Verified: `cargo build
-p wasm-vm-core --no-default-features --target wasm32-unknown-unknown` green; `wasm-vm-wasm`
wasm32 build green; native `signature` test 4/4; the wasm determinism fingerprint now matches
golden again.

**Browser compliance demo (deliverable):** substantially pre-exists as the E0-T23 web demo
(`web/index.html` + `main.js`): it loads the wasm module and runs the riscv-tests set live
with a per-test pass/fail heatmap, metrics, and a verdict — exactly the capstone's "live
per-test table + green/red banner". Referenced rather than duplicated; a dedicated
`www/compliance.html` rename is a cosmetic follow-on.

**Deferrals → follow-on tasks (the "sequence features" plan; capstone `depends_on` now
includes all five):** the 45 remaining deferrals map to five Level-1-out-of-scope features,
each now a task that removes its own allowlist/EXCLUSIONS entries:
- **E1-T25** exception-priority §3.7.1 (removes 1: `vm_sv39 VA_all_zeros`)
- **E1-T26** misaligned-access support (removes 1: `rv64ui-p-ma_data`; depends on T25)
- **E1-T27** 64-region PMP (removes 4: `pmpm_all_entries_check-01..04`)
- **E1-T28** Sv57 five-level paging (removes 38: `vm_sv57` + `vm_pmp/sv57`)
- **E1-T29** debug triggers tdata1/2 (removes 1: `rv64mi-p-breakpoint`)

When all five land and the gate's deferral total hits zero with every leg green, the capstone
flips to verified, the report is committed, and the `level-1` tag is cut (a step reserved for
that increment — not taken now).

**Local gate for THIS increment:** the no_std fix restores `make wasm`; `cargo test -p
wasm-vm-core --test signature` 4/4; determinism native+wasm green. Full `cargo fmt`/`clippy`/
`cargo test --workspace` re-run before push.

### 2026-07-04 — critic round 1: VERIFIED (cold clone at `dc962ab`) + 2 latent gate defects fixed
Adversarial cold-clone critic verified the gate increment at fixed HEAD `dc962ab`; clone left clean.

- **Workspace gate:** `cargo fmt --check` exit 0; `cargo clippy --workspace --all-targets` exit 0;
  `cargo test --workspace` → **90 ok-suites, 0 FAILED** (grepped), 473 tests passed.
- **no_std regression real, fix correct:** provenance `git log -S'fn signature'` → introduced by the
  E1-T20 wip commit (parent carries the identical bare `Result<String,String>`/`format!`); reverting
  the `alloc::` fix makes `cargo build -p wasm-vm-core --no-default-features --target
  wasm32-unknown-unknown` FAIL (`cannot find macro format`, `cannot find type String`); with the fix
  it builds; native unaffected (`--test signature` 4/4).
- **Gate honesty (read line-by-line + ran it):** exit 0 gated on `GREEN && COMPLETE && DEFERRED==0`;
  at 45 deferrals it CANNOT report MET — verdicts `❌/⏳ NOT MET`, exit 1. Leg-B plumbing truthful:
  `config.ini` DUT=wasmvm / ref=spike; `riscof_wasmvm.py` invokes `target/release/wasm-vm run
  --signature=…` (the exact regression path); a fully-provisioned run produced 395 real DUT-*.signature
  files vs the arch-test suite (genuine differential, not Spike-for-both).
- **T25–T29 arithmetic:** 1+1+4+38+1 = **45**, partitioning exactly into 43 EXCLUSIONS + 2 allowlist;
  every named entry confirmed present in the actual files.

**Two latent gate defects the critic found (neither faked a MET verdict — both fixed in this commit):**
1. **zero-count arithmetic** — `grep -c … || echo 0` emits `"0\n0"` when a count is *legitimately
   zero*, breaking `$((…))` on the FUTURE zero-deferral MET path. Fixed: `… || true; VAR=${VAR:-0}`.
   Verified the empty-file case now arithmetics to 0 (so the capstone-completion increment can actually
   flip MET). This was the important one — it would have sabotaged the very path this whole task builds toward.
2. **leg-B zero-coverage PASS** — `run_riscof.sh` with `passed=0, unexcused=0` recorded `B=PASS … 0
   passed` (vacuous, from an errored/half-provisioned run). Fixed: leg B now requires `passed > 0`,
   else records FAIL "RISCOF ran 0 tests (vacuous)". No longer rubber-stamps zero coverage.

**VERDICT: verified.** (critic agent `a049f7db5b022bbdf`; increment's honesty contract holds; the 2
defects were anti-green robustness holes, now closed.) Capstone stays **in_progress** — the gate is
built and honest, the threshold is legitimately not met (45 deferrals); E1-T25..T29 burn it to zero.
