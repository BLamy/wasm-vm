//! Critic-owned raw-bit and memory-authority checks with independent encodings.
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS, Priv, TCONTROL, TDATA1, TDATA2};
use wasm_vm_core::decode::decode;
use wasm_vm_core::decode_c::expand_c;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};

pub type Factory = fn(&Machine) -> Box<dyn CompiledBlockExecutor>;
const DATA: u64 = DRAM_BASE + 0x4000;
const PC: u64 = 0x4000_6000;
const SENTINEL: u64 = 0x0123_4567_89ab_cdef;

fn block(parcels: &[u32]) -> DecodedBlock {
    let ops: Vec<_> = parcels
        .iter()
        .map(|&raw| {
            let short = raw & 3 != 3;
            MicroOp {
                instr: decode(if short {
                    expand_c(raw as u16).unwrap()
                } else {
                    raw
                })
                .unwrap(),
                raw,
                len: if short { 2 } else { 4 },
            }
        })
        .collect();
    let len = ops.iter().map(|op| u64::from(op.len)).sum();
    DecodedBlock::new(DRAM_BASE, ops, len)
}

fn status(m: &mut Machine, bits: u64) {
    m.hart_mut().csr.mode = Priv::M;
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, bits, false, false, 0)
        .unwrap();
}

fn execute(e: &mut dyn CompiledBlockExecutor, m: &mut Machine) -> JitExit {
    let ptr: *mut Machine = m;
    // SAFETY: the Machine owns disjoint Hart and SystemBus components, borrowed
    // only for this synchronous generated invocation.
    unsafe {
        e.execute(DRAM_BASE, (*ptr).hart_mut(), (*ptr).bus_mut())
            .unwrap()
    }
}

fn install(make: Factory, m: &Machine, words: &[u32]) -> Box<dyn CompiledBlockExecutor> {
    let mut e = make(m);
    e.install(&block(words));
    assert!(e.is_compiled(DRAM_BASE));
    e
}

