#!/usr/bin/env python3
"""E4-T40b verifier round 2 sabotage harness (runtime head a2233d307).

For each named sabotage: apply one edit to crates/core/src/turbo.rs or crates/core/src/hart/turbo.rs,
run the acceptance-1 command (17 tests, release) — or, with `--full`, the whole
`cargo test --release -p wasm-vm-core --lib` — record which tests fail, restore with `git checkout`.
`--scratch` appends system_end_scratch_test.rs to the committed test file for the run (restored too).
`none` is the unsabotaged control.

Usage: sabotage_r2.py REPO [--full] [--scratch] name [name ...]
"""
import re
import subprocess
import sys

repo = sys.argv[1]
args = sys.argv[2:]
full = '--full' in args
scratch = '--scratch' in args
names = [a for a in args if not a.startswith('--')]
T = 'crates/core/src/turbo.rs'
H = 'crates/core/src/hart/turbo.rs'
TESTS = 'crates/core/src/turbo_equivalence_tests.rs'
SCRATCH = 'evidence/e4-t40b/verifier-r2/system_end_scratch_test.rs'
SAB = {
    'none': None,
    # --- round-1 coverage items 1-6 ---
    'item1-reservation-clear': (H, """                {
                    self.resv = None;
                }
                self.regs.pc = pc_next;""", """                {
                    let _ = (ra, rw);
                }
                self.regs.pc = pc_next;"""),
    'item2-uncached-entry-no-settle': (T, """                self.turbo_settle(&mut deferred);
                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)""", """                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)"""),
    'item3-filter-hit-that-drops-nothing-leaves-the-block': (T, """                    if self.block_cursor.is_none() {
                        // The running block was dropped: the next instruction is a boundary.
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }
                    self.block_cursor = None;""", """                    self.block_cursor = None;
                    self.turbo_stats.exit_boundary += 1;
                    return None;"""),
    'item4-jalr-keeps-bit0': (H, "let target = ea(self.regs.read(rs1), imm) & !1;",
                              "let target = ea(self.regs.read(rs1), imm);"),
    'item5-slow-op-live-work-not-counted': (T, """        self.irqstats.on_retire();
        self.advance_live_work(1, 1);
        if self.hart.last_was_wfi {""", """        self.irqstats.on_retire();
        if self.hart.last_was_wfi {"""),
    'item6-lh-zero-extends': (H, "Lh { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => i16::from_le_bytes(b) as i64 as u64),",
                              "Lh { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => u64::from(u16::from_le_bytes(b))),"),
    'item6-bge-is-strict': (H, "Bge { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) >= (b as i64)),",
                            "Bge { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) > (b as i64)),"),
    'item6-enter-block-trap-no-settle': (T, """                Err(trap) => {
                    self.turbo_settle(&mut deferred);
                    return Some(trap);
                }
            };
            tally.blocks += 1;""", """                Err(trap) => {
                    return Some(trap);
                }
            };
            tally.blocks += 1;"""),
    # --- item 6, one mutation per remaining arm (new in round 2) ---
    'item6-lwu-sign-extends': (H, "Lwu { rd, rs1, imm } => load!(rd, rs1, imm, 4, b => u64::from(u32::from_le_bytes(b))),",
                               "Lwu { rd, rs1, imm } => load!(rd, rs1, imm, 4, b => i32::from_le_bytes(b) as i64 as u64),"),
    'item6-lhu-sign-extends': (H, "Lhu { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => u64::from(u16::from_le_bytes(b))),",
                               "Lhu { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => i16::from_le_bytes(b) as i64 as u64),"),
    'item6-lbu-sign-extends': (H, "Lbu { rd, rs1, imm } => load!(rd, rs1, imm, 1, b => u64::from(b[0])),",
                               "Lbu { rd, rs1, imm } => load!(rd, rs1, imm, 1, b => b[0] as i8 as i64 as u64),"),
    'item6-sh-stores-the-base-register': (H, "Sh { rs1, rs2, imm } => store!(rs1, rs2, imm, 2, u16),",
                                          "Sh { rs1, rs2, imm } => {\n                let _ = rs2;\n                store!(rs1, rs1, imm, 2, u16)\n            }"),
    'item6-bgeu-is-strict': (H, "Bgeu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a >= b),",
                             "Bgeu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a > b),"),
    'item6-blt-is-le': (H, "Blt { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) < (b as i64)),",
                        "Blt { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) <= (b as i64)),"),
    'item6-bltu-is-le': (H, "Bltu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a < b),",
                         "Bltu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a <= b),"),
    # --- the `time` shadow (the deleted settle-on-entry rested on these) ---
    'shadow-settle-never-refreshes': (T, """                self.sync_clint();
                let within = deferred.pending - before;""", """                let within = deferred.pending - before;"""),
    'shadow-slow-op-settle-skips-the-boundary': (T, """                    // The ordinary executor, with the ordinary cursor and accounting.
                    self.turbo_settle(&mut deferred);""", """                    // The ordinary executor, with the ordinary cursor and accounting.
                    deferred.before_block = None;
                    self.turbo_settle(&mut deferred);"""),
    'shadow-code-filter-settle-skips-the-boundary': (T, """                    // the cursor in place so a dropped running block is observable.
                    self.turbo_settle(&mut deferred);""", """                    // the cursor in place so a dropped running block is observable.
                    deferred.before_block = None;
                    self.turbo_settle(&mut deferred);"""),
    'shadow-slow-op-settle-refreshes-late': (T, """                    // The ordinary executor, with the ordinary cursor and accounting.
                    self.turbo_settle(&mut deferred);""", """                    // The ordinary executor, with the ordinary cursor and accounting.
                    if deferred.before_block.is_some() {
                        deferred.before_block = Some(deferred.pending);
                    }
                    self.turbo_settle(&mut deferred);"""),
}
ACCEPT = ['turbo_equivalence_tests', 'tests::turbo_loop_takes_timer_interrupts_at_the_same_boundaries',
          'tests::replay_block_tail_is_unobservable', 'tests::deferred_retire_accounting_is_unobservable']


