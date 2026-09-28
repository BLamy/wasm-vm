//! Independent FMADD.S critic. Constants derive from Python Fraction arithmetic
//! in evidence/omarchy-profile/fmadd-single-verifier/derive-goldens.py.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const PC: u64 = 0x4000_bc00;
pub const BOX: u64 = 0xffff_ffff_0000_0000;
pub const SENTINEL: u64 = 0x2468_ace0_1357_bdf9;

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

pub fn fmadd(rd: u8, rs1: u8, rs2: u8, rs3: u8, rm: u8) -> u32 {
    0x43 | (u32::from(rs3) << 27)
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
                instr: decode(raw).expect("independent FMADD encoding"),
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
pub struct Golden {
    pub name: &'static str,
    pub operands: [u64; 3],
    pub result: [u32; 5],
    pub flags: [u8; 5],
}

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut oracle = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for rm in [0, 1, 2, 3, 4, 7] {
        e.invalidate_all();
        let raw = fmadd(31, 0, 29, 30, rm);
        e.install(&block(DRAM_BASE, &[raw]));
        assert!(e.is_compiled(DRAM_BASE));
        for (case, g) in GOLDENS.iter().enumerate() {
            for initial in [0_u8, 1, 2, 4, 8, 16, 31] {
                for dynamic in 0..if rm == 7 { 5 } else { 1 } {
                    let frm = if rm == 7 { dynamic } else { initial % 8 };
                    let mode = if rm == 7 { frm } else { rm } as usize;
                    for machine in [&mut m, &mut oracle] {
                        fs(machine, 1 + u64::from(initial % 3));
                        machine.hart_mut().regs.pc = PC;
                        for r in 1..32_u8 {
                            machine
                                .hart_mut()
                                .regs
                                .write(r, SENTINEL.wrapping_mul(u64::from(r)));
                        }
                        for (r, v) in [0, 29, 30].into_iter().zip(g.operands) {
                            machine.hart_mut().fregs.write_raw(r, v);
                        }
                        machine.hart_mut().fregs.write_raw(31, SENTINEL);
                        machine.hart_mut().csr.fflags = initial;
                        machine.hart_mut().csr.frm = frm;
                    }
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
                            BOX | 0xa880_0000,
                            "CRITIC_FMADD_SINGLE_ROUNDING"
                        );
                    }
                    assert_eq!(fregs(&m), want_f, "literal {} rm={rm} frm={frm}", g.name);
                    assert_eq!(xregs(&m), want_x);
                    assert_eq!(
                        m.hart().csr.fflags,
                        initial | g.flags[mode],
                        "literal flags {} mode={mode}",
                        g.name
                    );
                    assert_eq!(m.hart().csr.frm, frm);
                    assert_eq!(m.hart().csr.fs(), 3);
                    assert_ne!(m.hart().csr.mstatus & (1 << 63), 0);
                    interpreted(&mut oracle, raw);
                    assert_eq!(fregs(&oracle), want_f, "interpreter literal {}", g.name);
                    assert_eq!(
                        oracle.hart().csr.fflags,
                        initial | g.flags[mode],
                        "interpreter flags {} mode={mode}",
                        g.name
                    );
                    receipt.record([
                        case as u64,
                        u64::from(rm),
                        g.operands[0],
                        g.operands[1],
                        g.operands[2],
                        m.hart().fregs.read_raw(31),
                        u64::from(m.hart().csr.fflags),
                        u64::from(frm),
                    ]);
                }
            }
        }
    }
    assert_eq!(receipt.cases, GOLDENS.len() as u64 * 10 * 7);
    receipt
}
fn next(random: &mut u64) -> u64 {
    *random ^= *random << 13;
    *random ^= *random >> 7;
    *random ^= *random << 17;
    *random
}
fn small_bits(value: i32) -> u32 {
    let magnitude = value.unsigned_abs();
    if magnitude == 0 {
        return 0;
    }
    let exponent = 31 - magnitude.leading_zeros();
    ((value as u32) & 0x8000_0000)
        | ((exponent + 127) << 23)
        | ((magnitude << (23 - exponent)) & 0x7f_ffff)
}

