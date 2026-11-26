//! Equivalence tests for the turbo run loop (E4-T40b, `turbo.rs`), written by the task's verifier.
//!
//! Every scenario runs one guest program on two machines — the general per-op run loop (turbo
//! off, replay loop off) and the turbo loop — handing both the same work budget one `run()` call
//! at a time and comparing them after EVERY call, not only at the end: the run outcome, the
//! retire-trace hash and count, the whole hart snapshot (registers, CSRs, `mip`, the `time`
//! shadow, counters, the LR/SC reservation), the CLINT registers and tick residue, the SBI timer
//! deadline, the progress and interrupt counters, the position the run loop resumes at, and all
//! of guest RAM; and, at the end, the set of pages marked dirty since a mid-run commit. Budgets
//! of 1, 2, 3 and 5 work slots make the budget expire on every op index of every block.
//!
//! The scenarios are the ones the task's adversarial list names: the built-in SBI timer (future,
//! past and handler-re-armed deadlines), counter CSRs as the first op of a block, self-modifying
//! stores to an earlier op, a later op and another cached block, Sv39 page faults (load, store
//! and fetch) and page-table stores mid-chain, LR/SC around inline stores, `jalr` corner cases,
//! every inline load/store width and branch kind, misaligned and device accesses mid-block,
//! page-straddling entries (one that traps), the 128-op cap, FP and AMO ops between inline ops,
//! a stale code-page filter hit, `wfi` idle jumps in each guest-clock mode the loop runs in, the
//! modes it must stay out of, and seeded random programs.
//!
//! To build: this file is `crates/core/src/turbo_equivalence_tests.rs`, declared in `lib.rs` as
//! `#[cfg(all(test, not(feature = "zicsr-stub")))] mod turbo_equivalence_tests;`.
use super::*;
use crate::resume::ComponentSnapshot;
use crate::trace::HashSink;
use alloc::vec::Vec;

const BASE: u64 = bus::mmap::DRAM_BASE;
const RAM_BYTES: usize = 256 * 1024;
const DATA: u64 = BASE + 0x2_0000;
const DATA2: u64 = BASE + 0x3_0000;
const CLINT: u64 = bus::mmap::CLINT_BASE;
const UART: u64 = bus::mmap::UART0_BASE;
const SYSCON: u64 = platform::virt::TEST_BASE;

const SSTATUS: u32 = 0x100;
const SIE: u32 = 0x104;
const STVEC: u32 = 0x105;
const SEPC: u32 = 0x141;
const SCAUSE: u32 = 0x142;
const STVAL: u32 = 0x143;
const SATP: u32 = 0x180;
const MSTATUS: u32 = 0x300;
const MIE: u32 = 0x304;
const MTVEC: u32 = 0x305;
const MEPC: u32 = 0x341;
const MCAUSE: u32 = 0x342;
const MCYCLE: u32 = 0xB00;
const MINSTRET: u32 = 0xB02;
const CYCLE: u32 = 0xC00;
const TIME: u32 = 0xC01;
const INSTRET: u32 = 0xC02;

const ECALL: u32 = 0x0000_0073;
const MRET: u32 = 0x3020_0073;
const SRET: u32 = 0x1020_0073;
const WFI: u32 = 0x1050_0073;
const SFENCE_VMA: u32 = 0x1200_0073;
const JDOT: u32 = 0x0000_006F;
const C_NOP: u16 = 0x0001;

const BEQ: u32 = 0;
const BNE: u32 = 1;
const BLT: u32 = 4;
const BGE: u32 = 5;
const BLTU: u32 = 6;
const BGEU: u32 = 7;
const EBREAK: u32 = 0x0010_0073;
/// The custom-0 major opcode: not an instruction this machine decodes.
const UNDECODABLE: u32 = 0x0000_000B;

fn i_type(imm: i32, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op
}
fn s_type(imm: i32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((iu & 0x1F) << 7) | 0x23
}
fn b_type(off: i32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    let o = off as u32;
    (((o >> 12) & 1) << 31)
        | (((o >> 5) & 0x3F) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (f3 << 12)
        | (((o >> 1) & 0xF) << 8)
        | (((o >> 11) & 1) << 7)
        | 0x63
}
fn j_type(off: i32, rd: u32) -> u32 {
    let o = off as u32;
    (((o >> 20) & 1) << 31)
        | (((o >> 1) & 0x3FF) << 21)
        | (((o >> 11) & 1) << 20)
        | (((o >> 12) & 0xFF) << 12)
        | (rd << 7)
        | 0x6F
}
fn r_type(f7: u32, rs2: u32, rs1: u32, f3: u32, rd: u32) -> u32 {
    (f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x33
}
fn addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 0, rd, 0x13)
}
fn andi(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 7, rd, 0x13)
}
fn ori(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 6, rd, 0x13)
}
fn slli(rd: u32, rs1: u32, sh: i32) -> u32 {
    i_type(sh, rs1, 1, rd, 0x13)
}
fn srli(rd: u32, rs1: u32, sh: i32) -> u32 {
    i_type(sh, rs1, 5, rd, 0x13)
}
fn add(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0, rs2, rs1, 0, rd)
}
fn sub(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0x20, rs2, rs1, 0, rd)
}
fn xor(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0, rs2, rs1, 4, rd)
}
fn and(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0, rs2, rs1, 7, rd)
}
fn or(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0, rs2, rs1, 6, rd)
}
fn sltu(rd: u32, rs1: u32, rs2: u32) -> u32 {
    r_type(0, rs2, rs1, 3, rd)
}
fn lui(rd: u32, imm20: u32) -> u32 {
    ((imm20 & 0xF_FFFF) << 12) | (rd << 7) | 0x37
}
fn ld(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 3, rd, 0x03)
}
fn lw(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 2, rd, 0x03)
}
fn lwu(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 6, rd, 0x03)
}
fn lh(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 1, rd, 0x03)
}
fn lhu(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 5, rd, 0x03)
}
fn lb(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 0, rd, 0x03)
}
fn lbu(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 4, rd, 0x03)
}
fn sd(rs2: u32, rs1: u32, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 3)
}
fn sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 2)
}
fn sh(rs2: u32, rs1: u32, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 1)
}
fn sb(rs2: u32, rs1: u32, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0)
}
fn jalr(rd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 0, rd, 0x67)
}
fn csrrw(rd: u32, csr: u32, rs1: u32) -> u32 {
    (csr << 20) | (rs1 << 15) | (1 << 12) | (rd << 7) | 0x73
}
fn csrrs(rd: u32, csr: u32, rs1: u32) -> u32 {
    (csr << 20) | (rs1 << 15) | (2 << 12) | (rd << 7) | 0x73
}
/// `lr.w` (`f3` 2) / `lr.d` (`f3` 3).
fn lr(rd: u32, rs1: u32, f3: u32) -> u32 {
    (0x02 << 27) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x2F
}
/// `sc.w` (`f3` 2) / `sc.d` (`f3` 3).
fn sc(rd: u32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    (0x03 << 27) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x2F
}
/// `amoadd.d` (`f5` 0, `f3` 3), `amoswap.w` (`f5` 1, `f3` 2), ...
fn amo(f5: u32, rd: u32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    (f5 << 27) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x2F
}
fn fmv_w_x(fd: u32, rs1: u32) -> u32 {
    (0x78 << 25) | (rs1 << 15) | (fd << 7) | 0x53
}
fn fmv_x_w(rd: u32, fs1: u32) -> u32 {
    (0x70 << 25) | (fs1 << 15) | (rd << 7) | 0x53
}
fn fadd_s(fd: u32, fs1: u32, fs2: u32) -> u32 {
    (fs2 << 20) | (fs1 << 15) | (fd << 7) | 0x53
}
fn flw(fd: u32, rs1: u32, imm: i32) -> u32 {
    i_type(imm, rs1, 2, fd, 0x07)
}
fn fsw(fs2: u32, rs1: u32, imm: i32) -> u32 {
    (s_type(imm, fs2, rs1, 2) & !0x7F) | 0x27
}
/// A 32-bit value into `rd` (sign-extended from bit 31): `lui` + `addi`.
fn li32(rd: u32, v: u32) -> [u32; 2] {
    let lo = ((v & 0xFFF) as i32) << 20 >> 20;
    let hi = v.wrapping_sub(lo as u32) >> 12;
    [lui(rd, hi), addi(rd, rd, lo)]
}

enum Fix {
    Branch,
    Jal,
    La,
}

