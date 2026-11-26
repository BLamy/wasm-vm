#!/usr/bin/env python3
"""E5-T37a round 2 verifier: mutation run.

Pass 1 (every mutant): the committed tree + one mutation, WORKER tests only
    cargo test -p wasm-vm-core --lib paced_idle
Pass 2 (survivors of pass 1): the same mutation with the round-1 verifier's tests and mine
included (two `include!` lines appended to turbo_equivalence_tests.rs), run
    cargo test -p wasm-vm-core --lib -- v37a_ r2_
and compared with that pass's baseline (the tests that fail without any mutation).

Each mutation is one exact-string replacement that must match exactly once. After each run the
file is restored with `git checkout --` and re-touched (cargo fingerprints by mtime), and
`git status --short crates` must be empty.
"""
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
LIB = "crates/core/src/lib.rs"
TIME = "crates/core/src/time.rs"
TESTS = "crates/core/src/turbo_equivalence_tests.rs"
INCLUDES = (
    '\ninclude!("../../../evidence/e5-t37a/verifier/verifier_tests.rs");\n'
    'include!("../../../evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs");\n'
)

# (id, group, description, file, old, new)
M = [
    # ── the six round-1 survivors, re-applied to the round-2 code ──
    ("S1", "r1", "IDLE_SPIN_INSTRS 2048 -> 4096", LIB,
     "const IDLE_SPIN_INSTRS: u64 = 2048;", "const IDLE_SPIN_INSTRS: u64 = 4096;"),
    ("S2", "r1", "worked: `>` -> `>=` IDLE_SPIN_INSTRS", LIB,
     "wrapping_sub(self.idle_consult_retired) > IDLE_SPIN_INSTRS;",
     "wrapping_sub(self.idle_consult_retired) >= IDLE_SPIN_INSTRS;"),
    ("S3", "r1", "set_paced_icount_clock does not reset idle_consult_retired", LIB,
     "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        Ok(())",
     "        self.clear_idle_wait();\n        Ok(())"),
    ("S4", "r1", "set_paced_idle_policy does not hand the bound to an existing pacer", LIB,
     "        if let Some(pacer) = &mut self.idle_pacer {\n            pacer.set_max_busy_lag_ticks(self.idle_max_busy_lag_ticks);\n        }\n",
     ""),
    ("S5", "r1", "set_paced_icount_clock does not clear a recorded wait", LIB,
     "        self.last_time_jump = None;\n        self.clear_idle_wait();\n        self.idle_consult_retired",
     "        self.last_time_jump = None;\n        self.idle_consult_retired"),
    ("S6", "r1", "set_paced_idle_policy does not clear a recorded wait", LIB,
     "        self.idle_yield = yield_to_host;\n        self.clear_idle_wait();\n",
     "        self.idle_yield = yield_to_host;\n"),
    # ── round-1 mutants that were KILLED then, on code that changed since ──
    ("K1", "r1-killed", "clamp does not move the anchor", TIME,
     "                self.anchor_host_ns = self.latest_host_ns;\n                self.anchor_mtime = bounded;\n",
     ""),
    ("K2", "r1-killed", "wait recorded when `limited <= d`", LIB,
     "if self.idle_yield && limited < d {", "if self.idle_yield && limited <= d {"),
    ("K3", "r1-killed", "take does not clear the recorded wait", LIB,
     "let deadline = core::mem::replace(&mut self.idle_wait_deadline, u64::MAX);",
     "let deadline = self.idle_wait_deadline;"),
    # ── new: paced_wake ──
    ("M1", "new", "paced_wake: drop `if !pacer.waiting() { return; }`", LIB,
     "        if !pacer.waiting() {\n            return;\n        }\n", ""),
    ("M2", "new", "paced_wake: deadline cap removed (u64::MAX)", LIB,
     "            deadline.unwrap_or(u64::MAX),\n            false,",
     "            u64::MAX,\n            false,"),
    ("M3", "new", "paced_wake: no sync_sbi_timer() after moving mtime", LIB,
     "            self.sync_clint();\n            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest",
     "            self.sync_clint();\n        }\n    }\n\n    /// The guest's time and its nearest"),
    ("M3b", "new", "paced_wake: no sync_clint() after moving mtime", LIB,
     "            self.sync_clint();\n            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest",
     "            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest"),
    ("M4", "new", "paced_wake: `if limited != mtime` -> unconditional", LIB,
     "        if limited != mtime {\n            clint.borrow_mut().mtime = limited;",
     "        if limited != mtime || limited == mtime {\n            clint.borrow_mut().mtime = limited;"),
    ("M15", "new", "paced_wake: consult as worked (true) instead of waited", LIB,
     "            deadline.unwrap_or(u64::MAX),\n            false,",
     "            deadline.unwrap_or(u64::MAX),\n            true,"),
    # ── new: paced_wait_holds ──
    ("M5", "new", "paced_wait_holds: MTIP level term dropped", LIB,
     "if (c.msip && mie & (1 << 3) != 0) || (c.mtip() && mie & (1 << 7) != 0) {",
     "if c.msip && mie & (1 << 3) != 0 {"),
    ("M6", "new", "paced_wait_holds: STIP level term dropped", LIB,
     "            if self.builtin_sbi && c.mtime >= self.sbi_state.stimecmp && mie & (1 << 5) != 0 {\n                return false;\n            }\n",
     ""),
    ("M7", "new", "paced_wait_holds: msip not gated by mie.MSIE", LIB,
     "if (c.msip && mie & (1 << 3) != 0) || (c.mtip() && mie & (1 << 7) != 0) {",
     "if c.msip || (c.mtip() && mie & (1 << 7) != 0) {"),
    ("M7b", "new", "paced_wait_holds: STIP term without the builtin_sbi guard", LIB,
     "if self.builtin_sbi && c.mtime >= self.sbi_state.stimecmp && mie & (1 << 5) != 0 {",
     "if c.mtime >= self.sbi_state.stimecmp && mie & (1 << 5) != 0 {"),
    ("M25", "new", "paced_wait_holds: stale mip&mie term dropped", LIB,
     "        if self.hart.csr.mip_and_mie_nonzero()\n            || self.fabric_epoch.get() != self.idle_boundary_epoch\n        {",
     "        if self.fabric_epoch.get() != self.idle_boundary_epoch {"),
    # ── new: take_idle_wait_nanos ──
    ("M8", "new", "take: the `ticks == 0` path keeps the wake armed", LIB,
     "        if ticks == 0 {\n            self.idle_wake_pending = false;\n            return None;",
     "        if ticks == 0 {\n            return None;"),
    ("M9", "new", "take: reports without asking whether the wait holds", LIB,
     "            Some(pacer) if holds => pacer.ticks_until(deadline),",
     "            Some(pacer) if holds || !holds => pacer.ticks_until(deadline),"),
    # ── new: IdlePacer ──
    ("M10", "new", "limit_deadline_after: owed not capped by `ceiling - limited`", TIME,
     "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));",
     "            .saturating_sub(limited - current);"),
    ("M11", "new", "limit_deadline_after: waiting = true", TIME,
     "        self.waiting = limited < deadline;", "        self.waiting = true;"),
    ("M16", "new", "rebase keeps `waiting` (new pacer starts waiting)", TIME,
     "        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        self.max_busy_lag_ticks = max_busy_lag_ticks;",
     "        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        self.max_busy_lag_ticks = max_busy_lag_ticks;\n        self.waiting = true;"),
    # ── new: clear_idle_wait call sites and neighbours ──
    ("M12a", "new", "set_icount_clock does not clear the wait", LIB,
     "        self.idle_pacer = None;\n        self.clear_idle_wait();\n        self.mono_clock = None;",
     "        self.idle_pacer = None;\n        self.mono_clock = None;"),
    ("M12b", "new", "set_wall_clock does not clear the wait", LIB,
     "        self.idle_pacer = None;\n        self.clear_idle_wait();\n        self.mono_clock = Some(clock);\n        self.rebase_guest_clock();",
     "        self.idle_pacer = None;\n        self.mono_clock = Some(clock);\n        self.rebase_guest_clock();"),
    ("M13", "new", "load_resume does not reset idle_consult_retired", LIB,
     "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        self.pmp_revision_seen",
     "        self.clear_idle_wait();\n        self.pmp_revision_seen"),
    ("M17", "new", "run start: an untaken wait is dropped but its wake stays armed... inverse: clears only when a wake is pending", LIB,
     "        if self.idle_wait_deadline != u64::MAX {\n            self.clear_idle_wait();\n        }\n        while remaining_work != 0 {",
     "        if self.idle_wait_deadline != u64::MAX && self.idle_wake_pending {\n            self.clear_idle_wait();\n        }\n        while remaining_work != 0 {"),
]


