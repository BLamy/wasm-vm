//! Actual generated comparison modules; interpreter oracle plus literal bit-pattern goldens.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, FFLAGS, FRM, MSTATUS};
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
pub fn cmp(kind: u32, rd: u32, rs1: u32, rs2: u32) -> u32 {
    (0x50 << 25) | (rs2 << 20) | (rs1 << 15) | (kind << 12) | (rd << 7) | 0x53
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
            "f{r} unchanged"
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

// [LE, LT, EQ] results and NV flags, in raw instruction funct3 order. These
// values are literal independent expectations, not obtained from the interpreter.
const GOLDENS: &[(u64, u64, [u64; 3], [u8; 3])] = &[
    (boxed(0), boxed(0x8000_0000), [1, 0, 1], [0, 0, 0]),
    (boxed(0x8000_0000), boxed(0), [1, 0, 1], [0, 0, 0]),
    (boxed(0xbf80_0000), boxed(0xc000_0000), [0, 0, 0], [0, 0, 0]),
    (boxed(0xc000_0000), boxed(0xbf80_0000), [1, 1, 0], [0, 0, 0]),
    (boxed(0x8000_0001), boxed(0x8000_0000), [1, 1, 0], [0, 0, 0]),
    (boxed(0), boxed(1), [1, 1, 0], [0, 0, 0]),
    (boxed(1), boxed(0), [0, 0, 0], [0, 0, 0]),
    (boxed(0x007f_ffff), boxed(0x0080_0000), [1, 1, 0], [0, 0, 0]),
    (boxed(0x8080_0000), boxed(0x807f_ffff), [1, 1, 0], [0, 0, 0]),
    (boxed(0x3f80_0000), boxed(0x3f80_0000), [1, 0, 1], [0, 0, 0]),
    (boxed(0x3f80_0000), boxed(0x3f80_0001), [1, 1, 0], [0, 0, 0]),
    (boxed(0x7f80_0000), boxed(0x7f7f_ffff), [0, 0, 0], [0, 0, 0]),
    (boxed(0xff80_0000), boxed(0xff7f_ffff), [1, 1, 0], [0, 0, 0]),
    (boxed(0x7f80_0000), boxed(0x7f80_0000), [1, 0, 1], [0, 0, 0]),
    (boxed(0xff80_0000), boxed(0x7f80_0000), [1, 1, 0], [0, 0, 0]),
    (boxed(0x7fc0_1234), boxed(0), [0, 0, 0], [16, 16, 0]),
    (boxed(0), boxed(0xffc0_1234), [0, 0, 0], [16, 16, 0]),
    (
        boxed(0x7f80_0001),
        boxed(0x7f80_0000),
        [0, 0, 0],
        [16, 16, 16],
    ),
    (
        boxed(0x3f80_0000),
        boxed(0xff80_0001),
        [0, 0, 0],
        [16, 16, 16],
    ),
    (
        boxed(0x7fc0_1234),
        boxed(0x7f80_0001),
        [0, 0, 0],
        [16, 16, 16],
    ),
    (0x1234_5678_3f80_0000, boxed(0), [0, 0, 0], [16, 16, 0]),
    (boxed(0), 0xffff_fffe_7f80_0001, [0, 0, 0], [16, 16, 0]),
    (0x0000_0000_ff80_0001, 0, [0, 0, 0], [16, 16, 0]),
];

pub fn corpus(make: Factory) {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let mut blocks = Vec::new();
    for kind in 0..3 {
        for rd in [0, 5, 31] {
            let b = block(
                DRAM_BASE + blocks.len() as u64 * 0x100,
                &[0x0305, cmp(kind, rd, 0, 31), 0x0013_8393],
            );
            e.install(&b);
            assert!(e.is_compiled(b.phys_start));
            blocks.push((kind, rd, b));
        }
    }
    let mut cases = 0_u64;
    let mut digest = 0;
    for (kind, rd, b) in &blocks {
        for enabled in 0..=3 {
            for mode in 0..=7 {
                for &(a, bits, values, flags) in GOLDENS {
                    let prior = (cases as u8).wrapping_mul(7) & 31;
                    seed(&mut m, enabled, mode, prior);
                    m.hart_mut().fregs.write_raw(0, a);
                    m.hart_mut().fregs.write_raw(31, bits);
                    digest ^= compare(e.as_mut(), &mut m, b).rotate_left((cases % 64) as u32);
                    if enabled != 0 {
                        assert_eq!(
                            m.hart().regs.read(*rd as u8),
                            if *rd == 0 { 0 } else { values[*kind as usize] },
                            "literal comparison golden"
                        );
                        assert_eq!(
                            m.hart().csr.fflags,
                            prior | flags[*kind as usize],
                            "literal invalid flag golden"
                        );
                        assert_eq!(
                            m.hart().csr.fs(),
                            3,
                            "successful comparison dirties FS, including x0"
                        );
                    } else {
                        assert_eq!(m.hart().csr.fs(), 0);
                    }
                    cases += 1;
                }
            }
        }
    }
    for mut random in [0x1357_9bdf_2468_ace1_u64, 0xfedc_ba98_7654_3210] {
        for n in 0..512 {
            let (kind, _, b) = &blocks[n % blocks.len()];
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            let a = if n % 11 == 0 {
                random
            } else {
                boxed(random as u32)
            };
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            seed(&mut m, 1 + (n % 3) as u64, (n % 8) as u8, (n % 32) as u8);
            m.hart_mut().fregs.write_raw(0, a);
            m.hart_mut().fregs.write_raw(31, boxed(random as u32));
            digest ^= compare(e.as_mut(), &mut m, b).rotate_left(*kind + 1);
            cases += 1;
        }
    }
    assert_eq!(cases, 7648);
    eprintln!("FP_COMPARE corpus cases={cases} register_flags_fnv={digest:016x}");
}

pub fn handoff_and_faults(make: Factory) {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    let compare_only = block(DRAM_BASE, &[cmp(2, 5, 0, 31)]);
    let fault = block(
        DRAM_BASE + 0x100,
        &[cmp(1, 31, 0, 31), 0x0004_3283, cmp(2, 0, 0, 0)],
    );
    let same_source = block(
        DRAM_BASE + 0x200,
        &[cmp(0, 5, 0, 0), cmp(1, 31, 0, 0), cmp(2, 0, 0, 0)],
    );
    for b in [&compare_only, &fault, &same_source] {
        e.install(b);
        assert!(e.is_compiled(b.phys_start));
    }
    let mut cases = 0;
    for phase in 0..16 {
        seed(&mut m, 2, (phase % 8) as u8, phase as u8);
        m.hart_mut().fregs.write_raw(0, boxed(0x7f80_0001));
        m.hart_mut().fregs.write_raw(31, boxed(0));
        compare(e.as_mut(), &mut m, &compare_only);
        assert_eq!(m.hart().csr.fflags, phase as u8 | 16);
        // A replacement quiet operand must respect interpreted CSR writes;
        // the separate CSR-only clear below keeps both FPRs unchanged.
        m.hart_mut()
            .csr
            .access(FFLAGS, CsrOp::Write, 2, false, false, 0)
            .unwrap();
        m.hart_mut()
            .csr
            .access(FRM, CsrOp::Write, 7, false, false, 0)
            .unwrap();
        m.hart_mut().fregs.write_raw(0, boxed(0x7fc0_1234));
        m.hart_mut().regs.pc = 0x4000_2000;
        compare(e.as_mut(), &mut m, &compare_only);
        assert_eq!(
            m.hart().csr.fflags,
            2,
            "quiet EQ must not revive cleared NV"
        );
        m.hart_mut().regs.pc = 0x4000_2000;
        compare(e.as_mut(), &mut m, &fault);
        assert_eq!(
            m.hart().csr.fflags,
            18,
            "NV survives a later precise memory fault"
        );
        assert_eq!(m.hart().regs.pc, 0x4000_2004);
        m.hart_mut()
            .csr
            .access(FFLAGS, CsrOp::Write, 2, false, false, 0)
            .unwrap();
        m.hart_mut().regs.pc = 0x4000_2000;
        compare(e.as_mut(), &mut m, &compare_only);
        assert_eq!(
            m.hart().csr.fflags,
            2,
            "CSR-only clear refreshes control with unchanged FPRs"
        );
        m.hart_mut().regs.pc = 0x4000_2000;
        compare(e.as_mut(), &mut m, &same_source);
        assert_eq!(m.hart().regs.read(5), 0);
        assert_eq!(m.hart().regs.read(31), 0);
        assert_eq!(m.hart().csr.fflags, 18);
        cases += 5;
    }
    eprintln!("FP_COMPARE handoff/fault/same-source cases={cases} expected_flags=18");
}

pub fn runloop(make: Factory) {
    use wasm_vm_core::csr::{MCAUSE, MEPC, MTVAL, MTVEC};
    let mut m = Machine::new(64 * 1024);
    let programs = [
        vec![0x0305, cmp(1, 5, 0, 31), 0x0010_0073],
        vec![cmp(1, 5, 0, 31), 0x0004_3283, 0x0010_0073],
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
    }
    m.bus_mut().store32(DRAM_BASE + 0x400, 0x3000_2073).unwrap();
    // Keep the short post-trap budget on interpreted CSR instructions so the
    // retirement counter measures only the tested compiled prefix.
    m.bus_mut().store32(DRAM_BASE + 0x404, 0x3000_2073).unwrap();
    m.bus_mut().store32(DRAM_BASE + 0x408, 0x3000_2073).unwrap();
    m.bus_mut().store32(DRAM_BASE + 0x40c, 0x0000_006f).unwrap();
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_executor(e);
    m.set_jit(true);
    for i in 0..2 {
        let pc = DRAM_BASE + i * 0x100;
        seed(&mut m, 2, 7, 2);
        m.hart_mut().regs.pc = pc;
        m.run(4);
        seed(&mut m, if i == 0 { 0 } else { 2 }, 7, 2);
        m.hart_mut().regs.pc = pc;
        m.hart_mut().fregs.write_raw(0, boxed(0x7fc0_1234));
        m.hart_mut().fregs.write_raw(31, boxed(0));
        m.hart_mut()
            .csr
            .access(MTVEC, CsrOp::Write, DRAM_BASE + 0x400, false, false, 0)
            .unwrap();
        let before = m.executor().unwrap().retired_via_jit();
        let calls = m.executor().unwrap().executed_blocks();
        m.run(4);
        assert!(m.executor().unwrap().executed_blocks() > calls);
        assert_eq!(m.executor().unwrap().retired_via_jit() - before, 1);
        assert_eq!(m.hart_mut().csr.read(MEPC), pc + if i == 0 { 2 } else { 4 });
        assert_eq!(m.hart_mut().csr.read(MCAUSE), if i == 0 { 2 } else { 5 });
        assert_eq!(
            m.hart_mut().csr.read(MTVAL),
            if i == 0 {
                u64::from(cmp(1, 5, 0, 31))
            } else {
                BAD
            }
        );
        assert_eq!(m.hart().csr.fflags, if i == 0 { 2 } else { 18 });
    }
    eprintln!("FP_COMPARE runloop prefixes=1 FS-off-prefix-bytes=2 later-fault-flags=18");
}