/// A two-pass assembler just big enough for these guests: 32- and 16-bit parcels, labels,
/// branches/jumps to labels, `la` (a zero-extended 32-bit address) and `org`.
struct Asm {
    bytes: Vec<u8>,
    labels: Vec<(&'static str, u64)>,
    fixups: Vec<(usize, &'static str, Fix)>,
}

impl Asm {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            labels: Vec::new(),
            fixups: Vec::new(),
        }
    }
    fn pc(&self) -> u64 {
        BASE + self.bytes.len() as u64
    }
    fn w(&mut self, insn: u32) {
        self.bytes.extend_from_slice(&insn.to_le_bytes());
    }
    fn ws(&mut self, insns: &[u32]) {
        for insn in insns {
            self.w(*insn);
        }
    }
    fn h(&mut self, insn: u16) {
        self.bytes.extend_from_slice(&insn.to_le_bytes());
    }
    fn d(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn label(&mut self, name: &'static str) {
        assert!(self.labels.iter().all(|(n, _)| *n != name), "{name} twice");
        self.labels.push((name, self.pc()));
    }
    fn org(&mut self, addr: u64) {
        assert!(addr >= self.pc(), "org {addr:#x} behind {:#x}", self.pc());
        self.bytes.resize((addr - BASE) as usize, 0);
    }
    fn branch(&mut self, f3: u32, rs1: u32, rs2: u32, target: &'static str) {
        self.fixups.push((self.bytes.len(), target, Fix::Branch));
        self.w(b_type(0, rs2, rs1, f3));
    }
    fn jal(&mut self, rd: u32, target: &'static str) {
        self.fixups.push((self.bytes.len(), target, Fix::Jal));
        self.w(j_type(0, rd));
    }
    /// A zero-extended 32-bit address: `lui`, `addi`, `slli 32`, `srli 32`.
    fn la(&mut self, rd: u32, addr: u64) {
        assert!(addr <= u64::from(u32::MAX));
        self.ws(&li32(rd, addr as u32));
        self.ws(&[slli(rd, rd, 32), srli(rd, rd, 32)]);
    }
    fn la_label(&mut self, rd: u32, target: &'static str) {
        self.fixups.push((self.bytes.len(), target, Fix::La));
        self.la(rd, 0);
    }
    fn poweroff(&mut self) {
        // x2/x3 are reserved for this: no scenario uses them.
        self.la(2, SYSCON);
        self.ws(&li32(3, 0x5555));
        self.ws(&[sw(3, 2, 0), JDOT]);
    }
    fn finish(mut self) -> Vec<u8> {
        for (at, name, kind) in core::mem::take(&mut self.fixups) {
            let target = self
                .labels
                .iter()
                .find(|(n, _)| *n == name)
                .unwrap_or_else(|| panic!("no label {name}"))
                .1;
            let pc = BASE + at as u64;
            let word = u32::from_le_bytes(self.bytes[at..at + 4].try_into().unwrap());
            let off = target.wrapping_sub(pc) as i64 as i32;
            let mut put =
                |at: usize, w: u32| self.bytes[at..at + 4].copy_from_slice(&w.to_le_bytes());
            match kind {
                Fix::Branch => {
                    assert!(
                        (-4096..4096).contains(&off),
                        "branch to {name} out of range"
                    );
                    put(at, word | b_type(off, 0, 0, 0) & !0x7F);
                }
                Fix::Jal => put(at, word | j_type(off, 0) & !0x7F),
                Fix::La => {
                    let rd = (word >> 7) & 0x1F;
                    let [hi, lo] = li32(rd, target as u32);
                    put(at, hi);
                    put(at + 4, lo);
                }
            }
        }
        self.bytes
    }
}

/// The guest-clock modes the turbo loop is NOT excluded from.
#[derive(Clone, Copy, PartialEq, Debug)]
enum ClockMode {
    ICount,
    /// Paced ICount: `wfi` idle jumps are limited by a host clock (a deterministic one here).
    Paced,
    /// Live owned-provider control with capture disabled (work counters, deferred idle jumps).
    LiveUnrecorded,
}

#[derive(Clone, Copy)]
struct Cfg {
    /// S-mode entry with the built-in SBI (else M-mode with PMP open).
    supervisor: bool,
    /// Retirements per `mtime` tick; 0 = no CLINT.
    clint_div: u64,
    /// Attach the PLIC and the UART (a fabric device).
    uart: bool,
    clock: ClockMode,
}

impl Cfg {
    const fn m_mode(clint_div: u64) -> Self {
        Self {
            supervisor: false,
            clint_div,
            uart: false,
            clock: ClockMode::ICount,
        }
    }
    const fn s_mode(clint_div: u64) -> Self {
        Self {
            supervisor: true,
            clint_div,
            uart: false,
            clock: ClockMode::ICount,
        }
    }
}

/// A host clock that advances one millisecond per reading: deterministic for a given sequence of
/// readings, so two machines agree exactly when they consult it at the same points.
struct SteppingClock(core::cell::Cell<u64>);
impl time::MonotonicClock for SteppingClock {
    fn now_nanos(&self) -> u64 {
        let now = self.0.get();
        self.0.set(now + 1_000_000);
        now
    }
}

fn machine(cfg: &Cfg, image: &[u8], turbo: bool) -> Machine {
    let mut m = Machine::new(RAM_BYTES);
    if cfg.clint_div != 0 {
        m.enable_clint(cfg.clint_div);
    }
    m.enable_syscon();
    if cfg.uart {
        m.enable_plic();
        m.enable_uart16550();
    }
    if cfg.supervisor {
        m.enable_builtin_sbi();
        m.boot_supervisor(0, 0);
    } else {
        m.hart.csr.pmp.allow_all();
    }
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    // Control: the general per-op loop. Subject: the turbo loop (with the replay loop behind it).
    m.set_turbo(turbo);
    m.replay_tail_off = !turbo;
    m.bus_mut().write_ram_slice(BASE, image).unwrap();
    m.hart.regs.pc = BASE;
    match cfg.clock {
        ClockMode::ICount => {}
        ClockMode::Paced => m
            .set_paced_icount_clock(alloc::boxed::Box::new(SteppingClock(
                core::cell::Cell::new(0),
            )))
            .unwrap(),
        ClockMode::LiveUnrecorded => m.start_live_unrecorded().unwrap(),
    }
    m
}

/// Where the run loop resumes: `Some((block, op index))` mid-block, `None` at a block boundary.
/// (A cursor parked past its block's last op, or at another PC, IS a boundary: see
/// `Machine::at_block_boundary`.)
fn resume_point(m: &Machine) -> Option<(u64, usize)> {
    match &m.block_cursor {
        Some(c) if c.next_va == m.hart.regs.pc && c.idx < c.block.ops.len() => {
            Some((c.block.phys_start, c.idx))
        }
        _ => None,
    }
}

/// Everything compared after each `run()` call except RAM (compared bytewise by the caller).
#[derive(Debug, PartialEq)]
struct Observed {
    outcome: RunOutcome,
    trace_hash: u64,
    trace_retired: u64,
    pc: u64,
    hart: Vec<u8>,
    clint: Option<(u64, u64, bool)>,
    tick_accum: u64,
    stimecmp: u64,
    progress: (u64, [u64; 16], [u64; 16], u64),
    resume: Option<(u64, usize)>,
    live: Option<session_live::LiveWork>,
    last_was_wfi: bool,
}

fn observe(m: &Machine, trace: &HashSink, outcome: RunOutcome) -> Observed {
    let stats = m.irq_stats();
    Observed {
        outcome,
        trace_hash: trace.hash(),
        trace_retired: trace.retired(),
        pc: m.hart.regs.pc,
        hart: m.hart.to_snapshot(),
        clint: m.clint.as_ref().map(|c| {
            let c = c.borrow();
            (c.mtime, c.mtimecmp, c.msip)
        }),
        tick_accum: m.tick_accum,
        stimecmp: m.sbi_state.stimecmp,
        progress: (stats.retired, stats.exc, stats.int, stats.wfi),
        resume: resume_point(m),
        live: m.live_unrecorded_work(),
        last_was_wfi: m.hart.last_was_wfi,
    }
}

const SLICINGS: [&[u64]; 8] = [
    &[1_000_000],
    &[1],
    &[2],
    &[3],
    &[5],
    &[1, 7, 333],
    &[4096, 3],
    &[97],
];

/// Run `image` under the general loop and the turbo loop for every slicing, traced and untraced,
/// comparing after every `run()` call. `expect` sees the final control machine, the turbo
/// counters and the slicing, for scenario-specific sanity (the guest did what the scenario is
/// for, and the turbo loop engaged).
fn equivalent(
    name: &str,
    cfg: Cfg,
    image: &[u8],
    total: u64,
    expect: &dyn Fn(&Machine, &turbo::TurboStats, &[u64]),
) {
    for traced in [true, false] {
        for slices in SLICINGS {
            let mut control = machine(&cfg, image, false);
            let mut subject = machine(&cfg, image, true);
            let (mut control_trace, mut subject_trace) = (HashSink::new(), HashSink::new());
            let (mut done, mut call) = (0u64, 0usize);
            let mut committed = false;
            loop {
                let budget = slices[call % slices.len()];
                let (control_outcome, subject_outcome) = if traced {
                    (
                        control.run_traced(budget, &mut control_trace),
                        subject.run_traced(budget, &mut subject_trace),
                    )
                } else {
                    (control.run(budget), subject.run(budget))
                };
                let at = (name, traced, slices, call, budget, done);
                assert_eq!(
                    observe(&subject, &subject_trace, subject_outcome),
                    observe(&control, &control_trace, control_outcome),
                    "(scenario, traced, slicing, run call, its budget, work before) = {at:?}"
                );
                assert!(
                    subject.bus.ram().as_bytes() == control.bus.ram().as_bytes(),
                    "RAM differs: {at:?}"
                );
                call += 1;
                done += budget;
                if control_outcome != RunOutcome::MaxInstrs || done >= total {
                    break;
                }
                if !committed && done >= 1_500 {
                    // From here on every page the guest writes must be marked dirty again, by
                    // whichever path performs the store (the data pages now have fast-TLB
                    // entries, so the turbo loop's stores are inline).
                    committed = true;
                    commit_dirty(&mut control);
                    commit_dirty(&mut subject);
                }
            }
            let dirty = dirty_pages(&mut control);
            assert_eq!(
                dirty_pages(&mut subject),
                dirty,
                "dirty pages: {name} {slices:?}"
            );
            if let Some(pages) = &dirty
                && slices.iter().all(|budget| *budget < 1_000)
            {
                assert!(
                    !pages.is_empty(),
                    "{name}: stores after the commit mark pages dirty"
                );
            }
            assert_eq!(control.snapshot(), subject.snapshot(), "{name} {slices:?}");
            assert_eq!(
                control.turbo_stats().entries,
                0,
                "the control is the general loop"
            );
            expect(&control, &subject.turbo_stats(), slices);
        }
    }
}

/// The pages written since the dirty set was last committed (`None` when tracking is off, as in
/// live unrecorded mode). The keyframe recorder persists exactly these pages.
fn dirty_pages(m: &mut Machine) -> Option<Vec<usize>> {
    let ram = m.bus.ram_mut();
    ram.begin_dirty_epoch().ok()?;
    let pages = (0..RAM_BYTES / ram::KEYFRAME_PAGE_BYTES)
        .filter(|page| ram.pending_page(*page).is_some())
        .collect();
    ram.finish_dirty_epoch(false).unwrap();
    Some(pages)
}

/// Commit (and so empty) the dirty set, as a published keyframe does.
fn commit_dirty(m: &mut Machine) {
    let ram = m.bus.ram_mut();
    if ram.begin_dirty_epoch().is_ok() {
        ram.finish_dirty_epoch(true).unwrap();
    }
}

fn x(m: &Machine, reg: u8) -> u64 {
    m.hart.regs.read(reg)
}

fn powered_off(m: &Machine) -> bool {
    m.syscon.as_ref().and_then(|c| *c.borrow()) == Some(ExitReason::PowerOff)
}

/// (i) The built-in SBI timer from S-mode: `set_timer` to a future deadline every 16th pass, to
/// a deadline already in the past every 64th, and re-armed from the interrupt handler, which
/// folds every interrupted `sepc` into x30. STIP must be taken at the boundary the general loop
/// picks, with `time` read (`rdtime`) right before each call.
#[test]
fn sbi_timer_deadlines_future_past_and_rearmed() {
    const EID_TIME: u64 = 0x5449_4D45;
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, STVEC, 6));
    a.la(8, DATA);
    a.ws(&[addi(7, 0, 0x20), csrrs(0, SIE, 7)]); // STIE
    a.ws(&[addi(7, 0, 0x2), csrrs(0, SSTATUS, 7)]); // SIE
    a.w(addi(9, 0, 600));
    a.la(17, EID_TIME); // a7
    a.w(addi(16, 0, 0)); // a6 = set_timer
    a.label("loop");
    a.ws(&[
        addi(15, 15, 3),
        sd(15, 8, 0),
        ld(18, 8, 0),
        xor(19, 18, 15),
        andi(20, 9, 15),
    ]);
    a.branch(BNE, 20, 0, "skip_future");
    a.ws(&[csrrs(10, TIME, 0), addi(10, 10, 23), ECALL]); // a deadline 23 ticks ahead
    a.label("skip_future");
    a.ws(&[
        addi(21, 21, 1),
        sd(21, 8, 8),
        andi(20, 9, 63),
        addi(22, 0, 5),
    ]);
    a.branch(BNE, 20, 22, "skip_past");
    a.ws(&[addi(10, 0, 0), ECALL]); // a deadline already in the past
    a.label("skip_past");
    a.ws(&[ld(23, 8, 8), add(24, 24, 23), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[
        csrrs(28, SEPC, 0),
        slli(29, 30, 5),
        add(30, 30, 29),
        add(30, 30, 28), // x30 = x30 * 33 + sepc
        addi(31, 31, 1), // interrupts taken
        csrrs(10, TIME, 0),
        addi(10, 10, 37),
        ECALL, // re-arm from the handler
        SRET,
    ]);
    let image = a.finish();
    for div in [1, 3, 10] {
        equivalent(
            "sbi-timer",
            Cfg::s_mode(div),
            &image,
            400_000,
            &|m, stats, slices| {
                assert!(powered_off(m), "div={div}: the guest ran to its poweroff");
                assert_eq!(x(m, 9), 0);
                assert!(x(m, 31) > 20, "timer interrupts taken: {}", x(m, 31));
                if slices == [1_000_000] {
                    assert!(
                        stats.exit_horizon > 5 && stats.inline_ops > 2_000 && stats.exit_trap > 20,
                        "div={div}: the turbo loop must run to the SBI horizon: {stats:?}"
                    );
                }
            },
        );
    }
}

/// (ii) `csrr time` / `cycle` / `instret`, `csrw minstret` and `csrw mcycle`, each placed after
/// a run of inline loads, stores and integer ops and as the FIRST op of a block (after another
/// CSR op, and after a taken branch).
#[test]
fn counter_csrs_after_inline_ops_and_first_in_block() {
    let mut a = Asm::new();
    a.la(8, DATA);
    a.w(addi(9, 0, 400));
    a.label("loop");
    a.ws(&[
        addi(5, 5, 1),
        sd(5, 8, 0),
        ld(6, 8, 0),
        add(7, 7, 6),
        csrrs(12, TIME, 0),    // after inline ops
        csrrs(13, CYCLE, 0),   // first op of a block
        csrrs(14, INSTRET, 0), // first op of a block
        add(15, 15, 12),
        add(15, 15, 13),
        add(15, 15, 14),
        sd(15, 8, 8),
        csrrs(16, MINSTRET, 0), // after inline ops including a store
        csrrw(0, MINSTRET, 15), // first op: a counter write (its own tick is suppressed)
        csrrs(17, MINSTRET, 0), // first op: read it back
        addi(18, 18, 1),
        ld(19, 8, 8),
        csrrw(0, MCYCLE, 19), // a counter write after inline ops
        csrrs(20, MCYCLE, 0),
    ]);
    a.branch(BEQ, 0, 0, "next");
    a.label("next");
    a.ws(&[
        csrrs(21, TIME, 0), // first op after a taken branch
        add(22, 22, 21),
        add(22, 22, 17),
        add(22, 22, 20),
        add(22, 22, 16),
        sd(22, 8, 16),
        addi(9, 9, -1),
    ]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    let image = a.finish();
    for div in [1, 3, 64] {
        equivalent(
            "counters",
            Cfg::m_mode(div),
            &image,
            400_000,
            &|m, stats, slices| {
                assert!(powered_off(m));
                assert!(x(m, 21) > 100, "div={div}: `time` advanced: {}", x(m, 21));
                if slices == [1_000_000] {
                    assert!(
                        stats.inline_ops > 3_000 && stats.slow_ops > 3_000,
                        "{stats:?}"
                    );
                }
            },
        );
    }
}

/// (iii) Under Sv39 in S-mode: stores that rewrite an EARLIER op of the running block, a LATER
/// op of it, and a block cached on another page; a load page fault and two store page faults in
/// the middle of a chain of blocks; and stores into a page-table page — the handler sets the D
/// bit of a leaf and retries, the main loop clears it again and only flushes the TLB every other
/// pass, so a stale translation serves the store in between.
#[test]
fn self_modifying_stores_and_page_faults_under_sv39() {
    let (root, l1, l0) = (BASE + 0x1_0000, BASE + 0x1_1000, BASE + 0x1_2000);
    let patch = |rd: u32, imm: i32| addi(rd, rd, imm);
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, STVEC, 6));
    a.ws(&[addi(5, 0, 8), slli(5, 5, 60)]);
    a.la(7, root >> 12);
    a.ws(&[or(5, 5, 7), csrrw(0, SATP, 5), SFENCE_VMA, addi(7, 0, 0)]);
    a.la(8, 0xC000_0000); // a 4 KiB read-write leaf
    a.la(9, 0xC000_1000); // not mapped
    a.la(12, 0xC000_2000); // read-only leaf
    a.la(13, 0xC000_3000); // writable leaf with D clear
    a.la(14, l0); // the leaf table itself (identity-mapped)
    a.la_label(20, "later");
    a.la_label(21, "earlier");
    a.la_label(22, "sub");
    a.ws(&li32(23, patch(29, 7)));
    a.ws(&li32(27, patch(26, 7)));
    a.ws(&li32(28, patch(30, 7)));
    a.w(lui(24, 0x600)); // toggles the patched immediate between 7 and 1
    a.w(addi(25, 0, 120));
    a.label("loop");
    a.label("earlier");
    a.ws(&[
        patch(26, 1), // rewritten below, by a later op of this same block
        addi(15, 15, 3),
        sd(15, 8, 0),
        ld(16, 8, 0),
        sw(27, 21, 0), // rewrite an EARLIER op of the running block
        xor(27, 27, 24),
        addi(17, 17, 1),
        sw(23, 20, 0), // rewrite a LATER op of the running block
        xor(23, 23, 24),
        add(18, 18, 16),
    ]);
    a.label("later");
    a.ws(&[
        patch(29, 1), // overwritten before it runs
        add(19, 19, 29),
        ld(5, 9, 0), // load page fault (not mapped): the handler skips it
        addi(17, 17, 1),
        sd(15, 12, 0),  // store page fault (read-only leaf): skipped
        ld(5, 12, 8),   // the same page reads fine
        sd(15, 13, 16), // store page fault (D clear): the handler sets D and retries
        jalr(1, 9, 0),  // jump into the unmapped page: a fetch page fault at a block entry
        jalr(1, 8, 0),  // jump into a page without X: likewise
        UNDECODABLE,    // an illegal instruction at a block entry: skipped
    ]);
    a.jal(1, "sub");
    a.ws(&[
        sw(28, 22, 0), // rewrite a DIFFERENT cached block, on another page
        xor(28, 28, 24),
        ld(5, 14, 24),
        andi(5, 5, -129),
        sd(5, 14, 24), // clear D again: a store into a page-table page
        andi(6, 25, 1),
    ]);
    a.branch(BEQ, 6, 0, "noflush");
    a.w(SFENCE_VMA);
    a.label("noflush");
    a.w(addi(25, 25, -1));
    a.branch(BNE, 25, 0, "loop");
    a.poweroff();
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[csrrs(5, SCAUSE, 0), addi(6, 0, 12)]);
    a.branch(BNE, 5, 6, "not_fetch");
    a.ws(&[csrrw(0, SEPC, 1), addi(10, 10, 1), SRET]); // a fetch fault: return to the caller
    a.label("not_fetch");
    a.w(addi(6, 0, 15));
    a.branch(BNE, 5, 6, "skip");
    a.ws(&[csrrs(5, STVAL, 0), sub(5, 5, 13), srli(5, 5, 12)]);
    a.branch(BNE, 5, 0, "skip");
    a.ws(&[
        ld(5, 14, 24),
        ori(5, 5, 0x80),
        sd(5, 14, 24), // set D: a store into a page-table page
        SFENCE_VMA,
        addi(7, 7, 1),
        SRET,
    ]);
    a.label("skip");
    a.ws(&[
        csrrs(5, SEPC, 0),
        addi(5, 5, 4),
        csrrw(0, SEPC, 5),
        addi(4, 4, 1),
        SRET,
    ]);
    a.org(BASE + 0x2000);
    a.label("sub");
    a.ws(&[patch(30, 1), add(31, 31, 30), jalr(0, 1, 0)]);
    let leaf = |pa: u64, flags: u64| ((pa >> 12) << 10) | flags;
    a.org(root);
    a.d(leaf(0, 0xC7)); // 0x0000_0000: devices, read-write
    a.d(0);
    a.d(leaf(BASE, 0xCF)); // 0x8000_0000: RAM, identity, RWX
    a.d(leaf(l1, 0x01));
    a.org(l1);
    a.d(leaf(l0, 0x01));
    a.org(l0);
    a.d(leaf(DATA2, 0xC7)); // 0xC000_0000: read-write, A and D set
    a.d(0); // 0xC000_1000: not mapped
    a.d(leaf(DATA2, 0x43)); // 0xC000_2000: read-only
    a.d(leaf(DATA2, 0x47)); // 0xC000_3000: writable, D clear
    let image = a.finish();
    equivalent(
        "smc-sv39",
        Cfg::s_mode(10),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            assert_eq!(
                x(m, 4),
                360,
                "a load fault, a store fault and an illegal op skipped per pass"
            );
            assert_eq!(x(m, 10), 240, "two fetch page faults per pass");
            assert_eq!(x(m, 7), 60, "the D bit is set again after every TLB flush");
            assert_eq!(
                x(m, 29),
                120 * 7 - 60 * 6,
                "every later-op rewrite ran its new bytes"
            );
            assert_eq!(
                x(m, 26),
                1 + 60 * 7 + 59,
                "earlier-op rewrites took effect a pass later"
            );
            assert_eq!(
                x(m, 30),
                1 + 60 * 7 + 59,
                "other-block rewrites took effect a pass later"
            );
            if slices == [1_000_000] {
                assert!(
                    stats.inline_ops > 1_000 && stats.exit_trap > 200,
                    "{stats:?}"
                );
            }
        },
    );
}

