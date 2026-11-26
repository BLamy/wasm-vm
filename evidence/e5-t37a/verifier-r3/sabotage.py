#!/usr/bin/env python3
"""E5-T37a round-3 verifier — mutation run. Run from the repo root.

One mutation at a time. Each is run against the WORKER's tests
(`cargo test -p wasm-vm-core --lib paced_idle`, 24 tests). A mutant that survives them — and
every mutant of the `teeth` group — is then run against the three verifiers' files as well
(`-- paced_idle v37a_ r2_ r3_`, with the three include! lines appended to the worker's test
module for that run only). After each mutant every touched file is restored with `git checkout`
and re-touched (cargo fingerprints by mtime), and `git status --short crates` must be empty.

  python3 evidence/e5-t37a/verifier-r3/sabotage.py            # everything
  python3 evidence/e5-t37a/verifier-r3/sabotage.py A B        # groups / name prefixes
"""
import subprocess
import sys

LIB, TIME = "crates/core/src/lib.rs", "crates/core/src/time.rs"
TESTS = "crates/core/src/turbo_equivalence_tests.rs"
INCLUDES = (
    '\ninclude!("../../../evidence/e5-t37a/verifier/verifier_tests.rs");\n'
    'include!("../../../evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs");\n'
    'include!("../../../evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs");\n'
)

HOLDS = (
    "        self.fabric_idle_epoch == Some(self.fabric_epoch.get())\n"
    "            && self.fresh_mip() & self.hart.csr.mie_bits() == 0"
)
WAKE_TAIL = (
    "            self.sync_clint();\n            self.sync_sbi_timer();\n        }\n    }\n\n"
    "    /// The guest's time and its nearest armed FUTURE"
)

M = [
    # ── A: the seven mutants that survived the worker's round-2 tests, re-applied to round 3 ──
    ("A1 a wait recorded at a reached deadline (`limited < d` -> `<=`)", LIB,
     "                    if self.idle_yield && limited < d {",
     "                    if self.idle_yield && limited <= d {"),
    ("A2 paced_wake without the deadline cap", LIB,
     "            deadline.unwrap_or(u64::MAX),\n            false,",
     "            u64::MAX,\n            false,"),
    ("A3 paced_wake without sync_sbi_timer", LIB, WAKE_TAIL,
     WAKE_TAIL.replace("            self.sync_sbi_timer();\n", "")),
    ("A4 no STIP level in the wait decision", LIB,
     "            if self.builtin_sbi {\n                level(5, c.mtime >= self.sbi_state.stimecmp);\n            }\n",
     ""),
    ("A5 msip ends the wait although MSIE is clear", LIB,
     "            && self.fresh_mip() & self.hart.csr.mie_bits() == 0",
     "            && self.fresh_mip() & (self.hart.csr.mie_bits() | 0x8) == 0"),
    ("A6 owed waiting time not capped by what the host clock is ahead by", TIME,
     "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));",
     "            .saturating_sub(limited - current);"),
    ("A7 load_resume does not start a new worked/waited interval", LIB,
     "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        self.pmp_revision_seen",
     "        self.clear_idle_wait();\n        self.pmp_revision_seen"),
    # ── B: new mutants of round-3 code, none of them in evidence/e5-t37a/sabotage-r3.log ──
    ("B1 fresh_mip with the PLIC contexts swapped", LIB,
     "            level(11, p.eip(0));\n            level(9, p.eip(1));",
     "            level(11, p.eip(1));\n            level(9, p.eip(0));"),
    ("B2 fresh_mip without the builtin_sbi guard", LIB,
     "            if self.builtin_sbi {\n                level(5, c.mtime >= self.sbi_state.stimecmp);\n            }",
     "            level(5, c.mtime >= self.sbi_state.stimecmp);"),
    ("B3 fresh_mip: STIP level with `>`", LIB,
     "level(5, c.mtime >= self.sbi_state.stimecmp);",
     "level(5, c.mtime > self.sbi_state.stimecmp);"),
    ("B3b fresh_mip: MTIP level with `>`", LIB,
     "            level(7, c.mtip());",
     "            level(7, c.mtime > c.mtimecmp);"),
    ("B4 paced_wait_holds accepts an unset marker", LIB, HOLDS,
     HOLDS.replace("self.fabric_idle_epoch == Some(self.fabric_epoch.get())",
                   "self.fabric_idle_epoch.is_none_or(|e| e == self.fabric_epoch.get())")),
    ("B5 paced_wait_holds: marker set is enough (no epoch equality)", LIB, HOLDS,
     HOLDS.replace("self.fabric_idle_epoch == Some(self.fabric_epoch.get())",
                   "self.fabric_idle_epoch.is_some()")),
    ("B7 the run-entry clear of an untaken wait removed", LIB,
     "        if self.idle_wait_deadline != u64::MAX {\n            self.clear_idle_wait();\n        }\n        while remaining_work != 0 {",
     "        while remaining_work != 0 {"),
    ("B8 the run-entry reset of the quiescence marker removed (pre-existing line the contract leans on)", LIB,
     "        // changed device state since the last run: the first boundary performs a full sync.\n        self.fabric_idle_epoch = None;",
     "        // changed device state since the last run: the first boundary performs a full sync."),
    ("B9 paced_wake writes mtime and resyncs unconditionally (`limited != mtime` guard)", LIB,
     "        if limited != mtime {\n            clint.borrow_mut().mtime = limited;",
     "        if true {\n            clint.borrow_mut().mtime = limited;"),
    ("B11 owed time accumulates the whole span since the anchor at every consultation", TIME,
     ".saturating_add(ticks_of(self.latest_host_ns - before));",
     ".saturating_add(ticks_of(self.latest_host_ns - self.anchor_host_ns));"),
    ("B12 the pacer's `waiting` flag never set", TIME,
     "        self.waiting = limited < deadline;",
     "        self.waiting = false;"),
    ("B13 paced_wake looks at mip BEFORE this boundary's sync", LIB,
     "                self.boundary_sync();\n                // E5-T37a: for a guest a `wfi` left waiting on the paced clock, what is waking it.\n                if self.idle_wake_pending {\n                    self.paced_wake();\n                }",
     "                if self.idle_wake_pending {\n                    self.paced_wake();\n                }\n                self.boundary_sync();"),
    ("B16 fresh_mip starts from zero instead of the stale bits", LIB,
     "        let mut mip = self.hart.csr.mip_bits();\n        let mut level",
     "        let mut mip = 0u64;\n        let mut level"),
    ("B18 a wait is recorded without the opt-in", LIB,
     "                    if self.idle_yield && limited < d {",
     "                    if limited < d {"),
    # ── teeth: four of the WORKER's mutants, to show the round-3 verifier tests can see them ──
    ("T1 (worker R1) a wait holds without the devices being idle", LIB, HOLDS,
     "        self.fresh_mip() & self.hart.csr.mie_bits() == 0"),
    ("T2 (worker R2) fresh levels without the PLIC", LIB,
     "            level(11, p.eip(0));\n            level(9, p.eip(1));",
     "            let _ = &p;"),
    ("T3 (worker N9) the host's take does not ask whether the wait holds", LIB,
     "        let holds = self.paced_wait_holds();",
     "        let holds = true;"),
    ("T4 (worker N11) the loop top returns without asking whether the wait holds", LIB,
     "                if self.paced_wait_holds() {\n                    return RunOutcome::MaxInstrs;\n                }",
     "                if true {\n                    return RunOutcome::MaxInstrs;\n                }"),
]