pub fn seeded_aliases_and_illegal(make: Factory, inline: bool) -> Receipt {
    // All 15 equality partitions of rd/a/b/c, plus the f31 all-alias endpoint.
    let aliases = [
        (0, 0, 0, 0),
        (31, 31, 31, 31),
        (0, 0, 0, 31),
        (0, 0, 31, 0),
        (0, 31, 0, 0),
        (31, 0, 0, 0),
        (0, 0, 31, 31),
        (0, 31, 0, 31),
        (0, 31, 31, 0),
        (0, 0, 30, 31),
        (0, 30, 0, 31),
        (0, 30, 31, 0),
        (0, 30, 30, 31),
        (0, 30, 31, 30),
        (0, 30, 31, 31),
        (7, 0, 30, 31),
    ];
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for (rd, rs1, rs2, rs3) in aliases {
        for rm in 0..8_u8 {
            let raw = fmadd(rd, rs1, rs2, rs3, rm);
            e.invalidate_all();
            e.install(&block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]));
            assert!(e.is_compiled(DRAM_BASE));
            for seed in [
                0xe13a_69f2_c04d_87b5,
                0x2970_6e1b_f435_c8ad,
                0xb639_48ac_0fe2_d571,
            ] {
                let mut random = seed;
                for sample in 0..16_u64 {
                    let mut values = [0_i32; 32];
                    for r in 0..32_u8 {
                        m.hart_mut().regs.write(r, next(&mut random));
                        let v = next(&mut random);
                        let value = (v % 33) as i32 - 16;
                        values[r as usize] = value;
                        let boxed = if v.is_multiple_of(7) {
                            0xffff_fffe_0000_0000
                        } else {
                            BOX
                        };
                        m.hart_mut()
                            .fregs
                            .write_raw(r, boxed | u64::from(small_bits(value)));
                    }
                    let initial_fs = sample % 4;
                    let initial_flags = (next(&mut random) & 31) as u8;
                    let frm = (sample % 8) as u8;
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
                        let sources = [rs1, rs2, rs3].map(|r| want_f[r as usize]);
                        let [a, b, c] = [rs1, rs2, rs3].map(|r| values[r as usize]);
                        let result = a * b + c;
                        let bits = if sources.iter().any(|v| v >> 32 != 0xffff_ffff) {
                            0x7fc0_0000
                        } else if result == 0 {
                            let positive_same_zeros = (a == 0 || b == 0)
                                && c == 0
                                && (sources[0] ^ sources[1]) & 0x8000_0000 == 0;
                            if !positive_same_zeros && resolved == 2 {
                                0x8000_0000
                            } else {
                                0
                            }
                        } else {
                            small_bits(result)
                        };
                        want_f[rd as usize] = BOX | u64::from(bits);
                        want_x[13] = want_x[13].wrapping_add(1);
                    }
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(xregs(&m), want_x);
                    assert_eq!(
                        fregs(&m),
                        want_f,
                        "seed={seed:x} sample={sample} rm={rm} alias={rd}/{rs1}/{rs2}/{rs3}"
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
                        u64::from(raw),
                        m.hart().csr.mstatus,
                        u64::from(initial_flags),
                        u64::from(frm),
                    ]));
                }
            }
        }
    }
    assert_eq!(receipt.cases, 6144);
    assert_eq!(receipt.disabled, 2976);
    receipt
}

