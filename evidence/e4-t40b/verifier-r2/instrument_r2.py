#!/usr/bin/env python3
"""Round 2 (head a2233d307): the round-1 script minus the two hunks the rework deleted, plus
counters at the new debug_assert site and at the two mid-block first-settle sites.
Scratch coverage instrumentation for the E4-T40b verifier: static hit counters in
crates/core/src/turbo.rs and crates/core/src/hart/turbo.rs, dumped to stderr by
Machine::turbo_stats() when TURBO_COV is set. Restore with
`git checkout -- crates/core/src/turbo.rs crates/core/src/hart/turbo.rs`."""
import sys
root = sys.argv[1]
names = []
def idx(name):
    if name not in names:
        names.append(name)
    return names.index(name)
def hit(name):
    return f"crate::turbo::cov({idx(name)});"

def patch(path, edits):
    s = open(path).read()
    for old, new in edits:
        assert s.count(old) == 1, (path, old, s.count(old))
        s = s.replace(old, new)
    open(path, 'w').write(s)
    return s

t = root + '/crates/core/src/turbo.rs'
edits = [
 ("""                    match stop {
                        Stop::Horizon => self.turbo_stats.exit_horizon += 1,
                        Stop::Budget => self.turbo_stats.exit_budget += 1,
                        Stop::Device => self.turbo_stats.exit_boundary += 1,
                    }""",
  f"""                    match stop {{
                        Stop::Horizon => {{ {hit('stop_horizon')} self.turbo_stats.exit_horizon += 1 }}
                        Stop::Budget => {{ {hit('stop_budget_at_boundary')} self.turbo_stats.exit_budget += 1 }}
                        Stop::Device => {{ if device_touched {{ {hit('stop_device_touched')} }} else {{ {hit('stop_device_fabric_epoch_only')} }} self.turbo_stats.exit_boundary += 1 }}
                    }}"""),
 ("""                Err(trap) => {
                    self.turbo_settle(&mut deferred);
                    return Some(trap);
                }
            };
            tally.blocks += 1;""",
  f"""                Err(trap) => {{
                    {hit('enter_block_trap')}
                    self.turbo_settle(&mut deferred);
                    return Some(trap);
                }}
            }};
            tally.blocks += 1;"""),
 ("""                self.turbo_settle(&mut deferred);
                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)
                {
                    return Some(trap);
                }
                self.turbo_stats.exit_boundary += 1;
                return None;""",
  f"""                {hit('uncached_straddling_entry')}
                self.turbo_settle(&mut deferred);
                if let Err(trap) =
                    self.turbo_ordinary_op(&first, entry_pc, remaining_work, caps, tally)
                {{
                    {hit('uncached_straddling_entry_trap')}
                    return Some(trap);
                }}
                self.turbo_stats.exit_boundary += 1;
                return None;"""),
 ("""            debug_assert!(self.bus.code_write_log_mut().is_empty());""",
  f"""            {hit('cached_block_entry_assert_site')}
            if !self.bus.code_write_log_mut().is_empty() {{ {hit('code_write_log_NONEMPTY_at_block_entry')} }}
            debug_assert!(self.bus.code_write_log_mut().is_empty());"""),
 ("""                    // The ordinary executor, with the ordinary cursor and accounting.
                    self.turbo_settle(&mut deferred);""",
  f"""                    // The ordinary executor, with the ordinary cursor and accounting.
                    if deferred.before_block.is_some() {{ {hit('slow_op_is_first_settle_of_its_block')} }}
                    self.turbo_settle(&mut deferred);"""),
 ("""                    // the cursor in place so a dropped running block is observable.
                    self.turbo_settle(&mut deferred);""",
  f"""                    // the cursor in place so a dropped running block is observable.
                    if deferred.before_block.is_some() {{ {hit('code_filter_hit_is_first_settle_of_its_block')} }}
                    self.turbo_settle(&mut deferred);"""),
 ("""                if *remaining_work == 0 {
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = Some(BlockCursor {
                        block: alloc::rc::Rc::clone(&block),
                        idx,
                        next_va: self.hart.regs.pc,
                    });
                    self.turbo_stats.exit_budget += 1;
                    return None;
                }""",
  f"""                if *remaining_work == 0 {{
                    {hit('budget_exit_mid_block')}
                    self.turbo_settle(&mut deferred);
                    self.block_cursor = Some(BlockCursor {{
                        block: alloc::rc::Rc::clone(&block),
                        idx,
                        next_va: self.hart.regs.pc,
                    }});
                    self.turbo_stats.exit_budget += 1;
                    return None;
                }}"""),
 ("""                        let output = cap.finish(rd, value);
                        cap.retire(output, pc, op.raw);
                        Some(None)
                    } else {""",
  f"""                        let output = cap.finish(rd, value);
                        cap.retire(output, pc, op.raw);
                        {hit('inline_integer')}
                        Some(None)
                    }} else {{"""),
 ("""                            TurboStep::Retired(output) => {
                                cap.retire(output, pc, op.raw);""",
  f"""                            TurboStep::Retired(output) => {{
                                {hit('step_retired')}
                                cap.retire(output, pc, op.raw);"""),
 ("""                            TurboStep::Stored(output, pa) => {
                                cap.retire(output, pc, op.raw);""",
  f"""                            TurboStep::Stored(output, pa) => {{
                                {hit('step_stored')}
                                cap.retire(output, pc, op.raw);"""),
 ("""                            TurboStep::Slow => None,""",
  f"""                            TurboStep::Slow => {{ {hit('step_slow')} None }}"""),
 ("""                    if let Err(trap) = self.turbo_ordinary_op(op, pc, remaining_work, caps, tally) {
                        return Some(trap);
                    }
                    // The run loop's next loop-top tests, in its order.
                    if *remaining_work == 0 {
                        self.turbo_stats.exit_budget += 1;
                        return None;
                    }
                    if self.syscon.as_ref().is_some_and(|c| c.borrow().is_some())
                        || self.at_block_boundary()
                    {
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }""",
  f"""                    if let Err(trap) = self.turbo_ordinary_op(op, pc, remaining_work, caps, tally) {{
                        {hit('slow_op_trap')}
                        return Some(trap);
                    }}
                    // The run loop's next loop-top tests, in its order.
                    if *remaining_work == 0 {{
                        {hit('slow_op_budget_exit')}
                        self.turbo_stats.exit_budget += 1;
                        return None;
                    }}
                    if self.syscon.as_ref().is_some_and(|c| c.borrow().is_some())
                        || self.at_block_boundary()
                    {{
                        if self.syscon.as_ref().is_some_and(|c| c.borrow().is_some()) {{ {hit('slow_op_syscon_exit')} }} else if self.block_cursor.is_none() {{ {hit('slow_op_boundary_exit_cursor_dropped')} }} else {{ {hit('slow_op_boundary_exit_block_end')} }}
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }}"""),
 ("""                    let Some(next) = self.hart.turbo_ctx() else {
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    };
                    ctx = next;
                    if self.bus.device_access_count() != device_accesses {
                        device_touched = true;
                        horizon = u64::MAX;
                    }""",
  f"""                    let Some(next) = self.hart.turbo_ctx() else {{
                        {hit('slow_op_turbo_ctx_none')}
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }};
                    ctx = next;
                    {hit('slow_op_continue_inline')}
                    if self.bus.device_access_count() != device_accesses {{
                        {hit('slow_op_device_touched')}
                        device_touched = true;
                        horizon = u64::MAX;
                    }}"""),
 ("""                    self.bus.code_write_log_mut().push(frame);
                    self.drain_code_writes_slow();
                    if self.block_cursor.is_none() {
                        // The running block was dropped: the next instruction is a boundary.
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }
                    self.block_cursor = None;""",
  f"""                    self.bus.code_write_log_mut().push(frame);
                    self.drain_code_writes_slow();
                    if self.block_cursor.is_none() {{
                        {hit('inline_store_code_hit_block_dropped')}
                        // The running block was dropped: the next instruction is a boundary.
                        self.turbo_stats.exit_boundary += 1;
                        return None;
                    }}
                    {hit('inline_store_code_filter_false_positive')}
                    self.block_cursor = None;"""),
 ("""        self.irqstats.on_retire();
        self.advance_live_work(1, 1);
        if self.hart.last_was_wfi {""",
  f"""        self.irqstats.on_retire();
        {hit('ordinary_op_live_work_accounting')}
        if self.live_unrecorded.is_some() {{ {hit('ordinary_op_live_work_accounting_in_live_unrecorded_mode')} }}
        self.advance_live_work(1, 1);
        if self.hart.last_was_wfi {{"""),
 ("""            Some(before) => {
                if before != 0 {
                    self.settle_retired(before);
                }
                self.sync_clint();""",
  f"""            Some(before) => {{
                if before != 0 {{
                    {hit('settle_before_block_nonzero')}
                    self.settle_retired(before);
                }}
                {hit('settle_time_shadow_refresh')}
                self.sync_clint();"""),
 ("""            None => {
                if deferred.pending != 0 {
                    self.settle_retired(deferred.pending);
                }
            }""",
  f"""            None => {{
                if deferred.pending != 0 {{
                    {hit('settle_rest_only')}
                    self.settle_retired(deferred.pending);
                }}
            }}"""),
 ("""            RunCapture::Unit => self.turbo_loop(ctx, remaining_work, &mut UnitCaptures, &mut tally),
            RunCapture::Traced(sink) => self.turbo_loop(""",
  f"""            RunCapture::Unit => {{ {hit('capture_unit')} self.turbo_loop(ctx, remaining_work, &mut UnitCaptures, &mut tally) }}
            RunCapture::Traced(sink) => {{ {hit('capture_traced')} self.turbo_loop("""),
 ("""                &mut TracedCaptures(&mut **sink),
                &mut tally,
            ),
        };""",
  """                &mut TracedCaptures(&mut **sink),
                &mut tally,
            ) }
        };"""),
 ("""        if self.fabric_quiescent() && self.tick_accum < self.clock_div {
            self.hart.turbo_ctx()
        } else {
            None
        }""",
  f"""        if self.fabric_quiescent() && self.tick_accum < self.clock_div {{
            let c = self.hart.turbo_ctx();
            if c.is_none() {{ {hit('entry_refused_trigger_armed')} }}
            c
        }} else {{
            {hit('entry_refused_fabric_or_residue')}
            None
        }}"""),
 ("""        let Some(clint) = &self.clint else {
            return u64::MAX;
        };""",
  f"""        let Some(clint) = &self.clint else {{
            {hit('horizon_no_clint')}
            return u64::MAX;
        }};"""),
 ("""        if c.mtime < c.mtimecmp {
            ticks = ticks.min(c.mtimecmp - c.mtime);
        }
        if self.builtin_sbi && c.mtime < self.sbi_state.stimecmp {
            ticks = ticks.min(self.sbi_state.stimecmp - c.mtime);
        }""",
  f"""        if c.mtime < c.mtimecmp {{
            {hit('horizon_mtimecmp_ahead')}
            ticks = ticks.min(c.mtimecmp - c.mtime);
        }}
        if self.builtin_sbi && c.mtime < self.sbi_state.stimecmp {{
            {hit('horizon_stimecmp_ahead')}
            ticks = ticks.min(self.sbi_state.stimecmp - c.mtime);
        }}"""),
 ("""            Some(span) => span - self.tick_accum,
            None => u64::MAX,""",
  f"""            Some(span) => span - self.tick_accum,
            None => {{ {hit('horizon_span_overflow')} u64::MAX }}"""),
 ("""        if self.hart.last_was_wfi {
            self.after_wfi_retire();
        }
        Ok(())
    }

    /// Run consecutive decoded blocks""",
  f"""        if self.hart.last_was_wfi {{
            {hit('slow_op_wfi')}
            self.after_wfi_retire();
        }}
        Ok(())
    }}

    /// Run consecutive decoded blocks"""),
]
patch(t, edits)