def cargo(filters):
    out = subprocess.run(
        ["cargo", "test", "-p", "wasm-vm-core", "--lib", "--"] + filters,
        capture_output=True, text=True,
    )
    text = out.stdout + out.stderr
    failed = sorted(
        line.split()[1].split("::")[-1]
        for line in text.splitlines()
        if line.startswith("test ") and line.rstrip().endswith("FAILED")
    )
    return ("test result" in text), failed


def restore(paths):
    for path in paths:
        subprocess.run(["git", "checkout", "--", path], check=True)
        subprocess.run(["touch", path], check=True)
    dirty = subprocess.run(
        ["git", "status", "--short", "crates"], capture_output=True, text=True
    ).stdout.strip()
    assert not dirty, dirty


def verdict(built, failed):
    if not built:
        return "DID NOT BUILD"
    return f"KILLED by {len(failed)}: " + ", ".join(failed) if failed else "SURVIVED"


def main():
    only = sys.argv[1:]
    for name, path, old, new in M:
        if only and not any(name.startswith(o) for o in only):
            continue
        src = open(path).read()
        if src.count(old) != 1:
            print(f"{name}: PATTERN x{src.count(old)} — not applied", flush=True)
            continue
        try:
            open(path, "w").write(src.replace(old, new))
            built, failed = cargo(["paced_idle"])
            print(f"{name}\n    worker's 24 tests: {verdict(built, failed)}", flush=True)
            if built and (not failed or name.startswith("T")):
                tests = open(TESTS).read()
                open(TESTS, "w").write(tests + INCLUDES)
                built, failed = cargo(["paced_idle", "v37a_", "r2_", "r3_"])
                # Four of the earlier verifiers' tests fail on the UNMUTATED round-3 code (the
                # narrowed contract): they say nothing about a mutant.
                known = {
                    "v37a_busy_lag_is_exactly_the_bound_once_and_waiting_passes_in_full",
                    "v37a_lockstep_m_mode_guest_inline_block_and_page_straddle",
                    "v37a_lockstep_random_programs_with_wfi",
                    "r2_q1_lockstep_with_an_independent_predicate",
                }
                failed = [f for f in failed if f not in known]
                print(f"    + the three verifiers' files: {verdict(built, failed)}", flush=True)
        finally:
            restore([path, TESTS])


if __name__ == "__main__":
    main()
