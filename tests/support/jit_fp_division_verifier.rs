//! Independent FDIV.S critic. Literals are derived by exact rational arithmetic
//! in evidence/omarchy-profile/fp-division-verifier/derive-goldens.py.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const PC: u64 = 0x4000_b800;
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

pub fn division(rd: u8, rs1: u8, rs2: u8, rm: u8) -> u32 {
    0x1800_0053
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
                instr: decode(raw).expect("independent division encoding"),
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
    a: u64,
    b: u64,
    result: [u32; 5],
    flags: [u8; 5],
}
const GOLDENS: &[Golden] = &[
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff40400000,
        result: [0x3eaaaaab, 0x3eaaaaaa, 0x3eaaaaaa, 0x3eaaaaab, 0x3eaaaaab],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffffbf800000,
        b: 0xffffffff40400000,
        result: [0xbeaaaaab, 0xbeaaaaaa, 0xbeaaaaab, 0xbeaaaaaa, 0xbeaaaaab],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff40000000,
        b: 0xffffffff40400000,
        result: [0x3f2aaaab, 0x3f2aaaaa, 0x3f2aaaaa, 0x3f2aaaab, 0x3f2aaaab],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff41200000,
        result: [0x3dcccccd, 0x3dcccccc, 0x3dcccccc, 0x3dcccccd, 0x3dcccccd],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff40400000,
        b: 0xffffffff40000000,
        result: [0x3fc00000, 0x3fc00000, 0x3fc00000, 0x3fc00000, 0x3fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffffc1100000,
        b: 0xffffffffc0400000,
        result: [0x40400000, 0x40400000, 0x40400000, 0x40400000, 0x40400000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00000000,
        b: 0xffffffff3f800000,
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff80000000,
        b: 0xffffffff3f800000,
        result: [0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00000000,
        b: 0xffffffffbf800000,
        result: [0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff80000000,
        b: 0xffffffffbf800000,
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff00000000,
        result: [0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000],
        flags: [8, 8, 8, 8, 8],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff80000000,
        result: [0xff800000, 0xff800000, 0xff800000, 0xff800000, 0xff800000],
        flags: [8, 8, 8, 8, 8],
    },
    Golden {
        a: 0xffffffffbf800000,
        b: 0xffffffff80000000,
        result: [0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000],
        flags: [8, 8, 8, 8, 8],
    },
    Golden {
        a: 0xffffffff00000000,
        b: 0xffffffff00000000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff80000000,
        b: 0xffffffff00000000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff7f800000,
        b: 0xffffffff00000000,
        result: [0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffffff800000,
        b: 0xffffffff80000000,
        result: [0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff7f800000,
        b: 0xffffffff7f800000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffffff800000,
        b: 0xffffffff7f800000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffffff800000,
        result: [0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffffbf800000,
        b: 0xffffffffff800000,
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffffff800000,
        b: 0xffffffffbf800000,
        result: [0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000, 0x7f800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff7fc04321,
        b: 0xffffffff00000000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00000000,
        b: 0xffffffffffc00042,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff7f800001,
        b: 0xffffffff3f800000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff7fc00042,
        b: 0xffffffffff800042,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff00000001,
        b: 0xffffffff40000000,
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000001, 0x00000001],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff80000001,
        b: 0xffffffff40000000,
        result: [0x80000000, 0x80000000, 0x80000001, 0x80000000, 0x80000001],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff00000003,
        b: 0xffffffff40000000,
        result: [0x00000002, 0x00000001, 0x00000001, 0x00000002, 0x00000002],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff80000003,
        b: 0xffffffff40000000,
        result: [0x80000002, 0x80000001, 0x80000002, 0x80000001, 0x80000002],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff00800000,
        b: 0xffffffff40000000,
        result: [0x00400000, 0x00400000, 0x00400000, 0x00400000, 0x00400000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff007fffff,
        b: 0xffffffff3f000000,
        result: [0x00fffffe, 0x00fffffe, 0x00fffffe, 0x00fffffe, 0x00fffffe],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00ffffff,
        b: 0xffffffff40000000,
        result: [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff80ffffff,
        b: 0xffffffff40000000,
        result: [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff00800000,
        b: 0xffffffff3f800001,
        result: [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff80800000,
        b: 0xffffffff3f800001,
        result: [0x807fffff, 0x807fffff, 0x80800000, 0x807fffff, 0x807fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff00ffffff,
        b: 0xffffffff3fffffff,
        result: [0x00800000, 0x00800000, 0x00800000, 0x00800000, 0x00800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff80ffffff,
        b: 0xffffffff3fffffff,
        result: [0x80800000, 0x80800000, 0x80800000, 0x80800000, 0x80800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00800001,
        b: 0xffffffff3f800001,
        result: [0x00800000, 0x00800000, 0x00800000, 0x00800000, 0x00800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff00000001,
        b: 0xffffffff00000001,
        result: [0x3f800000, 0x3f800000, 0x3f800000, 0x3f800000, 0x3f800000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff00000001,
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        a: 0xffffffff00000001,
        b: 0xffffffff7f7fffff,
        result: [0x00000000, 0x00000000, 0x00000000, 0x00000001, 0x00000000],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff7f7fffff,
        b: 0xffffffff3f000000,
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        a: 0xffffffffff7fffff,
        b: 0xffffffff3f000000,
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        a: 0xffffffff7f7fffff,
        b: 0xffffffff3f7fffff,
        result: [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        a: 0xffffffffff7fffff,
        b: 0xffffffff3f7fffff,
        result: [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
        flags: [5, 5, 5, 5, 5],
    },
    Golden {
        a: 0xffffffff7f7ffffe,
        b: 0xffffffff3f7fffff,
        result: [0x7f7fffff, 0x7f7ffffe, 0x7f7ffffe, 0x7f7fffff, 0x7f7fffff],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffffff7ffffe,
        b: 0xffffffff3f7fffff,
        result: [0xff7fffff, 0xff7ffffe, 0xff7fffff, 0xff7ffffe, 0xff7fffff],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff3f800001,
        b: 0xffffffff3f800000,
        result: [0x3f800001, 0x3f800001, 0x3f800001, 0x3f800001, 0x3f800001],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xffffffff3f800001,
        result: [0x3f7ffffe, 0x3f7ffffe, 0x3f7ffffe, 0x3f7fffff, 0x3f7ffffe],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff00000001,
        b: 0xffffffff34000001,
        result: [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff80000001,
        b: 0xffffffff34000001,
        result: [0x807fffff, 0x807fffff, 0x80800000, 0x807fffff, 0x807fffff],
        flags: [3, 3, 3, 3, 3],
    },
    Golden {
        a: 0xffffffff00800000,
        b: 0xffffffff3f7fffff,
        result: [0x00800001, 0x00800000, 0x00800000, 0x00800001, 0x00800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xffffffff80800000,
        b: 0xffffffff3f7fffff,
        result: [0x80800001, 0x80800000, 0x80800001, 0x80800000, 0x80800001],
        flags: [1, 1, 1, 1, 1],
    },
    Golden {
        a: 0xfffffffe7f800001,
        b: 0xffffffff00000000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0xffffffff3f800000,
        b: 0xfffffffe00000000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
    Golden {
        a: 0x000000007f800001,
        b: 0xffffffffff800001,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0xffffffff7f800001,
        b: 0x00000000ff800001,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [16, 16, 16, 16, 16],
    },
    Golden {
        a: 0x000000003f800000,
        b: 0x800000003f800000,
        result: [0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000, 0x7fc00000],
        flags: [0, 0, 0, 0, 0],
    },
];

pub fn literal_goldens(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut oracle = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    for rm in [0, 1, 2, 3, 4, 7] {
        e.invalidate_all();
        let raw = division(31, 0, 30, rm);
        e.install(&block(DRAM_BASE, &[raw]));
        assert!(e.is_compiled(DRAM_BASE));
        for (case, g) in GOLDENS.iter().enumerate() {
            for initial in 0..32_u8 {
                let frm = if rm == 7 { initial % 5 } else { initial % 8 };
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
                    machine.hart_mut().fregs.write_raw(0, g.a);
                    machine.hart_mut().fregs.write_raw(30, g.b);
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
                        BOX | 0x3eaa_aaab,
                        "CRITIC_FDIV_THIRD_GOLDEN"
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
                interpreted(&mut oracle, raw);
                assert_eq!(fregs(&oracle), want_f, "interpreter literal case={case}");
                assert_eq!(
                    oracle.hart().csr.fflags,
                    initial | g.flags[mode],
                    "interpreter flags case={case} mode={mode}"
                );
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
    assert_eq!(receipt.cases, GOLDENS.len() as u64 * 6 * 32);
    receipt
}
fn next(random: &mut u64) -> u64 {
    *random ^= *random << 13;
    *random ^= *random >> 7;
    *random ^= *random << 17;
    *random
}

pub fn seeded_aliases_and_illegal(make: Factory, inline: bool) -> Receipt {
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
    for (rd, rs1, rs2) in aliases {
        for rm in 0..8_u8 {
            let raw = division(rd, rs1, rs2, rm);
            e.invalidate_all();
            e.install(&block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]));
            assert!(e.is_compiled(DRAM_BASE));
            for seed in [
                0x7614_afe3_b628_0d9a,
                0x998c_1f76_00e2_a4b3,
                0x46d3_e807_af92_516c,
            ] {
                let mut random = seed;
                for sample in 0..16_u64 {
                    // Same arbitrary significand at varying signs/exponents: every
                    // valid ratio is an exact signed power of two, independently known.
                    let fraction = (next(&mut random) & 0x7f_ffff) as u32;
                    for r in 0..32_u8 {
                        m.hart_mut().regs.write(r, next(&mut random));
                        let v = next(&mut random);
                        let exponent = 67 + (v % 121) as u32;
                        let bits = ((v >> 32) as u32 & 0x8000_0000) | (exponent << 23) | fraction;
                        let boxed = if v.is_multiple_of(5) {
                            0xffff_fffe_0000_0000
                        } else {
                            BOX
                        };
                        m.hart_mut().fregs.write_raw(r, boxed | u64::from(bits));
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
                        let a = want_f[rs1 as usize];
                        let b = want_f[rs2 as usize];
                        let bits = if a >> 32 != 0xffff_ffff || b >> 32 != 0xffff_ffff {
                            0x7fc0_0000
                        } else {
                            let exponent =
                                ((a >> 23) & 255) as i32 - ((b >> 23) & 255) as i32 + 127;
                            ((a ^ b) as u32 & 0x8000_0000) | ((exponent as u32) << 23)
                        };
                        want_f[rd as usize] = BOX | u64::from(bits);
                        want_x[13] = want_x[13].wrapping_add(1);
                    }
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE);
                    assert_eq!(xregs(&m), want_x);
                    assert_eq!(
                        fregs(&m),
                        want_f,
                        "seed={seed:x} sample={sample} rm={rm} alias={rd}/{rs1}/{rs2}"
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
    assert_eq!(receipt.cases, 3072);
    assert_eq!(receipt.disabled, 1488);
    receipt
}

pub fn control_and_faults(make: Factory, inline: bool) -> Receipt {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut receipt = Receipt::new();
    e.install(&block(DRAM_BASE, &[division(31, 1, 2, 7)]));
    assert!(e.is_compiled(DRAM_BASE));
    fs(&mut m, 1);
    m.hart_mut().fregs.write_raw(1, BOX | 1);
    m.hart_mut().fregs.write_raw(2, BOX | 0x4000_0000);
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
        interpreted(&mut m, 0x0010_2573); // csrrs x10,fflags,x0
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
        (division(0, 1, 2, 5), None),
    ] {
        e.invalidate_all();
        e.install(&block(
            DRAM_BASE,
            &[
                division(3, 1, 2, 3),
                division(4, 2, 0, 0),
                suffix,
                0x0016_8693,
            ],
        ));
        assert!(e.is_compiled(DRAM_BASE));
        fs(&mut m, 2);
        m.hart_mut().csr.fflags = 16;
        m.hart_mut().csr.frm = 6;
        m.hart_mut().fregs.write_raw(0, BOX);
        m.hart_mut().fregs.write_raw(1, BOX | 1);
        m.hart_mut().fregs.write_raw(2, BOX | 0x4000_0000);
        for r in [3, 4, 7, 13] {
            m.hart_mut().regs.write(r, SENTINEL);
        }
        m.hart_mut().regs.write(6, 0x5000_0000);
        m.hart_mut().regs.pc = PC;
        let want_x = xregs(&m);
        let mut want_f = fregs(&m);
        want_f[3] = BOX | 1;
        want_f[4] = BOX | 0x7f80_0000;
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
        assert_eq!(m.hart().csr.fflags, 27);
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