h = root + '/crates/core/src/hart/turbo.rs'
hedits = [
 ("""                capture.load(a, $w);
                let value: u64 = $value;""",
  f"""                capture.load(a, $w);
                {hit('H_load_inline')}
                let value: u64 = $value;"""),
 ("""                let Some(pa) = self.turbo_probe(FAST_LOAD, a, $w, ctx.load_ctx, ctx.pmp_rev) else {
                    return TurboStep::Slow;
                };
                let Some($bytes) = bus.turbo_load::<$w>(pa) else {
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");""",
  f"""                let Some(pa) = self.turbo_probe(FAST_LOAD, a, $w, ctx.load_ctx, ctx.pmp_rev) else {{
                    {hit('H_load_probe_miss_or_misaligned')}
                    return TurboStep::Slow;
                }};
                let Some($bytes) = bus.turbo_load::<$w>(pa) else {{
                    {hit('H_load_non_ram')}
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");"""),
 ("""                else {
                    return TurboStep::Slow;
                };
                if !bus.turbo_store::<$w>(pa, (v as $ty).to_le_bytes()) {
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");""",
  f"""                else {{
                    {hit('H_store_probe_miss_or_misaligned')}
                    return TurboStep::Slow;
                }};
                if !bus.turbo_store::<$w>(pa, (v as $ty).to_le_bytes()) {{
                    {hit('H_store_non_ram')}
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");"""),
 ("""                capture.store(a, $w, v);""",
  f"""                capture.store(a, $w, v);
                {hit('H_store_inline')}"""),
 ("""                {
                    self.resv = None;
                }
                self.regs.pc = pc_next;
                TurboStep::Stored(capture.finish(0, 0), pa)""",
  f"""                {{
                    {hit('H_store_cleared_reservation')}
                    self.resv = None;
                }}
                self.regs.pc = pc_next;
                TurboStep::Stored(capture.finish(0, 0), pa)"""),
 ("""                let next = if $taken {
                    let target = pc.wrapping_add($imm as u64);
                    if target & 1 != 0 {
                        return TurboStep::Slow;
                    }
                    target
                } else {
                    pc_next
                };""",
  f"""                let next = if $taken {{
                    let target = pc.wrapping_add($imm as u64);
                    if target & 1 != 0 {{
                        {hit('H_branch_odd_target')}
                        return TurboStep::Slow;
                    }}
                    {hit('H_branch_taken')}
                    target
                }} else {{
                    {hit('H_branch_not_taken')}
                    pc_next
                }};"""),
 ("""                let target = pc.wrapping_add(imm as u64);
                if target & 1 != 0 {
                    return TurboStep::Slow;
                }
                self.regs.write(rd, pc_next);""",
  f"""                let target = pc.wrapping_add(imm as u64);
                if target & 1 != 0 {{
                    {hit('H_jal_odd_target')}
                    return TurboStep::Slow;
                }}
                {hit('H_jal')}
                self.regs.write(rd, pc_next);"""),
 ("""                let target = ea(self.regs.read(rs1), imm) & !1;""",
  f"""                {hit('H_jalr')}
                let target = ea(self.regs.read(rs1), imm) & !1;"""),
 ("""            _ => TurboStep::Slow,
        }""",
  f"""            _ => {{ {hit('H_other_instruction_class')} TurboStep::Slow }}
        }}"""),
 ("""        if !self.csr.triggers_idle() {
            return None;
        }""",
  f"""        if !self.csr.triggers_idle() {{
            {hit('H_turbo_ctx_trigger_armed')}
            return None;
        }}"""),
]
variants = ["Ld","Lw","Lwu","Lh","Lhu","Lb","Lbu","Sd","Sw","Sh","Sb","Beq","Bne","Blt","Bge","Bltu","Bgeu"]
s = patch(h, hedits)
import re
for v in variants:
    pat = f"            {v} {{ "
    assert s.count(pat) == 1, (v, s.count(pat))
    # `Ld { rd, rs1, imm } => load!(...)` -> `Ld { .. } => { cov; load!(...) }`
    i = s.index(pat)
    j = s.index("=> ", i) + 3
    k = s.index(",\n", j)
    s = s[:j] + "{ " + hit('H_variant_' + v) + " " + s[j:k] + " }" + s[k:]
