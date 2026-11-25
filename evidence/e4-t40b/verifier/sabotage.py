#!/usr/bin/env python3
"""E4-T40b verifier sabotage harness. For each named sabotage: apply one edit to
crates/core/src/turbo.rs or crates/core/src/hart/turbo.rs, run the worker's three acceptance
tests and the verifier's turbo_equivalence_tests, record which fail, restore the file with
`git checkout`. Usage: sabotage.py REPO [name ...]"""
import subprocess, sys, re
repo = sys.argv[1]
T = 'crates/core/src/turbo.rs'
H = 'crates/core/src/hart/turbo.rs'
SAB = {
 'horizon-test': (T, "let stop = if tally.retired >= horizon {", "let stop = if false && tally.retired >= horizon {"),
 'device-access-stop': (T, "} else if device_touched || !self.fabric_quiescent() {", "} else if false && (device_touched || !self.fabric_quiescent()) {"),
 'device-access-not-recorded': (T, """                    if self.bus.device_access_count() != device_accesses {
                        device_touched = true;
                        horizon = u64::MAX;
                    }""", """                    if false && self.bus.device_access_count() != device_accesses {
                        device_touched = true;
                        horizon = u64::MAX;
                    }"""),
 'time-shadow-refresh': (T, """                self.sync_clint();
                let within = deferred.pending - before;""", """                let within = deferred.pending - before;"""),
 'code-filter-after-inline-store': (T, """                    && self.block_cache.may_hold_code(frame)
                {""", """                    && self.block_cache.may_hold_code(frame)
                    && false
                {"""),
 'reservation-clear-in-inline-store': (H, """                {
                    self.resv = None;
                }
                self.regs.pc = pc_next;""", """                {
                    let _ = (ra, rw);
                }
                self.regs.pc = pc_next;"""),
 # --- verifier's own, beyond the task's list ---
 'horizon-ignores-sbi-timer': (T, "if self.builtin_sbi && c.mtime < self.sbi_state.stimecmp {", "if false && self.builtin_sbi && c.mtime < self.sbi_state.stimecmp {"),
 'horizon-ignores-tick-residue': (T, "Some(span) => span - self.tick_accum,", "Some(span) => span,"),
 'system-end-settle-on-entry': (T, "if block.system_end() {", "if false && block.system_end() {"),
 'fetch-walk-ordinary-next': (T, "let mut ordinary_next = !self.bus.code_write_log_mut().is_empty();", "let mut ordinary_next = false;"),
 'syscon-stop-after-slow-op': (T, """                    if self.syscon.as_ref().is_some_and(|c| c.borrow().is_some())
                        || self.at_block_boundary()""", """                    if self.at_block_boundary()"""),
 'mid-block-budget-cursor': (T, """                    self.block_cursor = Some(BlockCursor {
                        block: alloc::rc::Rc::clone(&block),
                        idx,
                        next_va: self.hart.regs.pc,
                    });
                    self.turbo_stats.exit_budget += 1;
                    return None;""", """                    self.block_cursor = None;
                    self.turbo_stats.exit_budget += 1;
                    return None;"""),
 'boundary-stop-keeps-stale-shadow': (T, """                if let Some(stop) = stop {
                    self.turbo_settle(&mut deferred);""", """                if let Some(stop) = stop {
                    deferred.before_block = None;
                    self.turbo_settle(&mut deferred);"""),
 'jalr-keeps-bit0': (H, "let target = ea(self.regs.read(rs1), imm) & !1;", "let target = ea(self.regs.read(rs1), imm);"),
 'lh-zero-extends': (H, "Lh { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => i16::from_le_bytes(b) as i64 as u64),", "Lh { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => u64::from(u16::from_le_bytes(b))),"),
 'bge-is-strict': (H, "Bge { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) >= (b as i64)),", "Bge { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) > (b as i64)),"),
 'uncached-entry-no-settle': (T, """                self.turbo_settle(&mut deferred);
                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)""", """                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)"""),
 'enter-block-trap-no-settle': (T, """                Err(trap) => {
                    self.turbo_settle(&mut deferred);
                    return Some(trap);
                }
            };
            tally.blocks += 1;""", """                Err(trap) => {
                    return Some(trap);
                }
            };
            tally.blocks += 1;"""),
 'slow-op-live-work-not-counted': (T, """        self.irqstats.on_retire();
        self.advance_live_work(1, 1);
        if self.hart.last_was_wfi {""", """        self.irqstats.on_retire();
        if self.hart.last_was_wfi {"""),
 'ctx-not-refreshed-after-slow-op': (T, "                    ctx = next;\n", "                    let _ = next;\n"),
}
names = sys.argv[2:] or list(SAB)
WORKER = ['tests::turbo_loop_takes_timer_interrupts_at_the_same_boundaries', 'tests::replay_block_tail_is_unobservable', 'tests::deferred_retire_accounting_is_unobservable']
def run(cmd):
    return subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
for name in names:
    path, old, new = SAB[name]
    full = f"{repo}/{path}"
    s = open(full).read()
    assert s.count(old) == 1, (name, s.count(old))
    open(full, 'w').write(s.replace(old, new))
    try:
        r = run(['cargo', 'test', '--release', '-p', 'wasm-vm-core', '--lib', '--', *WORKER, 'turbo_equivalence_tests::'])
        out = r.stdout + r.stderr
        if 'error[' in out or 'could not compile' in out:
            print(f"SABOTAGE {name}: BUILD ERROR\n{out[-3000:]}")
            continue
        failed = sorted(set(re.findall(r'^test (\S+) \.\.\. FAILED', out, re.M)))
        passed = sorted(set(re.findall(r'^test (\S+) \.\.\. ok', out, re.M)))
        wf = [t for t in failed if t.startswith('tests::')]
        vf = [t for t in failed if t.startswith('turbo_equivalence_tests::')]
        print(f"SABOTAGE {name} ({path}): {len(failed)} failed / {len(passed)} passed")
        print(f"  worker's tests failing ({len(wf)}/3): {', '.join(t.split('::')[-1] for t in wf) or 'NONE'}")
        print(f"  verifier's tests failing ({len(vf)}/13): {', '.join(t.split('::')[-1] for t in vf) or 'NONE'}")
        for m in re.finditer(r"---- (\S+) stdout ----\n(.*?)\n(?:note|\n)", out, re.S):
            first = m.group(2).strip().splitlines()
            msg = ' | '.join(l.strip() for l in first[:4])[:420]
            print(f"    {m.group(1).split('::')[-1]}: {msg}")
    finally:
        run(['git', 'checkout', '--', path])
    sys.stdout.flush()
d = run(['git', 'diff', '--stat', '--', T, H]).stdout
print("restored; git diff --stat on the two files:", repr(d))