def run(cmd):
    return subprocess.run(cmd, cwd=repo, capture_output=True, text=True)


for name in names:
    touched = []
    try:
        if SAB[name] is not None:
            path, old, new = SAB[name]
            s = open(f"{repo}/{path}").read()
            assert s.count(old) == 1, (name, s.count(old))
            open(f"{repo}/{path}", 'w').write(s.replace(old, new))
            touched.append(path)
        if scratch:
            with open(f"{repo}/{TESTS}", 'a') as f:
                f.write(open(f"{repo}/{SCRATCH}").read())
            touched.append(TESTS)
        cmd = ['cargo', 'test', '--release', '-p', 'wasm-vm-core', '--lib', '--no-fail-fast']
        if not full:
            cmd += ['--', *ACCEPT]
        r = run(cmd)
        out = r.stdout + r.stderr
        if 'error[' in out or 'could not compile' in out:
            print(f"SABOTAGE {name}: BUILD ERROR\n{out[-3000:]}")
            continue
        failed = sorted(set(re.findall(r'^test (\S+) \.\.\. FAILED', out, re.M)))
        passed = sorted(set(re.findall(r'^test (\S+) \.\.\. ok', out, re.M)))
        scope = 'whole core lib suite' if full else 'acceptance 1'
        print(f"SABOTAGE {name} [{scope}{', + scratch test' if scratch else ''}]: "
              f"{len(failed)} failed / {len(passed)} passed")
        for t in failed:
            print(f"  FAILED {t}")
        for m in re.finditer(r"---- (\S+) stdout ----\n(.*?)\n(?:note|\n)", out, re.S):
            msg = ' | '.join(line.strip() for line in m.group(2).strip().splitlines()[:3])[:330]
            print(f"    {m.group(1).split('::')[-1]}: {msg}")
    finally:
        for path in touched:
            run(['git', 'checkout', '--', path])
    sys.stdout.flush()
print("restored; git status --short crates/:", repr(run(['git', 'status', '--short', 'crates/']).stdout))