open(h, 'w').write(s)

# The counter table itself.
s = open(t).read()
table = ", ".join(f'"{n}"' for n in names)
s += f"""
pub(crate) const COV_NAMES: [&str; {len(names)}] = [{table}];
pub(crate) static COV: [core::sync::atomic::AtomicU64; {len(names)}] =
    [const {{ core::sync::atomic::AtomicU64::new(0) }}; {len(names)}];
#[inline(always)]
pub(crate) fn cov(i: usize) {{
    COV[i].fetch_add(1, core::sync::atomic::Ordering::Relaxed);
}}
pub fn cov_dump() {{
    #[cfg(feature = "std")]
    for (name, hits) in COV_NAMES.iter().zip(COV.iter()) {{
        std::eprintln!("COV {{:>14}} {{}}", hits.load(core::sync::atomic::Ordering::Relaxed), name);
    }}
}}
"""
old = """    pub fn turbo_stats(&self) -> TurboStats {
        self.turbo_stats
    }"""
assert s.count(old) == 1
s = s.replace(old, """    pub fn turbo_stats(&self) -> TurboStats {
        #[cfg(feature = "std")]
        if std::env::var_os("TURBO_COV").is_some() {
            cov_dump();
        }
        self.turbo_stats
    }""")
open(t, 'w').write(s)
print(len(names), "counters")
