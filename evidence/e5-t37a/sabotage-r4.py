#!/usr/bin/env python3
"""Mutation run for E5-T37a round 2: apply one mutation, run the worker's paced_idle tests,
report which fail, restore. Run from the repo root."""
import os, subprocess, sys, shutil
LIB, TIME = 'crates/core/src/lib.rs', 'crates/core/src/time.rs'
M = [
 ("V1 idle-spin threshold 2048 -> 4096", LIB, "const IDLE_SPIN_INSTRS: u64 = 2048;", "const IDLE_SPIN_INSTRS: u64 = 4096;"),
 ("V2 threshold compare > -> >=", LIB, "retired.wrapping_sub(self.idle_consult_retired) > IDLE_SPIN_INSTRS", "retired.wrapping_sub(self.idle_consult_retired) >= IDLE_SPIN_INSTRS"),
 ("V3 selecting the clock does not start a new worked/waited interval", LIB, "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        Ok(())", "        self.clear_idle_wait();\n        Ok(())"),
 ("V4 the policy does not hand the bound to an existing pacer", LIB, "        if let Some(pacer) = &mut self.idle_pacer {\n            pacer.set_max_busy_lag_ticks(self.idle_max_busy_lag_ticks);\n        }\n    }", "    }"),
 ("V5 selecting the clock does not clear a recorded wait", LIB, "        self.last_time_jump = None;\n        self.clear_idle_wait();\n        self.idle_consult_retired", "        self.last_time_jump = None;\n        self.idle_consult_retired"),
 ("V6 selecting the policy does not clear a recorded wait", LIB, "        self.idle_yield = yield_to_host;\n        self.clear_idle_wait();", "        self.idle_yield = yield_to_host;"),
 ("N1 no wake accounting (paced_wake does nothing)", LIB, "        debug_assert_eq!(self.irqstats.retired, self.idle_consult_retired);\n        if !self.hart.csr.mip_and_mie_nonzero() {", "        debug_assert_eq!(self.irqstats.retired, self.idle_consult_retired);\n        if true || !self.hart.csr.mip_and_mie_nonzero() {"),
 ("N2 wake accounting although no enabled interrupt is pending", LIB, "        debug_assert_eq!(self.irqstats.retired, self.idle_consult_retired);\n        if !self.hart.csr.mip_and_mie_nonzero() {\n            return;\n        }", "        debug_assert_eq!(self.irqstats.retired, self.idle_consult_retired);"),
 ("N3 wake accounting without the level/time resync", LIB, "            clint.borrow_mut().mtime = limited;\n            // The levels and the `time` shadow this boundary already sampled follow the clock.\n            self.sync_clint();\n            self.sync_sbi_timer();", "            clint.borrow_mut().mtime = limited;"),
 ("N4 waiting time is not owed (not accumulated)", TIME, "        } else {\n            self.owed_wait_ticks = self\n                .owed_wait_ticks\n                .saturating_add(ticks_of(self.latest_host_ns - before));\n        }", "        }"),
 ("N5 owed waiting time ignored by the bound", TIME, "            let bounded = current\n                .saturating_add(self.owed_wait_ticks)\n                .saturating_add(self.max_busy_lag_ticks);", "            let bounded = current.saturating_add(self.max_busy_lag_ticks);"),
 ("N6 owed waiting time never consumed", TIME, "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));", "            .min(ceiling.saturating_sub(limited));"),
 ("N9 the host's take does not ask whether the wait holds", LIB, "        let holds = self.paced_wait_holds();", "        let holds = true;"),
 ("N10 a restore keeps a recorded wait", LIB, "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        self.pmp_revision_seen", "        self.pmp_revision_seen"),
 ("N11 the loop top returns without asking whether the wait holds", LIB, "                if self.paced_wait_holds() {\n                    return RunOutcome::MaxInstrs;\n                }", "                if true {\n                    return RunOutcome::MaxInstrs;\n                }"),
 ("N12 an untaken wait keeps its wake armed across run calls", LIB, "        if self.idle_wait_deadline != u64::MAX {\n            self.clear_idle_wait();\n        }\n        while remaining_work != 0 {", "        self.idle_wait_deadline = u64::MAX;\n        while remaining_work != 0 {"),
 ("N13 a wait dropped in the same run call keeps its wake armed", LIB, "                // would have to account for.\n                self.clear_idle_wait();", "                // would have to account for.\n                self.idle_wait_deadline = u64::MAX;"),
 ("N14 the wait is measured from guest time, not the ceiling", TIME, "        deadline.saturating_sub(ceiling)\n    }\n\n    /// E5-T37a: host time owed", "        let _ = ceiling;\n        deadline.saturating_sub(self.anchor_mtime)\n    }\n\n    /// E5-T37a: host time owed"),
 ("N15 a rebase drops the busy-lag bound", TIME, "        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        self.max_busy_lag_ticks = max_busy_lag_ticks;", "        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        let _ = max_busy_lag_ticks;"),
 ("W1 (worker round 1) the loop top never returns", LIB, "            if self.idle_wait_deadline != u64::MAX {\n                if self.paced_wait_holds() {", "            if self.idle_wait_deadline != u64::MAX {\n                if false && self.paced_wait_holds() {"),
 ("W2 (worker round 1) the bound applies without `worked`", TIME, "        if worked {\n            let bounded = current", "        if true {\n            let bounded = current"),
 ("W3 (worker round 1) a wait is recorded in pure ICount", LIB, "                _ => d,\n            };\n            // Jump the machine clock to the deadline;", "                _ => {\n                    if self.idle_yield {\n                        self.idle_wait_deadline = d;\n                    }\n                    d\n                }\n            };\n            // Jump the machine clock to the deadline;"),
 ("R1 a wait holds without the devices being idle", LIB, "        self.fabric_idle_epoch == Some(self.fabric_epoch.get())\n            && self.fresh_mip() & self.hart.csr.mie_bits() == 0", "        self.fresh_mip() & self.hart.csr.mie_bits() == 0"),
 ("R2 fresh levels without the PLIC", LIB, "            level(11, p.eip(0));\n            level(9, p.eip(1));", "            let _ = &p;"),
 ("R2b fresh levels without the S-context PLIC level", LIB, "            level(9, p.eip(1));", ""),
 ("R3 fresh levels without the SBI timer", LIB, "            if self.builtin_sbi {\n                level(5, c.mtime >= self.sbi_state.stimecmp);\n            }", ""),
 ("R4 fresh levels without the machine timer", LIB, "            level(7, c.mtip());\n", ""),
 ("R5 fresh levels without the software interrupt", LIB, "            level(3, c.msip);\n", ""),
 ("R6 a pending interrupt ends the wait even when it is not enabled", LIB, "            && self.fresh_mip() & self.hart.csr.mie_bits() == 0", "            && self.fresh_mip() == 0"),
 ("R7 the wake jumps over an armed deadline", LIB, "            deadline.unwrap_or(u64::MAX),\n            false,", "            u64::MAX,\n            false,"),
 ("R8 the wake does not resync the SBI timer level", LIB, "            self.sync_clint();\n            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest armed FUTURE", "            self.sync_clint();\n        }\n    }\n\n    /// The guest's time and its nearest armed FUTURE"),
 ("R9 the wake does not resync the CLINT levels and time", LIB, "            self.sync_clint();\n            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest armed FUTURE", "            self.sync_sbi_timer();\n        }\n    }\n\n    /// The guest's time and its nearest armed FUTURE"),
 ("R10 a wait is recorded at a deadline that was reached (< -> <=)", LIB, "                    if self.idle_yield && limited < d {", "                    if self.idle_yield && limited <= d {"),
 ("R11 owed waiting time is not capped by what the host clock is ahead", TIME, "            .saturating_sub(limited - current)\n            .min(ceiling.saturating_sub(limited));", "            .saturating_sub(limited - current);"),
 ("R12 a restore does not start a new worked/waited interval", LIB, "        self.clear_idle_wait();\n        self.idle_consult_retired = self.irqstats.retired;\n        self.pmp_revision_seen", "        self.clear_idle_wait();\n        self.pmp_revision_seen"),
 ("R13 the host's take keeps the wake armed for a wait it did not report", LIB, "        if ticks == 0 {\n            self.idle_wake_pending = false;\n            return None;\n        }", "        if ticks == 0 {\n            return None;\n        }"),
 ("R14 the worked/waited flag is inverted for the wake", LIB, "            deadline.unwrap_or(u64::MAX),\n            false,", "            deadline.unwrap_or(u64::MAX),\n            true,"),
 ("B11 (round-3 verifier) owed time measured from the anchor, not the previous consultation", TIME, "                .saturating_add(ticks_of(self.latest_host_ns - before));", "                .saturating_add(ticks_of(self.latest_host_ns - self.anchor_host_ns));"),
 ("B3 (round-3 verifier) the S-timer level at equality (>= -> >)", LIB, "                level(5, c.mtime >= self.sbi_state.stimecmp);", "                level(5, c.mtime > self.sbi_state.stimecmp);"),
 ("B12 (round-3 verifier) the waiting flag is never set", TIME, "        self.waiting = limited < deadline;\n", ""),
]
only = sys.argv[1:]
for name, path, old, new in M:
    if only and not any(name.startswith(o) for o in only): continue
    src = open(path).read()
    if src.count(old) != 1:
        print(f"{name}: PATTERN x{src.count(old)} — not applied"); continue
    shutil.copy(path, path + '.keep')
    open(path, 'w').write(src.replace(old, new))
    try:
        out = subprocess.run(['cargo', 'test', '-p', 'wasm-vm-core', '--lib', 'paced_idle'], capture_output=True, text=True)
        text = out.stdout + out.stderr
        failed = [l.split()[1].split('::')[-1] for l in text.splitlines() if l.startswith('test ') and l.rstrip().endswith('FAILED')]
        built = 'test result' in text
        print(f"{name}: " + ("DID NOT BUILD" if not built else (f"KILLED by {len(failed)}: " + ", ".join(failed) if failed else "SURVIVED")))
    finally:
        shutil.move(path + '.keep', path)
        os.utime(path, None)  # cargo fingerprints by mtime: make the restore visible
    sys.stdout.flush()