pub fn seeded_raw_aliases(make: Factory, inline: bool) {
    // fsw f5,0(x5); flw f5,0(x5); fsd f5,8(x5); fld f31,8(x5);
    // fsw f31,16(x5); addi x5,x5,32; fsd f31,-8(x5); fmv.x.w x31,f31.
    let words = [
        0x0052_a027,
        0x0002_a287,
        0x0052_b427,
        0x0082_bf87,
        0x01f2_a827,
        0x0202_8293,
        0xfff2_bc27,
        0xe00f_8fd3,
    ];
    let mut m = Machine::new(64 * 1024);
    let mut e = install(make, &m, &words);
    let mut cases = 0;
    let mut digest = 0xcbf2_9ce4_8422_2325_u64;
    for seed in [
        0xd42a_c871_159e_630b_u64,
        0x096a_f321_ca77_8de5,
        0x6b04_9fa7_3518_dc21,
    ] {
        let mut bits = seed;
        for iteration in 0..24 {
            bits ^= bits << 13;
            bits ^= bits >> 7;
            bits ^= bits << 17;
            let addr = DATA + (iteration % 8) * 64;
            for r in 0..32 {
                m.hart_mut().regs.write(r, SENTINEL ^ u64::from(r));
                m.hart_mut().fregs.write_raw(r, SENTINEL ^ u64::from(r));
            }
            m.hart_mut().regs.write(5, addr);
            m.hart_mut().regs.write(6, DATA + 0x800);
            m.bus_mut().store64(DATA + 0x800, bits).unwrap();
            status(&mut m, 3 << 13);
            // A real interpreter FLD replaces f5 between generated invocations.
            let ptr: *mut Machine = &mut m;
            unsafe {
                (*ptr)
                    .hart_mut()
                    .exec_oracle(
                        (*ptr).bus_mut(),
                        decode(0x0003_3287).unwrap(),
                        4,
                        0x0003_3287,
                    )
                    .unwrap();
            }
            assert_eq!(m.hart().fregs.read_raw(5), bits);
            status(&mut m, (1 + iteration % 3) << 13);
            m.hart_mut().csr.fflags = (iteration % 32) as u8;
            m.hart_mut().csr.frm = if iteration % 2 == 0 { 5 } else { 6 };
            m.hart_mut().regs.pc = PC;
            m.bus_mut()
                .ram_mut()
                .write_slice(addr - 8, &[0xa5; 48])
                .unwrap();
            let exit = execute(e.as_mut(), &mut m);
            let boxed = 0xffff_ffff_0000_0000 | (bits & 0xffff_ffff);
            assert_eq!(exit.code, ExitCode::Fallthrough);
            assert_eq!(exit.next_pc, PC + 32);
            assert_eq!(exit.retired, if inline { 8 } else { 0 });
            assert_eq!(
                m.hart().fregs.read_raw(5),
                boxed,
                "VERIFIER_SEEDED_RAW_PAYLOAD"
            );
            assert_eq!(m.hart().fregs.read_raw(31), boxed);
            assert_eq!(m.hart().regs.read(5), addr + 32);
            assert_eq!(m.hart().regs.read(31), bits as u32 as i32 as i64 as u64);
            assert_eq!(m.bus_mut().load32(addr).unwrap(), bits as u32);
            assert_eq!(m.bus_mut().load64(addr + 8).unwrap(), boxed);
            assert_eq!(m.bus_mut().load32(addr + 16).unwrap(), bits as u32);
            assert_eq!(m.bus_mut().load64(addr + 24).unwrap(), boxed);
            for offset in [-8, 4, 20, 32, 36] {
                assert_eq!(
                    m.bus_mut()
                        .load32(addr.wrapping_add_signed(offset))
                        .unwrap(),
                    0xa5a5_a5a5
                );
            }
            for r in 0..32 {
                if ![5, 31].contains(&r) {
                    assert_eq!(m.hart().fregs.read_raw(r), SENTINEL ^ u64::from(r));
                }
                if ![0, 5, 6, 31].contains(&r) {
                    assert_eq!(m.hart().regs.read(r), SENTINEL ^ u64::from(r));
                }
            }
            assert_eq!(m.hart().regs.read(0), 0);
            assert_eq!(m.hart().regs.read(6), DATA + 0x800);
            assert_eq!(m.hart().csr.fs(), 3);
            assert_eq!(m.hart().csr.fflags, (iteration % 32) as u8);
            assert_eq!(m.hart().csr.frm, if iteration % 2 == 0 { 5 } else { 6 });
            for byte in boxed.to_le_bytes() {
                digest = (digest ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
            }
            cases += 1;
        }
    }
    eprintln!("VERIFIER seeded aliases inline={inline} cases={cases} digest={digest:016x}");
}

pub fn compressed_maxima(make: Factory, inline: bool) {
    for (raw, write, reg, base, offset) in [
        (0x3c60, false, 8, 8, 248),
        (0xbc60, true, 8, 8, 248),
        (0x307e, false, 0, 2, 504),
        (0xbf82, true, 0, 2, 504),
    ] {
        let mut m = Machine::new(64 * 1024);
        // c.addi x12,1; selected FP parcel; c.addi x13,1.
        let mut e = install(make, &m, &[0x0605, raw, 0x0685]);
        for fs in [0, 1, 2, 3] {
            status(&mut m, fs << 13);
            m.hart_mut().csr.fflags = 0x13;
            m.hart_mut().csr.frm = 6;
            m.hart_mut().regs.pc = PC;
            m.hart_mut().regs.write(base, DATA);
            m.hart_mut().regs.write(12, 10);
            m.hart_mut().regs.write(13, 20);
            m.hart_mut().fregs.write_raw(reg, SENTINEL);
            m.bus_mut()
                .store64(DATA + offset, 0x7ff0_0000_0000_1234)
                .unwrap();
            let exit = execute(e.as_mut(), &mut m);
            assert_eq!(m.hart().regs.read(12), 11);
            assert_eq!(m.hart().regs.read(base), DATA);
            assert_eq!(m.hart().regs.read(0), 0);
            assert_eq!(m.hart().csr.fflags, 0x13);
            assert_eq!(m.hart().csr.frm, 6);
            if fs == 0 {
                assert_eq!(exit.code, ExitCode::IllegalInstruction);
                assert_eq!(exit.exit_info, u64::from(raw));
                assert_eq!(exit.next_pc, PC + 2);
                assert_eq!(exit.retired, u64::from(inline));
                assert_eq!(m.hart().regs.read(13), 20);
                assert_eq!(m.hart().fregs.read_raw(reg), SENTINEL);
                assert_eq!(
                    m.bus_mut().load64(DATA + offset).unwrap(),
                    0x7ff0_0000_0000_1234
                );
                assert_eq!(m.hart().csr.fs(), 0);
            } else {
                assert_eq!(exit.code, ExitCode::Fallthrough);
                assert_eq!(exit.next_pc, PC + 6);
                assert_eq!(exit.retired, if inline { 3 } else { 0 });
                assert_eq!(m.hart().regs.read(13), 21);
                assert_eq!(
                    m.hart().fregs.read_raw(reg),
                    if write {
                        SENTINEL
                    } else {
                        0x7ff0_0000_0000_1234
                    }
                );
                assert_eq!(
                    m.bus_mut().load64(DATA + offset).unwrap(),
                    if write {
                        SENTINEL
                    } else {
                        0x7ff0_0000_0000_1234
                    }
                );
                assert_eq!(m.hart().csr.fs(), if write { fs as u8 } else { 3 });
            }
        }
    }
    eprintln!(
        "VERIFIER compressed maxima inline={inline} cases=16 offsets=248,504 mtval=3c60,bc60,307e,bf82"
    );
}

pub fn pmp_interior(make: Factory, inline: bool) {
    let mut cases = 0;
    for double in [false, true] {
        for write in [false, true] {
            for mode in 0..4 {
                let mut m = Machine::new(64 * 1024);
                status(
                    &mut m,
                    (2 << 13) | if mode == 2 { (1 << 17) | (1 << 11) } else { 0 },
                );
                m.hart_mut().csr.mode = if mode == 0 { Priv::S } else { Priv::M };
                // An 8-byte NAPOT denial inside an otherwise allowed 4 KiB page.
                m.hart_mut().csr.pmp.write_addr(0, (DATA + 128) >> 2);
                m.hart_mut().csr.pmp.write_addr(1, (DATA >> 2) | 511);
                m.hart_mut()
                    .csr
                    .pmp
                    .write_cfg(0, (0x1f << 8) | 0x18 | if mode == 3 { 0x80 } else { 0 });
                let words = match (double, write) {
                    (false, false) => [0x0002_a007, 0x0802_af87],
                    (true, false) => [0x0002_b007, 0x0802_bf87],
                    (false, true) => [0x0002_a027, 0x09f2_a027],
                    (true, true) => [0x0002_b027, 0x09f2_b027],
                };
                let mut e = install(make, &m, &[0x0016_0613, words[0], words[1], 0x0016_8693]);
                m.hart_mut().regs.pc = PC;
                m.hart_mut().regs.write(5, DATA);
                m.hart_mut().regs.write(12, 10);
                m.hart_mut().regs.write(13, 20);
                m.hart_mut().fregs.write_raw(0, 0x0123_4567_ffa1_2345);
                m.hart_mut().fregs.write_raw(31, SENTINEL);
                m.hart_mut().resv = Some((DATA + 128, 8));
                m.bus_mut().store64(DATA, 0x7ff0_0000_0000_1234).unwrap();
                m.bus_mut()
                    .store64(DATA + 128, 0x7ff0_0000_0000_5678)
                    .unwrap();
                let exit = execute(e.as_mut(), &mut m);
                if mode != 1 {
                    assert_eq!(exit.code, ExitCode::Trap, "VERIFIER_INTERIOR_PMP_DENIAL");
                    assert_eq!(exit.next_pc, PC + 8);
                    assert_eq!(exit.retired, if inline { 2 } else { 0 });
                    assert_eq!(
                        exit.trap,
                        Some(Trap {
                            cause: if write {
                                Exception::StoreAccessFault
                            } else {
                                Exception::LoadAccessFault
                            },
                            tval: DATA + 128
                        })
                    );
                    assert_eq!(m.hart().fregs.read_raw(31), SENTINEL);
                    assert_eq!(
                        m.bus_mut().load64(DATA + 128).unwrap(),
                        0x7ff0_0000_0000_5678
                    );
                    assert_eq!(m.hart().resv, Some((DATA + 128, 8)));
                    assert_eq!(m.hart().regs.read(13), 20);
                } else {
                    assert_eq!(exit.code, ExitCode::Fallthrough);
                    assert_eq!(exit.next_pc, PC + 16);
                    assert_eq!(m.hart().regs.read(13), 21);
                }
                assert_eq!(m.hart().regs.read(12), 11);
                assert_eq!(m.hart().csr.fs(), if write { 2 } else { 3 });
                cases += 1;
            }
        }
    }
    eprintln!("VERIFIER interior PMP inline={inline} cases={cases} modes=S,M,MPRV-S,locked-M");
}

pub fn mprv_revokes_warm_page(make: Factory, inline: bool) {
    for write in [false, true] {
        let mut m = Machine::new(64 * 1024);
        let fs = if write { 2 } else { 3 };
        // Unlocked whole-page denial is permitted in M but denied in effective S.
        m.hart_mut().csr.pmp.write_addr(0, (DATA >> 2) | 511);
        m.hart_mut().csr.pmp.write_cfg(0, 0x18);
        let mut e = install(make, &m, &[if write { 0x0002_b027 } else { 0x0002_b007 }]);
        m.hart_mut().regs.write(5, DATA);
        for _ in 0..3 {
            status(&mut m, fs << 13);
            m.hart_mut().regs.pc = PC;
            m.hart_mut().fregs.write_raw(0, SENTINEL);
            m.bus_mut().store64(DATA, 0x7ff0_0000_0000_1234).unwrap();
            assert_eq!(execute(e.as_mut(), &mut m).code, ExitCode::Fallthrough);
        }
        // Keep FS identical: only effective privilege may revoke the warm tag.
        status(&mut m, (fs << 13) | (1 << 17) | (1 << 11));
        m.hart_mut().regs.pc = PC + 0x1000;
        m.hart_mut().fregs.write_raw(0, SENTINEL);
        m.bus_mut().store64(DATA, 0x7ff0_0000_0000_5678).unwrap();
        let exit = execute(e.as_mut(), &mut m);
        assert_eq!(exit.code, ExitCode::Trap);
        assert_eq!(exit.next_pc, PC + 0x1000);
        assert_eq!(exit.retired, 0);
        assert_eq!(
            exit.trap,
            Some(Trap {
                cause: if write {
                    Exception::StoreAccessFault
                } else {
                    Exception::LoadAccessFault
                },
                tval: DATA
            })
        );
        assert_eq!(m.hart().fregs.read_raw(0), SENTINEL);
        assert_eq!(m.bus_mut().load64(DATA).unwrap(), 0x7ff0_0000_0000_5678);
        assert_eq!(m.hart().csr.fs(), fs as u8);
    }
    eprintln!("VERIFIER MPRV warm permission revocation inline={inline} cases=2");
}

pub fn page_edges_and_triggers(make: Factory, inline: bool) {
    for write in [false, true] {
        for trigger in [false, true] {
            let mut m = Machine::new(if trigger { 64 * 1024 } else { 0x4100 });
            let second = if trigger { DATA + 128 } else { DATA + 256 };
            let words = match (write, trigger) {
                (false, false) => [0x0002_b007, 0x1002_bf87],
                (true, false) => [0x0002_b027, 0x11f2_b027],
                (false, true) => [0x0002_b007, 0x0802_bf87],
                (true, true) => [0x0002_b027, 0x09f2_b027],
            };
            let mut e = install(make, &m, &words);
            m.hart_mut().regs.write(5, DATA);
            if trigger {
                status(&mut m, 3 << 13);
                for _ in 0..2 {
                    m.hart_mut().regs.pc = PC;
                    assert_eq!(execute(e.as_mut(), &mut m).code, ExitCode::Fallthrough);
                }
                for (csr, value) in [
                    (TDATA2, second),
                    (TDATA1, (2 << 60) | (1 << 6) | if write { 2 } else { 1 }),
                    (TCONTROL, 1 << 3),
                ] {
                    m.hart_mut()
                        .csr
                        .access(csr, CsrOp::Write, value, false, false, 0)
                        .unwrap();
                }
            }
            for phase in 0..if trigger { 2 } else { 1 } {
                if phase == 1 {
                    m.hart_mut()
                        .csr
                        .access(TDATA2, CsrOp::Write, DATA, false, false, 0)
                        .unwrap();
                }
                status(&mut m, 2 << 13);
                m.hart_mut().regs.pc = PC;
                m.hart_mut().fregs.write_raw(0, SENTINEL);
                m.hart_mut().fregs.write_raw(31, SENTINEL);
                m.bus_mut().store64(DATA, 0x7ff0_0000_0000_1234).unwrap();
                if trigger {
                    m.bus_mut().store64(second, 0x7ff0_0000_0000_5678).unwrap();
                }
                let exit = execute(e.as_mut(), &mut m);
                assert_eq!(exit.code, ExitCode::Trap);
                assert_eq!(exit.next_pc, PC + if phase == 0 { 4 } else { 0 });
                assert_eq!(exit.retired, u64::from(inline && phase == 0));
                assert_eq!(
                    exit.trap,
                    Some(Trap {
                        cause: if trigger {
                            Exception::Breakpoint
                        } else if write {
                            Exception::StoreAccessFault
                        } else {
                            Exception::LoadAccessFault
                        },
                        tval: if phase == 0 { second } else { DATA },
                    })
                );
                assert_eq!(m.hart().fregs.read_raw(31), SENTINEL);
                assert_eq!(
                    m.hart().fregs.read_raw(0),
                    if write || phase == 1 {
                        SENTINEL
                    } else {
                        0x7ff0_0000_0000_1234
                    }
                );
                assert_eq!(
                    m.bus_mut().load64(DATA).unwrap(),
                    if write && phase == 0 {
                        SENTINEL
                    } else {
                        0x7ff0_0000_0000_1234
                    }
                );
                assert_eq!(m.hart().csr.fs(), if write || phase == 1 { 2 } else { 3 });
                if trigger {
                    assert_eq!(m.bus_mut().load64(second).unwrap(), 0x7ff0_0000_0000_5678);
                }
            }
        }
    }
    eprintln!("VERIFIER partial RAM page and data triggers inline={inline} cases=6");
}