/// (iv) LR/SC with an inline store in between: to the reservation (the SC must fail), next to it
/// (must succeed), overlapping its last byte, one byte past it, into its upper half — and a
/// reservation that survives an inline load and a block boundary.
#[test]
fn inline_stores_clear_exactly_the_overlapping_reservation() {
    let mut a = Asm::new();
    a.la(8, DATA + 64);
    a.w(addi(9, 0, 300));
    a.w(sd(0, 8, 0));
    a.label("loop");
    a.ws(&[
        addi(6, 6, 5),
        lr(5, 8, 3),
        sd(6, 8, 0), // the reservation itself
        sc(7, 9, 8, 3),
        add(20, 20, 7),
        lr(5, 8, 3),
        sd(6, 8, 8), // the next doubleword
        sc(7, 9, 8, 3),
        add(21, 21, 7),
        lr(5, 8, 2),
        sb(6, 8, 3), // the last byte of the reserved word
        sc(7, 9, 8, 2),
        add(22, 22, 7),
        lr(5, 8, 2),
        sb(6, 8, 4), // one byte past it
        sc(7, 9, 8, 2),
        add(23, 23, 7),
        lr(5, 8, 3),
        sh(6, 8, -2), // just below
        sw(6, 8, 4),  // the upper half
        sc(7, 9, 8, 3),
        add(24, 24, 7),
        lr(5, 8, 3),
        ld(6, 8, 0), // an inline load leaves it alone
    ]);
    a.branch(BEQ, 0, 0, "over"); // and so does a block boundary
    a.label("over");
    a.ws(&[sc(7, 9, 8, 3), add(25, 25, 7), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    let image = a.finish();
    equivalent(
        "lr-sc",
        Cfg::m_mode(10),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            let fails: Vec<u64> = (20..=25).map(|r| x(m, r)).collect();
            assert_eq!(fails, [300, 0, 300, 0, 300, 0], "SC failures per case");
            if slices == [1_000_000] {
                assert!(
                    stats.inline_ops > 3_000 && stats.slow_ops > 3_000,
                    "{stats:?}"
                );
            }
        },
    );
}

/// (v) `jalr` with bit 0 set in the register and in the immediate (cleared, not a trap), with
/// `rd == rs1`, and with the running block itself as the target; plus compressed loads, stores,
/// `c.jalr` and `c.jr` (2-byte ops: the link and the fall-through are `pc + 2`).
#[test]
fn jalr_targets_and_compressed_inline_ops() {
    let mut a = Asm::new();
    a.la(8, DATA);
    a.w(addi(9, 0, 200));
    a.la_label(16, "after");
    a.la_label(15, "selfblk");
    a.w(sub(15, 15, 16)); // x15 = selfblk - after
    a.label("loop");
    a.la_label(5, "t1");
    a.ws(&[addi(5, 5, 1), jalr(1, 5, 0)]); // odd register value: bit 0 is cleared
    a.la_label(6, "t2");
    a.ws(&[jalr(6, 6, 0), add(20, 20, 6)]); // rd == rs1: jump through the old value
    a.la_label(7, "t3");
    a.w(jalr(1, 7, 1)); // odd immediate
    a.w(addi(12, 0, 5));
    a.label("selfblk");
    a.ws(&[
        addi(12, 12, -1),
        add(21, 21, 12),
        sltu(14, 0, 12),
        sub(14, 0, 14),
        and(14, 14, 15),
        add(13, 16, 14),
        jalr(0, 13, 0), // back to this block's own first op while x12 != 0
    ]);
    a.label("after");
    a.w(addi(14, 14, 9));
    a.h(0xE018); // c.sd x14, 0(x8)
    a.h(0x0285); // c.addi x5, 1
    a.h(0x6018); // c.ld x14, 0(x8)
    a.h(C_NOP);
    a.la_label(5, "t4");
    a.h(0x9282); // c.jalr x5
    a.h(C_NOP);
    a.w(addi(9, 9, -1));
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.label("t1");
    a.ws(&[addi(22, 22, 1), jalr(0, 1, 0)]);
    a.label("t2");
    a.ws(&[addi(23, 23, 1), jalr(0, 6, 0)]);
    a.label("t3");
    a.ws(&[addi(24, 24, 1), jalr(0, 1, 0)]);
    a.label("t4");
    a.w(add(25, 25, 1));
    a.h(0x8082); // c.jr x1
    let image = a.finish();
    equivalent(
        "jalr",
        Cfg::m_mode(10),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            let calls: Vec<u64> = (22..=24).map(|r| x(m, r)).collect();
            assert_eq!(calls, [200, 200, 200]);
            assert_eq!(
                x(m, 21),
                200 * 10,
                "the self-targeting block ran five times per pass"
            );
            if slices == [1_000_000] {
                assert!(stats.inline_ops > 10_000, "{stats:?}");
            }
        },
    );
}

/// (vi) Misaligned loads and stores (one across a page) and device accesses in the middle of a
/// block, each followed by more inline ops: a UART status read and a transmit (fabric devices),
/// and — in a block that touches no fabric device — a CLINT `mtime` load, an `mtimecmp` rewrite
/// and an `msip` write that raises a software interrupt; plus a write to `mtime` itself. The
/// handler folds `mepc` and `mcause` of every interrupt into x30.
#[test]
fn misaligned_and_device_accesses_in_the_middle_of_a_block() {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, DATA);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.la(25, UART);
    a.la(12, CLINT);
    a.ws(&[ld(5, 14, 0), addi(5, 5, 50), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]); // MTIE | MSIE
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]); // MIE
    a.w(addi(9, 0, 400));
    a.label("loop");
    a.ws(&[
        addi(15, 15, 3),
        sd(15, 8, 1), // misaligned store
        ld(16, 8, 1), // misaligned loads
        lw(17, 8, 3),
        sh(15, 8, 7),
        lhu(18, 8, 7),
        sd(15, 8, -3), // misaligned across a page (DATA - 3)
        lwu(19, 8, -2),
        lh(20, 8, 2),
        lb(21, 8, 1),
        add(16, 16, 17),
        andi(27, 9, 3),
        addi(24, 0, 1),
    ]);
    a.branch(BNE, 27, 24, "no_uart_read");
    a.ws(&[
        lbu(22, 25, 5), // UART line status (a fabric device) as the first op of a block
        addi(23, 23, 1),
        sd(23, 8, 16),
    ]);
    a.label("no_uart_read");
    a.ws(&[ld(24, 8, 16), addi(23, 23, 2), andi(27, 9, 7)]);
    a.branch(BNE, 27, 0, "no_clint");
    // CLINT accesses only: no fabric window is touched in this block, so the loop must stop at
    // the next boundary because it recorded the device access itself.
    a.ws(&[
        addi(29, 29, 1),
        ld(5, 14, 0), // CLINT mtime, mid-block
        addi(5, 5, 9),
        sd(5, 13, 0), // move the timer deadline from inside a block
        addi(28, 28, 1),
        sw(28, 12, 0), // msip = x28 & 1: a software interrupt every other time
        addi(29, 29, 1),
        sd(29, 8, 24),
        ld(31, 8, 24),
    ]);
    a.label("no_clint");
    a.ws(&[andi(27, 9, 15), addi(24, 0, 6)]);
    a.branch(BNE, 27, 24, "no_tx");
    a.ws(&[
        addi(23, 23, 1),
        sb(15, 25, 0), // UART transmit, mid-block
        addi(23, 23, 1),
        sd(23, 8, 32),
    ]);
    a.label("no_tx");
    a.ws(&[andi(27, 9, 31), addi(24, 0, 11)]);
    a.branch(BNE, 27, 24, "no_mtime");
    a.ws(&[
        ld(5, 14, 0),
        addi(5, 5, 100),
        sd(5, 14, 0), // write mtime itself: the clock jumps under the loop
        addi(23, 23, 1),
        sd(23, 8, 40),
    ]);
    a.label("no_mtime");
    a.w(addi(9, 9, -1));
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[
        csrrs(10, MEPC, 0),
        slli(11, 30, 5),
        add(30, 30, 11),
        add(30, 30, 10),
        csrrs(10, MCAUSE, 0),
        add(30, 30, 10), // x30 folds every interrupted mepc and its cause
        addi(4, 4, 1),
        sw(0, 12, 0), // clear msip
        ld(10, 14, 0),
        addi(10, 10, 37),
        sd(10, 13, 0), // next timer deadline
        MRET,
    ]);
    let image = a.finish();
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    equivalent(
        "mmio-misaligned",
        cfg,
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            assert!(x(m, 4) > 40, "interrupts taken: {}", x(m, 4));
            assert_eq!(x(m, 28), 50, "the device block ran every eighth pass");
            if slices == [1_000_000] {
                assert!(
                    stats.inline_ops > 3_000 && stats.slow_ops > 3_000,
                    "{stats:?}"
                );
            }
        },
    );
}

/// (vii) Block shapes: an entry instruction that straddles a page (reached by a jump, by falling
/// off the end of a page, and one that traps), straight-line runs longer than the 128-op block
/// cap, and a block that ends at the page edge — with a timer interrupt every 111 instructions,
/// so interrupts are sampled at cap boundaries and around the uncached entries.
#[test]
fn page_straddling_entries_and_the_128_op_cap() {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.ws(&[csrrw(0, MTVEC, 6), addi(6, 0, 0)]);
    a.la(8, DATA);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&[ld(10, 14, 0), addi(10, 10, 50), sd(10, 13, 0)]);
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.w(addi(9, 0, 40));
    a.label("loop");
    a.jal(0, "straddle");
    a.org(BASE + 0xFFE);
    a.label("straddle");
    a.w(addi(5, 5, 1)); // bytes 0xFFE..0x1002: an entry op that straddles the page
    a.h(C_NOP);
    for i in 0..300 {
        // Longer than two full blocks; loads and stores keep it off the pure-integer path.
        match i % 5 {
            0 => a.w(sd(6, 8, 0)),
            1 => a.w(ld(7, 8, 0)),
            _ => a.w(addi(6, 6, 1)),
        }
    }
    a.jal(0, "edge");
    a.org(BASE + 0x1FF0);
    a.label("edge");
    a.ws(&[addi(15, 15, 1), sd(15, 8, 8), ld(16, 8, 8)]);
    a.h(C_NOP); // 0x1FFC: the block ends at the page edge
    a.w(add(17, 17, 16)); // 0x1FFE: reached by falling through, straddles the page
    a.h(C_NOP);
    a.jal(0, "trapper");
    a.org(BASE + 0x2FF0);
    a.label("trapper");
    a.ws(&[addi(18, 18, 1), sd(18, 8, 16), ld(19, 8, 16)]);
    a.h(C_NOP);
    a.w(ld(20, 0, 0)); // 0x2FFE: a straddling entry op that traps (load access fault)
    a.h(C_NOP);
    a.w(addi(9, 9, -1));
    a.branch(BNE, 9, 0, "back");
    a.poweroff();
    a.label("back");
    a.jal(0, "loop");
    a.org(BASE + 0x3800);
    a.label("handler");
    a.w(csrrs(28, MCAUSE, 0));
    a.branch(BLT, 28, 0, "interrupt");
    a.ws(&[
        csrrs(28, MEPC, 0),
        addi(28, 28, 4),
        csrrw(0, MEPC, 28),
        addi(4, 4, 1), // exceptions skipped
        MRET,
    ]);
    a.label("interrupt");
    a.ws(&[
        csrrs(28, MEPC, 0),
        slli(29, 30, 5),
        add(30, 30, 29),
        add(30, 30, 28), // x30 folds every interrupted mepc
        addi(31, 31, 1),
        ld(10, 14, 0),
        addi(10, 10, 37),
        sd(10, 13, 0),
        MRET,
    ]);
    let image = a.finish();
    equivalent(
        "block-shapes",
        Cfg::m_mode(3),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            assert_eq!(x(m, 5), 40);
            assert_eq!(x(m, 6), 40 * 180);
            assert_eq!(x(m, 17), (1..=40).sum::<u64>());
            assert_eq!(x(m, 4), 40, "the straddling load trapped once per pass");
            assert!(
                x(m, 31) > 50,
                "timer interrupts across the long blocks: {}",
                x(m, 31)
            );
            if slices == [1_000_000] {
                assert!(
                    stats.inline_ops > 10_000 && stats.slow_ops >= 80,
                    "{stats:?}"
                );
            }
        },
    );
}

