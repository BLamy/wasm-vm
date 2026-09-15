//! Independent integer-to-binary32 critic. Expectations are literal IEEE encodings
//! or constructed significand/remainder identities, never SoftFloat or float casts.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const PC: u64 = 0x4000_9c00;
pub const BOX: u64 = 0xffff_ffff_0000_0000;
pub const SENTINEL: u64 = 0x1234_5678_abcd_ef01;

#[derive(Debug)]
pub struct Receipt {
    pub cases: u64,
    pub illegal: u64,
    pub digest: u64,
}
impl Receipt {
    fn new() -> Self {
        Self {
            cases: 0,
            illegal: 0,
            digest: 0xcbf2_9ce4_8422_2325,
        }
    }
    fn record(&mut self, words: impl IntoIterator<Item = u64>) {
        for word in words {
            for byte in word.to_le_bytes() {
                self.digest = (self.digest ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
            }
        }
        self.cases += 1;
    }
}

pub fn conversion(kind: u8, rd: u8, rs: u8, rm: u8) -> u32 {
    assert!(kind < 4);
    0xd000_0053
        | (u32::from(kind) << 20)
        | (u32::from(rs) << 15)
        | (u32::from(rm) << 12)
        | (u32::from(rd) << 7)
}

pub fn block(at: u64, words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        at,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("independent conversion encoding"),
                len: 4,
                raw,
            })
            .collect(),
        words.len() as u64 * 4,
    )
}

pub fn fs(m: &mut Machine, value: u64) {
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, value << 13, false, false, 0)
        .unwrap();
}
pub fn execute(e: &mut dyn CompiledBlockExecutor, m: &mut Machine, at: u64) -> JitExit {
    let ptr: *mut Machine = m;
    let before = e.executed_blocks();
    // SAFETY: synchronous call using disjoint live components of Machine.
    let exit = unsafe { e.execute(at, (*ptr).hart_mut(), (*ptr).bus_mut()).unwrap() };
    assert_eq!(
        e.executed_blocks(),
        before + 1,
        "must execute actual generated code"
    );
    exit
}
pub fn interpreted(m: &mut Machine, raw: u32) {
    let ptr: *mut Machine = m;
    // SAFETY: synchronous reference execution using disjoint live components.
    unsafe {
        (*ptr)
            .hart_mut()
            .exec_oracle((*ptr).bus_mut(), decode(raw).unwrap(), 4, u64::from(raw))
            .unwrap();
    }
}
pub fn xregs(m: &Machine) -> [u64; 32] {
    core::array::from_fn(|r| m.hart().regs.read(r as u8))
}
pub fn fregs(m: &Machine) -> [u64; 32] {
    core::array::from_fn(|r| m.hart().fregs.read_raw(r as u8))
}

