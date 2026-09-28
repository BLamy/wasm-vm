//! Independent comparison/state critic: literal encodings and integer-only goldens.
//! This module deliberately does not call the interpreter's floating-point helpers.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const PC: u64 = 0x4000_6000;
const BOX: u64 = 0xffff_ffff_0000_0000;
const SENTINEL: u64 = 0x0123_4567_89ab_cdef;

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

pub fn comparison(kind: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    0xa000_0053
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (kind << 12)
        | (u32::from(rd) << 7)
}

pub fn block(at: u64, words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        at,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("independent comparison encoding"),
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
    // SAFETY: the live Machine owns disjoint Hart/SystemBus components; the
    // generated call is synchronous and neither reference escapes it.
    let before = e.executed_blocks();
    let exit = unsafe { e.execute(at, (*ptr).hart_mut(), (*ptr).bus_mut()).unwrap() };
    assert_eq!(
        e.executed_blocks(),
        before + 1,
        "comparison must execute generated code"
    );
    exit
}

pub fn interpreted(m: &mut Machine, raw: u32) {
    let ptr: *mut Machine = m;
    // SAFETY: same disjoint live Machine components, synchronous interpreter call.
    unsafe {
        (*ptr)
            .hart_mut()
            .exec_oracle((*ptr).bus_mut(), decode(raw).unwrap(), 4, u64::from(raw))
            .unwrap();
    }
}

fn xregs(m: &Machine) -> [u64; 32] {
    core::array::from_fn(|r| m.hart().regs.read(r as u8))
}

pub fn fregs(m: &Machine) -> [u64; 32] {
    core::array::from_fn(|r| m.hart().fregs.read_raw(r as u8))
}

fn next(random: &mut u64) -> u64 {
    *random ^= *random << 13;
    *random ^= *random >> 7;
    *random ^= *random << 17;
    *random
}

fn operand(raw: u64) -> u32 {
    if raw >> 32 == u64::from(u32::MAX) {
        raw as u32
    } else {
        0x7fc0_0000
    }
}