/// `wfi` idle jumps and M-mode timer interrupts in the three guest-clock modes the turbo loop
/// runs in: plain ICount, paced ICount (the idle jump is limited by a host clock, consulted only
/// when a `wfi` retires) and live unrecorded control (work counters, the idle jump taken as its
/// own work slot at the next loop top).
#[test]
fn wfi_idle_jumps_in_every_clock_mode_the_loop_runs_in() {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(8, DATA);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&[ld(5, 14, 0), addi(5, 5, 50), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.w(addi(9, 0, 300));
    a.label("loop");
    a.ws(&[
        addi(15, 15, 3),
        sd(15, 8, 0),
        ld(16, 8, 0),
        add(17, 17, 16),
        andi(18, 9, 3),
    ]);
    a.branch(BNE, 18, 0, "busy");
    a.ws(&[WFI, addi(19, 19, 1)]);
    a.label("busy");
    a.ws(&[ld(20, 8, 0), add(21, 21, 20), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[
        csrrs(28, MEPC, 0),
        slli(29, 30, 5),
        add(30, 30, 29),
        add(30, 30, 28),
        addi(31, 31, 1),
        ld(5, 14, 0),
        addi(5, 5, 37),
        sd(5, 13, 0),
        MRET,
    ]);
    let image = a.finish();
    for clock in [
        ClockMode::ICount,
        ClockMode::Paced,
        ClockMode::LiveUnrecorded,
    ] {
        for div in [1, 10] {
            let cfg = Cfg {
                clock,
                ..Cfg::m_mode(div)
            };
            equivalent("wfi", cfg, &image, 400_000, &|m, stats, slices| {
                assert!(powered_off(m), "{clock:?} div={div}");
                assert_eq!(x(m, 19), 75, "one wfi every fourth pass");
                assert!(x(m, 31) > 10, "{clock:?}: interrupts taken: {}", x(m, 31));
                assert_eq!(
                    m.guest_clock_mode() == time::TimeMode::PacedICount,
                    clock == ClockMode::Paced
                );
                assert_eq!(
                    m.live_unrecorded_work().is_some(),
                    clock == ClockMode::LiveUnrecorded
                );
                if slices == [1_000_000] {
                    assert!(
                        stats.entries > 50 && stats.inline_ops > 2_000,
                        "{clock:?} div={div}: the turbo loop runs in this mode: {stats:?}"
                    );
                }
            });
        }
    }
}

/// The loop must stay out — `entries == 0` — with a debug trigger armed, in wall-clock mode,
/// with the JIT attached, under a session clock, with the profiler or HTIF armed, and without
/// the block cache or interrupt batching; and the same guest must engage it otherwise.
#[test]
fn excluded_modes_never_enter_the_turbo_loop() {
    use crate::csr::{CsrOp, TDATA1, TDATA2, TSELECT};
    struct NullExecutor;
    impl jit::CompiledBlockExecutor for NullExecutor {
        fn install(&mut self, _: &dispatch::DecodedBlock) {}
        fn is_compiled(&self, _: u64) -> bool {
            false
        }
        fn execute(
            &mut self,
            _: u64,
            _: &mut hart::Hart,
            _: &mut mmio::SystemBus,
        ) -> Option<jit::JitExit> {
            None
        }
        fn invalidate_all(&mut self) {}
        fn invalidate_page(&mut self, _: u64) {}
        fn compiled_count(&self) -> usize {
            0
        }
        fn executed_blocks(&self) -> u64 {
            0
        }
        fn retired_via_jit(&self) -> u64 {
            0
        }
    }
    let mut a = Asm::new();
    a.la(8, DATA);
    a.label("loop");
    a.ws(&[addi(5, 5, 1), sd(5, 8, 0), ld(6, 8, 0), add(7, 7, 6)]);
    a.branch(BEQ, 0, 0, "loop");
    let image = a.finish();
    let entries = |setup: &dyn Fn(&mut Machine)| {
        let mut m = machine(&Cfg::m_mode(10), &image, true);
        m.replay_tail_off = false;
        setup(&mut m);
        for _ in 0..4 {
            assert_eq!(m.run(5_000), RunOutcome::MaxInstrs);
        }
        assert!(x(&m, 5) > 100, "the guest ran");
        m.turbo_stats().entries
    };
    assert!(
        entries(&|_| {}) > 0,
        "the guest engages the loop when nothing excludes it"
    );
    type Setup<'a> = &'a dyn Fn(&mut Machine);
    let excluded: [(&str, Setup); 9] = [
        ("turbo off", &|m| m.set_turbo(false)),
        ("armed debug trigger", &|m| {
            for (csr, v) in [
                (TSELECT, 0),
                (TDATA2, BASE + 0x8000),
                (TDATA1, (2u64 << 60) | (1 << 6) | (1 << 2)),
            ] {
                m.hart
                    .csr
                    .access(csr, CsrOp::Write, v, false, false, 0)
                    .unwrap();
            }
            assert!(!m.hart.csr.triggers_idle());
        }),
        ("wall clock", &|m| {
            m.set_wall_clock(
                alloc::boxed::Box::new(time::FixedMonotonic(0)),
                time::WallClockPolicy::default(),
            )
        }),
        ("JIT attached", &|m| {
            m.set_executor(alloc::boxed::Box::new(NullExecutor));
            m.set_jit(true);
            assert!(m.jit_active());
        }),
        ("session clock", &|m| m.start_session_clock(1).unwrap()),
        ("profiler", &|m| m.set_profiling(true)),
        ("HTIF", &|m| m.set_htif(DATA + 0x800)),
        ("no interrupt batching", &|m| {
            m.set_interrupt_batching(false)
        }),
        ("no block cache", &|m| m.set_block_cache(false)),
    ];
    for (name, setup) in excluded {
        assert_eq!(entries(setup), 0, "{name} must keep the turbo loop out");
    }
}

/// Every inline load width and sign, every inline store width, and all six conditional
/// branches taken and not taken, on data that changes every pass.
#[test]
fn inline_load_store_widths_and_all_six_branches() {
    let mut a = Asm::new();
    a.la(8, DATA);
    a.ws(&li32(5, 0x80F1_92A3));
    a.ws(&li32(6, 0xC4D5_E6F7));
    a.ws(&[sw(5, 8, 0), sw(6, 8, 4), sd(5, 8, 8), sd(6, 8, 16)]);
    a.ws(&li32(28, 0x7F4A_7C15));
    a.ws(&li32(29, 0x9E37_79B9));
    a.ws(&[slli(29, 29, 32), or(28, 28, 29)]); // an odd 64-bit multiplier
    a.w(addi(9, 0, 300));
    a.label("loop");
    a.ws(&[
        lb(10, 8, 0),
        lbu(11, 8, 1),
        lh(12, 8, 2),
        lhu(13, 8, 2),
        lw(14, 8, 4),
        lwu(15, 8, 4),
        ld(16, 8, 0),
        add(17, 17, 10),
        add(17, 17, 11),
        add(17, 17, 12),
        add(17, 17, 13),
        add(17, 17, 14),
        add(17, 17, 15),
        r_type(1, 28, 5, 0, 5), // mul x5, x5, x28: every bit of the data changes each pass
        add(5, 5, 9),
        sb(5, 8, 8),
        sh(5, 8, 10),
        sw(5, 8, 12),
        sd(5, 8, 16),
        lb(18, 8, 8),
        lh(19, 8, 10),
        lw(20, 8, 12),
        ld(21, 8, 16),
        add(17, 17, 18),
        add(17, 17, 19),
        add(17, 17, 20),
    ]);
    a.branch(BLT, 18, 19, "b1");
    a.w(addi(22, 22, 1));
    a.label("b1");
    a.branch(BGE, 18, 19, "b2");
    a.w(addi(23, 23, 1));
    a.label("b2");
    a.branch(BLTU, 20, 21, "b3");
    a.w(addi(24, 24, 1));
    a.label("b3");
    a.branch(BGEU, 20, 21, "b4");
    a.w(addi(25, 25, 1));
    a.label("b4");
    a.branch(BEQ, 12, 13, "b5");
    a.w(addi(26, 26, 1));
    a.label("b5");
    a.branch(BNE, 12, 13, "b6");
    a.w(addi(27, 27, 1));
    a.label("b6");
    a.ws(&[sd(5, 8, 0), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    let image = a.finish();
    for div in [10, 0] {
        // `div == 0`: no CLINT at all, so there is no timer horizon.
        equivalent(
            "widths-branches",
            Cfg::m_mode(div),
            &image,
            400_000,
            &|m, stats, slices| {
                assert!(powered_off(m));
                for (not_taken, taken) in [(22, 23), (24, 25), (26, 27)] {
                    // Each pair of complementary branches skips exactly one increment per pass...
                    assert_eq!(x(m, not_taken) + x(m, taken), 300);
                    // ...and both outcomes of each comparison occurred.
                    assert!(
                        x(m, not_taken) > 20 && x(m, taken) > 20,
                        "x{not_taken}/x{taken}"
                    );
                }
                if slices == [1_000_000] {
                    assert!(stats.inline_ops > 10_000, "{stats:?}");
                }
            },
        );
    }
}

/// Ops the loop hands to the ordinary executor and then carries on from inline: FP moves,
/// arithmetic, loads and stores, and AMOs, each between inline loads and stores.
#[test]
fn fp_and_amo_ops_between_inline_ops() {
    let mut a = Asm::new();
    a.la(8, DATA);
    a.ws(&[lui(7, 2), csrrs(0, MSTATUS, 7)]); // FS = Initial
    a.w(addi(9, 0, 300));
    a.w(sd(0, 8, 0));
    a.label("loop");
    a.ws(&[
        addi(5, 5, 3),
        fmv_w_x(1, 5),
        addi(6, 6, 1),
        sd(6, 8, 16),
        fadd_s(2, 1, 1),
        fsw(2, 8, 8),
        ld(10, 8, 8),
        flw(3, 8, 8),
        fmv_x_w(11, 3),
        add(12, 12, 11),
        amo(0, 13, 6, 8, 3), // amoadd.d
        ld(14, 8, 0),
        amo(1, 15, 5, 8, 2), // amoswap.w
        lw(16, 8, 0),
        add(12, 12, 13),
        add(12, 12, 14),
        add(12, 12, 15),
        add(12, 12, 16),
        add(12, 12, 10),
        addi(9, 9, -1),
    ]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    let image = a.finish();
    equivalent(
        "fp-amo",
        Cfg::m_mode(3),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            assert_eq!(x(m, 16), 3 * 300, "the last amoswap.w stored x5");
            if slices == [1_000_000] {
                assert!(
                    stats.inline_ops > 3_000 && stats.slow_ops > 1_500,
                    "{stats:?}"
                );
            }
        },
    );
}

/// A trap with no handler installed escapes the run loop from the middle of a chain of blocks:
/// the same `Trapped` outcome at the same point, with the accounting settled.
#[test]
fn unhandled_trap_escapes_identically() {
    let mut a = Asm::new();
    a.la(8, DATA);
    a.w(addi(9, 0, 50));
    a.label("loop");
    a.ws(&[addi(5, 5, 1), sd(5, 8, 0), ld(6, 8, 0), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "loop");
    a.ws(&[addi(7, 7, 1), sd(7, 8, 8), EBREAK, addi(7, 7, 1)]);
    let image = a.finish();
    equivalent(
        "unhandled-trap",
        Cfg::m_mode(3),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(!powered_off(m));
            assert_eq!((x(m, 9), x(m, 7)), (0, 1), "stopped at the ebreak");
            assert_eq!(m.irq_stats().retired, 4 + 50 * 5 + 2 + 1);
            if slices == [1_000_000] {
                assert!(stats.exit_trap == 1 && stats.inline_ops > 200, "{stats:?}");
            }
        },
    );
}

/// An inline store to a page whose cached code was dropped by a whole-cache flush (a PMP change
/// bumps the cache generation): the block cache's presence filter still says the frame may hold
/// code, the page invalidation finds nothing live, and the running block must carry on — the
/// one path on which the turbo loop takes its cursor back after a code-page check.
#[test]
fn inline_store_to_a_page_whose_code_was_flushed_wholesale() {
    const PMPADDR5: u32 = 0x3B5;
    let mut a = Asm::new();
    // The entry block lives on the first code page and runs once.
    a.la(8, DATA);
    a.la(20, BASE + 0x800); // a data slot on that same page
    a.w(addi(9, 0, 300));
    a.jal(0, "main");
    a.org(BASE + 0x1000);
    a.label("main");
    a.w(csrrw(0, PMPADDR5, 9)); // an unused PMP entry changes: every cached block is dropped
    a.label("loop");
    a.ws(&[
        addi(5, 5, 1),
        sd(5, 20, 0), // the entry page: its (stale) code-page record is still in the filter
        ld(6, 20, 0),
        add(7, 7, 6),
        sd(7, 8, 0),
        addi(9, 9, -1),
    ]);
    a.branch(BNE, 9, 0, "loop");
    a.poweroff();
    let image = a.finish();
    equivalent(
        "stale-code-filter",
        Cfg::m_mode(10),
        &image,
        400_000,
        &|m, stats, slices| {
            assert!(powered_off(m));
            assert_eq!(x(m, 7), (1..=300).sum::<u64>());
            assert!(
                m.block_cache.may_hold_code((BASE + 0x800) >> 12),
                "the store target is still filter-positive at the end: the scenario stayed on the path"
            );
            if slices == [1_000_000] {
                // Six ops per pass in one block: had the store dropped the running block every pass
                // the loop would leave and re-enter 300 times.
                assert!(stats.inline_ops > 1_500 && stats.entries < 50, "{stats:?}");
            }
        },
    );
}

/// Random guests: 32 seeded programs mixing integer ops, loads and stores of every width
/// (aligned and misaligned), forward branches and jumps, counter CSR reads, CLINT `mtime`
/// loads, `mtimecmp` rewrites (sometimes into the past), `msip` writes, LR/SC pairs around a
/// store, and `wfi`, under a timer/software interrupt handler that folds every interrupted
/// `mepc` and `mcause`. Each runs under every slicing, traced and untraced.
#[test]
fn random_programs_agree_under_every_slicing() {
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
        /// One of x16..x25: the registers the random body computes in.
        fn reg(&mut self) -> u32 {
            16 + self.below(10) as u32
        }
    }
    let (finished, interrupts, inline) = (
        core::cell::Cell::new(0u32),
        core::cell::Cell::new(0u64),
        core::cell::Cell::new(0u64),
    );
    for seed in 1..=32u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut a = Asm::new();
        a.la_label(6, "handler");
        a.w(csrrw(0, MTVEC, 6));
        a.la(8, DATA + 0x800);
        a.la(12, CLINT);
        a.la(13, CLINT + 0x4000);
        a.la(14, CLINT + 0xBFF8);
        a.ws(&[ld(10, 14, 0), addi(10, 10, 50), sd(10, 13, 0)]);
        a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]); // MTIE | MSIE
        a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
        for reg in 16..26 {
            a.ws(&li32(reg, rng.next() as u32));
        }
        a.w(addi(9, 0, 10));
        a.label("loop");
        for _ in 0..60 + rng.below(120) {
            let (rd, rs1, rs2) = (rng.reg(), rng.reg(), rng.reg());
            // Mostly aligned, sometimes not; always inside the data pages.
            let off = rng.below(64) as i32 * 8 - 256 + [0, 0, 0, 1, 3][rng.below(5) as usize];
            match rng.below(40) {
                0..=9 => a.w(match rng.below(5) {
                    0 => addi(rd, rs1, rng.below(4096) as i32 - 2048),
                    1 => add(rd, rs1, rs2),
                    2 => xor(rd, rs1, rs2),
                    3 => r_type(1, rs2, rs1, 0, rd), // mul
                    _ => slli(rd, rs1, rng.below(64) as i32),
                }),
                10..=17 => a.w([lb, lbu, lh, lhu, lw, lwu, ld][rng.below(7) as usize](
                    rd, 8, off,
                )),
                18..=25 => a.w([sb, sh, sw, sd][rng.below(4) as usize](rs2, 8, off)),
                26..=30 => {
                    // A forward branch over the next one to three instructions.
                    let f3 = [BEQ, BNE, BLT, BGE, BLTU, BGEU][rng.below(6) as usize];
                    a.w(b_type(4 * (2 + rng.below(3) as i32), rs2, rs1, f3));
                }
                31 => a.w(j_type(4 * (2 + rng.below(2) as i32), 0)),
                32..=34 => {
                    let csr = [TIME, CYCLE, INSTRET, MCYCLE, MINSTRET][rng.below(5) as usize];
                    a.w(csrrs(rd, csr, 0));
                }
                35 => a.w(ld(rd, 14, 0)), // CLINT mtime
                36 => {
                    // Move the timer deadline, sometimes into the past.
                    let ahead = rng.below(64) as i32 - 8;
                    a.ws(&[ld(10, 14, 0), addi(10, 10, ahead), sd(10, 13, 0)]);
                }
                37 => a.w(sw(rs2, 12, 0)), // msip = bit 0 of a register
                38 => {
                    let store = match rng.below(4) {
                        0 => sd(rs2, 8, 0),
                        1 => sd(rs2, 8, 8),
                        2 => sw(rs2, 8, 4),
                        _ => sb(rs2, 8, -1),
                    };
                    a.ws(&[lr(rd, 8, 3), store, sc(rs1, rs2, 8, 3)]);
                }
                _ => a.w(WFI),
            }
        }
        // Landing pads for a branch or jump emitted at the very end of the body.
        a.ws(&[addi(0, 0, 0); 4]);
        a.w(addi(9, 9, -1));
        a.branch(BNE, 9, 0, "loop");
        a.poweroff();
        a.label("handler");
        a.ws(&[
            csrrs(28, MEPC, 0),
            slli(29, 30, 5),
            add(30, 30, 29),
            add(30, 30, 28),
            csrrs(28, MCAUSE, 0),
            add(30, 30, 28), // x30 folds every interrupted mepc and its cause
            addi(31, 31, 1),
            sw(0, 12, 0), // clear msip
            ld(27, 14, 0),
            addi(27, 27, 37),
            sd(27, 13, 0), // next timer deadline
            MRET,
        ]);
        let image = a.finish();
        let div = [1, 3, 10, 64][(seed % 4) as usize];
        equivalent(
            "random",
            Cfg::m_mode(div),
            &image,
            60_000,
            &|m, stats, slices| {
                if slices == [1_000_000] {
                    finished.set(finished.get() + u32::from(powered_off(m)));
                    interrupts.set(interrupts.get() + x(m, 31));
                    inline.set(inline.get() + stats.inline_ops);
                }
            },
        );
    }
    // Counted over the two full-budget runs (traced and untraced) of each of the 32 programs.
    let (finished, interrupts, inline) = (finished.get(), interrupts.get(), inline.get());
    assert!(
        finished >= 56,
        "most programs run to their poweroff: {finished}/64"
    );
    assert!(interrupts > 1_000, "interrupts were taken: {interrupts}");
    assert!(inline > 40_000, "the turbo loop ran the programs: {inline}");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a: paced idle yield (worker-written; the tests above are the E4-T40b verifier's).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/// A host clock the test sets, counting how often it is read.
#[derive(Clone, Default)]
struct HostClock {
    now: alloc::rc::Rc<core::cell::Cell<u64>>,
    reads: alloc::rc::Rc<core::cell::Cell<u64>>,
}
impl time::MonotonicClock for HostClock {
    fn now_nanos(&self) -> u64 {
        self.reads.set(self.reads.get() + 1);
        self.now.get()
    }
}

/// A host clock that advances `step` nanoseconds per reading (the pacer reads it once when it is
/// selected and once per `wfi` that consults it), so two machines that execute the same guest
/// instructions see the same host times.
struct StepClock {
    now: core::cell::Cell<u64>,
    step: u64,
}
impl time::MonotonicClock for StepClock {
    fn now_nanos(&self) -> u64 {
        let now = self.now.get();
        self.now.set(now + self.step);
        now
    }
}

/// M-mode: arm `mtimecmp = mtime + first`, enable the timer interrupt, then
/// `loop: wfi; x19 += 1; j loop`. The handler counts in x31, folds `mepc` into x30 and either
/// re-arms `mtimecmp = mtime + rearm` or (rearm == 0) disarms the timer; after `stop` interrupts
/// it powers off. `busy` instructions of straight-line work run before the first `wfi`.
fn paced_idle_image(first: i32, rearm: i32, stop: i32, busy: i32) -> Vec<u8> {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.w(addi(9, 0, busy));
    a.branch(BEQ, 9, 0, "arm");
    a.label("work");
    a.ws(&[addi(15, 15, 3), xor(16, 16, 15), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "work");
    a.label("arm");
    a.ws(&[ld(5, 14, 0), addi(5, 5, first), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.w(addi(10, 0, stop));
    a.label("loop");
    a.ws(&[WFI, addi(19, 19, 1)]);
    a.jal(0, "loop");
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[
        csrrs(28, MEPC, 0),
        slli(29, 30, 5),
        add(30, 30, 29),
        add(30, 30, 28),
        addi(31, 31, 1),
    ]);
    a.branch(BEQ, 31, 10, "off");
    if rearm == 0 {
        a.ws(&[addi(5, 0, -1), sd(5, 13, 0), MRET]);
    } else {
        a.ws(&[ld(5, 14, 0), addi(5, 5, rearm), sd(5, 13, 0), MRET]);
    }
    a.label("off");
    a.poweroff();
    a.finish()
}

fn paced_idle_machine(image: &[u8], div: u64, turbo: bool) -> Machine {
    machine(&Cfg::m_mode(div), image, turbo)
}

const NS_PER_TICK: u64 = 1_000_000_000 / platform::virt::TIMEBASE_FREQ_HZ as u64;

/// The contract of one waiting `wfi`: the run call ends there with part of its budget unused,
/// the wait is the distance from the pacer's ceiling to the deadline, it is reported once, a
/// new run call re-derives it, and once the host clock passes the deadline the guest wakes and
/// nothing more is reported. Without the opt-in the same guest uses its whole budget.
#[test]
fn paced_idle_yield_ends_the_run_at_a_waiting_wfi_and_reports_the_wait() {
    // First deadline 2000 ticks out; the handler disarms the timer (rearm 0) and never stops.
    let image = paced_idle_image(2000, 0, 100, 0);
    for turbo in [false, true] {
        for div in [1u64, 10, 64] {
            let host = HostClock::default();
            host.now.set(5_000_000_000);
            let mut m = paced_idle_machine(&image, div, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            assert!(!m.paced_idle_yield());
            m.set_paced_idle_policy(true, None);
            assert!(m.paced_idle_yield());
            assert_eq!(m.take_idle_wait_nanos(), None, "nothing ran yet");

            // 1. The host clock has not moved since the clock was selected (guest time 0), so
            //    the pacer's ceiling is still 0: the wait is the whole way to the deadline. The
            //    few ticks the guest's own retirements put it ahead of the host do not count.
            assert_eq!(m.run(100_000), RunOutcome::MaxInstrs);
            let retired = m.irq_stats().retired;
            assert!(
                retired < 100,
                "turbo={turbo} div={div}: budget unused: {retired}"
            );
            assert_eq!(m.irq_stats().wfi, 1);
            assert!(!powered_off(&m));
            let (mtime, cmp) = {
                let c = m.clint.as_ref().unwrap().borrow();
                (c.mtime, c.mtimecmp)
            };
            assert!(cmp > mtime && cmp >= 2000, "the deadline is still ahead");
            assert_eq!(
                mtime,
                retired / div,
                "guest time is its own retirements, no jump"
            );
            let wait = m.take_idle_wait_nanos();
            assert_eq!(wait, Some(cmp * NS_PER_TICK), "turbo={turbo} div={div}");
            assert_eq!(m.take_idle_wait_nanos(), None, "reported once");
            assert_eq!(x(&m, 31), 0, "no interrupt yet");

            // 2. Called again without sleeping: one pass of the idle loop (addi, jal, wfi) and
            //    the same wait again — the host clock, not retirement, measures it.
            assert_eq!(m.run(100_000), RunOutcome::MaxInstrs);
            assert_eq!(m.irq_stats().retired, retired + 3);
            assert_eq!(m.irq_stats().wfi, 2);
            assert_eq!(m.take_idle_wait_nanos(), Some(cmp * NS_PER_TICK));

            // 3. A wait the host does not take is dropped by the next run call, which sets its
            //    own; a run with a budget of zero neither runs nor reports.
            assert_eq!(m.run(100_000), RunOutcome::MaxInstrs);
            assert_eq!(m.irq_stats().retired, retired + 6);
            assert_eq!(m.run(0), RunOutcome::MaxInstrs);
            assert_eq!(
                m.take_idle_wait_nanos(),
                None,
                "a run call clears an untaken wait"
            );

            // 4. Half the wait passes on the host: guest time is carried to the host's (it was
            //    behind it by now), and the rest of the wait is reported.
            let half = cmp / 2;
            host.now.set(host.now.get() + half * NS_PER_TICK);
            assert_eq!(m.run(100_000), RunOutcome::MaxInstrs);
            let now = m.clint.as_ref().unwrap().borrow().mtime;
            assert_eq!(
                now, half,
                "turbo={turbo} div={div}: idle time follows the host clock"
            );
            assert_eq!(m.take_idle_wait_nanos(), Some((cmp - half) * NS_PER_TICK));
            assert_eq!(x(&m, 31), 0);

            // 5. The host clock passes the deadline: the guest takes its timer interrupt, the
            //    handler disarms the timer, and with no deadline armed nothing is reported —
            //    the guest spins through the rest of the budget as it always has.
            host.now.set(host.now.get() + 10_000_000_000);
            let at = m.irq_stats().retired;
            assert_eq!(m.run(5_000), RunOutcome::MaxInstrs);
            assert_eq!(
                x(&m, 31),
                1,
                "turbo={turbo} div={div}: the timer interrupt was taken"
            );
            // (The taken interrupt used one work slot without retiring.)
            assert_eq!(m.irq_stats().int.iter().sum::<u64>(), 1);
            assert_eq!(
                m.irq_stats().retired,
                at + 5_000 - 1,
                "no early return without a deadline"
            );
            assert_eq!(m.take_idle_wait_nanos(), None);
            assert_eq!(m.clint.as_ref().unwrap().borrow().mtimecmp, u64::MAX);

            // Control: the same guest and host clock without the opt-in never returns early.
            let host = HostClock::default();
            host.now.set(5_000_000_000);
            let mut c = paced_idle_machine(&image, div, turbo);
            c.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            c.set_paced_idle_policy(false, None);
            assert_eq!(c.run(100_000), RunOutcome::MaxInstrs);
            // Spinning retires instructions, and retirement alone moves guest time: at a small
            // divider the deadline is reached that way and the interrupt uses one work slot.
            let taken: u64 = c.irq_stats().int.iter().sum();
            assert!(taken <= 1);
            assert_eq!(c.irq_stats().retired, 100_000 - taken);
            assert_eq!(c.take_idle_wait_nanos(), None);
            assert!(c.irq_stats().wfi > 1_000, "it spun on wfi");
        }
    }
}

/// The opt-in means nothing outside the paced clock: a retire-count machine jumps straight to
/// its deadline and a wall-clock machine never jumps, and neither reports a wait or returns
/// early. Selecting the policy does not change the resume bytes.
#[test]
fn paced_idle_policy_is_inert_in_other_clock_modes_and_is_not_serialized() {
    let image = paced_idle_image(2000, 0, 100, 0);
    for turbo in [false, true] {
        // Pure ICount.
        let mut plain = paced_idle_machine(&image, 10, turbo);
        let mut opted = paced_idle_machine(&image, 10, turbo);
        let before = opted.save_resume().unwrap();
        opted.set_paced_idle_policy(true, Some(50_000_000));
        assert_eq!(
            opted.save_resume().unwrap(),
            before,
            "host policy is not snapshot state"
        );
        for budget in [1u64, 7, 40, 3, 5_000] {
            let (mut ta, mut tb) = (HashSink::new(), HashSink::new());
            let oa = plain.run_traced(budget, &mut ta);
            let ob = opted.run_traced(budget, &mut tb);
            assert_eq!(
                observe(&plain, &ta, oa),
                observe(&opted, &tb, ob),
                "budget {budget}"
            );
            assert_eq!(opted.take_idle_wait_nanos(), None);
        }
        assert_eq!(opted.guest_clock_mode(), time::TimeMode::ICount);
        assert_eq!(
            x(&opted, 31),
            1,
            "the idle jump reached the deadline at once"
        );
        assert_eq!(plain.save_resume().unwrap(), opted.save_resume().unwrap());

        // Pure ICount again, with a timer the guest armed but never enabled: the idle jump
        // reaches a deadline that wakes nothing, and the guest spins. Still no early return.
        let mut a = Asm::new();
        a.la(13, CLINT + 0x4000);
        a.la(14, CLINT + 0xBFF8);
        a.ws(&[ld(5, 14, 0), addi(5, 5, 2000), sd(5, 13, 0)]);
        a.label("loop");
        a.ws(&[WFI, addi(19, 19, 1)]);
        a.jal(0, "loop");
        let masked = a.finish();
        let mut plain = paced_idle_machine(&masked, 10, turbo);
        let mut opted = paced_idle_machine(&masked, 10, turbo);
        opted.set_paced_idle_policy(true, Some(50_000_000));
        // The first call enters the `wfi`'s block itself, so it has seen the devices idle and
        // would be entitled to report a wait if there were one to report.
        for budget in [500u64, 1, 9, 3] {
            let (mut ta, mut tb) = (HashSink::new(), HashSink::new());
            let oa = plain.run_traced(budget, &mut ta);
            let ob = opted.run_traced(budget, &mut tb);
            assert_eq!(
                observe(&plain, &ta, oa),
                observe(&opted, &tb, ob),
                "masked timer, budget {budget}"
            );
            assert_eq!(opted.take_idle_wait_nanos(), None);
        }
        assert!(x(&opted, 19) > 100, "it spun");

        // Wall clock: mtime is the host's; `wfi` never jumps and never reports.
        let host = HostClock::default();
        host.now.set(1_000_000_000);
        let mut wall = paced_idle_machine(&image, 10, turbo);
        wall.set_wall_clock(
            alloc::boxed::Box::new(host.clone()),
            time::WallClockPolicy::DEFAULT,
        );
        wall.set_paced_idle_policy(true, Some(50_000_000));
        assert_eq!(wall.run(2_000), RunOutcome::MaxInstrs);
        assert_eq!(wall.irq_stats().retired, 2_000);
        assert_eq!(wall.take_idle_wait_nanos(), None);
    }
}

/// A host wake that is still outstanding (here a key the host has pressed and not released —
/// the guard that stops a short physical press from turning into a long guest key hold) keeps
/// the idle jump from happening at all, so no wait is reported and the run call is not cut
/// short: sleeping on the guest's timer would be wrong while the host owes it an event.
#[test]
fn paced_idle_yield_stays_out_while_a_host_wake_is_outstanding() {
    let image = paced_idle_image(2000, 0, 100, 0);
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(5_000_000_000);
        let mut m = paced_idle_machine(&image, 64, turbo);
        m.enable_plic();
        m.enable_virtio_slots(None);
        let (_, keyboard, _) = m.enable_virtio_keyboard();
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, Some(50_000_000));
        // EV_KEY, KEY_A, pressed; staged, never released, and no driver takes it.
        assert!(keyboard.borrow_mut().inject_event(1, 30, 1));
        assert!(keyboard.borrow().awaiting_host_key_release());
        let reads = host.reads.get();
        assert_eq!(m.run(20_000), RunOutcome::MaxInstrs);
        assert_eq!(
            m.irq_stats().retired,
            20_000,
            "turbo={turbo}: the budget was used"
        );
        assert!(m.irq_stats().wfi > 1_000);
        assert_eq!(m.take_idle_wait_nanos(), None);
        assert_eq!(host.reads.get(), reads, "the pacer was never consulted");
        assert_eq!(x(&m, 31), 0);
    }
}

/// "The retire stream is unchanged; only where a host call ends moves": the same guest, with
/// timer interrupts taken out of `wfi`, run to its poweroff (a) in one call without the opt-in
/// and (b) with it, as however many calls it takes — with every budget pattern making the budget
/// expire around the waiting `wfi` too. Both consult the host clock once per `wfi`, so they see
/// the same host times; everything observable must match, with the turbo loop on and off.
#[test]
fn paced_idle_yield_leaves_the_retire_stream_unchanged() {
    let mut yields = 0u64;
    for (first, rearm, stop) in [(300, 170, 40), (37, 37, 60), (5000, 1, 25)] {
        let image = paced_idle_image(first, rearm, stop, 50);
        for div in [1u64, 10, 64] {
            // Host steps per reading, in ticks: slower than, about, and faster than the deadlines.
            for step_ticks in [7u64, 90, 1_000] {
                for lag in [None, Some(50_000u64), Some(0)] {
                    let build = |turbo: bool, yield_to_host: bool| {
                        let mut m = paced_idle_machine(&image, div, turbo);
                        m.set_paced_idle_policy(yield_to_host, lag);
                        m.set_paced_icount_clock(alloc::boxed::Box::new(StepClock {
                            now: core::cell::Cell::new(123_456),
                            step: step_ticks * NS_PER_TICK,
                        }))
                        .unwrap();
                        m
                    };
                    // Control: no opt-in, ordinary loop, one call.
                    let mut control = build(false, false);
                    let mut tc = HashSink::new();
                    let oc = control.run_traced(50_000_000, &mut tc);
                    let want = observe(&control, &tc, oc);
                    assert!(powered_off(&control), "the control runs to its poweroff");
                    assert_eq!(x(&control, 31), stop as u64);
                    let label = alloc::format!(
                        "first={first} rearm={rearm} div={div} step={step_ticks} lag={lag:?}"
                    );
                    for turbo in [false, true] {
                        for budgets in [&[50_000_000u64][..], &[1, 2, 3, 5], &[4, 4, 9, 1, 64]] {
                            let mut m = build(turbo, true);
                            let mut t = HashSink::new();
                            let mut calls = 0usize;
                            let outcome = loop {
                                let budget = budgets[calls % budgets.len()];
                                let before = m.irq_stats().retired;
                                let ints: u64 = m.irq_stats().int.iter().sum();
                                let o = m.run_traced(budget, &mut t);
                                calls += 1;
                                let ran = m.irq_stats().retired - before;
                                if let Some(wait) = m.take_idle_wait_nanos() {
                                    yields += 1;
                                    assert!(
                                        wait >= NS_PER_TICK,
                                        "{label}: a wait is at least a tick"
                                    );
                                    assert!(!m.hart.last_was_wfi && ran >= 1);
                                    assert_eq!(o, RunOutcome::MaxInstrs);
                                } else if o == RunOutcome::MaxInstrs {
                                    // A taken interrupt uses a work slot without retiring.
                                    let taken: u64 = m.irq_stats().int.iter().sum::<u64>() - ints;
                                    assert_eq!(
                                        ran + taken,
                                        budget,
                                        "{label}: early return without a wait"
                                    );
                                }
                                if o != RunOutcome::MaxInstrs {
                                    break o;
                                }
                                assert!(calls < 2_000_000, "{label}: no progress");
                            };
                            assert_eq!(
                                observe(&m, &t, outcome),
                                want,
                                "{label} turbo={turbo} budgets={budgets:?}"
                            );
                            assert_eq!(
                                m.save_resume().unwrap(),
                                control.save_resume().unwrap(),
                                "{label} turbo={turbo}: resume bytes"
                            );
                            assert!(
                                m.bus.ram().as_bytes() == control.bus.ram().as_bytes(),
                                "{label} turbo={turbo}: RAM"
                            );
                        }
                    }
                }
            }
        }
    }
    assert!(yields > 5_000, "the yield path was exercised: {yields}");
}

/// Machine level: after a busy stretch during which the host ran far ahead, the next idle jump
/// moves guest time by exactly the bound; idle-loop passes after that move it by the host's
/// elapsed time in full; without a bound the busy guest catches up completely.
#[test]
fn paced_idle_busy_lag_bound_applies_after_work_and_never_while_waiting() {
    // 2000 passes of a 4-instruction loop: 8,000 busy instructions before the first `wfi`.
    let image = paced_idle_image(2000, 0, 100, 2000);
    const FAR: u64 = 1 << 40;
    const HOST_LEAD_NS: u64 = 10_000_000_000;
    const LAG_NS: u64 = 50_000_000;
    let ticks = |ns: u64| ns / NS_PER_TICK;
    for turbo in [false, true] {
        for bound in [Some(LAG_NS), Some(0), None] {
            let label = alloc::format!("turbo={turbo} bound={bound:?}");
            let host = HostClock::default();
            host.now.set(1_000_000_000);
            // Divider 1: guest time advances exactly one tick per retirement.
            let mut m = paced_idle_machine(&image, 1, turbo);
            m.set_paced_idle_policy(true, bound);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            // Run the busy stretch up to the block that ends in the first `wfi` (`addi; wfi`): the
            // run call that executes the `wfi` must enter its block, because a wait is reported
            // only by a call that has seen the devices idle at a boundary of its own.
            while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc + 4).unwrap() != WFI {
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            }
            assert!(m.irq_stats().retired > IDLE_SPIN_INSTRS, "{label}");
            assert_eq!(m.irq_stats().wfi, 0);
            assert_eq!(
                host.reads.get(),
                1,
                "{label}: read at selection only, never while busy"
            );
            // Put the deadline out of reach, and let the host have run 10 s ahead meanwhile.
            let before = m.clint.as_ref().unwrap().borrow().mtime;
            m.clint.as_ref().unwrap().borrow_mut().mtimecmp = before + FAR;
            host.now.set(host.now.get() + HOST_LEAD_NS);

            // The `wfi` after the work: the guest fell 10 s behind and may skip only the bound.
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(
                m.irq_stats().wfi,
                1,
                "{label}: the run ended at the waiting wfi"
            );
            let after = m.clint.as_ref().unwrap().borrow().mtime;
            let current = before + 2; // the `addi` and the wfi's own retirement
            let wait = m.take_idle_wait_nanos().expect("still waiting");
            match bound {
                Some(ns) => {
                    assert_eq!(after, current + ticks(ns), "{label}: exactly the bound");
                    assert_eq!(wait, (before + FAR - after) * NS_PER_TICK, "{label}");
                }
                None => {
                    assert_eq!(
                        after,
                        ticks(HOST_LEAD_NS),
                        "{label}: the whole 10 s (anchor 0)"
                    );
                    assert_eq!(wait, (before + FAR - after) * NS_PER_TICK, "{label}");
                }
            }

            // Three seconds of host time while the guest only waits: one idle pass, and guest
            // time moves by exactly three seconds, bound or no bound.
            host.now.set(host.now.get() + 3_000_000_000);
            let retired = m.irq_stats().retired;
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(
                m.irq_stats().retired,
                retired + 3,
                "{label}: addi, jal, wfi"
            );
            let later = m.clint.as_ref().unwrap().borrow().mtime;
            assert_eq!(
                later,
                after + ticks(3_000_000_000),
                "{label}: waiting time in full"
            );
            assert_eq!(
                m.take_idle_wait_nanos(),
                Some((before + FAR - later) * NS_PER_TICK),
                "{label}"
            );

            // A hundred more idle passes with the host stepping 80 ms each time (more than the
            // bound): none of it is lost.
            for _ in 0..100 {
                host.now.set(host.now.get() + 80_000_000);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            }
            let end = m.clint.as_ref().unwrap().borrow().mtime;
            assert_eq!(
                end,
                later + 100 * ticks(80_000_000),
                "{label}: 8 s in 80 ms sleeps"
            );
            assert_eq!(x(&m, 31), 0, "{label}: the far deadline was never reached");
        }
    }
}

// ── E5-T37a round 2 (after the verifier's refutation): what wakes a waiting guest, waits that
//    stop holding, and the cases the first seven tests left unpinned. ──

/// M-mode guest for the wake tests: timer and software interrupts enabled, the timer armed
/// `first` ticks out (a 32-bit value), then `loop: wfi; x19 += 1; j loop`. The handler records
/// `mtime` as its very first act (x27), counts in x26 (software) or x31 (timer), clears `msip`,
/// re-arms the timer `rearm` ticks out when it was the timer, runs `work` passes of a
/// three-instruction loop and returns. `pad` extra `addi`s sit between the `wfi` and the jump.
fn paced_wake_image(first: u32, rearm: u32, work: i32, pad: usize) -> Vec<u8> {
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, first));
    a.ws(&li32(21, rearm));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.label("loop");
    a.w(WFI);
    a.w(addi(19, 19, 1));
    for _ in 0..pad {
        a.w(addi(18, 18, 1));
    }
    a.jal(0, "loop");
    a.org(BASE + 0x4000);
    a.label("handler");
    a.ws(&[ld(27, 14, 0), csrrs(28, MCAUSE, 0), andi(28, 28, 0xF)]);
    a.w(addi(29, 0, 3));
    a.branch(BEQ, 28, 29, "soft");
    a.ws(&[addi(31, 31, 1), ld(5, 14, 0), add(5, 5, 21), sd(5, 13, 0)]);
    a.jal(0, "work");
    a.label("soft");
    a.ws(&[sw(0, 12, 0), addi(26, 26, 1)]);
    a.label("work");
    a.w(addi(9, 0, work));
    a.branch(BEQ, 9, 0, "done");
    a.label("spin");
    a.ws(&[addi(15, 15, 3), xor(16, 16, 15), addi(9, 9, -1)]);
    a.branch(BNE, 9, 0, "spin");
    a.label("done");
    a.w(MRET);
    a.finish()
}

