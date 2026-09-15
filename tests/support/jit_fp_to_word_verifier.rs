//! Independent binary32-to-word critic. Every expected result/flag is a literal
//! architectural value; neither SoftFloat nor a host float conversion is an oracle.
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
    assert!(kind < 2);
    0xc000_0053
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
    unsigned: bool,
    source: u64,
    result: [u64; 5],
    flags: [u8; 5],
}
const fn g(unsigned: bool, bits: u32, result: [i64; 5], flags: [u8; 5]) -> Golden {
    Golden {
        unsigned,
        source: BOX | bits as u64,
        result: [
            result[0] as u64,
            result[1] as u64,
            result[2] as u64,
            result[3] as u64,
            result[4] as u64,
        ],
        flags,
    }
}
const fn malformed(unsigned: bool, source: u64) -> Golden {
    Golden {
        unsigned,
        source,
        result: [if unsigned { u64::MAX } else { 0x7fff_ffff }; 5],
        flags: [16; 5],
    }
}
const GOLDENS: &[Golden] = &[
    g(false, 0, [0; 5], [0; 5]),
    g(false, 0x8000_0000, [0; 5], [0; 5]),
    g(true, 0, [0; 5], [0; 5]),
    g(true, 0x8000_0000, [0; 5], [0; 5]),
    g(false, 0x3fc0_0000, [2, 1, 1, 2, 2], [1; 5]),
    g(false, 0xbfc0_0000, [-2, -1, -2, -1, -2], [1; 5]),
    g(true, 0x3fc0_0000, [2, 1, 1, 2, 2], [1; 5]),
    g(false, 0x4020_0000, [2, 2, 2, 3, 3], [1; 5]),
    g(false, 0xc020_0000, [-2, -2, -3, -2, -3], [1; 5]),
    g(true, 0x4020_0000, [2, 2, 2, 3, 3], [1; 5]),
    g(false, 0x3f00_0000, [0, 0, 0, 1, 1], [1; 5]),
    g(false, 0xbf00_0000, [0, 0, -1, 0, -1], [1; 5]),
    g(true, 0xbf00_0000, [0; 5], [1, 1, 16, 1, 16]),
    g(true, 0xbe80_0000, [0; 5], [1, 1, 16, 1, 1]),
    g(true, 0xbf40_0000, [0; 5], [16, 1, 16, 1, 16]),
    g(true, 0xbf80_0000, [0; 5], [16; 5]),
    g(false, 1, [0, 0, 0, 1, 0], [1; 5]),
    g(false, 0x8000_0001, [0, 0, -1, 0, 0], [1; 5]),
    g(true, 1, [0, 0, 0, 1, 0], [1; 5]),
    g(true, 0x8000_0001, [0; 5], [1, 1, 16, 1, 1]),
    g(false, 0x007f_ffff, [0, 0, 0, 1, 0], [1; 5]),
    g(false, 0x807f_ffff, [0, 0, -1, 0, 0], [1; 5]),
    g(true, 0x807f_ffff, [0; 5], [1, 1, 16, 1, 1]),
    g(false, 0x3f80_0000, [1; 5], [0; 5]),
    g(false, 0xbf80_0000, [-1; 5], [0; 5]),
    g(true, 0x3f80_0000, [1; 5], [0; 5]),
    g(false, 0x4eff_ffff, [0x7fff_ff80; 5], [0; 5]),
    g(true, 0x4eff_ffff, [0x7fff_ff80; 5], [0; 5]),
    g(false, 0x4f00_0000, [0x7fff_ffff; 5], [16; 5]),
    g(true, 0x4f00_0000, [-0x8000_0000; 5], [0; 5]),
    g(false, 0xcf00_0000, [-0x8000_0000; 5], [0; 5]),
    g(true, 0xcf00_0000, [0; 5], [16; 5]),
    g(false, 0xcf00_0001, [-0x8000_0000; 5], [16; 5]),
    g(true, 0x4f7f_ffff, [-256; 5], [0; 5]),
    g(true, 0x4f80_0000, [-1; 5], [16; 5]),
    g(false, 0x7f7f_ffff, [0x7fff_ffff; 5], [16; 5]),
    g(false, 0xff7f_ffff, [-0x8000_0000; 5], [16; 5]),
    g(true, 0x7f7f_ffff, [-1; 5], [16; 5]),
    g(true, 0xff7f_ffff, [0; 5], [16; 5]),
    g(false, 0x7f80_0000, [0x7fff_ffff; 5], [16; 5]),
    g(false, 0xff80_0000, [-0x8000_0000; 5], [16; 5]),
    g(true, 0x7f80_0000, [-1; 5], [16; 5]),
    g(true, 0xff80_0000, [0; 5], [16; 5]),
    g(false, 0x7fc0_0000, [0x7fff_ffff; 5], [16; 5]),
    g(false, 0xffc0_1234, [0x7fff_ffff; 5], [16; 5]),
    g(false, 0x7f80_0001, [0x7fff_ffff; 5], [16; 5]),
    g(false, 0xff80_0001, [0x7fff_ffff; 5], [16; 5]),
    g(true, 0x7fc0_0000, [-1; 5], [16; 5]),
    g(true, 0xffc0_1234, [-1; 5], [16; 5]),
    g(true, 0x7f80_0001, [-1; 5], [16; 5]),
    g(true, 0xff80_0001, [-1; 5], [16; 5]),
    malformed(false, 0xffff_fffe_3f80_0000),
    malformed(false, 0x0000_0000_ff80_0000),
    malformed(true, 0x7fff_ffff_0000_0000),
    malformed(true, 0xffff_fffe_bf00_0000),
];

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut oracle = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for kind in 0..2 {
        for rd in [0, 31] {
            for rm in [0, 1, 2, 3, 4, 7] {
                let rs = rd;
                let raw = conversion(kind, rd, rs, rm);
                e.invalidate_all();
                e.install(&block(DRAM_BASE, &[raw]));
                assert!(e.is_compiled(DRAM_BASE));
                for (case, golden) in GOLDENS
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| g.unsigned == (kind == 1))
                {
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
                            machine.hart_mut().fregs.write_raw(rs, golden.source);
                            machine.hart_mut().csr.fflags = initial;
                            machine.hart_mut().csr.frm = frm;
                        }
                        let mut want_x = xregs(&m);
                        let want_f = fregs(&m);
                        if rd != 0 {
                            want_x[rd as usize] = golden.result[mode];
                        }
                        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                        interpreted(&mut oracle, raw);
                        assert_eq!(exit.code, ExitCode::Fallthrough);
                        assert_eq!(exit.next_pc, PC + 4);
                        assert_eq!(exit.retired, u64::from(inline));
                        if case == 12 && mode == 4 && initial == 0 {
                            assert_eq!(
                                m.hart().csr.fflags,
                                16,
                                "CRITIC_TO_WORD_NEGATIVE_HALF_RMM_GOLDEN"
                            );
                        }
                        assert_eq!(
                            xregs(&m),
                            want_x,
                            "literal case={case} rd={rd} rm={rm} frm={frm}"
                        );
                        assert_eq!(fregs(&m), want_f);
                        assert_eq!(
                            m.hart().csr.fflags,
                            initial | golden.flags[mode],
                            "flags case={case} rm={rm} frm={frm}"
                        );
                        assert_eq!(m.hart().csr.frm, frm);
                        assert_eq!(m.hart().csr.fs(), 3);
                        assert_ne!(m.hart().csr.mstatus & (1 << 63), 0);
                        assert_eq!(fregs(&oracle), want_f);
                        assert_eq!(xregs(&oracle), want_x);
                        assert_eq!(oracle.hart().csr.fflags, initial | golden.flags[mode]);
                        assert_eq!(oracle.hart().csr.mstatus, m.hart().csr.mstatus);
                        receipt.record([
                            case as u64,
                            u64::from(raw),
                            golden.source,
                            m.hart().regs.read(rd),
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

pub fn seeded_aliases_and_illegal(make: Factory, inline: bool) -> Receipt {
    const SEED: u64 = 0x29ac_c813_67d5_b0e4;
    let mut random = SEED;
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for kind in 0..2 {
        let goldens = GOLDENS
            .iter()
            .filter(|g| g.unsigned == (kind == 1))
            .collect::<Vec<_>>();
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
                    let golden = goldens[(next(&mut random) % goldens.len() as u64) as usize];
                    let frm = sample as u8 % 8;
                    let mode = if rm == 7 { frm } else { rm };
                    for r in 0..32_u8 {
                        m.hart_mut().regs.write(r, next(&mut random));
                        m.hart_mut().fregs.write_raw(r, next(&mut random));
                    }
                    m.hart_mut().fregs.write_raw(rs, golden.source);
                    let start_fs = sample % 4;
                    let prior = (next(&mut random) & 31) as u8;
                    let legal = start_fs != 0 && mode < 5;
                    fs(&mut m, start_fs);
                    m.hart_mut().csr.fflags = prior;
                    m.hart_mut().csr.frm = frm;
                    m.hart_mut().regs.pc = PC + sample * 16;
                    let status = m.hart().csr.mstatus;
                    let mut want_x = xregs(&m);
                    let want_f = fregs(&m);
                    want_x[12] = want_x[12].wrapping_add(1);
                    if legal {
                        if rd != 0 {
                            want_x[rd as usize] = golden.result[mode as usize];
                        }
                        want_x[13] = want_x[13].wrapping_add(1);
                    }
                    let want_flags = prior
                        | if legal {
                            golden.flags[mode as usize]
                        } else {
                            0
                        };
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(
                        xregs(&m),
                        want_x,
                        "seed={SEED:x} kind={kind} rd={rd} rs={rs} rm={rm} frm={frm} sample={sample}"
                    );
                    assert_eq!(fregs(&m), want_f);
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
    assert_eq!(receipt.cases, 1792);
    receipt
}

pub fn control_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    e.install(&block(DRAM_BASE, &[conversion(1, 31, 1, 7)]));
    assert!(e.is_compiled(DRAM_BASE));
    fs(&mut m, 1);
    m.hart_mut().fregs.write_raw(1, BOX | 0xbf00_0000);
    for frm in 0..8 {
        m.hart_mut().csr.fflags = 31;
        m.hart_mut().regs.write(9, (u64::from(frm) << 5) | 8);
        interpreted(&mut m, 0x0034_9073); // csrrw x0,fcsr,x9
        assert_eq!(m.hart().csr.fflags, 8);
        m.hart_mut().regs.write(31, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let mut want_x = xregs(&m);
        let want_f = fregs(&m);
        if frm < 5 {
            want_x[31] = 0;
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
        let flags = [9, 9, 24, 9, 24, 8, 8, 8][frm as usize];
        assert_eq!(m.hart().csr.fflags, flags);
        assert_eq!(m.hart().csr.frm, frm);
        assert_eq!(xregs(&m), want_x);
        assert_eq!(fregs(&m), want_f);
        interpreted(&mut m, 0x0010_2573); // csrrs x10,fflags,x0
        assert_eq!(m.hart().regs.read(10), u64::from(flags));
        receipt.record([
            u64::from(frm),
            m.hart().regs.read(31),
            u64::from(flags),
            exit.next_pc,
        ]);
    }
    // An exact conversion after a real CSR clear cannot resurrect NX/NV.
    m.hart_mut().regs.write(9, 4);
    interpreted(&mut m, 0x0034_9073);
    m.hart_mut().fregs.write_raw(1, BOX | 0x4f7f_ffff);
    m.hart_mut().regs.pc = PC;
    execute(e.as_mut(), &mut m, DRAM_BASE);
    assert_eq!(m.hart().csr.fflags, 4);
    assert_eq!(m.hart().regs.read(31), 0xffff_ffff_ffff_ff00);
    receipt.record([4, m.hart().regs.read(31)]);
    for (suffix, cause) in [
        (0x0003_3383, Some(Exception::LoadAccessFault)),
        (0x01f3_3023, Some(Exception::StoreAccessFault)),
        (conversion(0, 31, 1, 5), None),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[
                conversion(0, 3, 1, 3),
                conversion(1, 4, 2, 2),
                suffix,
                0x0016_8693,
            ],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 2);
        m.hart_mut().csr.fflags = 8;
        m.hart_mut().csr.frm = 6;
        m.hart_mut().fregs.write_raw(1, BOX | 0x3fc0_0000);
        m.hart_mut().fregs.write_raw(2, BOX | 0xbf00_0000);
        for r in [3, 4, 7, 13] {
            m.hart_mut().regs.write(r, SENTINEL);
        }
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.pc = PC;
        let mut want_x = xregs(&m);
        let want_f = fregs(&m);
        want_x[3] = 2;
        want_x[4] = 0;
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
        assert_eq!(m.hart().csr.fflags, 25);
        assert_eq!(m.hart().csr.frm, 6);
        assert_eq!(m.hart().csr.fs(), 3);
        receipt.record([
            u64::from(suffix),
            exit.next_pc,
            m.hart().regs.read(3),
            m.hart().regs.read(4),
            u64::from(m.hart().csr.fflags),
        ]);
    }
    assert_eq!(receipt.cases, 12);
    receipt
}