pub fn control_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    e.install(&block(DRAM_BASE, &[fmadd(31, 1, 2, 0, 7)]));
    assert!(e.is_compiled(DRAM_BASE));
    fs(&mut m, 1);
    m.hart_mut().fregs.write_raw(0, BOX);
    m.hart_mut().fregs.write_raw(1, BOX | 1);
    m.hart_mut().fregs.write_raw(2, BOX | 0x3f00_0000);
    for frm in 0..8 {
        m.hart_mut().csr.fflags = 31;
        m.hart_mut().regs.write(9, (u64::from(frm) << 5) | 8);
        interpreted(&mut m, 0x0034_9073);
        assert_eq!(m.hart().csr.fflags, 8);
        m.hart_mut().fregs.write_raw(31, SENTINEL);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        if frm < 5 {
            want_f[31] = BOX | [0, 0, 0, 1, 1][frm as usize];
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
        let flags = if frm < 5 { 11 } else { 8 };
        assert_eq!(m.hart().csr.fflags, flags);
        assert_eq!(m.hart().csr.frm, frm);
        assert_eq!(xregs(&m), want_x);
        assert_eq!(fregs(&m), want_f);
        interpreted(&mut m, 0x0010_2573);
        assert_eq!(m.hart().regs.read(10), u64::from(flags));
        receipt.record([
            u64::from(frm),
            m.hart().fregs.read_raw(31),
            u64::from(flags),
            exit.next_pc,
        ]);
    }
    m.hart_mut().regs.write(9, 16);
    interpreted(&mut m, 0x0034_9073);
    m.hart_mut().fregs.write_raw(1, BOX | 0x40c0_0000);
    m.hart_mut().regs.pc = PC;
    execute(e.as_mut(), &mut m, DRAM_BASE);
    assert_eq!(m.hart().csr.fflags, 16);
    assert_eq!(m.hart().fregs.read_raw(31), BOX | 0x4040_0000);
    receipt.record([16, m.hart().fregs.read_raw(31)]);
    for (suffix, cause) in [
        (0x0003_3383, Some(Exception::LoadAccessFault)),
        (0x01f3_3023, Some(Exception::StoreAccessFault)),
        (fmadd(0, 1, 2, 30, 5), None),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[
                fmadd(3, 1, 2, 0, 3),
                fmadd(4, 29, 30, 0, 1),
                suffix,
                0x0016_8693,
            ],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 2);
        m.hart_mut().csr.fflags = 16;
        m.hart_mut().csr.frm = 6;
        for (r, v) in [
            (0, 0),
            (1, 1),
            (2, 0x3f00_0000),
            (29, 0x7f7f_ffff),
            (30, 0x4000_0000),
        ] {
            m.hart_mut().fregs.write_raw(r, BOX | v);
        }
        for r in [3, 4, 7, 13] {
            m.hart_mut().regs.write(r, SENTINEL);
        }
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        want_f[3] = BOX | 1;
        want_f[4] = BOX | 0x7f7f_ffff;
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
        assert_eq!(m.hart().csr.fflags, 23);
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

pub const GOLDENS: &[Golden] = &[
    Golden {
        name: "fused_cancellation",
        operands: [0xffffffff3f800001, 0xffffffff3f7ffffe, 0xffffffffbf800000],
        result: [0xa8800000, 0xa8800000, 0xa8800000, 0xa8800000, 0xa8800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "intermediate_overflow_cancelled",
        operands: [0xffffffff7f7fffff, 0xffffffff40000000, 0xffffffffff7fffff],
        result: [0x7f7fffff, 0x7f7fffff, 0x7f7fffff, 0x7f7fffff, 0x7f7fffff],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "large_cancel_to_small",
        operands: [0xffffffff7f000000, 0xffffffff40000000, 0xffffffffff7fffff],
        result: [0x73800000, 0x73800000, 0x73800000, 0x73800000, 0x73800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "tiny_boundary_0_3e800000",
        operands: [0xffffffff00000001, 0xffffffff3e800000, 0xffffffff007fffff],
        result: [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_0_3effffff",
        operands: [0xffffffff00000001, 0xffffffff3effffff, 0xffffffff007fffff],
        result: [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_0_3f000000",
        operands: [0xffffffff00000001, 0xffffffff3f000000, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_0_3f000001",
        operands: [0xffffffff00000001, 0xffffffff3f000001, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 1, 3],
    },
    Golden {
        name: "tiny_boundary_0_3f200000",
        operands: [0xffffffff00000001, 0xffffffff3f200000, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 1, 3],
    },
    Golden {
        name: "tiny_boundary_0_3f3fffff",
        operands: [0xffffffff00000001, 0xffffffff3f3fffff, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 1, 3],
    },
    Golden {
        name: "tiny_boundary_0_3f400000",
        operands: [0xffffffff00000001, 0xffffffff3f400000, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [1, 3, 3, 1, 1],
    },
    Golden {
        name: "tiny_boundary_0_3f400001",
        operands: [0xffffffff00000001, 0xffffffff3f400001, 0xffffffff007fffff],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [1, 3, 3, 1, 1],
    },
    Golden {
        name: "tiny_boundary_0_3f800000",
        operands: [0xffffffff00000001, 0xffffffff3f800000, 0xffffffff007fffff],
        result: [0x00800000, 0x00800000, 0x00800000, 0x00800000, 0x00800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "half_min_sub_0",
        operands: [0xffffffff00000001, 0xffffffff3f000000, 0xffffffff00000000],
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000001, 0x00000001],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "exact_min_sub_0",
        operands: [0xffffffff00000001, 0xffffffff3f800000, 0xffffffff00000000],
        result: [0x00000001, 0x00000001, 0x00000001, 0x00000001, 0x00000001],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "tiny_half_normal_0",
        operands: [0xffffffff00800000, 0xffffffff3f7fffff, 0xffffffff00000000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "normal_inexact_above_0",
        operands: [0xffffffff00000001, 0xffffffff3f000000, 0xffffffff00800000],
        result: [0x00800000, 0x00800000, 0x00800000, 0x00800001, 0x00800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "large_overflow_0",
        operands: [0xffffffff7f7fffff, 0xffffffff40000000, 0xffffffff00000000],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_0_1",
        operands: [0xffffffff7f000000, 0xffffffff40000000, 0xffffffff00000001],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_0_80000001",
        operands: [0xffffffff7f000000, 0xffffffff40000000, 0xffffffff80000001],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 1, 1, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_0_7fffff",
        operands: [0xffffffff7f000000, 0xffffffff40000000, 0xffffffff007fffff],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_0_807fffff",
        operands: [0xffffffff7f000000, 0xffffffff40000000, 0xffffffff807fffff],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 1, 1, 5, 5],
    },
    Golden {
        name: "tininess_threshold_0_3e7fffff",
        operands: [0xffffffff80000001, 0xffffffff3e7fffff, 0xffffffff00800000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [1, 3, 3, 1, 1],
    },
    Golden {
        name: "tininess_threshold_0_3e800000",
        operands: [0xffffffff80000001, 0xffffffff3e800000, 0xffffffff00800000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [1, 3, 3, 1, 1],
    },
    Golden {
        name: "tininess_threshold_0_3e800001",
        operands: [0xffffffff80000001, 0xffffffff3e800001, 0xffffffff00800000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 1, 3],
    },
    Golden {
        name: "tininess_threshold_0_3effffff",
        operands: [0xffffffff80000001, 0xffffffff3effffff, 0xffffffff00800000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 1, 3],
    },
    Golden {
        name: "tininess_threshold_0_3f000000",
        operands: [0xffffffff80000001, 0xffffffff3f000000, 0xffffffff00800000],
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tininess_threshold_0_3f000001",
        operands: [0xffffffff80000001, 0xffffffff3f000001, 0xffffffff00800000],
        result: [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "overflow_boundary_0_1",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff00000001],
        result: [0x7f7fffff, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f7fffff],
        flags: [1, 1, 1, 5, 1],
    },
    Golden {
        name: "overflow_boundary_0_72800000",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff72800000],
        result: [0x7f7fffff, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f7fffff],
        flags: [1, 1, 1, 5, 1],
    },
    Golden {
        name: "overflow_boundary_0_72ffffff",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff72ffffff],
        result: [0x7f7fffff, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f7fffff],
        flags: [1, 1, 1, 5, 1],
    },
    Golden {
        name: "overflow_boundary_0_73000000",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff73000000],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 1, 1, 5, 5],
    },
    Golden {
        name: "overflow_boundary_0_73000001",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff73000001],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 1, 1, 5, 5],
    },
    Golden {
        name: "overflow_boundary_0_73800000",
        operands: [0xffffffff7f7fffff, 0xffffffff3f800000, 0xffffffff73800000],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "unit_tie_0",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0xffffffff33800000],
        result: [0x3f800000, 0x3f800000, 0x3f800000, 0x3f800001, 0x3f800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "unit_odd_tie_0",
        operands: [0xffffffff3f800001, 0xffffffff3f800000, 0xffffffff33800000],
        result: [0x3f800002, 0x3f800001, 0x3f800001, 0x3f800002, 0x3f800002],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "tiny_boundary_80000000_3e800000",
        operands: [0xffffffff80000001, 0xffffffff3e800000, 0xffffffff807fffff],
        result: [0x807fffff, 0x807fffff, 0x80800000, 0x807fffff, 0x807fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3effffff",
        operands: [0xffffffff80000001, 0xffffffff3effffff, 0xffffffff807fffff],
        result: [0x807fffff, 0x807fffff, 0x80800000, 0x807fffff, 0x807fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3f000000",
        operands: [0xffffffff80000001, 0xffffffff3f000000, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3f000001",
        operands: [0xffffffff80000001, 0xffffffff3f000001, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 1, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3f200000",
        operands: [0xffffffff80000001, 0xffffffff3f200000, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 1, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3f3fffff",
        operands: [0xffffffff80000001, 0xffffffff3f3fffff, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 1, 3, 3],
    },
    Golden {
        name: "tiny_boundary_80000000_3f400000",
        operands: [0xffffffff80000001, 0xffffffff3f400000, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [1, 3, 1, 3, 1],
    },
    Golden {
        name: "tiny_boundary_80000000_3f400001",
        operands: [0xffffffff80000001, 0xffffffff3f400001, 0xffffffff807fffff],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [1, 3, 1, 3, 1],
    },
    Golden {
        name: "tiny_boundary_80000000_3f800000",
        operands: [0xffffffff80000001, 0xffffffff3f800000, 0xffffffff807fffff],
        result: [0x80800000, 0x80800000, 0x80800000, 0x80800000, 0x80800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "half_min_sub_80000000",
        operands: [0xffffffff80000001, 0xffffffff3f000000, 0xffffffff80000000],
        result: [0x80000000, 0x80000000, 0x80000001, 0x80000000, 0x80000001],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "exact_min_sub_80000000",
        operands: [0xffffffff80000001, 0xffffffff3f800000, 0xffffffff80000000],
        result: [0x80000001, 0x80000001, 0x80000001, 0x80000001, 0x80000001],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "tiny_half_normal_80000000",
        operands: [0xffffffff80800000, 0xffffffff3f7fffff, 0xffffffff80000000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "normal_inexact_above_80000000",
        operands: [0xffffffff80000001, 0xffffffff3f000000, 0xffffffff80800000],
        result: [0x80800000, 0x80800000, 0x80800001, 0x80800000, 0x80800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "large_overflow_80000000",
        operands: [0xffffffffff7fffff, 0xffffffff40000000, 0xffffffff80000000],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_80000000_1",
        operands: [0xffffffffff000000, 0xffffffff40000000, 0xffffffff80000001],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_80000000_80000001",
        operands: [0xffffffffff000000, 0xffffffff40000000, 0xffffffff00000001],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 1, 5, 1, 5],
    },
    Golden {
        name: "overflow_wide_gap_80000000_7fffff",
        operands: [0xffffffffff000000, 0xffffffff40000000, 0xffffffff807fffff],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "overflow_wide_gap_80000000_807fffff",
        operands: [0xffffffffff000000, 0xffffffff40000000, 0xffffffff007fffff],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 1, 5, 1, 5],
    },
    Golden {
        name: "tininess_threshold_80000000_3e7fffff",
        operands: [0xffffffff00000001, 0xffffffff3e7fffff, 0xffffffff80800000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [1, 3, 1, 3, 1],
    },
    Golden {
        name: "tininess_threshold_80000000_3e800000",
        operands: [0xffffffff00000001, 0xffffffff3e800000, 0xffffffff80800000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [1, 3, 1, 3, 1],
    },
    Golden {
        name: "tininess_threshold_80000000_3e800001",
        operands: [0xffffffff00000001, 0xffffffff3e800001, 0xffffffff80800000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 1, 3, 3],
    },
    Golden {
        name: "tininess_threshold_80000000_3effffff",
        operands: [0xffffffff00000001, 0xffffffff3effffff, 0xffffffff80800000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 1, 3, 3],
    },
    Golden {
        name: "tininess_threshold_80000000_3f000000",
        operands: [0xffffffff00000001, 0xffffffff3f000000, 0xffffffff80800000],
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "tininess_threshold_80000000_3f000001",
        operands: [0xffffffff00000001, 0xffffffff3f000001, 0xffffffff80800000],
        result: [0x807fffff, 0x807fffff, 0x80800000, 0x807fffff, 0x807fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        name: "overflow_boundary_80000000_1",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xffffffff80000001],
        result: [0xff7fffff, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff7fffff],
        flags: [1, 1, 5, 1, 1],
    },
    Golden {
        name: "overflow_boundary_80000000_72800000",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xfffffffff2800000],
        result: [0xff7fffff, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff7fffff],
        flags: [1, 1, 5, 1, 1],
    },
    Golden {
        name: "overflow_boundary_80000000_72ffffff",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xfffffffff2ffffff],
        result: [0xff7fffff, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff7fffff],
        flags: [1, 1, 5, 1, 1],
    },
    Golden {
        name: "overflow_boundary_80000000_73000000",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xfffffffff3000000],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 1, 5, 1, 5],
    },
    Golden {
        name: "overflow_boundary_80000000_73000001",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xfffffffff3000001],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 1, 5, 1, 5],
    },
    Golden {
        name: "overflow_boundary_80000000_73800000",
        operands: [0xffffffffff7fffff, 0xffffffff3f800000, 0xfffffffff3800000],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "unit_tie_80000000",
        operands: [0xffffffffbf800000, 0xffffffff3f800000, 0xffffffffb3800000],
        result: [0xbf800000, 0xbf800000, 0xbf800001, 0xbf800000, 0xbf800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "unit_odd_tie_80000000",
        operands: [0xffffffffbf800001, 0xffffffff3f800000, 0xffffffffb3800000],
        result: [0xbf800002, 0xbf800001, 0xbf800002, 0xbf800001, 0xbf800002],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "zero_signs_0_0_0",
        operands: [0xffffffff00000000, 0xffffffff3f800000, 0xffffffff00000000],
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_0_0_80000000",
        operands: [0xffffffff00000000, 0xffffffff3f800000, 0xffffffff80000000],
        result: [0x00000000, 0x00000000, 0x80000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_0_80000000_0",
        operands: [0xffffffff00000000, 0xffffffffbf800000, 0xffffffff00000000],
        result: [0x00000000, 0x00000000, 0x80000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_0_80000000_80000000",
        operands: [0xffffffff00000000, 0xffffffffbf800000, 0xffffffff80000000],
        result: [0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_80000000_0_0",
        operands: [0xffffffff80000000, 0xffffffff3f800000, 0xffffffff00000000],
        result: [0x00000000, 0x00000000, 0x80000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_80000000_0_80000000",
        operands: [0xffffffff80000000, 0xffffffff3f800000, 0xffffffff80000000],
        result: [0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_80000000_80000000_0",
        operands: [0xffffffff80000000, 0xffffffffbf800000, 0xffffffff00000000],
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_signs_80000000_80000000_80000000",
        operands: [0xffffffff80000000, 0xffffffffbf800000, 0xffffffff80000000],
        result: [0x00000000, 0x00000000, 0x80000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "zero_inf_3f800000",
        operands: [0xffffffff00000000, 0xffffffff7f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_zero_3f800000",
        operands: [0xffffffffff800000, 0xffffffff80000000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "zero_inf_7fc01234",
        operands: [0xffffffff00000000, 0xffffffff7f800000, 0xffffffff7fc01234],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_zero_7fc01234",
        operands: [0xffffffffff800000, 0xffffffff80000000, 0xffffffff7fc01234],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "zero_inf_7f800001",
        operands: [0xffffffff00000000, 0xffffffff7f800000, 0xffffffff7f800001],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_zero_7f800001",
        operands: [0xffffffffff800000, 0xffffffff80000000, 0xffffffff7f800001],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "zero_inf_ff800000",
        operands: [0xffffffff00000000, 0xffffffff7f800000, 0xffffffffff800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_zero_ff800000",
        operands: [0xffffffffff800000, 0xffffffff80000000, 0xffffffffff800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_opposite",
        operands: [0xffffffff7f800000, 0xffffffff3f800000, 0xffffffffff800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "inf_same",
        operands: [0xffffffffff800000, 0xffffffff3f800000, 0xffffffffff800000],
        result: [0xff800000, 0xff800000, 0xff800000, 0xff800000, 0xff800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "inf_addend",
        operands: [0xffffffff7f7fffff, 0xffffffff7f7fffff, 0xffffffffff800000],
        result: [0xff800000, 0xff800000, 0xff800000, 0xff800000, 0xff800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_0_ffffffff7fc01234",
        operands: [0xffffffff7fc01234, 0xffffffff3f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_0_ffffffff7f800001",
        operands: [0xffffffff7f800001, 0xffffffff3f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "special_operand_0_fffffffe7f800001",
        operands: [0xfffffffe7f800001, 0xffffffff3f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_0_7f800001",
        operands: [0x000000007f800001, 0xffffffff3f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_0_800000003f800000",
        operands: [0x800000003f800000, 0xffffffff3f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_1_ffffffff7fc01234",
        operands: [0xffffffff3f800000, 0xffffffff7fc01234, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_1_ffffffff7f800001",
        operands: [0xffffffff3f800000, 0xffffffff7f800001, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "special_operand_1_fffffffe7f800001",
        operands: [0xffffffff3f800000, 0xfffffffe7f800001, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_1_7f800001",
        operands: [0xffffffff3f800000, 0x000000007f800001, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_1_800000003f800000",
        operands: [0xffffffff3f800000, 0x800000003f800000, 0xffffffff3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_2_ffffffff7fc01234",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0xffffffff7fc01234],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_2_ffffffff7f800001",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0xffffffff7f800001],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "special_operand_2_fffffffe7f800001",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0xfffffffe7f800001],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_2_7f800001",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0x000000007f800001],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "special_operand_2_800000003f800000",
        operands: [0xffffffff3f800000, 0xffffffff3f800000, 0x800000003f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "malformed_addend_invalid_product",
        operands: [0xffffffff00000000, 0xffffffff7f800000, 0xfffffffe3f800000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "malformed_product_suppresses_false_invalid",
        operands: [0xfffffffe00000000, 0xffffffff7f800000, 0xffffffff00000000],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_0",
        operands: [0xffffffffe576ea4a, 0xffffffffea73d51e, 0xffffffff4999b534],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_1",
        operands: [0xfffffffe517d4b5e, 0xffffffffdf76a648, 0xffffffffcda0d904],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_2",
        operands: [0xffffffff464159b6, 0xffffffffc0a77685, 0xffffffff587b3928],
        result: [0x587b3928, 0x587b3927, 0x587b3927, 0x587b3928, 0x587b3928],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_3",
        operands: [0xffffffff9594855a, 0xffffffff2495bad0, 0xffffffff63a225a5],
        result: [0x63a225a5, 0x63a225a4, 0x63a225a4, 0x63a225a5, 0x63a225a5],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_4",
        operands: [0xffffffff8a04a8ae, 0xffffffff07d14a7f, 0xfffffffe0695972b],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_5",
        operands: [0xffffffffb29216c5, 0xffffffff8afa23a8, 0xffffffff18cc3def],
        result: [0x18cc3def, 0x18cc3def, 0x18cc3def, 0x18cc3df0, 0x18cc3def],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_6",
        operands: [0xfffffffecee73e54, 0xfffffffedd2fe528, 0xffffffff960df0e2],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_7",
        operands: [0xffffffff2b479383, 0xfffffffec84d9c64, 0xffffffff938e9e5c],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_8",
        operands: [0xffffffff44059460, 0xffffffff8ff48748, 0xffffffff0bafbc46],
        result: [0x947f2fad, 0x947f2fac, 0x947f2fad, 0x947f2fac, 0x947f2fad],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_9",
        operands: [0xffffffffd8a332be, 0xffffffff293f1b5b, 0xffffffff769ad3ad],
        result: [0x769ad3ad, 0x769ad3ac, 0x769ad3ac, 0x769ad3ad, 0x769ad3ad],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_10",
        operands: [0xffffffff5022ad4a, 0xffffffff5ea0fa90, 0xffffffff59bb1f65],
        result: [0x6f4c970e, 0x6f4c970d, 0x6f4c970d, 0x6f4c970e, 0x6f4c970e],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_11",
        operands: [0xffffffff0c15101b, 0xffffffff3abc5cfb, 0xffffffff43457a82],
        result: [0x43457a82, 0x43457a82, 0x43457a82, 0x43457a83, 0x43457a82],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_12",
        operands: [0xffffffff1e2310f7, 0xfffffffe0ee98b16, 0xffffffffdaf45d80],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_13",
        operands: [0xffffffff0d90d53b, 0xffffffff51bbda51, 0xffffffffffee19a5],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_14",
        operands: [0xffffffffed0f0cd6, 0xffffffff3a12e74f, 0xfffffffe12b4f141],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_15",
        operands: [0xffffffff3c43e8e3, 0xffffffff083937f2, 0xffffffff5aa0f91d],
        result: [0x5aa0f91d, 0x5aa0f91d, 0x5aa0f91d, 0x5aa0f91e, 0x5aa0f91d],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_16",
        operands: [0xffffffff3e565faf, 0xffffffffa9e8f8d0, 0xfffffffef5dd1d21],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_17",
        operands: [0xffffffff8263cf5b, 0xffffffff2675be05, 0xffffffff9ae47439],
        result: [0x9ae47439, 0x9ae47439, 0x9ae4743a, 0x9ae47439, 0x9ae47439],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_18",
        operands: [0xffffffff81699291, 0xfffffffff5b5c5f4, 0xffffffff3b6f537f],
        result: [0x3b709f31, 0x3b709f31, 0x3b709f31, 0x3b709f32, 0x3b709f31],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_19",
        operands: [0xfffffffe3c90b219, 0xfffffffffafc353d, 0xffffffff188d2217],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_20",
        operands: [0xfffffffefa905d93, 0xffffffff8f1079e8, 0xffffffffdd1b231b],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_21",
        operands: [0xffffffffdb30b39d, 0xffffffff71ad95ba, 0xfffffffe10bee011],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_22",
        operands: [0xffffffffde07b991, 0xffffffff9423f2a2, 0xfffffffffa2d5dc7],
        result: [0xfa2d5dc7, 0xfa2d5dc6, 0xfa2d5dc7, 0xfa2d5dc6, 0xfa2d5dc7],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_c3a85d176901b2ef_23",
        operands: [0xfffffffffc4e96bc, 0xffffffff11e62491, 0xffffffffdfeeec98],
        result: [0xdfeeec98, 0xdfeeec98, 0xdfeeec99, 0xdfeeec98, 0xdfeeec98],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_0",
        operands: [0xffffffffd4617afd, 0xffffffffde58a748, 0xffffffff1328c406],
        result: [0x733ed31c, 0x733ed31c, 0x733ed31c, 0x733ed31d, 0x733ed31c],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_1",
        operands: [0xffffffff7fa3540e, 0xffffffff9544d126, 0xffffffffb576d104],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        name: "seed_1fab8423d97ec65_2",
        operands: [0xfffffffe68c4fda6, 0xffffffffad24dddd, 0xffffffff48be4326],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_3",
        operands: [0xffffffff279b3620, 0xffffffffed45884c, 0xffffffff2c4c905c],
        result: [0xd56f8693, 0xd56f8692, 0xd56f8693, 0xd56f8692, 0xd56f8693],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_4",
        operands: [0xffffffffadc39e7c, 0xffffffff6f300640, 0xffffffff8fbff64c],
        result: [0xdd8681bc, 0xdd8681bb, 0xdd8681bc, 0xdd8681bb, 0xdd8681bc],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_5",
        operands: [0xffffffff9cd49aa0, 0xfffffffff0b59b95, 0xffffffff6684b5e2],
        result: [0x6684b5e2, 0x6684b5e2, 0x6684b5e2, 0x6684b5e3, 0x6684b5e2],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_6",
        operands: [0xffffffff5dca8409, 0xffffffff49d33341, 0xfffffffff92a6567],
        result: [0xf92a6567, 0xf92a6566, 0xf92a6567, 0xf92a6566, 0xf92a6567],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_7",
        operands: [0xffffffff8c37886d, 0xffffffff4fba5c3d, 0xffffffff6dbf87c5],
        result: [0x6dbf87c5, 0x6dbf87c4, 0x6dbf87c4, 0x6dbf87c5, 0x6dbf87c5],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_8",
        operands: [0xffffffff4769a98a, 0xffffffff820e5859, 0xffffffff82c572a9],
        result: [0x8a01ee39, 0x8a01ee38, 0x8a01ee39, 0x8a01ee38, 0x8a01ee39],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_9",
        operands: [0xffffffffaad1720c, 0xffffffffca49d3e8, 0xffffffff3b4aba4f],
        result: [0x3b4acef3, 0x3b4acef2, 0x3b4acef2, 0x3b4acef3, 0x3b4acef3],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_10",
        operands: [0xfffffffe352d5cfb, 0xffffffff1c8b5882, 0xffffffff5e122eb3],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_11",
        operands: [0xffffffff5dafc62e, 0xffffffff9264d222, 0xffffffff7a3cd306],
        result: [0x7a3cd306, 0x7a3cd305, 0x7a3cd305, 0x7a3cd306, 0x7a3cd306],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_12",
        operands: [0xffffffffc9dcab20, 0xffffffff76edda76, 0xfffffffee2bc5c42],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_13",
        operands: [0xffffffffe312747a, 0xfffffffebce20e12, 0xffffffff73c60e8e],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_14",
        operands: [0xffffffff6b55e113, 0xffffffff3efb6e11, 0xffffffff68853c8d],
        result: [0x6ada636b, 0x6ada636b, 0x6ada636b, 0x6ada636c, 0x6ada636b],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_15",
        operands: [0xffffffff81e2b5b4, 0xffffffff1f449ddf, 0xffffffff2bae8324],
        result: [0x2bae8324, 0x2bae8323, 0x2bae8323, 0x2bae8324, 0x2bae8324],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_16",
        operands: [0xfffffffee4799722, 0xffffffff3428ec8c, 0xffffffff2f401e55],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_17",
        operands: [0xffffffff6a81ab29, 0xfffffffff325423f, 0xffffffff7722677b],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_1fab8423d97ec65_18",
        operands: [0xffffffff8d509d75, 0xffffffff55ddc10f, 0xffffffffbebdd94d],
        result: [0xbebdd94d, 0xbebdd94d, 0xbebdd94e, 0xbebdd94d, 0xbebdd94d],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_19",
        operands: [0xffffffffa8e151bf, 0xfffffffff86b1cdc, 0xffffffffad0d7de5],
        result: [0x61ceef71, 0x61ceef70, 0x61ceef70, 0x61ceef71, 0x61ceef71],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_20",
        operands: [0xffffffff9008be5e, 0xffffffff3d88f8a2, 0xffffffff657f81d3],
        result: [0x657f81d3, 0x657f81d2, 0x657f81d2, 0x657f81d3, 0x657f81d3],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_1fab8423d97ec65_21",
        operands: [0xfffffffff44f6a10, 0xffffffffeab770c4, 0xffffffff96ecaf25],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_1fab8423d97ec65_22",
        operands: [0xfffffffefd781f3b, 0xfffffffff6e841c5, 0xffffffffcd214006],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_1fab8423d97ec65_23",
        operands: [0xffffffffa6e7c306, 0xfffffffe923a0d00, 0xfffffffe2a09391a],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_0",
        operands: [0xffffffff50a7b6ee, 0xfffffffe8b308203, 0xffffffffafc803c7],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_1",
        operands: [0xffffffff4eef8200, 0xffffffff87dadd04, 0xffffffff6ebea9be],
        result: [0x6ebea9be, 0x6ebea9bd, 0x6ebea9bd, 0x6ebea9be, 0x6ebea9be],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_2",
        operands: [0xfffffffe08247b6d, 0xfffffffff5f148db, 0xffffffff6047fc8a],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_3",
        operands: [0xffffffffbf0f11f3, 0xffffffff5fab1310, 0xffffffffc9de8136],
        result: [0xdf3f3749, 0xdf3f3749, 0xdf3f374a, 0xdf3f3749, 0xdf3f3749],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_4",
        operands: [0xffffffff5aa3b1b4, 0xffffffffe9621bd7, 0xffffffff2d0cca20],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_5",
        operands: [0xffffffff04485bb4, 0xffffffff7726a603, 0xffffffff1bbf0b8f],
        result: [0x3c026d65, 0x3c026d64, 0x3c026d64, 0x3c026d65, 0x3c026d65],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_6",
        operands: [0xffffffff778b7658, 0xffffffffe61af6b4, 0xffffffff8b0fee59],
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_7",
        operands: [0xfffffffe57a347c5, 0xffffffffa131500a, 0xffffffff6872702a],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_8",
        operands: [0xffffffff86afde4a, 0xffffffff79705376, 0xfffffffff158ae50],
        result: [0xf158ae50, 0xf158ae50, 0xf158ae51, 0xf158ae50, 0xf158ae50],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_9",
        operands: [0xfffffffe69438b0c, 0xffffffff80264f1a, 0xffffffffef5e8504],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_10",
        operands: [0xffffffffcb9df90e, 0xffffffff32ad417c, 0xffffffffda4bc4fe],
        result: [0xda4bc4fe, 0xda4bc4fe, 0xda4bc4ff, 0xda4bc4fe, 0xda4bc4fe],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_11",
        operands: [0xffffffff887facf7, 0xffffffff5bc68e6e, 0xffffffff02fb58f2],
        result: [0xa4c64e07, 0xa4c64e06, 0xa4c64e07, 0xa4c64e06, 0xa4c64e07],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_12",
        operands: [0xffffffff02b0d2c3, 0xfffffffe939563a6, 0xffffffff6c5c60e1],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_13",
        operands: [0xfffffffe0540c060, 0xffffffffd0b659e0, 0xffffffff8b1b4d53],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_14",
        operands: [0xffffffff43664f09, 0xffffffffb43c61d7, 0xffffffff47de8cd4],
        result: [0x47de8cd4, 0x47de8cd3, 0x47de8cd3, 0x47de8cd4, 0x47de8cd4],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_15",
        operands: [0xffffffff92f284cd, 0xffffffff2ee7f284, 0xffffffff4fd41c61],
        result: [0x4fd41c61, 0x4fd41c60, 0x4fd41c60, 0x4fd41c61, 0x4fd41c61],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_16",
        operands: [0xffffffff3bf28c19, 0xffffffff68274f41, 0xffffffff29f2f19f],
        result: [0x649e847b, 0x649e847b, 0x649e847b, 0x649e847c, 0x649e847b],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_17",
        operands: [0xffffffffc45693bc, 0xffffffff413b519b, 0xffffffffb8ae21f8],
        result: [0xc61d0251, 0xc61d0251, 0xc61d0252, 0xc61d0251, 0xc61d0251],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_18",
        operands: [0xfffffffe131e03bb, 0xffffffffb437b17c, 0xffffffff42a0011e],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_19",
        operands: [0xffffffffad3ec69c, 0xffffffffab249c11, 0xffffffff2a05f169],
        result: [0x2a05f169, 0x2a05f169, 0x2a05f169, 0x2a05f16a, 0x2a05f169],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_20",
        operands: [0xffffffff889680cb, 0xffffffff382aff0a, 0xfffffffe55ec2874],
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_21",
        operands: [0xffffffff4f0b6d24, 0xffffffff7516b2fe, 0xffffffff1039e01b],
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_22",
        operands: [0xffffffffc254f51b, 0xffffffff502c7a31, 0xfffffffffbde8e85],
        result: [0xfbde8e85, 0xfbde8e85, 0xfbde8e86, 0xfbde8e85, 0xfbde8e85],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        name: "seed_7e934b1ac652d08f_23",
        operands: [0xffffffff53ea32d8, 0xffffffffd8e050bd, 0xfffffffffdea1f5c],
        result: [0xfdea1f5c, 0xfdea1f5c, 0xfdea1f5d, 0xfdea1f5c, 0xfdea1f5c],
        flags: [1, 1, 1, 1, 1],
    },
];
