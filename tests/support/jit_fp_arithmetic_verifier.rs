//! Independent arithmetic critic. Literal IEEE-754 goldens and exact integer
//! identities compute expectations without the interpreter or SoftFloat.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const PC: u64 = 0x4000_7800;
pub const BOX: u64 = 0xffff_ffff_0000_0000;
pub const SENTINEL: u64 = 0x1234_5678_abcd_ef01;

#[derive(Debug)]
pub struct Receipt {
    pub cases: u64,
    pub disabled: u64,
    pub digest: u64,
}

impl Receipt {
    fn new() -> Self {
        Self {
            cases: 0,
            disabled: 0,
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

pub fn arithmetic(multiply: bool, rd: u8, rs1: u8, rs2: u8, rm: u8) -> u32 {
    0x0000_0053
        | (u32::from(multiply) << 28)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (u32::from(rm) << 12)
        | (u32::from(rd) << 7)
}

pub fn block(at: u64, words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        at,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("independent arithmetic encoding"),
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
    // SAFETY: synchronous call with disjoint live Machine components.
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
    // SAFETY: synchronous oracle call with disjoint live Machine components.
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

#[derive(Clone, Copy)]
struct Golden {
    multiply: bool,
    a: u64,
    b: u64,
    result: [u32; 5],
    flags: [u8; 5],
}

const fn golden(multiply: bool, a: u32, b: u32, result: [u32; 5], flags: [u8; 5]) -> Golden {
    Golden {
        multiply,
        a: BOX | a as u64,
        b: BOX | b as u64,
        result,
        flags,
    }
}

const GOLDENS: &[Golden] = &[
    // RNE, RTZ, RDN, RUP, RMM. These are hand-derived literal values.
    golden(
        false,
        0x3f80_0000,
        0x3380_0000,
        [
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0001,
            0x3f80_0001,
        ],
        [1; 5],
    ),
    golden(
        false,
        0xbf80_0000,
        0xb380_0000,
        [
            0xbf80_0000,
            0xbf80_0000,
            0xbf80_0001,
            0xbf80_0000,
            0xbf80_0001,
        ],
        [1; 5],
    ),
    golden(
        false,
        0x3f80_0001,
        0x3380_0000,
        [
            0x3f80_0002,
            0x3f80_0001,
            0x3f80_0001,
            0x3f80_0002,
            0x3f80_0002,
        ],
        [1; 5],
    ),
    golden(
        false,
        0x3f80_0000,
        0x3300_0000,
        [
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0001,
            0x3f80_0000,
        ],
        [1; 5],
    ),
    golden(
        false,
        0x3f80_0000,
        0x0000_0001,
        [
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0000,
            0x3f80_0001,
            0x3f80_0000,
        ],
        [1; 5],
    ),
    golden(
        false,
        0x3f80_0000,
        0xbf80_0000,
        [0, 0, 0x8000_0000, 0, 0],
        [0; 5],
    ),
    golden(
        false,
        0x0000_0000,
        0x8000_0000,
        [0, 0, 0x8000_0000, 0, 0],
        [0; 5],
    ),
    golden(false, 0x8000_0000, 0x8000_0000, [0x8000_0000; 5], [0; 5]),
    golden(false, 0x0000_0000, 0x0000_0000, [0; 5], [0; 5]),
    golden(false, 0x007f_ffff, 0x0000_0001, [0x0080_0000; 5], [0; 5]),
    golden(false, 0x0080_0000, 0x807f_ffff, [0x0000_0001; 5], [0; 5]),
    golden(
        false,
        0x7f7f_ffff,
        0x7f7f_ffff,
        [
            0x7f80_0000,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f80_0000,
        ],
        [5; 5],
    ),
    golden(
        false,
        0xff7f_ffff,
        0xff7f_ffff,
        [
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
        ],
        [5; 5],
    ),
    // Below 2^128, directed truncation accrues NX only. Crossing the threshold
    // changes that flag to OF|NX even though the saturated result stays identical.
    golden(
        false,
        0x7f7f_ffff,
        0x737f_ffff,
        [
            0x7f80_0000,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f80_0000,
        ],
        [5, 1, 1, 5, 5],
    ),
    golden(
        false,
        0xff7f_ffff,
        0xf37f_ffff,
        [
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
        ],
        [5, 1, 5, 1, 5],
    ),
    golden(
        false,
        0x7f7f_ffff,
        0x72ff_ffff,
        [
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f7f_ffff,
        ],
        [1, 1, 1, 5, 1],
    ),
    golden(
        false,
        0xff7f_ffff,
        0xf2ff_ffff,
        [
            0xff7f_ffff,
            0xff7f_ffff,
            0xff80_0000,
            0xff7f_ffff,
            0xff7f_ffff,
        ],
        [1, 1, 5, 1, 1],
    ),
    golden(
        false,
        0x7f7f_ffff,
        0x7380_0000,
        [
            0x7f80_0000,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f80_0000,
        ],
        [5; 5],
    ),
    golden(false, 0x7f80_0000, 0xff80_0000, [0x7fc0_0000; 5], [16; 5]),
    golden(false, 0x7f80_0000, 0xbf80_0000, [0x7f80_0000; 5], [0; 5]),
    golden(false, 0xff80_0000, 0x3f80_0000, [0xff80_0000; 5], [0; 5]),
    golden(false, 0x7fc0_0042, 0x3f80_0000, [0x7fc0_0000; 5], [0; 5]),
    golden(false, 0x3f80_0000, 0xff80_0042, [0x7fc0_0000; 5], [16; 5]),
    Golden {
        multiply: false,
        a: 0xffff_fffe_7f80_0042,
        b: BOX | 0x3f80_0000,
        result: [0x7fc0_0000; 5],
        flags: [0; 5],
    },
    Golden {
        multiply: false,
        a: 0x0000_0000_3f80_0000,
        b: BOX | 0xff80_0001,
        result: [0x7fc0_0000; 5],
        flags: [16; 5],
    },
    golden(true, 0x3f80_0000, 0x3f80_0000, [0x3f80_0000; 5], [0; 5]),
    golden(true, 0x3fc0_0000, 0x3fc0_0000, [0x4010_0000; 5], [0; 5]),
    golden(true, 0x0000_0000, 0xbf80_0000, [0x8000_0000; 5], [0; 5]),
    golden(true, 0x8000_0000, 0xbf80_0000, [0; 5], [0; 5]),
    golden(true, 0x0000_0001, 0x3f00_0000, [0, 0, 0, 1, 1], [3; 5]),
    golden(
        true,
        0x8000_0001,
        0x3f00_0000,
        [
            0x8000_0000,
            0x8000_0000,
            0x8000_0001,
            0x8000_0000,
            0x8000_0001,
        ],
        [3; 5],
    ),
    golden(true, 0x0080_0000, 0x3f00_0000, [0x0040_0000; 5], [0; 5]),
    golden(true, 0x007f_ffff, 0x4000_0000, [0x00ff_fffe; 5], [0; 5]),
    golden(
        true,
        0x0080_0000,
        0x3f7f_ffff,
        [
            0x0080_0000,
            0x007f_ffff,
            0x007f_ffff,
            0x0080_0000,
            0x0080_0000,
        ],
        [1, 3, 3, 1, 1],
    ),
    golden(
        true,
        0x7f7f_ffff,
        0x4000_0000,
        [
            0x7f80_0000,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f80_0000,
        ],
        [5; 5],
    ),
    golden(
        true,
        0xff7f_ffff,
        0x4000_0000,
        [
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
        ],
        [5; 5],
    ),
    golden(
        true,
        0x3f80_0001,
        0x3f80_0001,
        [
            0x3f80_0002,
            0x3f80_0002,
            0x3f80_0002,
            0x3f80_0003,
            0x3f80_0002,
        ],
        [1; 5],
    ),
    golden(
        true,
        0xbf80_0001,
        0x3f80_0001,
        [
            0xbf80_0002,
            0xbf80_0002,
            0xbf80_0003,
            0xbf80_0002,
            0xbf80_0002,
        ],
        [1; 5],
    ),
    // (2^64-2^41)*(2^64+2^41) = 2^128-2^82, below overflow under truncation.
    golden(
        true,
        0x5f7f_fffe,
        0x5f80_0001,
        [
            0x7f80_0000,
            0x7f7f_ffff,
            0x7f7f_ffff,
            0x7f80_0000,
            0x7f80_0000,
        ],
        [5, 1, 1, 5, 5],
    ),
    golden(
        true,
        0xdf7f_fffe,
        0x5f80_0001,
        [
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
            0xff7f_ffff,
            0xff80_0000,
        ],
        [5, 1, 5, 1, 5],
    ),
    golden(true, 0x7f80_0000, 0x0000_0000, [0x7fc0_0000; 5], [16; 5]),
    golden(true, 0xff80_0000, 0xbf80_0000, [0x7f80_0000; 5], [0; 5]),
    golden(true, 0x7fc0_4321, 0x7f80_0000, [0x7fc0_0000; 5], [0; 5]),
    golden(true, 0x7f80_0042, 0x7fc0_4321, [0x7fc0_0000; 5], [16; 5]),
    Golden {
        multiply: true,
        a: BOX | 0x7f80_0000,
        b: 0x7ff0_0000_0000_0000,
        result: [0x7fc0_0000; 5],
        flags: [0; 5],
    },
    Golden {
        multiply: true,
        a: BOX | 0x7f80_0001,
        b: 0xffff_fffe_0000_0000,
        result: [0x7fc0_0000; 5],
        flags: [16; 5],
    },
];

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for multiply in [false, true] {
        for rm in [0, 1, 2, 3, 4, 7] {
            e.invalidate_all();
            e.install(&block(DRAM_BASE, &[arithmetic(multiply, 31, 0, 30, rm)]));
            assert!(e.is_compiled(DRAM_BASE));
            for (case, g) in GOLDENS
                .iter()
                .enumerate()
                .filter(|(_, g)| g.multiply == multiply)
            {
                for initial in 0..32_u8 {
                    let frm = if rm == 7 { initial % 5 } else { initial % 8 };
                    let mode = if rm == 7 { frm } else { rm } as usize;
                    fs(&mut m, 1 + u64::from(initial % 3));
                    m.hart_mut().regs.pc = PC;
                    for r in 1..32_u8 {
                        m.hart_mut()
                            .regs
                            .write(r, SENTINEL.wrapping_mul(u64::from(r)));
                    }
                    m.hart_mut().fregs.write_raw(0, g.a);
                    m.hart_mut().fregs.write_raw(30, g.b);
                    m.hart_mut().fregs.write_raw(31, SENTINEL);
                    m.hart_mut().csr.fflags = initial;
                    m.hart_mut().csr.frm = frm;
                    let want_x = xregs(&m);
                    let mut want_f = fregs(&m);
                    want_f[31] = BOX | u64::from(g.result[mode]);
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(exit.code, ExitCode::Fallthrough);
                    assert_eq!(exit.next_pc, PC + 4);
                    assert_eq!(exit.retired, u64::from(inline));
                    if case == 0 && mode == 0 {
                        assert_eq!(
                            m.hart().fregs.read_raw(31),
                            BOX | 0x3f80_0000,
                            "CRITIC_FADD_HALF_ULP_GOLDEN"
                        );
                    }
                    assert_eq!(fregs(&m), want_f, "literal case={case} rm={rm} frm={frm}");
                    assert_eq!(xregs(&m), want_x);
                    assert_eq!(
                        m.hart().csr.fflags,
                        initial | g.flags[mode],
                        "literal flags case={case} mode={mode}"
                    );
                    assert_eq!(m.hart().csr.frm, frm);
                    assert_eq!(m.hart().csr.fs(), 3);
                    assert_ne!(m.hart().csr.mstatus & (1 << 63), 0);
                    receipt.record([
                        case as u64,
                        u64::from(rm),
                        g.a,
                        g.b,
                        m.hart().fregs.read_raw(31),
                        u64::from(m.hart().csr.fflags),
                        u64::from(frm),
                    ]);
                }
            }
        }
    }
    assert_eq!(receipt.cases, GOLDENS.len() as u64 * 6 * 32);
    receipt
}

fn next(random: &mut u64) -> u64 {
    *random ^= *random << 13;
    *random ^= *random >> 7;
    *random ^= *random << 17;
    *random
}

/// Exact binary32 encoding for integers whose magnitude fits within 24 bits.
fn integer_bits(n: i64) -> u32 {
    if n == 0 {
        return 0;
    }
    let magnitude = n.unsigned_abs() as u32;
    assert!(magnitude < (1 << 24));
    let exponent = 31 - magnitude.leading_zeros();
    let fraction = (magnitude << (23 - exponent)) & 0x007f_ffff;
    (u32::from(n < 0) << 31) | ((127 + exponent) << 23) | fraction
}

pub fn seeded_exact_aliases_and_illegal(make: Factory, inline: bool) -> Receipt {
    let aliases = [
        (0, 0, 0),
        (31, 31, 31),
        (1, 1, 2),
        (2, 1, 2),
        (2, 1, 1),
        (31, 0, 31),
        (0, 31, 0),
        (17, 9, 27),
    ];
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for multiply in [false, true] {
        for (rd, rs1, rs2) in aliases {
            for rm in 0..8_u8 {
                let raw = arithmetic(multiply, rd, rs1, rs2, rm);
                e.invalidate_all();
                e.install(&block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]));
                assert!(e.is_compiled(DRAM_BASE));
                for seed in [
                    0xa385_14de_690f_7c21,
                    0x48ce_9760_aa31_ebd5,
                    0xf351_2a49_c087_6de3,
                ] {
                    let mut random = seed;
                    for sample in 0..8_u64 {
                        let mut integers = [0_i64; 32];
                        for r in 0..32_u8 {
                            m.hart_mut().regs.write(r, next(&mut random));
                            let bits = next(&mut random);
                            let n = (bits % 1023 + 1) as i64 * if bits >> 63 != 0 { -1 } else { 1 };
                            integers[r as usize] = n;
                            m.hart_mut()
                                .fregs
                                .write_raw(r, BOX | u64::from(integer_bits(n)));
                        }
                        let initial_fs = sample % 4;
                        let initial_flags = (next(&mut random) & 31) as u8;
                        let frm = sample as u8;
                        let resolved = if rm == 7 { frm } else { rm };
                        let legal = initial_fs != 0 && resolved < 5;
                        fs(&mut m, initial_fs);
                        m.hart_mut().csr.fflags = initial_flags;
                        m.hart_mut().csr.frm = frm;
                        m.hart_mut().regs.pc = PC + sample * 16;
                        let status = m.hart().csr.mstatus;
                        let mut want_x = xregs(&m);
                        let mut want_f = fregs(&m);
                        want_x[12] = want_x[12].wrapping_add(1);
                        if legal {
                            let a = integers[rs1 as usize];
                            let b = integers[rs2 as usize];
                            let n = if multiply { a * b } else { a + b };
                            let bits = if n == 0 && !multiply && resolved == 2 {
                                0x8000_0000
                            } else {
                                integer_bits(n)
                            };
                            want_f[rd as usize] = BOX | u64::from(bits);
                            want_x[13] = want_x[13].wrapping_add(1);
                        }
                        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                        assert_eq!(xregs(&m), want_x);
                        assert_eq!(
                            fregs(&m),
                            want_f,
                            "seed={seed:x} sample={sample} mul={multiply} rm={rm} alias={rd}/{rs1}/{rs2}"
                        );
                        assert_eq!(m.hart().csr.frm, frm);
                        assert_eq!(m.hart().csr.fflags, initial_flags);
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
                            receipt.disabled += 1;
                            assert_eq!(exit.code, ExitCode::IllegalInstruction);
                            assert_eq!(exit.exit_info, u64::from(raw));
                            assert_eq!(m.hart().csr.mstatus, status);
                        }
                        receipt.record(xregs(&m).into_iter().chain(fregs(&m)).chain([
                            exit.next_pc,
                            raw as u64,
                            m.hart().csr.mstatus,
                            u64::from(initial_flags),
                            u64::from(frm),
                        ]));
                    }
                }
            }
        }
    }
    assert_eq!(receipt.cases, 3072);
    assert_eq!(receipt.disabled, 1488);
    receipt
}