fn mtime_of(m: &Machine) -> u64 {
    m.clint.as_ref().unwrap().borrow().mtime
}

/// The host sleeps on a reported wait and an event for the guest ends the sleep. The time the
/// guest spent waiting is on its clock when the handler starts — not later, and not lost to
/// the busy-lag bound however much the handler then runs.
#[test]
fn paced_idle_time_slept_before_a_host_wake_is_on_the_guest_clock() {
    const SLEPT_NS: u64 = 5_000_000_000;
    for turbo in [false, true] {
        for div in [1u64, 10, 64] {
            for work in [0, 100, 1000, 5000] {
                for bound in [Some(50_000_000u64), Some(0), None] {
                    let label =
                        alloc::format!("turbo={turbo} div={div} work={work} bound={bound:?}");
                    let host = HostClock::default();
                    host.now.set(40_000_000_000);
                    // Timer 10 s out, re-armed 100 s out.
                    let image = paced_wake_image(100_000_000, 1_000_000_000, work, 0);
                    let mut m = paced_idle_machine(&image, div, turbo);
                    m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                        .unwrap();
                    m.set_paced_idle_policy(true, bound);
                    host.now.set(host.now.get() + 1_000_000_000);
                    assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                    let wait = m.take_idle_wait_nanos().expect("idle");
                    assert!(wait > 8_000_000_000, "{label}: about 9 s to the deadline");
                    let t0 = mtime_of(&m);
                    // The host sleeps 5 s of the wait; then an event for the guest arrives.
                    host.now.set(host.now.get() + SLEPT_NS);
                    m.clint.as_ref().unwrap().borrow_mut().msip = true;
                    assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                    assert_eq!(x(&m, 26), 1, "{label}: the software interrupt was handled");
                    assert_eq!(x(&m, 31), 0, "{label}: the timer has not fired");
                    assert_eq!(
                        x(&m, 27),
                        t0 + SLEPT_NS / NS_PER_TICK,
                        "{label}: the handler's first instruction saw the slept time"
                    );
                    let rest = m.take_idle_wait_nanos().expect("idle again");
                    let moved = mtime_of(&m) - t0;
                    assert!(
                        moved >= SLEPT_NS / NS_PER_TICK,
                        "{label}: guest time moved {moved} ticks for 5 s of host sleep"
                    );
                    assert!(
                        rest <= wait - SLEPT_NS,
                        "{label}: the wait shrank by the sleep"
                    );
                }
            }
        }
    }
}