struct Golden {
    kind: u8,
    source: u64,
    result: [u32; 5],
    flags: u8,
}
const fn g(kind: u8, source: u64, result: [u32; 5], flags: u8) -> Golden {
    Golden {
        kind,
        source,
        result,
        flags,
    }
}
const POS_HALF: [u32; 5] = [
    0x4b80_0000,
    0x4b80_0000,
    0x4b80_0000,
    0x4b80_0001,
    0x4b80_0001,
];
const NEG_HALF: [u32; 5] = [
    0xcb80_0000,
    0xcb80_0000,
    0xcb80_0001,
    0xcb80_0000,
    0xcb80_0001,
];
const POS_ODD: [u32; 5] = [
    0x4b80_0002,
    0x4b80_0001,
    0x4b80_0001,
    0x4b80_0002,
    0x4b80_0002,
];
const NEG_ODD: [u32; 5] = [
    0xcb80_0002,
    0xcb80_0001,
    0xcb80_0002,
    0xcb80_0001,
    0xcb80_0002,
];
const GOLDENS: &[Golden] = &[
    g(0, 0x8000_0000_0000_0000, [0; 5], 0),
    g(1, 0xffff_ffff_0000_0000, [0; 5], 0),
    g(2, 0, [0; 5], 0),
    g(3, 0, [0; 5], 0),
    g(0, 0x1234_5678_ffff_ffff, [0xbf80_0000; 5], 0),
    g(2, u64::MAX, [0xbf80_0000; 5], 0),
    g(0, 0x1234_5678_8000_0000, [0xcf00_0000; 5], 0),
    g(2, 0xffff_ffff_8000_0000, [0xcf00_0000; 5], 0),
    g(2, 0x8000_0000_0000_0000, [0xdf00_0000; 5], 0),
    g(0, 0x8000_0000_0100_0001, POS_HALF, 1),
    g(1, 0xffff_ffff_0100_0001, POS_HALF, 1),
    g(2, 0x0100_0001, POS_HALF, 1),
    g(3, 0x0100_0001, POS_HALF, 1),
    g(0, 0x1234_5678_feff_ffff, NEG_HALF, 1),
    g(2, 0xffff_ffff_feff_ffff, NEG_HALF, 1),
    g(0, 0x0100_0003, POS_ODD, 1),
    g(1, 0x0100_0003, POS_ODD, 1),
    g(2, 0x0100_0003, POS_ODD, 1),
    g(3, 0x0100_0003, POS_ODD, 1),
    g(0, 0xfeff_fffd, NEG_ODD, 1),
    g(2, 0xffff_ffff_feff_fffd, NEG_ODD, 1),
    g(
        0,
        0x7fff_ffff,
        [
            0x4f00_0000,
            0x4eff_ffff,
            0x4eff_ffff,
            0x4f00_0000,
            0x4f00_0000,
        ],
        1,
    ),
    g(
        1,
        0xffff_ffff,
        [
            0x4f80_0000,
            0x4f7f_ffff,
            0x4f7f_ffff,
            0x4f80_0000,
            0x4f80_0000,
        ],
        1,
    ),
    g(1, 0x8000_0000, [0x4f00_0000; 5], 0),
    g(
        2,
        0x7fff_ffff_ffff_ffff,
        [
            0x5f00_0000,
            0x5eff_ffff,
            0x5eff_ffff,
            0x5f00_0000,
            0x5f00_0000,
        ],
        1,
    ),
    g(3, 0x8000_0000_0000_0000, [0x5f00_0000; 5], 0),
    g(
        3,
        0x8000_0000_0000_0001,
        [
            0x5f00_0000,
            0x5f00_0000,
            0x5f00_0000,
            0x5f00_0001,
            0x5f00_0000,
        ],
        1,
    ),
    g(
        3,
        0x8000_0080_0000_0000,
        [
            0x5f00_0000,
            0x5f00_0000,
            0x5f00_0000,
            0x5f00_0001,
            0x5f00_0001,
        ],
        1,
    ),
    g(
        3,
        u64::MAX,
        [
            0x5f80_0000,
            0x5f7f_ffff,
            0x5f7f_ffff,
            0x5f80_0000,
            0x5f80_0000,
        ],
        1,
    ),
    g(0, 0x00ff_ffff, [0x4b7f_ffff; 5], 0),
    g(1, 1, [0x3f80_0000; 5], 0),
    g(2, 0x0100_0002, [0x4b80_0001; 5], 0),
    g(3, 0x0100_0000, [0x4b80_0000; 5], 0),
];

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut oracle = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for kind in 0..4 {
        for rd in [0, 31] {
            for rm in [0, 1, 2, 3, 4, 7] {
                let raw = conversion(kind, rd, 31, rm);
                e.invalidate_all();
                e.install(&block(DRAM_BASE, &[raw]));
                assert!(e.is_compiled(DRAM_BASE));
                for (case, golden) in GOLDENS.iter().enumerate().filter(|(_, g)| g.kind == kind) {
                    for initial in 0..32_u8 {
                        let frm = if rm == 7 { initial % 5 } else { initial % 8 };
                        let mode = if rm == 7 { frm } else { rm } as usize;
                        for machine in [&mut m, &mut oracle] {
                            fs(machine, 1 + u64::from(initial % 3));
                            machine.hart_mut().regs.pc = PC;
                            for r in 0..32_u8 {
                                machine
                                    .hart_mut()
                                    .regs
                                    .write(r, SENTINEL.wrapping_mul(u64::from(r) + 1));
                                machine
                                    .hart_mut()
                                    .fregs
                                    .write_raw(r, SENTINEL ^ u64::from(r));
                            }
                            machine.hart_mut().regs.write(31, golden.source);
                            machine.hart_mut().csr.fflags = initial;
                            machine.hart_mut().csr.frm = frm;
                        }
                        let want_x = xregs(&m);
                        let mut want_f = fregs(&m);
                        want_f[rd as usize] = BOX | u64::from(golden.result[mode]);
                        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                        interpreted(&mut oracle, raw);
                        assert_eq!(exit.code, ExitCode::Fallthrough);
                        assert_eq!(exit.next_pc, PC + 4);
                        assert_eq!(exit.retired, u64::from(inline));
                        if case == 9 && mode == 0 {
                            assert_eq!(
                                m.hart().fregs.read_raw(rd),
                                BOX | 0x4b80_0000,
                                "CRITIC_FCVT_POSITIVE_HALF_GOLDEN"
                            );
                        }
                        assert_eq!(
                            fregs(&m),
                            want_f,
                            "literal case={case} rd={rd} rm={rm} frm={frm}"
                        );
                        assert_eq!(xregs(&m), want_x);
                        assert_eq!(m.hart().csr.fflags, initial | golden.flags);
                        assert_eq!(m.hart().csr.frm, frm);
                        assert_eq!(m.hart().csr.fs(), 3);
                        assert_ne!(m.hart().csr.mstatus & (1 << 63), 0);
                        assert_eq!(fregs(&oracle), want_f);
                        assert_eq!(xregs(&oracle), want_x);
                        assert_eq!(oracle.hart().csr.fflags, initial | golden.flags);
                        assert_eq!(oracle.hart().csr.mstatus, m.hart().csr.mstatus);
                        receipt.record([
                            case as u64,
                            u64::from(raw),
                            golden.source,
                            m.hart().fregs.read_raw(rd),
                            u64::from(m.hart().csr.fflags),
                            u64::from(frm),
                        ]);
                    }
                }
            }
        }
    }
    assert_eq!(receipt.cases, GOLDENS.len() as u64 * 2 * 6 * 32);
    receipt
}

