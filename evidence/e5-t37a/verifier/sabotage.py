import subprocess, sys, re, os
REPO='/Users/blamy/Documents/Codex/wasm-vm'
LIB='crates/core/src/lib.rs'; TIME='crates/core/src/time.rs'
M=[
 ('S1 IDLE_SPIN_INSTRS 2048 -> 4096', LIB, 'const IDLE_SPIN_INSTRS: u64 = 2048;', 'const IDLE_SPIN_INSTRS: u64 = 4096;'),
 ('S2 set_paced_icount_clock: drop idle_consult_retired = irqstats.retired', LIB, '        self.idle_wait_ticks = 0;\n        self.idle_consult_retired = self.irqstats.retired;\n        Ok(())', '        self.idle_wait_ticks = 0;\n        Ok(())'),
 ('S3 set_paced_idle_policy: bound not handed to the existing pacer', LIB, '        if let Some(pacer) = &mut self.idle_pacer {\n            pacer.set_max_busy_lag_ticks(self.idle_max_busy_lag_ticks);\n        }\n    }', '    }'),
 ('S4 limit_deadline_after: anchor not moved when clamping', TIME, '            self.anchor_host_ns = self.latest_host_ns;\n            self.anchor_mtime = bounded;\n', ''),
 ('S5 wfi_fast_forward: limited < d -> limited <= d', LIB, 'if self.idle_yield && limited < d {', 'if self.idle_yield && limited <= d {'),
 ('S6 run_capture_inner: run-start clear of idle_wait_ticks dropped', LIB, '        // E5-T37a: a wait the host did not take belongs to the previous run call.\n        self.idle_wait_ticks = 0;\n', '        // E5-T37a: a wait the host did not take belongs to the previous run call.\n'),
 ('S7 wait measured from guest time (d - limited)', LIB, 'self.idle_wait_ticks = pacer.ticks_until(d).max(1);', 'self.idle_wait_ticks = (d - limited).max(1);'),
 ('S8 .max(1) dropped', LIB, 'self.idle_wait_ticks = pacer.ticks_until(d).max(1);', 'self.idle_wait_ticks = pacer.ticks_until(d);'),
 ('S9 set_paced_icount_clock: drop idle_wait_ticks = 0', LIB, '        self.last_time_jump = None;\n        self.idle_wait_ticks = 0;\n        self.idle_consult_retired = self.irqstats.retired;', '        self.last_time_jump = None;\n        self.idle_consult_retired = self.irqstats.retired;'),
 ('S10 set_paced_idle_policy: drop idle_wait_ticks = 0', LIB, '        self.idle_yield = yield_to_host;\n        self.idle_wait_ticks = 0;\n', '        self.idle_yield = yield_to_host;\n'),
 ('S11 worked: > IDLE_SPIN_INSTRS -> >=', LIB, 'retired.wrapping_sub(self.idle_consult_retired) > IDLE_SPIN_INSTRS;', 'retired.wrapping_sub(self.idle_consult_retired) >= IDLE_SPIN_INSTRS;'),
 ('S12 rebase: bound not kept', TIME, '        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        self.max_busy_lag_ticks = max_busy_lag_ticks;\n', '        *self = Self::new(host_ns, mtime, self.timebase_hz);\n        let _ = max_busy_lag_ticks;\n'),
 ('S13 set_paced_icount_clock: bound not handed to the new pacer', LIB, '        pacer.set_max_busy_lag_ticks(self.idle_max_busy_lag_ticks);\n        self.wall_time = None;', '        let _ = &mut pacer;\n        self.wall_time = None;'),
 ('S14 take_idle_wait_nanos does not clear', LIB, 'let ticks = core::mem::take(&mut self.idle_wait_ticks);', 'let ticks = self.idle_wait_ticks;'),
]
REFUTES=('_REFUTES',)
only=sys.argv[1:] 
os.chdir(REPO)
for name,f,old,new in M:
    if only and name.split()[0] not in only: continue
    src=open(f).read()
    if src.count(old)!=1:
        print(f'## {name}: PATTERN COUNT {src.count(old)} — skipped'); continue
    open(f,'w').write(src.replace(old,new))
    try:
        r=subprocess.run(['cargo','test','-p','wasm-vm-core','--lib','--','paced_idle','v37a_'],capture_output=True,text=True,env={k:v for k,v in os.environ.items() if k not in('RUSTFLAGS','RUST_LOG')})
        out=r.stdout+r.stderr
    finally:
        subprocess.run(['git','checkout','--',f],check=True)
    st=subprocess.run(['git','status','--short',f],capture_output=True,text=True).stdout.strip()
    if 'error[' in out or 'could not compile' in out:
        print(f'## {name}: DID NOT COMPILE'); print(out[-1500:]); continue
    res={m.group(1):m.group(2) for m in re.finditer(r'^test (\S+) \.\.\. (\w+)',out,re.M)}
    # with --nocapture off, lines are "test name ... ok"
    worker_failed=sorted(n.split('::')[-1] for n,v in res.items() if 'v37a_' not in n and v!='ok')
    mine_failed=sorted(n.split('::')[-1] for n,v in res.items() if 'v37a_' in n and v!='ok' and not n.endswith('_REFUTES'))
    nworker=sum(1 for n in res if 'v37a_' not in n); nmine=sum(1 for n in res if 'v37a_' in n and not n.endswith('_REFUTES'))
    print(f'## {name}')
    print(f'   worker tests ({nworker}): ' + ('SURVIVED (all pass)' if not worker_failed else f'KILLED by {len(worker_failed)}: ' + ', '.join(worker_failed)))
    print(f'   verifier tests ({nmine} that pass unmutated): ' + ('survived' if not mine_failed else f'killed by {len(mine_failed)}: ' + ', '.join(mine_failed)))
    print(f'   restored: git status {f!r} -> {"clean" if not st else st}')
    sys.stdout.flush()