/// IEEE binary32 ordering from sign/magnitude integers, independent of softfloat
/// and native floating-point comparisons. kind follows RISC-V funct3: LE/LT/EQ.
fn expected(kind: u32, raw_a: u64, raw_b: u64) -> (u64, u8) {
    let a = operand(raw_a);
    let b = operand(raw_b);
    let nan = |x: u32| x & 0x7fff_ffff > 0x7f80_0000;
    let signaling = |x: u32| nan(x) && x & 0x0040_0000 == 0;
    if nan(a) || nan(b) {
        return (
            0,
            if kind != 2 || signaling(a) || signaling(b) {
                16
            } else {
                0
            },
        );
    }
    let equal = a == b || ((a | b) & 0x7fff_ffff == 0);
    let less = !equal
        && if a >> 31 != b >> 31 {
            a >> 31 == 1
        } else if a >> 31 == 1 {
            a > b
        } else {
            a < b
        };
    (
        u64::from(match kind {
            0 => equal || less,
            1 => less,
            2 => equal,
            _ => unreachable!(),
        }),
        0,
    )
}

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    // (raw a, raw b, [LE, LT, EQ], invalid for LE/LT, invalid for EQ)
    let goldens = [
        (BOX, BOX | 0x8000_0000, [1, 0, 1], 0, 0),
        (BOX | 0x8000_0000, BOX, [1, 0, 1], 0, 0),
        (BOX | 0xff80_0000, BOX | 0xff7f_ffff, [1, 1, 0], 0, 0),
        (BOX | 0xc000_0000, BOX | 0xbf80_0000, [1, 1, 0], 0, 0),
        (BOX | 0xbf80_0000, BOX | 0xc000_0000, [0, 0, 0], 0, 0),
        (BOX | 0x8000_0001, BOX, [1, 1, 0], 0, 0),
        (BOX, BOX | 1, [1, 1, 0], 0, 0),
        (BOX | 0x007f_ffff, BOX | 0x0080_0000, [1, 1, 0], 0, 0),
        (BOX | 0x3f80_0000, BOX | 0x3f80_0001, [1, 1, 0], 0, 0),
        (BOX | 0x7f7f_ffff, BOX | 0x7f80_0000, [1, 1, 0], 0, 0),
        (BOX | 0x7f80_0000, BOX | 0x7f80_0000, [1, 0, 1], 0, 0),
        (BOX | 0xff80_0000, BOX | 0xff80_0000, [1, 0, 1], 0, 0),
        (BOX | 0x7fc0_0123, BOX | 0x3f80_0000, [0, 0, 0], 16, 0),
        (BOX | 0x3f80_0000, BOX | 0xffc0_0123, [0, 0, 0], 16, 0),
        (BOX | 0x7f80_0001, BOX | 0x3f80_0000, [0, 0, 0], 16, 16),
        (BOX | 0x3f80_0000, BOX | 0xff80_0001, [0, 0, 0], 16, 16),
        (BOX | 0x7fc0_0000, BOX | 0xff80_0001, [0, 0, 0], 16, 16),
        (0xffff_fffe_7f80_0001, BOX | 0x3f80_0000, [0, 0, 0], 16, 0),
        (BOX | 0x3f80_0000, 0x0000_0000_ff80_0001, [0, 0, 0], 16, 0),
        (0x7ff0_0000_0000_0000, BOX, [0, 0, 0], 16, 0),
        (BOX | 0x7f80_0000, 0x1234_5678_0000_0000, [0, 0, 0], 16, 0),
    ];
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for kind in [2, 1, 0] {
        e.invalidate_all();
        e.install(&block(DRAM_BASE, &[comparison(kind, 31, 0, 31)]));
        assert!(e.is_compiled(DRAM_BASE));
        for (case, &(a, b, results, ordered_nv, eq_nv)) in goldens.iter().enumerate() {
            for initial in 0..32_u8 {
                fs(&mut m, 1 + u64::from(initial % 3));
                m.hart_mut().regs.pc = PC;
                m.hart_mut().regs.write(31, SENTINEL);
                m.hart_mut().fregs.write_raw(0, a);
                m.hart_mut().fregs.write_raw(31, b);
                m.hart_mut().csr.fflags = initial;
                m.hart_mut().csr.frm = initial % 8;
                let want_f = fregs(&m);
                let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                let nv = if kind == 2 { eq_nv } else { ordered_nv };
                assert_eq!(exit.code, ExitCode::Fallthrough);
                assert_eq!(exit.next_pc, PC + 4);
                assert_eq!(exit.retired, u64::from(inline));
                if case == 0 && kind == 2 {
                    assert_eq!(m.hart().regs.read(31), 1, "CRITIC_FEQ_SIGNED_ZERO_GOLDEN");
                }
                assert_eq!(
                    m.hart().regs.read(31),
                    results[kind as usize],
                    "golden case={case} kind={kind}"
                );
                assert_eq!(fregs(&m), want_f);
                assert_eq!(m.hart().regs.read(0), 0);
                assert_eq!(
                    m.hart().csr.fflags,
                    initial | nv,
                    "golden flags case={case} kind={kind}"
                );
                assert_eq!(m.hart().csr.frm, initial % 8);
                assert_eq!(m.hart().csr.fs(), 3);
                assert_ne!(m.hart().csr.mstatus & (1 << 63), 0);
                receipt.record([
                    a,
                    b,
                    kind as u64,
                    m.hart().regs.read(31),
                    u64::from(m.hart().csr.fflags),
                ]);
            }
        }
    }
    assert_eq!(receipt.cases, 2016);
    receipt
}