/// The host oversleeps a wait (a throttled timer, a suspended laptop) and nothing but the
/// guest's own timer wakes it. The deadline is taken on time in guest terms; the time slept
/// past it was still waiting time and reaches the guest clock at its next idle jump, whatever
/// the handler did in between.
#[test]
fn paced_idle_time_a_host_overslept_is_kept() {
    const OVER_NS: u64 = 2_000_000_000;
    for turbo in [false, true] {
        for work in [0, 100, 1000, 5000] {
            for bound in [Some(50_000_000u64), Some(0), None] {
                let label = alloc::format!("turbo={turbo} work={work} bound={bound:?}");
                let host = HostClock::default();
                host.now.set(40_000_000_000);
                let image = paced_wake_image(20_000, 1_000_000_000, work, 0);
                let mut m = paced_idle_machine(&image, 10, turbo);
                m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                    .unwrap();
                m.set_paced_idle_policy(true, bound);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                let wait = m.take_idle_wait_nanos().expect("idle");
                let deadline = m.clint.as_ref().unwrap().borrow().mtimecmp;
                host.now.set(host.now.get() + wait + OVER_NS);
                assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
                assert_eq!(x(&m, 31), 1, "{label}: the timer interrupt was handled");
                assert_eq!(
                    x(&m, 27),
                    deadline,
                    "{label}: taken at its deadline in guest time"
                );
                assert!(m.take_idle_wait_nanos().is_some(), "{label}: idle again");
                let past = mtime_of(&m) - deadline;
                assert!(
                    past >= OVER_NS / NS_PER_TICK,
                    "{label}: guest time is {past} ticks past the deadline for 2 s overslept"
                );
            }
        }
    }
}

/// A recorded wait describes one guest under one clock. Selecting another clock or policy, or
/// restoring another guest, drops it; rebasing the host anchor is reflected in it.
#[test]
fn paced_idle_wait_does_not_outlive_a_clock_change_or_a_restore() {
    let image = paced_idle_image(2000, 0, 100, 500);
    for turbo in [false, true] {
        let build = || {
            let host = HostClock::default();
            host.now.set(2_000_000_000);
            // Divider 1: retire-derived guest time runs ahead of the standing host clock.
            let mut m = paced_idle_machine(&image, 1, turbo);
            let blob = m.save_resume().unwrap();
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, None);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            (m, host, blob)
        };
        let (mut m, _, _) = build();
        let wait = m.take_idle_wait_nanos().expect("the control has a wait");
        assert_eq!(
            wait,
            m.clint.as_ref().unwrap().borrow().mtimecmp * NS_PER_TICK
        );

        let (mut m, _, _) = build();
        m.set_icount_clock();
        assert_eq!(m.take_idle_wait_nanos(), None, "turbo={turbo}: pure ICount");
        let (mut m, host, _) = build();
        m.set_wall_clock(
            alloc::boxed::Box::new(host.clone()),
            time::WallClockPolicy::DEFAULT,
        );
        assert_eq!(m.take_idle_wait_nanos(), None, "turbo={turbo}: wall clock");
        let (mut m, host, _) = build();
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        assert_eq!(
            m.take_idle_wait_nanos(),
            None,
            "turbo={turbo}: clock re-selected"
        );
        for (yield_to_host, lag) in [(true, None), (true, Some(7)), (false, None)] {
            let (mut m, _, _) = build();
            m.set_paced_idle_policy(yield_to_host, lag);
            assert_eq!(
                m.take_idle_wait_nanos(),
                None,
                "turbo={turbo}: policy re-selected"
            );
        }
        let (mut m, _, blob) = build();
        m.load_resume(&blob).unwrap();
        assert_eq!(m.hart.regs.pc, BASE);
        assert_eq!(
            m.take_idle_wait_nanos(),
            None,
            "turbo={turbo}: another guest restored"
        );
        // A rebase moves the pacer's ceiling to the guest's own time: the distance follows.
        let (mut m, _, _) = build();
        let (mtime, cmp) = {
            let c = m.clint.as_ref().unwrap().borrow();
            (c.mtime, c.mtimecmp)
        };
        assert!(mtime > 1_000, "the guest ran ahead of the host clock");
        m.rebase_guest_clock();
        assert_eq!(
            m.take_idle_wait_nanos(),
            Some((cmp - mtime) * NS_PER_TICK),
            "turbo={turbo}: after a rebase"
        );
    }
}

