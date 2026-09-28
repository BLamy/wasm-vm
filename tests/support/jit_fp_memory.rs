//! Real generated modules against the interpreter, with independent byte goldens.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS, Priv, SATP};
use wasm_vm_core::decode::decode;
use wasm_vm_core::decode_c::expand_c;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};
use wasm_vm_core::mmio::{RecordingDevice, SystemBus};
use wasm_vm_core::ram::Ram;

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
pub const DATA: u64 = DRAM_BASE + 0x6000;
const SENTINEL: u64 = 0x0123_4567_89ab_cdef;

pub fn load(double: bool, rd: u32, base: u32, offset: i32) -> u32 {
    ((offset as u32 & 4095) << 20)
        | (base << 15)
        | ((if double { 3 } else { 2 }) << 12)
        | (rd << 7)
        | 7
}
pub fn store(double: bool, src: u32, base: u32, offset: i32) -> u32 {
    let offset = offset as u32;
    ((offset >> 5 & 127) << 25)
        | (src << 20)
        | (base << 15)
        | ((if double { 3 } else { 2 }) << 12)
        | ((offset & 31) << 7)
        | 0x27
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
fn seed(m: &mut Machine, enabled: u64, bits: u64) {
    let h = m.hart_mut();
    h.csr.mode = Priv::M;
    for r in 0..32 {
        h.regs.write(r, SENTINEL ^ u64::from(r));
        h.fregs.write_raw(r, bits);
    }
    for r in [2, 5, 8] {
        h.regs.write(r, DATA);
    }
    h.regs.pc = 0x4000_0000;
    h.resv = Some((DATA, 8));
    fs(h, enabled);
    h.csr.fflags = 0x15;
    h.csr.frm = 7;
}
pub fn execute(
    e: &mut dyn CompiledBlockExecutor,
    m: &mut Machine,
    pc: u64,
    chain: bool,
) -> JitExit {
    let ptr: *mut Machine = m;
    // Machine owns these two disjoint components for the entire synchronous call.
    unsafe {
        e.execute_with_budget(pc, (*ptr).hart_mut(), (*ptr).bus_mut(), 256, 256, chain)
            .unwrap()
    }
}
fn compare(e: &mut dyn CompiledBlockExecutor, m: &mut Machine, b: &DecodedBlock) -> u64 {
    let initial = m.hart();
    let mut oracle = Hart {
        regs: initial.regs.clone(),
        fregs: initial.fregs.clone(),
        csr: initial.csr.clone(),
        resv: initial.resv,
        ..Hart::default()
    };
    let mut bus = SystemBus::new(Ram::new(m.bus_mut().ram().len()).unwrap());
    bus.ram_mut()
        .write_slice(DRAM_BASE, m.bus_mut().ram().as_bytes())
        .unwrap();
    bus.arm_code_write_tracking(true);
    m.bus_mut().arm_code_write_tracking(true);
    m.bus_mut().code_write_log_mut().clear();
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
    let exit = execute(e, m, b.phys_start, false);
    let actual = if exit.code == ExitCode::IllegalInstruction {
        Some(Trap {
            cause: Exception::IllegalInstruction,
            tval: exit.exit_info,
        })
    } else {
        exit.trap
    };
    assert_eq!(
        actual,
        trap,
        "raw={:x?}",
        b.ops.iter().map(|op| op.raw).collect::<Vec<_>>()
    );
    assert_eq!(exit.next_pc, oracle.regs.pc);
    // Private executors use zero as the legacy 'derive from PC' marker.
    // The run-loop fixture below proves the derived retirement accounting.
    if exit.retired != 0 {
        assert_eq!(exit.retired, retired);
    }
    m.hart_mut().regs.pc = exit.next_pc;
    for r in 0..32 {
        assert_eq!(m.hart().regs.read(r), oracle.regs.read(r), "x{r}");
        assert_eq!(m.hart().fregs.read_raw(r), oracle.fregs.read_raw(r), "f{r}");
    }
    assert_eq!(m.hart().resv, oracle.resv);
    assert_eq!(m.hart().csr.fflags, oracle.csr.fflags);
    assert_eq!(m.hart().csr.frm, oracle.csr.frm);
    assert_eq!(m.hart_mut().csr.read(MSTATUS), oracle.csr.read(MSTATUS));
    assert_eq!(m.bus_mut().ram().as_bytes(), bus.ram().as_bytes());
    let mut actual_pages = m.bus_mut().code_write_log_mut().clone();
    let mut wanted_pages = bus.code_write_log_mut().clone();
    actual_pages.sort_unstable();
    actual_pages.dedup();
    wanted_pages.sort_unstable();
    wanted_pages.dedup();
    assert_eq!(actual_pages, wanted_pages);
    let mstatus = m.hart_mut().csr.read(MSTATUS);
    let mut digest = 0xcbf29ce484222325_u64;
    for bits in (0..32)
        .flat_map(|r| [m.hart().regs.read(r), m.hart().fregs.read_raw(r)])
        .chain([exit.next_pc, retired, mstatus])
    {
        for byte in bits.to_le_bytes() {
            digest = (digest ^ u64::from(byte)).wrapping_mul(0x100000001b3);
        }
    }
    for byte in m.bus_mut().ram().as_bytes() {
        digest = (digest ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    digest
}

pub fn transfers(make: Factory) {
    let mut m = Machine::new(64 * 1024);
    let mut e = make(&m);
    // Integer/FPR aliases, f0, negative offsets, and all four RV64C FP forms.
    let specs = [
        (load(false, 0, 5, -8), false, false, 0, DATA - 8),
        (load(true, 5, 5, 0), false, true, 5, DATA),
        (store(false, 0, 5, -4), true, false, 0, DATA - 4),
        (store(true, 5, 5, 8), true, true, 5, DATA + 8),
        (0x2000, false, true, 8, DATA),
        (0xa400, true, true, 8, DATA + 8),
        (0x2002, false, true, 0, DATA),
        (0xa47e, true, true, 31, DATA + 8),
    ];
    let blocks: Vec<_> = specs
        .iter()
        .enumerate()
        .map(|(i, s)| block(DRAM_BASE + i as u64 * 64, &[0x00130313, s.0, 0x00138393]))
        .collect();
    for b in &blocks {
        e.install(b);
        assert!(e.is_compiled(b.phys_start));
    }
    let mut patterns = vec![
        0,
        0x80000000,
        0xffffffff7fa12345,
        0x012345677fc54321,
        0xfff0123456789abc,
        0x7ff8123456789abc,
        u64::MAX,
    ];
    for seed in [0xabe5_1234_u64, 0x9721_0357_468a_bcef] {
        let mut n = seed;
        for _ in 0..8 {
            n ^= n << 13;
            n ^= n >> 7;
            n ^= n << 17;
            patterns.push(n);
        }
    }
    let mut digest = 0_u64;
    let mut cases = 0;
    for (i, b) in blocks.iter().enumerate() {
        let (_, is_store, double, reg, addr) = specs[i];
        for enabled in 0..=3 {
            for (index, &bits) in patterns.iter().enumerate() {
                for _warm in 0..2 {
                    seed(&mut m, enabled, bits);
                    m.hart_mut().csr.frm = (index % 8) as u8;
                    m.hart_mut().csr.fflags = (index % 32) as u8;
                    m.bus_mut()
                        .ram_mut()
                        .write_slice(DATA - 16, &[0xa5; 48])
                        .unwrap();
                    if !is_store {
                        m.bus_mut().store64(addr, bits).unwrap();
                    }
                    digest = digest.rotate_left(1) ^ compare(e.as_mut(), &mut m, b);
                    if enabled != 0 {
                        if is_store {
                            if double {
                                assert_eq!(m.bus_mut().load64(addr).unwrap(), bits);
                            } else {
                                assert_eq!(m.bus_mut().load32(addr).unwrap(), bits as u32);
                            }
                            assert_eq!(m.hart().csr.fs(), enabled as u8);
                        } else {
                            assert_eq!(
                                m.hart().fregs.read_raw(reg),
                                if double {
                                    bits
                                } else {
                                    0xffffffff00000000 | (bits & 0xffffffff)
                                }
                            );
                            assert_eq!(m.hart().csr.fs(), 3);
                        }
                    }
                    cases += 1;
                }
            }
        }
    }
    eprintln!("FP_MEMORY transfers cases={cases} digest={digest:016x}");
}

pub fn virtual_pages(make: Factory) {
    const FIRST: u64 = DRAM_BASE + 0xa000;
    const SECOND: u64 = DRAM_BASE + 0xc000;
    const VA: u64 = 0x4000;
    const FLAGS: u64 = 1 | 2 | 4 | 8 | 64 | 128;
    let mut digest = 0_u64;
    let mut cases = 0;
    for (flags, pmp) in [
        (FLAGS, false),
        (0, false),
        (FLAGS & !4, false),
        (FLAGS, true),
    ] {
        let mut m = Machine::new(64 * 1024);
        let l2 = DRAM_BASE + 0x1000;
        let l1 = DRAM_BASE + 0x2000;
        let l0 = DRAM_BASE + 0x3000;
        m.bus_mut().store64(l2, ((l1 >> 12) << 10) | 1).unwrap();
        m.bus_mut().store64(l1, ((l0 >> 12) << 10) | 1).unwrap();
        m.bus_mut()
            .store64(l0 + 32, ((FIRST >> 12) << 10) | FLAGS)
            .unwrap();
        m.bus_mut()
            .store64(l0 + 40, ((SECOND >> 12) << 10) | flags)
            .unwrap();
        let mut e = make(&m);
        for double in [false, true] {
            let width = if double { 8 } else { 4 };
            for write in [false, true] {
                let raw = if write {
                    store(double, 5, 5, 0)
                } else {
                    load(double, 5, 5, 0)
                };
                let b = block(
                    DRAM_BASE + 0x8000 + u64::from(double) * 128 + u64::from(write) * 64,
                    &[0x00130313, raw, 0x00138393],
                );
                e.install(&b);
                for offset in (4097 - width)..4096 {
                    seed(&mut m, 2, 0x817263547fa12345);
                    m.hart_mut().regs.write(5, VA + offset);
                    m.hart_mut().resv = Some((VA + 4096, 8));
                    m.hart_mut().csr.pmp.allow_all();
                    if pmp {
                        m.hart_mut().csr.pmp.write_cfg(0, 0);
                        m.hart_mut().csr.pmp.write_addr(0, (SECOND >> 2) | 511);
                        m.hart_mut().csr.pmp.write_addr(1, u64::MAX);
                        m.hart_mut().csr.pmp.write_cfg(0, 0x18 | (0x1f << 8));
                    }
                    m.hart_mut()
                        .csr
                        .access(SATP, CsrOp::Write, (8 << 60) | (l2 >> 12), false, false, 0)
                        .unwrap();
                    m.hart_mut().csr.mode = Priv::S;
                    m.bus_mut()
                        .ram_mut()
                        .write_slice(FIRST + 4080, &[0xa5; 16])
                        .unwrap();
                    m.bus_mut()
                        .ram_mut()
                        .write_slice(SECOND, &[0x5a; 16])
                        .unwrap();
                    let before = m.bus_mut().ram().as_bytes().to_vec();
                    digest = digest.rotate_left(1) ^ compare(e.as_mut(), &mut m, &b);
                    if flags == 0 || pmp || (write && flags & 4 == 0) {
                        assert_eq!(m.hart().regs.pc, 0x40000004);
                        assert_eq!(m.hart().csr.fs(), 2);
                        assert_eq!(m.bus_mut().ram().as_bytes(), before);
                    } else {
                        assert_eq!(m.hart().regs.pc, 0x4000000c);
                        if !write {
                            let n = (4096 - offset) * 8;
                            let raw = (0xa5a5a5a5a5a5a5a5 & ((1_u64 << n) - 1))
                                | (0x5a5a5a5a5a5a5a5a & !((1_u64 << n) - 1));
                            assert_eq!(
                                m.hart().fregs.read_raw(5),
                                if double {
                                    raw
                                } else {
                                    0xffffffff00000000 | (raw & 0xffffffff)
                                }
                            );
                        }
                    }
                    cases += 1;
                }
            }
        }
    }
    eprintln!("FP_MEMORY virtual crossings cases={cases} digest={digest:016x}");
}

pub fn mmio_and_faults(make: Factory) {
    const DEVICE: u64 = 0x40000000;
    let mut count = 0;
    for double in [false, true] {
        for write in [false, true] {
            for enabled in [0, 2] {
                for addr in [DEVICE, DEVICE + 1, 0x50000000, u64::MAX - 1] {
                    let mut m = Machine::new(64 * 1024);
                    let (dev, log) = RecordingDevice::new(0x7ff12345_ffa67890);
                    m.bus_mut().attach(DEVICE, 4096, Box::new(dev)).unwrap();
                    let mut e = make(&m);
                    let raw = if write {
                        store(double, 0, 5, 0)
                    } else {
                        load(double, 0, 5, 0)
                    };
                    let b = block(DRAM_BASE, &[0x00130313, raw, load(true, 31, 7, 0)]);
                    e.install(&b);
                    seed(&mut m, enabled, 0x12345678_ffa67890);
                    m.hart_mut().regs.pc = 0x4000000;
                    m.hart_mut().regs.write(5, addr);
                    m.hart_mut().regs.write(7, 0x50000000);
                    let exit = execute(e.as_mut(), &mut m, DRAM_BASE, false);
                    if enabled == 0 {
                        assert_eq!(exit.code, ExitCode::IllegalInstruction);
                        assert_eq!(exit.exit_info, u64::from(raw));
                        assert_eq!(exit.next_pc, 0x4000004);
                        assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
                    } else if addr == DEVICE {
                        assert_eq!(exit.next_pc, 0x4000008);
                        assert_eq!(
                            exit.trap,
                            Some(Trap {
                                cause: Exception::LoadAccessFault,
                                tval: 0x50000000
                            })
                        );
                        if write {
                            let log = log.borrow();
                            assert_eq!(log.writes.len(), 1);
                            assert_eq!(
                                log.writes[0].2,
                                if double {
                                    0x12345678ffa67890
                                } else {
                                    0xffa67890
                                }
                            );
                            assert!(log.reads.is_empty());
                        } else {
                            assert_eq!(log.borrow().reads.len(), 1);
                            assert!(log.borrow().writes.is_empty());
                            assert_eq!(
                                m.hart().fregs.read_raw(0),
                                if double {
                                    0x7ff12345ffa67890
                                } else {
                                    0xffffffffffa67890
                                }
                            );
                        }
                    } else {
                        assert_eq!(exit.next_pc, 0x4000004);
                        assert_eq!(exit.trap.unwrap().tval, addr);
                        assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
                        assert_eq!(m.hart().csr.fs(), 2);
                    }
                    assert_eq!(m.hart().fregs.read_raw(31), 0x12345678ffa67890);
                    assert_eq!(m.hart().csr.fflags, 0x15);
                    assert_eq!(m.hart().csr.frm, 7);
                    count += 1;
                }
            }
        }
    }
    eprintln!("FP_MEMORY MMIO/fault precedence cases={count}");
}

pub fn runloop(make: Factory) {
    use wasm_vm_core::csr::{MCAUSE, MEPC, MTVAL, MTVEC};
    let mut m = Machine::new(64 * 1024);
    let programs = [
        vec![0x00130313, 0x2002, 0x00100073],
        vec![
            load(false, 0, 5, 0),
            store(true, 0, 7, 0),
            load(true, 31, 8, 0),
            0x00100073,
        ],
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
    m.bus_mut().store32(DRAM_BASE + 0x400, 0x30002073).unwrap();
    m.bus_mut().store32(DRAM_BASE + 0x404, 0x0000006f).unwrap();
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_executor(e);
    m.set_jit(true);
    for i in 0..2 {
        let pc = DRAM_BASE + i * 0x100;
        seed(&mut m, 2, 0x12345678ffa67890);
        m.hart_mut().regs.pc = pc;
        m.run(4);
        seed(&mut m, if i == 0 { 0 } else { 2 }, 0x12345678ffa67890);
        m.hart_mut().regs.pc = pc;
        m.hart_mut().regs.write(7, DATA + 8);
        m.hart_mut().regs.write(8, 0x50000000);
        m.bus_mut().store32(DATA, 0x7fa12345).unwrap();
        m.hart_mut()
            .csr
            .access(MTVEC, CsrOp::Write, DRAM_BASE + 0x400, false, false, 0)
            .unwrap();
        let before = m.executor().unwrap().retired_via_jit();
        let executions = m.executor().unwrap().executed_blocks();
        m.run(4);
        assert!(m.executor().unwrap().executed_blocks() > executions);
        assert_eq!(
            m.executor().unwrap().retired_via_jit() - before,
            if i == 0 { 1 } else { 2 }
        );
        assert_eq!(m.hart_mut().csr.read(MEPC), pc + if i == 0 { 4 } else { 8 });
        assert_eq!(m.hart_mut().csr.read(MCAUSE), if i == 0 { 2 } else { 5 });
        assert_eq!(
            m.hart_mut().csr.read(MTVAL),
            if i == 0 { 0x2002 } else { 0x50000000 }
        );
        if i == 1 {
            assert_eq!(m.bus_mut().load64(DATA + 8).unwrap(), 0xffffffff7fa12345);
        }
    }
    eprintln!("FP_MEMORY runloop prefixes=1,2 compressed_mtval=2002 fault_tval=50000000");
}