pub fn seeded_aliases_and_fs(make: Factory, inline: bool) -> Receipt {
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
    for kind in [0, 1, 2] {
        for (rd, rs1, rs2) in aliases {
            let raw = comparison(kind, rd, rs1, rs2);
            e.invalidate_all();
            // Integer prefix and suffix bound the exact FS-Off exit.
            e.install(&block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]));
            assert!(e.is_compiled(DRAM_BASE));
            for seed in [
                0x91ae_5362_774b_d8cf,
                0xc274_86f1_a501_39ed,
                0x38b7_10ad_ce95_6243,
            ] {
                let mut random = seed;
                for sample in 0..64_u64 {
                    for r in 0..32_u8 {
                        m.hart_mut().regs.write(r, next(&mut random));
                        let bits = next(&mut random);
                        let raw = match sample % 8 {
                            0..=3 => BOX | (bits & 0xffff_ffff),
                            4 => BOX | 0x7f80_0001 | (bits & 0x803f_ffff),
                            5 => BOX | 0x7fc0_0000 | (bits & 0x803f_ffff),
                            6 => 0xffff_fffe_0000_0000 | (bits & 0xffff_ffff),
                            _ => bits,
                        };
                        m.hart_mut().fregs.write_raw(r, raw);
                    }
                    let initial_fs = (sample / 8) % 4;
                    fs(&mut m, initial_fs);
                    let initial_flags = (sample / 2) as u8;
                    let frm = (sample % 8) as u8;
                    m.hart_mut().csr.fflags = initial_flags;
                    m.hart_mut().csr.frm = frm;
                    m.hart_mut().regs.pc = PC + sample * 16;
                    let mut want_x = xregs(&m);
                    let want_f = fregs(&m);
                    let initial_status = m.hart().csr.mstatus;
                    let (result, invalid) =
                        expected(kind, want_f[rs1 as usize], want_f[rs2 as usize]);
                    want_x[12] = want_x[12].wrapping_add(1);
                    if initial_fs != 0 {
                        if rd != 0 {
                            want_x[rd as usize] = result;
                        }
                        want_x[13] = want_x[13].wrapping_add(1);
                    }
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(
                        xregs(&m),
                        want_x,
                        "kind={kind} sample={sample} aliases={rd}/{rs1}/{rs2}"
                    );
                    assert_eq!(fregs(&m), want_f);
                    assert_eq!(m.hart().csr.frm, frm);
                    if initial_fs == 0 {
                        receipt.disabled += 1;
                        assert_eq!(exit.code, ExitCode::IllegalInstruction);
                        assert_eq!(exit.next_pc, PC + sample * 16 + 4);
                        assert_eq!(exit.exit_info, u64::from(raw));
                        assert_eq!(exit.retired, u64::from(inline));
                        assert_eq!(m.hart().csr.mstatus, initial_status);
                        assert_eq!(m.hart().csr.fflags, initial_flags);
                    } else {
                        assert_eq!(exit.code, ExitCode::Fallthrough);
                        assert_eq!(exit.next_pc, PC + sample * 16 + 12);
                        assert_eq!(exit.retired, if inline { 3 } else { 0 });
                        assert_eq!(
                            m.hart().csr.mstatus,
                            (initial_status & !0x6000) | 0x8000_0000_0000_6000
                        );
                        assert_eq!(m.hart().csr.fflags, initial_flags | invalid);
                    }
                    receipt.record(xregs(&m).into_iter().chain(fregs(&m)).chain([
                        exit.next_pc,
                        raw as u64,
                        m.hart().csr.mstatus,
                        u64::from(m.hart().csr.fflags),
                        u64::from(frm),
                    ]));
                }
            }
        }
    }
    assert_eq!(receipt.cases, 4608);
    assert_eq!(receipt.disabled, 1152);
    receipt
}

