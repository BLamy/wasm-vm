//! Actual generated FCVT.W[U].S modules, interpreter checks and literal goldens.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::decode_c::expand_c;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const BAD: u64 = 0x5000_0000;
pub const fn boxed(bits: u32) -> u64 {
    0xffff_ffff_0000_0000 | bits as u64
}
pub fn conversion(width: u32, rm: u32, rd: u32, rs1: u32) -> u32 {
    (0x60 << 25) | (width << 20) | (rs1 << 15) | (rm << 12) | (rd << 7) | 0x53
}
pub fn block(pc: u64, parcels: &[u32]) -> DecodedBlock {
    let ops: Vec<_> = parcels
        .iter()
        .map(|&raw| {
            let short = raw & 3 != 3;
            MicroOp {
                raw,
                len: if short { 2 } else { 4 },
                instr: decode(if short {
                    expand_c(raw as u16).unwrap()
                } else {
                    raw
                })
                .unwrap(),
            }
        })
        .collect();
    let len = ops.iter().map(|op| u64::from(op.len)).sum();
    DecodedBlock::new(pc, ops, len)
}
pub fn fs(h: &mut Hart, value: u64) {
    h.csr
        .access(MSTATUS, CsrOp::Write, value << 13, false, false, 0)
        .unwrap();
}
pub fn execute(
    e: &mut dyn CompiledBlockExecutor,
    m: &mut Machine,
    pc: u64,
    fuel: u64,
    chain: bool,
) -> JitExit {
    let ptr: *mut Machine = m;
    // The machine owns the disjoint hart and bus throughout the synchronous call.
    unsafe {
        e.execute_with_budget(pc, (*ptr).hart_mut(), (*ptr).bus_mut(), fuel, fuel, chain)
            .unwrap()
    }
}
fn seed(m: &mut Machine, enabled: u64, mode: u8, flags: u8) {
    let h = m.hart_mut();
    for r in 0..32 {
        h.regs.write(r, 0x1234_5678_0000_0000 | u64::from(r));
        h.fregs.write_raw(r, 0x0abc_def0_0000_0000 | u64::from(r));
    }
    h.regs.pc = 0x4000_2000;
    h.regs.write(8, BAD);
    h.resv = Some((DRAM_BASE + 0x6000, 8));
    fs(h, enabled);
    h.csr.fflags = flags;
    h.csr.frm = mode;
}
fn compare(e: &mut dyn CompiledBlockExecutor, m: &mut Machine, b: &DecodedBlock) -> u64 {
    let h = m.hart();
    let mut oracle = Hart {
        regs: h.regs.clone(),
        fregs: h.fregs.clone(),
        csr: h.csr.clone(),
        resv: h.resv,
        ..Hart::default()
    };
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut trap = None;
    let mut retired = 0;
    for op in &b.ops {
        match oracle.exec_oracle(&mut bus, op.instr, op.len.into(), op.raw.into()) {
            Ok(_) => retired += 1,
            Err(t) => {
                trap = Some(t);
                break;
            }
        }
    }
    let exit = execute(e, m, b.phys_start, 256, false);
    let actual_trap = if exit.code == ExitCode::IllegalInstruction {
        Some(Trap {
            cause: Exception::IllegalInstruction,
            tval: exit.exit_info,
        })
    } else {
        exit.trap
    };
    assert_eq!(
        actual_trap, trap,
        "actual cause and original instruction bits"
    );
    assert_eq!(
        exit.next_pc, oracle.regs.pc,
        "virtual PC / completed prefix"
    );
    if exit.retired != 0 {
        assert_eq!(exit.retired, retired);
    }
    m.hart_mut().regs.pc = exit.next_pc;
    let mut digest = 0xcbf2_9ce4_8422_2325_u64;
    for r in 0..32 {
        assert_eq!(m.hart().regs.read(r), oracle.regs.read(r), "x{r}");
        assert_eq!(
            m.hart().fregs.read_raw(r),
            oracle.fregs.read_raw(r),
            "f{r} architectural result"
        );
        for word in [m.hart().regs.read(r), m.hart().fregs.read_raw(r)] {
            for byte in word.to_le_bytes() {
                digest = (digest ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
            }
        }
    }
    assert_eq!(m.hart().csr.fflags, oracle.csr.fflags, "sticky flags");
    assert_eq!(m.hart().csr.frm, oracle.csr.frm, "rounding mode unchanged");
    assert_eq!(m.hart().resv, oracle.resv);
    let status = m.hart_mut().csr.read(MSTATUS);
    assert_eq!(status, oracle.csr.read(MSTATUS));
    for word in [
        exit.next_pc,
        retired,
        status,
        u64::from(m.hart().csr.fflags),
        u64::from(m.hart().csr.frm),
        trap.map_or(0, |t| t.tval),
    ] {
        for byte in word.to_le_bytes() {
            digest = (digest ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
        }
    }
    digest
}

// Source, [signed,unsigned] word results and flags in RNE/RTZ/RDN/RUP/RMM order.
// Literal powers/ties/clipping boundaries; no oracle computes these expectations.
type Golden = (u64, [[u32; 5]; 2], [[u8; 5]; 2]);
const GOLDENS: &[Golden] = &[
    (boxed(0), [[0; 5]; 2], [[0; 5]; 2]),
    (boxed(0x8000_0000), [[0; 5]; 2], [[0; 5]; 2]),
    (boxed(0x3f80_0000), [[1; 5]; 2], [[0; 5]; 2]),
    (
        boxed(0xbf80_0000),
        [[u32::MAX; 5], [0; 5]],
        [[0; 5], [16; 5]],
    ),
    (boxed(0x3f00_0000), [[0, 0, 0, 1, 1]; 2], [[1; 5]; 2]),
    (
        boxed(0xbf00_0000),
        [[0, 0, u32::MAX, 0, u32::MAX], [0; 5]],
        [[1; 5], [1, 1, 16, 1, 16]],
    ),
    (boxed(0x3fc0_0000), [[2, 1, 1, 2, 2]; 2], [[1; 5]; 2]),
    (
        boxed(0xbfc0_0000),
        [
            [0xffff_fffe, u32::MAX, 0xffff_fffe, u32::MAX, 0xffff_fffe],
            [0; 5],
        ],
        [[1; 5], [16; 5]],
    ),
    (boxed(0x4020_0000), [[2, 2, 2, 3, 3]; 2], [[1; 5]; 2]),
    (
        boxed(0xc020_0000),
        [
            [
                0xffff_fffe,
                0xffff_fffe,
                0xffff_fffd,
                0xffff_fffe,
                0xffff_fffd,
            ],
            [0; 5],
        ],
        [[1; 5], [16; 5]],
    ),
    (boxed(0x3e80_0000), [[0, 0, 0, 1, 0]; 2], [[1; 5]; 2]),
    (
        boxed(0xbe80_0000),
        [[0, 0, u32::MAX, 0, 0], [0; 5]],
        [[1; 5], [1, 1, 16, 1, 1]],
    ),
    (boxed(0x3f40_0000), [[1, 0, 0, 1, 1]; 2], [[1; 5]; 2]),
    (
        boxed(0xbf40_0000),
        [[u32::MAX, 0, u32::MAX, 0, u32::MAX], [0; 5]],
        [[1; 5], [16, 1, 16, 1, 16]],
    ),
    (boxed(1), [[0, 0, 0, 1, 0]; 2], [[1; 5]; 2]),
    (
        boxed(0x8000_0001),
        [[0, 0, u32::MAX, 0, 0], [0; 5]],
        [[1; 5], [1, 1, 16, 1, 1]],
    ),
    (boxed(0x007f_ffff), [[0, 0, 0, 1, 0]; 2], [[1; 5]; 2]),
    (boxed(0x4eff_ffff), [[0x7fff_ff80; 5]; 2], [[0; 5]; 2]),
    (
        boxed(0x4f00_0000),
        [[0x7fff_ffff; 5], [0x8000_0000; 5]],
        [[16; 5], [0; 5]],
    ),
    (
        boxed(0xcf00_0000),
        [[0x8000_0000; 5], [0; 5]],
        [[0; 5], [16; 5]],
    ),
    (boxed(0xcf00_0001), [[0x8000_0000; 5], [0; 5]], [[16; 5]; 2]),
    (
        boxed(0x4f7f_ffff),
        [[0x7fff_ffff; 5], [0xffff_ff00; 5]],
        [[16; 5], [0; 5]],
    ),
    (
        boxed(0x4f80_0000),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        boxed(0x7f7f_ffff),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (boxed(0xff7f_ffff), [[0x8000_0000; 5], [0; 5]], [[16; 5]; 2]),
    (
        boxed(0x7f80_0000),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (boxed(0xff80_0000), [[0x8000_0000; 5], [0; 5]], [[16; 5]; 2]),
    (
        boxed(0x7fc0_0001),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        boxed(0xffc0_1234),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        boxed(0x7f80_0001),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        boxed(0xff80_0001),
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        0x1234_5678_3f80_0000,
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
    (
        0x0000_0000_ff80_0000,
        [[0x7fff_ffff; 5], [u32::MAX; 5]],
        [[16; 5]; 2],
    ),
];

pub fn corpus(make: Factory) {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut blocks = 0;
    let mut cases = 0;
    let mut digest = 0_u64;
    for width in 0..2 {
        for rm in 0..8 {
            for (rs1, rd) in [(31, 0), (5, 31), (0, 5)] {
                let b = block(
                    DRAM_BASE + blocks * 0x100,
                    &[0x0305, conversion(width, rm, rd, rs1), 0x0013_8393],
                );
                blocks += 1;
                e.install(&b);
                assert!(e.is_compiled(b.phys_start));
                for enabled in 0..=3 {
                    for mode in 0..8 {
                        for &(source, results, flags) in GOLDENS {
                            let prior = (cases as u8).wrapping_mul(7) & 31;
                            seed(&mut m, enabled, mode, prior);
                            m.hart_mut().fregs.write_raw(rs1 as u8, source);
                            digest ^=
                                compare(e.as_mut(), &mut m, &b).rotate_left((cases % 64) as u32);
                            let resolved = if rm == 7 { u32::from(mode) } else { rm };
                            if enabled != 0 && resolved <= 4 {
                                let word = results[width as usize][resolved as usize];
                                let value = if rd == 0 {
                                    0
                                } else {
                                    word as i32 as i64 as u64
                                };
                                assert_eq!(
                                    m.hart().regs.read(rd as u8),
                                    value,
                                    "literal width={width} raw={source:016x} rm={rm} frm={mode} f{rs1}->x{rd}"
                                );
                                assert_eq!(
                                    m.hart().csr.fflags,
                                    prior | flags[width as usize][resolved as usize]
                                );
                                assert_eq!(
                                    m.hart().csr.fs(),
                                    3,
                                    "even an exact discarded result dirties FS"
                                );
                            }
                            cases += 1;
                        }
                    }
                }
                let mut random = 0x3acf_8239_167e_54db_u64 ^ blocks;
                for n in 0..32 {
                    random ^= random << 13;
                    random ^= random >> 7;
                    random ^= random << 17;
                    seed(&mut m, 1 + n % 3, (n % 8) as u8, (n % 32) as u8);
                    let source = if n % 3 == 0 {
                        random
                    } else {
                        boxed(random as u32)
                    };
                    m.hart_mut().fregs.write_raw(rs1 as u8, source);
                    digest ^= compare(e.as_mut(), &mut m, &b).rotate_left((n % 64) as u32);
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 52_224);
    eprintln!("FP_TO_WORD corpus cases={cases} register_flags_fnv={digest:016x}");
}

fn replace_fcsr(m: &mut Machine, value: u64) {
    let raw = 0x0035_1073; // csrrw x0,fcsr,x10
    m.hart_mut().regs.write(10, value);
    let ptr: *mut Machine = m;
    // Synchronous interpreter CSR operation on disjoint machine components.
    unsafe {
        (*ptr)
            .hart_mut()
            .exec_oracle((*ptr).bus_mut(), decode(raw).unwrap(), 4, u64::from(raw))
            .unwrap();
    }
    m.hart_mut().regs.pc = 0x4000_2000;
}

pub fn handoff_and_faults(make: Factory) {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut cases = 0;
    for width in 0..2 {
        let at = DRAM_BASE + u64::from(width) * 0x1000;
        let dynamic = block(at, &[conversion(width, 7, 31, 0)]);
        let fault = block(
            at + 0x100,
            &[conversion(width, 7, 5, 0), 0x0004_3283, 0x0013_8393],
        );
        let invalid = block(
            at + 0x200,
            &[conversion(width, 0, 31, 0), conversion(width, 6, 5, 0)],
        );
        let consumed = block(at + 0x300, &[conversion(width, 0, 31, 0), 0x001f_8f93]);
        for b in [&dynamic, &fault, &invalid, &consumed] {
            e.install(b);
            assert!(e.is_compiled(b.phys_start));
        }
        for phase in 0..16 {
            seed(&mut m, 2, 0, phase);
            m.hart_mut().fregs.write_raw(0, boxed(0x3fa0_0000)); // 1.25
            compare(e.as_mut(), &mut m, &dynamic);
            assert_eq!(m.hart().regs.read(31), 1);
            assert_eq!(m.hart().csr.fflags, phase | 1);
            replace_fcsr(&mut m, 8 | (3 << 5));
            compare(e.as_mut(), &mut m, &dynamic);
            assert_eq!(m.hart().regs.read(31), 2);
            assert_eq!(m.hart().csr.fflags, 9);
            replace_fcsr(&mut m, 8 | (3 << 5));
            m.hart_mut().fregs.write_raw(0, boxed(0x4000_0000));
            compare(e.as_mut(), &mut m, &dynamic);
            assert_eq!(m.hart().regs.read(31), 2);
            assert_eq!(
                m.hart().csr.fflags,
                8,
                "old NX stays cleared on exact conversion"
            );
            m.hart_mut().regs.pc = 0x4000_2000;
            m.hart_mut().fregs.write_raw(0, boxed(0x3fa0_0000));
            compare(e.as_mut(), &mut m, &fault);
            assert_eq!(m.hart().regs.pc, 0x4000_2004);
            assert_eq!(m.hart().regs.read(5), 2);
            assert_eq!(m.hart().csr.fflags, 9);
            m.hart_mut().regs.pc = 0x4000_2000;
            compare(e.as_mut(), &mut m, &invalid);
            assert_eq!(m.hart().regs.pc, 0x4000_2004);
            m.hart_mut().regs.pc = 0x4000_2000;
            compare(e.as_mut(), &mut m, &consumed);
            assert_eq!(
                m.hart().regs.read(31),
                2,
                "integer successor sees newly converted 1"
            );
            cases += 6;
        }
    }
    assert_eq!(cases, 192);
    eprintln!("FP_TO_WORD CSR/consume/later-fault/invalid-prefix cases={cases}");
}

pub fn runloop(make: Factory) {
    use wasm_vm_core::csr::{MCAUSE, MEPC, MTVAL, MTVEC};
    let mut m = Machine::new(64 * 1024);
    let programs = [
        vec![0x0305, conversion(0, 7, 5, 31), 0x0010_0073],
        vec![0x0305, conversion(1, 7, 5, 31), 0x0010_0073],
        vec![conversion(0, 7, 5, 31), 0x0004_3283, 0x0010_0073],
    ];
    let mut e = make(&m);
    for (i, p) in programs.iter().enumerate() {
        let b = block(DRAM_BASE + i as u64 * 0x100, p);
        let mut pc = b.phys_start;
        for op in &b.ops {
            m.bus_mut()
                .ram_mut()
                .write_slice(pc, &op.raw.to_le_bytes()[..op.len as usize])
                .unwrap();
            pc += u64::from(op.len);
        }
        e.install(&b);
        assert!(e.is_compiled(b.phys_start));
    }
    for offset in [0x400, 0x404, 0x408] {
        m.bus_mut()
            .store32(DRAM_BASE + offset, 0x3000_2073)
            .unwrap();
    }
    m.bus_mut().store32(DRAM_BASE + 0x40c, 0x0000_006f).unwrap();
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_executor(e);
    m.set_jit(true);
    for i in 0..3 {
        let pc = DRAM_BASE + i * 0x100;
        seed(&mut m, 2, 0, 2);
        m.hart_mut().regs.pc = pc;
        m.run(4);
        seed(
            &mut m,
            if i == 0 { 0 } else { 2 },
            if i == 1 { 7 } else { 0 },
            2,
        );
        m.hart_mut().regs.pc = pc;
        m.hart_mut().fregs.write_raw(31, boxed(0x3fc0_0000));
        m.hart_mut()
            .csr
            .access(MTVEC, CsrOp::Write, DRAM_BASE + 0x400, false, false, 0)
            .unwrap();
        let before = m.executor().unwrap().retired_via_jit();
        let calls = m.executor().unwrap().executed_blocks();
        m.run(4);
        assert!(m.executor().unwrap().executed_blocks() > calls);
        assert_eq!(m.executor().unwrap().retired_via_jit() - before, 1);
        assert_eq!(m.hart_mut().csr.read(MEPC), pc + if i < 2 { 2 } else { 4 });
        assert_eq!(m.hart_mut().csr.read(MCAUSE), if i < 2 { 2 } else { 5 });
        assert_eq!(
            m.hart_mut().csr.read(MTVAL),
            if i < 2 {
                u64::from(programs[i as usize][1])
            } else {
                BAD
            }
        );
        assert_eq!(m.hart().csr.fflags, if i < 2 { 2 } else { 3 });
    }
    eprintln!("FP_TO_WORD runloop FS-off/invalid-rm prefix=1 bytes=2 later-fault-flags=3");
}