fn next(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// Independent construction: we select an already-encoded significand/exponent,
/// then put the integer a known distance above it. There is no general converter.
fn constructed(random: &mut u64, kind: u8, sample: u64, mode: u8) -> (u64, u32, u8) {
    let exponent = 25
        + (next(random)
            % match kind {
                0 => 6,
                1 => 7,
                2 => 38,
                _ => 39,
            }) as u32;
    let shift = exponent - 23;
    let significand = 0x0080_0000 | (next(random) as u32 & 0x007f_fffe);
    let half = 1_u64 << (shift - 1);
    let remainder = [0, half - 1, half, half + 1, (1 << shift) - 1][sample as usize % 5];
    let magnitude = (u64::from(significand) << shift) + remainder;
    let negative = kind & 1 == 0 && next(random) & 1 != 0;
    let increment = match mode {
        0 => remainder > half || (remainder == half && significand & 1 != 0),
        1 => false,
        2 => negative && remainder != 0,
        3 => !negative && remainder != 0,
        4 => remainder >= half,
        _ => false,
    };
    let word = (u32::from(negative) << 31) | ((exponent + 127) << 23) | (significand & 0x007f_ffff);
    let bits = word + u32::from(increment);
    let integer = if negative {
        magnitude.wrapping_neg()
    } else {
        magnitude
    };
    let source = if kind < 2 {
        (integer & 0xffff_ffff) | (next(random) & 0xffff_ffff_0000_0000)
    } else {
        integer
    };
    (source, bits, u8::from(remainder != 0))
}

pub fn seeded_aliases_and_illegal(make: Factory, inline: bool) -> Receipt {
    const SEED: u64 = 0x6d42_a8c9_f031_75be;
    let mut random = SEED;
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for kind in 0..4 {
        for (rd, rs) in [
            (0, 0),
            (31, 0),
            (0, 31),
            (31, 31),
            (1, 1),
            (12, 12),
            (17, 9),
        ] {
            for rm in 0..8 {
                let raw = conversion(kind, rd, rs, rm);
                e.invalidate_all();
                e.install(&block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]));
                assert!(e.is_compiled(DRAM_BASE));
                for sample in 0..16_u64 {
                    let frm = sample as u8 % 8;
                    let mode = if rm == 7 { frm } else { rm };
                    let (source, bits, flags) = constructed(&mut random, kind, sample, mode);
                    for r in 0..32_u8 {
                        m.hart_mut().regs.write(r, next(&mut random));
                        m.hart_mut().fregs.write_raw(r, next(&mut random));
                    }
                    m.hart_mut().regs.write(
                        rs,
                        if rs == 12 {
                            source.wrapping_sub(1)
                        } else {
                            source
                        },
                    );
                    let start_fs = sample % 4;
                    let prior = (next(&mut random) & 31) as u8;
                    let legal = start_fs != 0 && mode < 5;
                    fs(&mut m, start_fs);
                    m.hart_mut().csr.fflags = prior;
                    m.hart_mut().csr.frm = frm;
                    m.hart_mut().regs.pc = PC + sample * 16;
                    let status = m.hart().csr.mstatus;
                    let mut want_x = xregs(&m);
                    let mut want_f = fregs(&m);
                    want_x[12] = want_x[12].wrapping_add(1);
                    if legal {
                        want_x[13] = want_x[13].wrapping_add(1);
                        want_f[rd as usize] = BOX | u64::from(if rs == 0 { 0 } else { bits });
                    }
                    let want_flags = prior | if legal && rs != 0 { flags } else { 0 };
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(xregs(&m), want_x);
                    assert_eq!(
                        fregs(&m),
                        want_f,
                        "seed={SEED:x} kind={kind} rd={rd} rs={rs} rm={rm} frm={frm} sample={sample}"
                    );
                    assert_eq!(m.hart().csr.fflags, want_flags);
                    assert_eq!(m.hart().csr.frm, frm);
                    assert_eq!(exit.next_pc, PC + sample * 16 + if legal { 12 } else { 4 });
                    assert_eq!(
                        exit.retired,
                        if inline { if legal { 3 } else { 1 } } else { 0 }
                    );
                    if legal {
                        assert_eq!(exit.code, ExitCode::Fallthrough);
                        assert_eq!(
                            m.hart().csr.mstatus,
                            (status & !0x6000) | 0x8000_0000_0000_6000
                        );
                    } else {
                        receipt.illegal += 1;
                        assert_eq!(exit.code, ExitCode::IllegalInstruction);
                        assert_eq!(exit.exit_info, u64::from(raw));
                        assert_eq!(m.hart().csr.mstatus, status);
                    }
                    receipt.record(xregs(&m).into_iter().chain(fregs(&m)).chain([
                        exit.next_pc,
                        u64::from(raw),
                        m.hart().csr.mstatus,
                        u64::from(want_flags),
                        u64::from(frm),
                    ]));
                }
            }
        }
    }
    assert_eq!(receipt.cases, 3584);
    receipt
}