pub fn control_handoff_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    e.install(&block(DRAM_BASE, &[arithmetic(false, 31, 1, 2, 7)]));
    assert!(e.is_compiled(DRAM_BASE));
    fs(&mut m, 1);
    m.hart_mut().fregs.write_raw(1, BOX | 0x3f80_0000);
    m.hart_mut().fregs.write_raw(2, BOX | 0x3380_0000);
    for frm in 0..8_u8 {
        m.hart_mut().csr.fflags = 31;
        m.hart_mut().regs.write(9, u64::from((frm << 5) | 8));
        interpreted(&mut m, 0x0034_9073); // csrrw x0,fcsr,x9
        assert_eq!(m.hart().csr.fflags, 8);
        m.hart_mut().fregs.write_raw(31, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        if frm < 5 {
            want_f[31] = BOX | if frm >= 3 { 0x3f80_0001 } else { 0x3f80_0000 };
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
    for (suffix, cause) in [
        (0x0003_3383, Some(Exception::LoadAccessFault)),
        (0x01f3_3023, Some(Exception::StoreAccessFault)),
        (arithmetic(false, 31, 1, 2, 5), None),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[
                arithmetic(false, 3, 1, 2, 3),
                arithmetic(true, 4, 3, 1, 0),
                suffix,
                0x0016_8693,
            ],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 2);
        m.hart_mut().csr.fflags = 8;
        m.hart_mut().csr.frm = 6;
        m.hart_mut().fregs.write_raw(3, SENTINEL);
        m.hart_mut().fregs.write_raw(4, SENTINEL);
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.write(7, SENTINEL);
        m.hart_mut().regs.write(13, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        want_f[3] = BOX | 0x3f80_0001;
        want_f[4] = BOX | 0x3f80_0001;
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
    assert_eq!(receipt.cases, 11);
    receipt
}