/// No wait is recorded when the `wfi`'s wake condition is met by something its stale `mip`
/// did not show: a software interrupt raised earlier in the `wfi`'s own block (levels are
/// sampled at block boundaries only), or a device touched in that block, whose service at the
/// next boundary may raise an interrupt. The guest goes straight on within the same run call.
#[test]
fn paced_idle_no_wait_while_an_interrupt_is_deliverable_or_a_device_was_touched() {
    // (a) `sw 1, msip; wfi` in one block, software interrupt enabled.
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]);
    a.w(addi(4, 0, 1));
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.ws(&[sw(4, 12, 0), WFI]);
    a.label("loop");
    a.ws(&[addi(19, 19, 1), WFI]);
    a.jal(0, "loop");
    a.org(BASE + 0x400);
    a.label("handler");
    a.ws(&[sw(0, 12, 0), addi(26, 26, 1), MRET]);
    let image = a.finish();
    for turbo in [false, true] {
        for budget in [1_000_000u64, 1] {
            let host = HostClock::default();
            host.now.set(5_000_000_000);
            let mut m = paced_idle_machine(&image, 10, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, None);
            // Run until the first `wfi` has retired, one call per `budget`.
            let mut wait = None;
            while m.irq_stats().wfi == 0 {
                assert_eq!(m.run(budget), RunOutcome::MaxInstrs);
                wait = m.take_idle_wait_nanos();
            }
            let label = alloc::format!("turbo={turbo} budget={budget}");
            if budget == 1 {
                // The call ended on the `wfi` itself, the interrupt not yet taken.
                assert_eq!(x(&m, 26), 0);
                assert!(m.clint.as_ref().unwrap().borrow().msip, "{label}");
                assert_eq!(wait, None, "{label}: a wait with an interrupt deliverable");
                let reads = host.reads.get();
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
                assert_eq!(
                    m.irq_stats().int.iter().sum::<u64>(),
                    1,
                    "{label}: taken at once"
                );
                assert_eq!(
                    host.reads.get(),
                    reads,
                    "{label}: no wake accounting: nobody slept"
                );
            } else {
                // The same call went on: the interrupt was taken, the handler ran, and the wait
                // that ended the call is the second `wfi`'s, with the timer 10 s away.
                assert_eq!(x(&m, 26), 1, "{label}: handled within the call");
                assert_eq!(m.irq_stats().wfi, 2, "{label}");
                assert!(
                    wait.is_some_and(|ns| ns > 9_000_000_000),
                    "{label}: {wait:?}"
                );
                // The host clock was read when the clock was selected and once per `wfi`: the
                // guest that went straight on had not slept, so no wake was accounted for.
                assert_eq!(host.reads.get(), 3, "{label}");
            }
        }
    }

    // (b) A device (the UART's scratch register) written in the `wfi`'s own block.
    let mut a = Asm::new();
    a.la_label(6, "handler");
    a.w(csrrw(0, MTVEC, 6));
    a.la(11, UART);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]);
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.ws(&[sb(4, 11, 7), WFI]);
    a.label("loop");
    a.ws(&[addi(19, 19, 1), WFI]);
    a.jal(0, "loop");
    a.org(BASE + 0x400);
    a.label("handler");
    a.w(MRET);
    let image = a.finish();
    for turbo in [false, true] {
        let cfg = Cfg {
            uart: true,
            ..Cfg::m_mode(10)
        };
        let run_to_first_wait = |yield_to_host: bool| {
            let host = HostClock::default();
            host.now.set(5_000_000_000);
            let mut m = machine(&cfg, &image, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(yield_to_host, None);
            assert_eq!(m.run(60), RunOutcome::MaxInstrs);
            m
        };
        let mut m = run_to_first_wait(true);
        assert_eq!(
            m.irq_stats().wfi,
            2,
            "turbo={turbo}: not at the wfi after the device write"
        );
        assert_eq!(x(&m, 19), 1);
        assert!(
            m.take_idle_wait_nanos().is_some(),
            "turbo={turbo}: at the next one"
        );
        // The device write is what holds the first wait back: without it the first `wfi` yields.
        let control = run_to_first_wait(false);
        assert_eq!(
            control.irq_stats().retired,
            60,
            "the control spins through its budget"
        );
    }
}

/// The line between a guest that only went round its idle loop and one that worked is
/// `IDLE_SPIN_INSTRS` retirements between two consultations, exactly: at the threshold the
/// host time in between is waiting time (kept in full); one more and it is busy time (bounded).
#[test]
fn paced_idle_spin_threshold_is_exact() {
    for turbo in [false, true] {
        // One pass is `wfi`, `addi x19`, `pad` more `addi`s and the `jal`: pad + 3 retirements.
        for (pad, worked) in [
            (IDLE_SPIN_INSTRS as usize - 4, false), // 2047
            (IDLE_SPIN_INSTRS as usize - 3, false), // 2048: still waiting
            (IDLE_SPIN_INSTRS as usize - 2, true),  // 2049: worked
        ] {
            let label = alloc::format!("turbo={turbo} pass={} retirements", pad + 3);
            let host = HostClock::default();
            host.now.set(1_000_000_000);
            let image = paced_wake_image(1_000_000_000, 1_000_000_000, 0, pad);
            let mut m = paced_idle_machine(&image, 64, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, Some(0));
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert!(
                m.take_idle_wait_nanos().is_some(),
                "{label}: at the first wfi"
            );
            let (t0, r0) = (mtime_of(&m), m.irq_stats().retired);
            // One second of host time, then exactly one pass of the idle loop.
            host.now.set(host.now.get() + 1_000_000_000);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(m.irq_stats().retired - r0, pad as u64 + 3, "{label}");
            let moved = mtime_of(&m) - t0;
            if worked {
                assert!(
                    moved < 100,
                    "{label}: busy time, bound 0: moved {moved} ticks"
                );
            } else {
                assert!(
                    moved >= 10_000_000,
                    "{label}: waiting time in full: moved {moved} ticks"
                );
            }
        }
    }
}

/// The policy and the clock can be selected in either order and at any point of a run: the
/// bound reaches a pacer that already exists, and selecting the clock starts a new interval for
/// the worked/waited decision.
#[test]
fn paced_idle_policy_and_clock_in_either_order_and_mid_run() {
    const FAR: u64 = 1 << 40;
    let image = paced_idle_image(2000, 0, 100, 2000);
    for turbo in [false, true] {
        // (a) The bound handed to an existing pacer: clock first, then a zero bound.
        for policy_first in [false, true] {
            let host = HostClock::default();
            host.now.set(1_000_000_000);
            let mut m = paced_idle_machine(&image, 1, turbo);
            if policy_first {
                m.set_paced_idle_policy(true, Some(0));
                m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                    .unwrap();
            } else {
                m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                    .unwrap();
                m.set_paced_idle_policy(true, Some(0));
            }
            while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc + 4).unwrap() != WFI {
                assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            }
            let before = mtime_of(&m);
            m.clint.as_ref().unwrap().borrow_mut().mtimecmp = before + FAR;
            host.now.set(host.now.get() + 10_000_000_000);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(
                m.irq_stats().wfi,
                1,
                "turbo={turbo}: stopped at the first wfi"
            );
            assert_eq!(
                mtime_of(&m),
                before + 2,
                "turbo={turbo} policy_first={policy_first}: a zero bound after 8,000 busy instructions"
            );
        }
        // (b) The clock selected after the busy stretch: the stretch before the selection is
        // not the pacer's business, so the first consultation counts as waiting and the host
        // time since the selection is kept in full even with a zero bound.
        let host = HostClock::default();
        host.now.set(1_000_000_000);
        let mut m = paced_idle_machine(&image, 1, turbo);
        m.set_paced_idle_policy(true, Some(0));
        while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc + 4).unwrap() != WFI {
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        }
        assert!(m.irq_stats().retired > IDLE_SPIN_INSTRS);
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        let before = mtime_of(&m);
        m.clint.as_ref().unwrap().borrow_mut().mtimecmp = before + FAR;
        host.now.set(host.now.get() + 3_000_000_000);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(
            mtime_of(&m),
            before + 30_000_000,
            "turbo={turbo}: three seconds since the clock was selected"
        );
    }
}

/// A waiting guest can also be woken without a trap: an enabled interrupt becomes pending while
/// interrupts are globally masked, and the `wfi` simply returns. The slept time is on the clock
/// — and in the `time` CSR the guest reads next — before its next instruction runs.
#[test]
fn paced_idle_wake_without_a_trap_updates_the_time_the_guest_reads() {
    const SLEPT_NS: u64 = 5_000_000_000;
    let mut a = Asm::new();
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 1_000_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    // MSIE and MTIE on in `mie`; `mstatus.MIE` stays off, so nothing is ever taken.
    a.ws(&[addi(7, 0, 0x88), csrrs(0, MIE, 7)]);
    a.w(WFI);
    a.ws(&[csrrs(25, TIME, 0), ld(27, 14, 0), addi(19, 19, 1)]);
    a.w(JDOT);
    let image = a.finish();
    for turbo in [false, true] {
        for bound in [Some(50_000_000u64), None] {
            let label = alloc::format!("turbo={turbo} bound={bound:?}");
            let host = HostClock::default();
            host.now.set(40_000_000_000);
            let mut m = paced_idle_machine(&image, 10, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, bound);
            host.now.set(host.now.get() + 1_000_000_000);
            assert_eq!(m.run(1_000), RunOutcome::MaxInstrs);
            assert!(m.take_idle_wait_nanos().is_some(), "{label}: waiting");
            let t0 = mtime_of(&m);
            host.now.set(host.now.get() + SLEPT_NS);
            m.clint.as_ref().unwrap().borrow_mut().msip = true;
            assert_eq!(m.run(3), RunOutcome::MaxInstrs);
            assert_eq!(x(&m, 19), 1, "{label}: the guest went on past the wfi");
            assert_eq!(m.irq_stats().int.iter().sum::<u64>(), 0, "{label}: no trap");
            let slept = SLEPT_NS / NS_PER_TICK;
            assert_eq!(
                x(&m, 25),
                t0 + slept,
                "{label}: the time CSR at the next instruction"
            );
            assert!(x(&m, 27) >= t0 + slept, "{label}: and the CLINT register");
        }
    }
}

/// The wake accounting belongs to a wait the host took. A host that ignores the reported wait
/// and simply calls again was not asleep on the guest's behalf: an interrupt it raises is taken
/// with the guest's clock where the guest left it, and the host clock is not read for it.
#[test]
fn paced_idle_wake_is_only_accounted_for_a_wait_the_host_took() {
    for turbo in [false, true] {
        for taken in [true, false] {
            let label = alloc::format!("turbo={turbo} taken={taken}");
            let host = HostClock::default();
            host.now.set(40_000_000_000);
            let image = paced_wake_image(100_000_000, 1_000_000_000, 0, 0);
            let mut m = paced_idle_machine(&image, 10, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, Some(50_000_000));
            // A second of host time first, so the guest's clock is the host's, not its own
            // few retirements ahead of it.
            host.now.set(host.now.get() + 1_000_000_000);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            if taken {
                assert!(m.take_idle_wait_nanos().is_some());
            }
            let (t0, reads) = (mtime_of(&m), host.reads.get());
            host.now.set(host.now.get() + 5_000_000_000);
            m.clint.as_ref().unwrap().borrow_mut().msip = true;
            // One work slot: the interrupt is taken; the handler has not run yet.
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            assert_eq!(m.irq_stats().int.iter().sum::<u64>(), 1, "{label}");
            if taken {
                assert_eq!(
                    host.reads.get(),
                    reads + 1,
                    "{label}: one reading for the wake"
                );
                assert_eq!(mtime_of(&m), t0 + 50_000_000, "{label}: five seconds slept");
            } else {
                assert_eq!(host.reads.get(), reads, "{label}: no reading");
                assert_eq!(
                    mtime_of(&m),
                    t0,
                    "{label}: the clock is where the guest left it"
                );
            }
        }
    }
}

// ── E5-T37a round 3 (after the second refutation): a wait needs every device idle and no
//    enabled interrupt pending per ALL the levels a boundary samples; wake accounting survives
//    a rebase; the round-2 mutants the verifier's tests caught and mine did not. ──

const PLIC: u64 = bus::mmap::PLIC_BASE;
const RTC: u64 = platform::virt::RTC_BASE;
const MIP: u32 = 0x344;

struct FixedWall(u64);
impl dev::rtc::WallClock for FixedWall {
    fn now_ns(&self) -> u64 {
        self.0
    }
}

/// `fresh_mip` is `mip` as the boundary's level sync leaves it, for every combination of the
/// five levels it samples, with and without the built-in SBI timer — and computing it changes
/// nothing.
#[test]
fn paced_idle_fresh_mip_is_what_the_boundary_sync_writes() {
    let image = paced_idle_image(2000, 0, 100, 0);
    for sbi in [false, true] {
        let cfg = Cfg {
            uart: true,
            ..Cfg::m_mode(10)
        };
        let mut m = machine(&cfg, &image, false);
        if sbi {
            m.enable_builtin_sbi();
        }
        let plic = alloc::rc::Rc::clone(m.plic.as_ref().unwrap());
        let line = dev::plic::Plic::irq_line(&plic, 5);
        crate::bus::Bus::store32(&mut m.bus, PLIC + 4 * 5, 1).unwrap(); // priority[5]
        let mut seen = [[false; 2]; 12];
        // Twice round, so every case also starts from every other case's stale bits.
        for case in (0..32u32).chain((0..32).rev()) {
            let on = |bit: u32| case >> bit & 1 != 0;
            {
                let mut c = m.clint.as_ref().unwrap().borrow_mut();
                c.msip = on(0);
                c.mtime = 1_000;
                c.mtimecmp = if on(1) { 1_000 } else { 1_001 };
            }
            m.sbi_state.stimecmp = if on(2) { 999 } else { u64::MAX };
            line.set(on(3) || on(4));
            crate::bus::Bus::store32(&mut m.bus, PLIC + 0x2000, u32::from(on(3)) << 5).unwrap();
            crate::bus::Bus::store32(&mut m.bus, PLIC + 0x2080, u32::from(on(4)) << 5).unwrap();
            let stale = m.hart.csr.mip_bits();
            let predicted = m.fresh_mip();
            assert_eq!(m.hart.csr.mip_bits(), stale, "computing it changes nothing");
            m.sync_clint();
            m.sync_plic();
            m.sync_sbi_timer();
            assert_eq!(
                m.hart.csr.mip_bits(),
                predicted,
                "sbi={sbi} case={case:05b} stale={stale:#x}"
            );
            for bit in [3usize, 5, 7, 9, 11] {
                seen[bit][(predicted >> bit & 1) as usize] = true;
            }
        }
        for bit in [3usize, 7, 9, 11] {
            assert_eq!(
                seen[bit],
                [true, true],
                "sbi={sbi}: bit {bit} was both clear and set"
            );
        }
        assert_eq!(
            seen[5],
            [true, sbi],
            "STIP is a level only with the built-in SBI timer"
        );
    }
}