pub fn control_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    e.install(&block(DRAM_BASE, &[conversion(3, 31, 1, 7)]));
    assert!(e.is_compiled(DRAM_BASE));
    fs(&mut m, 1);
    m.hart_mut().regs.write(1, 0x0100_0001);
    for frm in 0..8 {
        m.hart_mut().csr.fflags = 31;
        m.hart_mut().regs.write(9, (u64::from(frm) << 5) | 8);
        interpreted(&mut m, 0x0034_9073); // csrrw x0,fcsr,x9
        assert_eq!(m.hart().csr.fflags, 8);
        m.hart_mut().fregs.write_raw(31, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        if frm < 5 {
            want_f[31] = BOX | u64::from(POS_HALF[frm as usize]);
        }
        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
        assert_eq!(
            exit.code,
            if frm < 5 {
                ExitCode::Fallthrough
            } else {
                ExitCode::IllegalInstruction
            }
        );
        assert_eq!(exit.next_pc, PC + if frm < 5 { 4 } else { 0 });
        assert_eq!(exit.retired, u64::from(inline && frm < 5));
        assert_eq!(m.hart().csr.fflags, if frm < 5 { 9 } else { 8 });
        assert_eq!(m.hart().csr.frm, frm);
        assert_eq!(xregs(&m), want_x);
        assert_eq!(fregs(&m), want_f);
        interpreted(&mut m, 0x0010_2573); // csrrs x10,fflags,x0
        assert_eq!(m.hart().regs.read(10), if frm < 5 { 9 } else { 8 });
        receipt.record([
            u64::from(frm),
            m.hart().fregs.read_raw(31),
            u64::from(m.hart().csr.fflags),
            exit.next_pc,
        ]);
    }
    // A new exact conversion must not resurrect NX after an interpreted clear.
    m.hart_mut().regs.write(9, 16);
    interpreted(&mut m, 0x0034_9073);
    m.hart_mut().regs.write(1, 1 << 24);
    m.hart_mut().regs.pc = PC;
    execute(e.as_mut(), &mut m, DRAM_BASE);
    assert_eq!(m.hart().csr.fflags, 16);
    assert_eq!(m.hart().fregs.read_raw(31), BOX | 0x4b80_0000);
    receipt.record([16, m.hart().fregs.read_raw(31)]);
    for (suffix, cause) in [
        (0x0003_3383, Some(Exception::LoadAccessFault)),
        (0x01f3_3023, Some(Exception::StoreAccessFault)),
        (conversion(0, 31, 1, 5), None),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[
                conversion(2, 3, 1, 3),
                conversion(2, 4, 2, 2),
                suffix,
                0x0016_8693,
            ],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 2);
        m.hart_mut().csr.fflags = 8;
        m.hart_mut().csr.frm = 6;
        m.hart_mut().regs.write(1, 0x0100_0001);
        m.hart_mut().regs.write(2, 0xffff_ffff_feff_ffff);
        m.hart_mut().fregs.write_raw(3, SENTINEL);
        m.hart_mut().fregs.write_raw(4, SENTINEL);
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.write(7, SENTINEL);
        m.hart_mut().regs.write(13, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        want_f[3] = BOX | 0x4b80_0001;
        want_f[4] = BOX | 0xcb80_0001;
        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
        assert_eq!(
            exit.code,
            if cause.is_some() {
                ExitCode::Trap
            } else {
                ExitCode::IllegalInstruction
            }
        );
        assert_eq!(exit.next_pc, PC + 8);
        assert_eq!(exit.retired, if inline { 2 } else { 0 });
        assert_eq!(
            exit.trap,
            cause.map(|cause| Trap {
                cause,
                tval: 0x5000_0000
            })
        );
        if cause.is_none() {
            assert_eq!(exit.exit_info, u64::from(suffix));
        }
        assert_eq!(xregs(&m), want_x);
        assert_eq!(fregs(&m), want_f);
        assert_eq!(m.hart().csr.fflags, 9);
        assert_eq!(m.hart().csr.frm, 6);
        assert_eq!(m.hart().csr.fs(), 3);
        receipt.record([
            u64::from(suffix),
            exit.next_pc,
            m.hart().fregs.read_raw(3),
            m.hart().fregs.read_raw(4),
            u64::from(m.hart().csr.fflags),
        ]);
    }
    assert_eq!(receipt.cases, 12);
    receipt
}