def sh(cmd):
    return subprocess.run(cmd, cwd=ROOT, shell=True, text=True, capture_output=True)


def restore(paths, whole_tree=True):
    for p in paths:
        sh(f"git checkout -- {p}")
        os.utime(os.path.join(ROOT, p))
    # In pass 2 the test file carries the two include lines on purpose: check the restored
    # paths only.
    scope = "crates" if whole_tree else " ".join(paths)
    dirty = sh(f"git status --short {scope}").stdout.strip()
    assert dirty == "", f"tree not clean after restore: {dirty}"


def apply(path, old, new):
    full = os.path.join(ROOT, path)
    src = open(full).read()
    assert src.count(old) == 1, f"{path}: pattern matches {src.count(old)} times:\n{old}"
    open(full, "w").write(src.replace(old, new))


def run_tests(filt):
    r = sh(f"cargo test -p wasm-vm-core --lib -- {filt} 2>&1")
    out = r.stdout
    if "error: could not compile" in out or re.search(r"^error\[E\d+\]", out, re.M):
        return None, out
    failed = sorted(set(re.findall(r"^test (\S+) \.\.\. FAILED", out, re.M)))
    m = re.search(r"test result: \w+\. (\d+) passed; (\d+) failed", out)
    assert m, out[-2000:]
    return (failed, int(m.group(1)), int(m.group(2))), out