pub fn control_handoff_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut receipt = Receipt::new();
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    e.install(&block(DRAM_BASE, &[comparison(1, 4, 1, 2)]));
    e.install(&block(DRAM_BASE + 0x40, &[comparison(2, 5, 1, 2)]));
    assert!(e.is_compiled(DRAM_BASE) && e.is_compiled(DRAM_BASE + 0x40));
    fs(&mut m, 2);
    m.hart_mut().csr.fflags = 9;
    m.hart_mut().csr.frm = 7;
    m.hart_mut().fregs.write_raw(1, BOX | 0x7fc0_0123);
    m.hart_mut().fregs.write_raw(2, BOX | 0x3f80_0000);
    let unchanged_f = fregs(&m);
    for round in 0..8_u8 {
        m.hart_mut().regs.pc = PC;
        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
        assert_eq!(exit.code, ExitCode::Fallthrough);
        assert_eq!(m.hart().csr.fflags & 16, 16);
        // Real CSRR[S] x10,fflags,x0 sees newly generated NV.
        interpreted(&mut m, 0x0010_2573);
        assert_eq!(m.hart().regs.read(10), u64::from(m.hart().csr.fflags));
        assert_ne!(m.hart().regs.read(10) & 16, 0);
        // Real CSRRW x0,fcsr,x9 replaces flags AND frm. FPRs do not change.
        m.hart_mut().regs.write(9, u64::from((round << 5) | 1));
        interpreted(&mut m, 0x0034_9073);
        assert_eq!(m.hart().csr.fflags, 1);
        assert_eq!(m.hart().csr.frm, round);
        m.hart_mut().regs.pc = PC + 0x40;
        let exit = execute(e.as_mut(), &mut m, DRAM_BASE + 0x40);
        assert_eq!(exit.code, ExitCode::Fallthrough);
        assert_eq!(
            m.hart().csr.fflags,
            1,
            "a fresh fcsr cannot resurrect old NV"
        );
        assert_eq!(m.hart().csr.frm, round);
        assert_eq!(m.hart().regs.read(5), 0);
        assert_eq!(fregs(&m), unchanged_f);
        receipt.record([
            u64::from(round),
            u64::from(m.hart().csr.fflags),
            exit.next_pc,
        ]);
    }
    // A real interpreted move invalidates only the FPR cache; equal operands then compare true.
    m.hart_mut().regs.write(9, 0x3f80_0000);
    interpreted(&mut m, 0xf004_80d3); // fmv.w.x f1,x9
    m.hart_mut().regs.pc = PC + 0x40;
    execute(e.as_mut(), &mut m, DRAM_BASE + 0x40);
    assert_eq!(m.hart().regs.read(5), 1);
    assert_eq!(m.hart().fregs.read_raw(1), BOX | 0x3f80_0000);
    assert_eq!(m.hart().csr.fflags, 1);
    for (memory, cause) in [
        (0x0003_3383, Exception::LoadAccessFault),
        (0x01f3_3023, Exception::StoreAccessFault),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[comparison(2, 31, 1, 2), memory, 0x0016_8693],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 1);
        m.hart_mut().csr.fflags = 10;
        m.hart_mut().csr.frm = 6;
        m.hart_mut().fregs.write_raw(1, BOX | 0xff80_0001);
        m.hart_mut().fregs.write_raw(2, BOX | 0x3f80_0000);
        let want_f = fregs(&m);
        m.hart_mut().regs.pc = PC;
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.write(7, SENTINEL);
        m.hart_mut().regs.write(13, 11);
        m.hart_mut().regs.write(31, SENTINEL);
        let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
        assert_eq!(exit.code, ExitCode::Trap);
        assert_eq!(
            exit.trap,
            Some(Trap {
                cause,
                tval: 0x5000_0000
            })
        );
        assert_eq!(exit.next_pc, PC + 4);
        assert_eq!(exit.retired, u64::from(inline));
        assert_eq!(m.hart().regs.read(31), 0);
        assert_eq!(m.hart().regs.read(7), SENTINEL);
        assert_eq!(m.hart().regs.read(13), 11);
        assert_eq!(m.hart().csr.fflags, 26);
        assert_eq!(m.hart().csr.frm, 6);
        assert_eq!(m.hart().csr.fs(), 3);
        assert_eq!(fregs(&m), want_f);
        receipt.record([exit.next_pc, u64::from(m.hart().csr.fflags), memory as u64]);
    }
    assert_eq!(receipt.cases, 10);
    receipt
}