/// A wait holds only while every device is idle. An armed RTC alarm is device work on a
/// schedule the CLINT knows nothing about: no wait is reported while it is armed, the guest
/// goes round its idle loop as it always has, and once it is cleared the next `wfi` waits.
#[test]
fn paced_idle_no_wait_while_a_device_has_work() {
    let image = paced_idle_image(2000, 0, 100, 0);
    let cfg = Cfg {
        uart: true,
        ..Cfg::m_mode(10)
    };
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(5_000_000_000);
        let mut m = machine(&cfg, &image, turbo);
        m.enable_rtc(alloc::boxed::Box::new(FixedWall(1_000_000)));
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, Some(50_000_000));
        // Control point: with no alarm the first `wfi` waits.
        assert_eq!(m.run(10_000), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1, "turbo={turbo}");
        assert!(m.take_idle_wait_nanos().is_some());
        // The host arms the alarm far ahead (interrupt disabled: it will never fire here).
        crate::bus::Bus::store32(&mut m.bus, RTC + 0x0c, 1).unwrap(); // ALARM_HIGH
        crate::bus::Bus::store32(&mut m.bus, RTC + 0x08, 0).unwrap(); // ALARM_LOW arms
        let retired = m.irq_stats().retired;
        for _ in 0..3 {
            assert_eq!(m.run(900), RunOutcome::MaxInstrs);
            assert_eq!(
                m.take_idle_wait_nanos(),
                None,
                "turbo={turbo}: a device has work"
            );
        }
        assert_eq!(
            m.irq_stats().retired,
            retired + 2_700,
            "turbo={turbo}: every budget used"
        );
        assert!(m.irq_stats().wfi > 800, "turbo={turbo}: it spun on wfi");
        // Alarm cleared: the next run call sees the devices idle again and waits.
        crate::bus::Bus::store32(&mut m.bus, RTC + 0x14, 1).unwrap(); // CLEAR_ALARM
        let wfis = m.irq_stats().wfi;
        assert_eq!(m.run(10_000), RunOutcome::MaxInstrs);
        assert!(
            m.irq_stats().wfi - wfis <= 2,
            "turbo={turbo}: stopped at once"
        );
        assert!(m.take_idle_wait_nanos().is_some(), "turbo={turbo}");
    }
}

/// A run call reports a wait only if it has itself serviced the devices at a block boundary
/// since it started — it cannot vouch for them otherwise (the host may have delivered
/// something between calls). A call that begins on the `wfi`, inside its block, goes on: the
/// wait is picked up one pass of the idle loop later, and the guest's instructions are the same.
#[test]
fn paced_idle_a_call_that_begins_inside_the_wfi_block_reports_one_pass_later() {
    let image = paced_idle_image(2000, 0, 100, 0);
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(5_000_000_000);
        let mut m = paced_idle_machine(&image, 10, turbo);
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, None);
        // One work slot at a time up to the first `wfi`, which is the second op of its block.
        while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc).unwrap() != WFI {
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            assert_eq!(m.take_idle_wait_nanos(), None);
        }
        assert!(
            resume_point(&m).is_some(),
            "the next call starts inside a block"
        );
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1);
        assert_eq!(
            m.take_idle_wait_nanos(),
            None,
            "turbo={turbo}: not vouched for"
        );
        // The same from a longer call: on past the first `wfi`, stopped at the second.
        let retired = m.irq_stats().retired;
        assert_eq!(m.run(10_000), RunOutcome::MaxInstrs);
        assert_eq!(
            m.irq_stats().retired,
            retired + 3,
            "turbo={turbo}: addi, jal, wfi"
        );
        assert_eq!(m.irq_stats().wfi, 2);
        assert!(m.take_idle_wait_nanos().is_some());
    }
}

/// An interrupt that is pending but not enabled does not end a wait: the `wfi` cannot wake on
/// it. (`sw 1, msip; wfi` in one block, with only the timer enabled.)
#[test]
fn paced_idle_a_disabled_interrupt_does_not_end_the_wait() {
    let mut a = Asm::new();
    a.la(12, CLINT);
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 100_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.ws(&[addi(7, 0, 0x80), csrrs(0, MIE, 7)]); // MTIE only
    a.w(addi(4, 0, 1));
    a.ws(&[addi(7, 0, 0x8), csrrs(0, MSTATUS, 7)]);
    a.ws(&[sw(4, 12, 0), WFI]);
    a.w(JDOT);
    let image = a.finish();
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(5_000_000_000);
        let mut m = paced_idle_machine(&image, 10, turbo);
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, None);
        assert_eq!(m.run(10_000), RunOutcome::MaxInstrs);
        assert!(m.clint.as_ref().unwrap().borrow().msip);
        assert_eq!(
            m.irq_stats().wfi,
            1,
            "turbo={turbo}: the call ended on the wfi"
        );
        assert!(m.irq_stats().retired < 100);
        assert!(
            m.take_idle_wait_nanos()
                .is_some_and(|ns| ns > 9_000_000_000)
        );
    }
}

/// The CLINT timer coming due inside the `wfi`'s own block, with another deadline (the SBI
/// timer's) still ahead: `mip` does not show MTIP yet, the idle jump aims at the far deadline,
/// and the wait must still not be reported — the machine timer interrupt is deliverable.
#[test]
fn paced_idle_no_wait_when_the_machine_timer_came_due_inside_the_wfi_block() {
    let mut a = Asm::new();
    a.ws(&[addi(7, 0, 0xA0), csrrs(0, MIE, 7)]); // MTIE | STIE
    a.ws(&[addi(15, 15, 1), addi(15, 15, 1), addi(15, 15, 1), WFI]);
    a.w(JDOT);
    let image = a.finish();
    for turbo in [false, true] {
        for due in [true, false] {
            let host = HostClock::default();
            host.now.set(5_000_000_000);
            let mut m = paced_idle_machine(&image, 1, turbo);
            m.enable_builtin_sbi();
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, None);
            assert_eq!(m.run(2), RunOutcome::MaxInstrs); // addi, csrrs: at the block's entry
            let mtime = mtime_of(&m);
            // The machine timer comes due two retirements into the four-instruction block.
            m.clint.as_ref().unwrap().borrow_mut().mtimecmp =
                if due { mtime + 2 } else { u64::MAX };
            m.sbi_state.stimecmp = mtime + 1_000_000;
            // Exactly the block: the call's last work slot is the `wfi`.
            assert_eq!(m.run(4), RunOutcome::MaxInstrs);
            assert_eq!(m.irq_stats().wfi, 1);
            assert_eq!(m.hart.csr.mip_bits() & 0x80, 0, "mip is stale: no MTIP yet");
            let wait = m.take_idle_wait_nanos();
            assert_eq!(wait.is_some(), !due, "turbo={turbo} due={due}: {wait:?}");
        }
    }
}

/// A rebase of the host anchor between the run call that ended on a wait and the event that
/// ends the wait discards the host time before it, as a rebase always has — and the time the
/// guest waits after it is still put on its clock when it is woken.
#[test]
fn paced_idle_time_slept_after_a_rebase_is_kept() {
    for turbo in [false, true] {
        for bound in [Some(50_000_000u64), None] {
            let label = alloc::format!("turbo={turbo} bound={bound:?}");
            let host = HostClock::default();
            host.now.set(40_000_000_000);
            let image = paced_wake_image(100_000_000, 1_000_000_000, 1000, 0);
            let mut m = paced_idle_machine(&image, 10, turbo);
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, bound);
            host.now.set(host.now.get() + 1_000_000_000);
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert!(m.take_idle_wait_nanos().is_some());
            let t0 = mtime_of(&m);
            // Paused for a minute (discarded by the rebase), then five seconds asleep.
            host.now.set(host.now.get() + 60_000_000_000);
            m.rebase_guest_clock();
            host.now.set(host.now.get() + 5_000_000_000);
            m.clint.as_ref().unwrap().borrow_mut().msip = true;
            assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
            assert_eq!(x(&m, 26), 1, "{label}: handled");
            assert_eq!(
                x(&m, 27),
                t0 + 50_000_000,
                "{label}: five seconds, not sixty-five"
            );
            assert!(
                mtime_of(&m) - t0 >= 50_000_000,
                "{label}: and not lost to the bound"
            );
        }
    }
}

/// A host event ends a wait after the guest's own timer deadline has passed (the host slept
/// 5 s; the deadline was 2 s in). The wake stops the clock at the deadline — guest time never
/// jumps over an armed timer — the pending levels and the `time` the guest reads follow at
/// once, and the 3 s beyond the deadline stay owed and reach the clock at the next idle jump.
#[test]
fn paced_idle_wake_stops_at_a_deadline_inside_the_slept_interval() {
    let mut a = Asm::new();
    a.la(12, CLINT);
    a.la(14, CLINT + 0xBFF8);
    // MSIE and STIE on in `mie`; `mstatus.MIE` off: the wake is a `wfi` that simply returns.
    a.ws(&[addi(7, 0, 0x28), csrrs(0, MIE, 7)]);
    a.w(WFI);
    a.ws(&[
        csrrs(25, MIP, 0),
        ld(27, 14, 0),
        sw(0, 12, 0),
        addi(19, 19, 1),
    ]);
    a.label("idle");
    a.w(WFI);
    a.w(addi(18, 18, 1));
    a.jal(0, "idle");
    let image = a.finish();
    for turbo in [false, true] {
        for bound in [Some(50_000_000u64), None] {
            let label = alloc::format!("turbo={turbo} bound={bound:?}");
            let host = HostClock::default();
            host.now.set(40_000_000_000);
            let mut m = paced_idle_machine(&image, 10, turbo);
            m.enable_builtin_sbi();
            m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
                .unwrap();
            m.set_paced_idle_policy(true, bound);
            host.now.set(host.now.get() + 1_000_000_000);
            let deadline = 10_000_000 + 20_000_000; // 2 s after the host's first second
            m.sbi_state.stimecmp = deadline;
            assert_eq!(m.run(1_000), RunOutcome::MaxInstrs);
            assert_eq!(m.take_idle_wait_nanos(), Some(2_000_000_000), "{label}");
            // Five seconds asleep, then the host's event.
            host.now.set(host.now.get() + 5_000_000_000);
            m.clint.as_ref().unwrap().borrow_mut().msip = true;
            assert_eq!(m.run(4), RunOutcome::MaxInstrs);
            assert_eq!(x(&m, 19), 1, "{label}: the guest went on");
            assert_eq!(
                x(&m, 27),
                deadline,
                "{label}: the clock stopped at the deadline"
            );
            assert_eq!(
                x(&m, 25) & 0x28,
                0x28,
                "{label}: MSIP and STIP both pending at once"
            );
            // Idle again (the S timer is due but nothing takes it; push it far away): the three
            // seconds slept beyond the deadline are handed over, bound or no bound.
            m.sbi_state.stimecmp = 1 << 40;
            m.hart.csr.set_mip_bit(5, false);
            assert_eq!(m.run(1_000), RunOutcome::MaxInstrs);
            let now = mtime_of(&m);
            assert!(
                now >= deadline + 30_000_000 && now < deadline + 30_000_100,
                "{label}: three more seconds: {deadline} -> {now}"
            );
        }
    }
}

/// A timer the guest armed but never enabled: when the host clock reaches its deadline the
/// idle jump lands on it, nothing wakes, and from then on the guest has no deadline ahead — it
/// spins through its budget as it always has, with no early return and no wait.
#[test]
fn paced_idle_a_reached_deadline_that_wakes_nothing_does_not_end_the_run() {
    let mut a = Asm::new();
    a.la(13, CLINT + 0x4000);
    a.la(14, CLINT + 0xBFF8);
    a.ws(&li32(20, 20_000_000));
    a.ws(&[ld(5, 14, 0), add(5, 5, 20), sd(5, 13, 0)]);
    a.jal(0, "loop");
    a.label("loop");
    a.ws(&[WFI, addi(19, 19, 1)]);
    a.jal(0, "loop");
    let image = a.finish();
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(5_000_000_000);
        let mut m = paced_idle_machine(&image, 10, turbo);
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, None);
        assert_eq!(m.run(10_000), RunOutcome::MaxInstrs);
        let wait = m
            .take_idle_wait_nanos()
            .expect("the deadline is ahead: it waits");
        let deadline = m.clint.as_ref().unwrap().borrow().mtimecmp;
        // The host clock reaches the deadline exactly.
        host.now.set(host.now.get() + wait);
        let retired = m.irq_stats().retired;
        assert_eq!(m.run(5_000), RunOutcome::MaxInstrs);
        assert!(mtime_of(&m) >= deadline);
        assert_eq!(
            m.irq_stats().retired,
            retired + 5_000,
            "turbo={turbo}: no early return"
        );
        assert_eq!(m.take_idle_wait_nanos(), None);
        assert_eq!(m.irq_stats().int.iter().sum::<u64>(), 0);
    }
}

/// A restore starts a new interval for the worked/waited decision: what the replaced guest had
/// retired since the pacer was last consulted says nothing about the restored one. A guest
/// restored just short of its `wfi` reaches it within the idle-spin threshold, so the host time
/// since the restore (and the rebase a host does after one) is waiting time, kept in full even
/// with a zero bound.
#[test]
fn paced_idle_a_restore_starts_a_new_interval() {
    const FAR: u64 = 1 << 40;
    let image = paced_idle_image(2000, 0, 100, 2000);
    for turbo in [false, true] {
        let host = HostClock::default();
        host.now.set(1_000_000_000);
        let mut m = paced_idle_machine(&image, 1, turbo);
        m.set_paced_icount_clock(alloc::boxed::Box::new(host.clone()))
            .unwrap();
        m.set_paced_idle_policy(true, Some(0));
        // 8,000 busy instructions since the clock was selected, up to the `wfi`'s block.
        while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc + 4).unwrap() != WFI {
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        }
        assert!(m.irq_stats().retired > IDLE_SPIN_INSTRS);
        let before = mtime_of(&m);
        m.clint.as_ref().unwrap().borrow_mut().mtimecmp = before + FAR;
        let blob = m.save_resume().unwrap();
        m.load_resume(&blob).unwrap();
        m.rebase_guest_clock();
        host.now.set(host.now.get() + 3_000_000_000);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1, "turbo={turbo}");
        assert_eq!(
            mtime_of(&m),
            before + 30_000_000,
            "turbo={turbo}: three seconds of waiting since the restore"
        );
    }
}