def short(names):
    return ", ".join(n.split("::")[-1] for n in names) or "-"


def main():
    # `--pass2 ID...` runs pass 2 alone for the named survivors of an earlier pass 1.
    pass2_only = "--pass2" in sys.argv[1:]
    only = set(a for a in sys.argv[1:] if a != "--pass2")
    restore([LIB, TIME, TESTS])
    survivors = []
    if pass2_only:
        survivors = [m for m in M if m[0] in only]
    else:
        print("# E5-T37a round 2 — verifier mutation run", flush=True)
        print("# head", sh("git rev-parse --short HEAD").stdout.strip(), flush=True)
        base, _ = run_tests("paced_idle")
        print(f"# pass 1 baseline (worker tests, no mutation): {base[1]} passed, {base[2]} failed", flush=True)
        assert base[2] == 0 and base[1] == 15
    for mid, group, desc, path, old, new in ([] if pass2_only else M):
        if only and mid not in only:
            continue
        apply(path, old, new)
        try:
            res, out = run_tests("paced_idle")
        finally:
            restore([path])
        if res is None:
            print(f"{mid} [{group}] {desc}: DOES NOT COMPILE\n{out[-1500:]}", flush=True)
            continue
        failed, passed, nfail = res
        if nfail:
            print(f"{mid} [{group}] {desc}: KILLED by {nfail} worker test(s): {short(failed)}", flush=True)
        else:
            print(f"{mid} [{group}] {desc}: SURVIVES the worker's {passed} tests", flush=True)
            survivors.append((mid, group, desc, path, old, new))
    if not survivors:
        return
    print("\n# pass 2 — survivors against the round-1 verifier's tests (v37a_) and mine (r2_)", flush=True)
    full = os.path.join(ROOT, TESTS)
    open(full, "a").write(INCLUDES)
    try:
        base, out = run_tests("v37a_ r2_")
        assert base is not None, out[-3000:]
        base_failed = set(base[0])
        print(f"# pass 2 baseline (no mutation): {base[1]} passed, {base[2]} failed: {short(sorted(base_failed))}", flush=True)
        for mid, group, desc, path, old, new in survivors:
            apply(path, old, new)
            try:
                res, out = run_tests("v37a_ r2_")
            finally:
                restore([path], whole_tree=False)
            if res is None:
                print(f"{mid}: DOES NOT COMPILE with the verifier tests\n{out[-1500:]}", flush=True)
                continue
            failed = set(res[0])
            killed = sorted(failed - base_failed)
            fixed = sorted(base_failed - failed)
            verdict = f"killed by {short(killed)}" if killed else "SURVIVES these too"
            extra = f"; and makes {short(fixed)} PASS" if fixed else ""
            print(f"{mid} [{group}] {desc}: {verdict}{extra}", flush=True)
    finally:
        restore([TESTS, LIB, TIME])
    print("\n# git status --short crates after the run:", repr(sh("git status --short crates").stdout), flush=True)


if __name__ == "__main__":
    main()
