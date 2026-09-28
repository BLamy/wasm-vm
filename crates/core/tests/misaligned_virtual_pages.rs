//! Omarchy scalar-memory regression: adjacent virtual pages need not have
//! adjacent physical frames. These tests use real page tables and CSR state.
#![cfg(not(feature = "zicsr-stub"))]

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, Priv, SATP};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::mmio::RecordingDevice;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{TraceRecord, TraceSink};

const VA: u64 = 0x4000;
const PC: u64 = 0x1000;
const CODE: u64 = DRAM_BASE + 0x8000;
const FIRST: u64 = DRAM_BASE + 0xa000;
const SECOND: u64 = DRAM_BASE + 0xc000;
const PERMS: u64 = 1 | 2 | 4 | 8 | 64 | 128;

fn fixture(second: u64, second_perms: u64) -> (Hart, SystemBus) {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let (l2, l1, l0) = (DRAM_BASE + 0x1000, DRAM_BASE + 0x2000, DRAM_BASE + 0x3000);
    bus.store64(l2, ((l1 >> 12) << 10) | 1).unwrap();
    bus.store64(l1, ((l0 >> 12) << 10) | 1).unwrap();
    for (va, pa, flags) in [
        (PC, CODE, PERMS),
        (VA, FIRST, PERMS),
        (VA + 4096, second, second_perms),
    ] {
        bus.store64(l0 + ((va >> 12) & 511) * 8, ((pa >> 12) << 10) | flags)
            .unwrap();
    }
    let mut hart = Hart::new();
    hart.csr.pmp.allow_all();
    hart.csr
        .access(SATP, CsrOp::Write, (8 << 60) | (l2 >> 12), false, false, 0)
        .unwrap();
    hart.csr.mode = Priv::S;
    hart.regs.pc = PC;
    (hart, bus)
}

#[test]
fn ld_crosses_noncontiguous_physical_pages() {
    let (mut hart, mut bus) = fixture(SECOND, PERMS);
    bus.store32(FIRST + 4092, 0x44332211).unwrap();
    bus.store32(SECOND, 0x88776655).unwrap();
    // ld x5, 0(x6), exactly the page+0xffc shape seen in systemd.
    bus.store32(CODE, (6 << 15) | (3 << 12) | (5 << 7) | 0x03)
        .unwrap();
    hart.regs.write(6, VA + 4092);
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(5), 0x8877665544332211);
    assert_eq!(hart.regs.pc, PC + 4);
}

fn load_insn(kind: u32) -> u32 {
    (6 << 15) | (kind << 12) | (5 << 7) | 0x03
}

fn store_insn(width: u64) -> u32 {
    (5 << 20) | (6 << 15) | (width.trailing_zeros() << 12) | 0x23
}

// An independent oracle: explicit tail/head indexing, not the runtime plan.
fn physical(second: u64, offset: u64, index: u64) -> u64 {
    if offset + index < 4096 {
        FIRST + offset + index
    } else {
        second + offset + index - 4096
    }
}

fn filled_fixture(second: u64, flags: u64) -> (Hart, SystemBus) {
    let (hart, mut bus) = fixture(second, flags);
    for pa in [FIRST, SECOND, FIRST - 4096, FIRST + 4096] {
        for i in 0..4096 {
            bus.store8(pa + i, 0x5a).unwrap();
        }
    }
    (hart, bus)
}

#[test]
fn crossing_load_matrix_interpreter_and_jit() {
    let bytes = [0x13, 0xe7, 0x85, 0xd3, 0x42, 0xa6, 0x39, 0xf1];
    for second in [SECOND, FIRST - 4096, FIRST, FIRST + 4096] {
        for (kind, width, signed) in [
            (1, 2, true),
            (5, 2, false),
            (2, 4, true),
            (6, 4, false),
            (3, 8, true),
        ] {
            for offset in (4097 - width)..4096 {
                for jit in [false, true] {
                    let (mut hart, mut bus) = filled_fixture(second, PERMS);
                    for i in 0..width {
                        bus.store8(physical(second, offset, i), bytes[i as usize])
                            .unwrap();
                    }
                    let raw = bytes[..width as usize]
                        .iter()
                        .rev()
                        .fold(0_u64, |v, b| (v << 8) | u64::from(*b));
                    let expected = if signed {
                        ((raw << (64 - 8 * width)) as i64 >> (64 - 8 * width)) as u64
                    } else {
                        raw
                    };
                    let value = if jit {
                        hart.jit_load(&mut bus, VA + offset, kind).unwrap() as u64
                    } else {
                        bus.store32(CODE, load_insn(kind as u32)).unwrap();
                        hart.regs.write(6, VA + offset);
                        hart.step(&mut bus).unwrap();
                        assert_eq!(hart.regs.pc, PC + 4);
                        hart.regs.read(5)
                    };
                    assert_eq!(
                        value, expected,
                        "second={second:x} offset={offset} kind={kind} jit={jit}"
                    );
                }
            }
        }
    }
}

#[test]
fn crossing_store_matrix_preserves_other_bytes_and_logs_all_frames() {
    const VALUE: u64 = 0xe193a65cd287f041;
    for second in [SECOND, FIRST - 4096, FIRST, FIRST + 4096] {
        for width in [2_u64, 4, 8] {
            for offset in (4097 - width)..4096 {
                for jit in [false, true] {
                    for overlap in [false, true] {
                        let (mut hart, mut bus) = filled_fixture(second, PERMS);
                        bus.store32(CODE, store_insn(width)).unwrap();
                        hart.regs.write(6, VA + offset);
                        hart.regs.write(5, VALUE);
                        let reservation = Some((if overlap { VA + 4096 } else { VA + 256 }, 8));
                        hart.resv = reservation;
                        let mut expected = bus.ram().as_bytes().to_vec();
                        for i in 0..width {
                            expected[(physical(second, offset, i) - DRAM_BASE) as usize] =
                                VALUE.to_le_bytes()[i as usize];
                        }
                        bus.arm_code_write_tracking(true);
                        if jit {
                            assert_eq!(
                                hart.jit_store_with_ram_phys(
                                    &mut bus,
                                    VA + offset,
                                    VALUE as i64,
                                    width as i32
                                ),
                                Ok(None)
                            );
                        } else {
                            hart.step(&mut bus).unwrap();
                            assert_eq!(hart.regs.pc, PC + 4);
                        }
                        assert_eq!(
                            bus.ram().as_bytes(),
                            expected,
                            "second={second:x} offset={offset} width={width} jit={jit}"
                        );
                        assert_eq!(hart.resv, if overlap { None } else { reservation });
                        let mut frames = bus.code_write_log_mut().clone();
                        frames.sort_unstable();
                        frames.dedup();
                        let mut expected_frames = vec![FIRST >> 12, second >> 12];
                        expected_frames.sort_unstable();
                        expected_frames.dedup();
                        assert_eq!(frames, expected_frames);
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)] // Explicit independent fault matrix coordinates.
fn check_fault(
    mut hart: Hart,
    mut bus: SystemBus,
    width: u64,
    offset: u64,
    store: bool,
    jit: bool,
    cause: Exception,
    tval: u64,
) {
    bus.store32(
        CODE,
        if store {
            store_insn(width)
        } else {
            load_insn(width.trailing_zeros())
        },
    )
    .unwrap();
    hart.regs.write(6, VA + offset);
    hart.regs.write(5, 0xfeedface);
    hart.resv = Some((VA + offset, 8));
    let before = bus.ram().as_bytes().to_vec();
    bus.arm_code_write_tracking(true);
    let result = if jit {
        if store {
            hart.jit_store_with_ram_phys(&mut bus, VA + offset, -1, width as i32)
                .map(|_| ())
        } else {
            hart.jit_load(&mut bus, VA + offset, width.trailing_zeros() as i32)
                .map(|_| ())
        }
    } else {
        hart.step(&mut bus)
    };
    assert_eq!(result, Err(Trap { cause, tval }));
    assert_eq!(bus.ram().as_bytes(), before);
    assert!(bus.code_write_log_mut().is_empty());
    assert_eq!(hart.resv, Some((VA + offset, 8)));
    assert_eq!(hart.regs.pc, PC);
    assert_eq!(hart.regs.read(5), 0xfeedface);
}

#[test]
fn first_fragment_pmp_denial_and_wrapping_address_are_silent() {
    for jit in [false, true] {
        for store in [false, true] {
            let (mut hart, bus) = filled_fixture(SECOND, PERMS);
            first_pmp_region(&mut hart, FIRST, true, 0);
            check_fault(
                hart,
                bus,
                8,
                4092,
                store,
                jit,
                if store {
                    Exception::StoreAccessFault
                } else {
                    Exception::LoadAccessFault
                },
                VA + 4092,
            );
        }
    }
    let (mut hart, mut bus) = fixture(SECOND, PERMS);
    let before = bus.ram().as_bytes().to_vec();
    assert_eq!(
        hart.jit_load(&mut bus, u64::MAX - 2, 3),
        Err(Trap {
            cause: Exception::LoadAccessFault,
            tval: u64::MAX - 2
        })
    );
    assert_eq!(
        hart.jit_store_with_ram_phys(&mut bus, u64::MAX - 2, -1, 8),
        Err(Trap {
            cause: Exception::StoreAccessFault,
            tval: u64::MAX - 2
        })
    );
    assert_eq!(bus.ram().as_bytes(), before);
}

#[test]
fn atomics_remain_misaligned_and_preserve_reservation() {
    for funct5 in [2_u32, 3, 0, 1, 4, 8, 12, 16, 20, 24, 28] {
        for width in [4_u64, 8] {
            for offset in (4097 - width)..4096 {
                // Missing second leaf ensures alignment traps still precede translation.
                let (mut hart, mut bus) = filled_fixture(SECOND, 0);
                let rs2 = if funct5 == 2 { 0 } else { 5 };
                let insn = (funct5 << 27)
                    | (rs2 << 20)
                    | (6 << 15)
                    | (width.trailing_zeros() << 12)
                    | (7 << 7)
                    | 0x2f;
                bus.store32(CODE, insn).unwrap();
                hart.regs.write(6, VA + offset);
                hart.resv = Some((VA + offset, width as u8));
                let before = bus.ram().as_bytes().to_vec();
                bus.arm_code_write_tracking(true);
                assert_eq!(
                    hart.step(&mut bus),
                    Err(Trap {
                        cause: if funct5 == 2 {
                            Exception::LoadAddrMisaligned
                        } else {
                            Exception::StoreAddrMisaligned
                        },
                        tval: VA + offset,
                    })
                );
                assert_eq!(hart.resv, Some((VA + offset, width as u8)));
                assert_eq!(bus.ram().as_bytes(), before);
                assert!(bus.code_write_log_mut().is_empty());
            }
        }
    }
}

#[test]
fn second_page_faults_are_precise_and_preflight_all_data() {
    for width in [2_u64, 4, 8] {
        for offset in (4097 - width)..4096 {
            for jit in [false, true] {
                for (flags, store, cause) in [
                    (0, false, Exception::LoadPageFault),
                    (0, true, Exception::StorePageFault),
                    (PERMS & !4, true, Exception::StorePageFault),
                    (PERMS & !(2 | 4), false, Exception::LoadPageFault),
                ] {
                    let (hart, bus) = filled_fixture(SECOND, flags);
                    check_fault(hart, bus, width, offset, store, jit, cause, VA + 4096);
                }
            }
        }
    }
}

fn first_pmp_region(hart: &mut Hart, address: u64, napot: bool, permissions: u8) {
    // Entry 0 matches one NA4 word or a NAPOT page; entry 1 allows everything
    // else, including all page-table reads. No permissive entry can override 0.
    hart.csr.pmp.write_cfg(0, 0);
    hart.csr
        .pmp
        .write_addr(0, (address >> 2) | if napot { 511 } else { 0 });
    hart.csr.pmp.write_addr(1, u64::MAX);
    hart.csr.pmp.write_cfg(
        0,
        u64::from(permissions | if napot { 0x18 } else { 0x10 }) | (0x1f << 8),
    );
}

#[test]
fn pmp_denial_and_partial_fragment_match_preflight() {
    for jit in [false, true] {
        for store in [false, true] {
            for (napot, permissions, offset) in [(true, 0, 4092), (false, 7, 4094)] {
                let (mut hart, bus) = filled_fixture(SECOND, PERMS);
                first_pmp_region(&mut hart, SECOND, napot, permissions);
                check_fault(
                    hart,
                    bus,
                    8,
                    offset,
                    store,
                    jit,
                    if store {
                        Exception::StoreAccessFault
                    } else {
                        Exception::LoadAccessFault
                    },
                    VA + 4096,
                );
            }
            let (mut hart, bus) = filled_fixture(FIRST + 4096, PERMS);
            first_pmp_region(&mut hart, FIRST, true, 7);
            // Both per-page entries allow access; one physically contiguous
            // access still straddles the lowest matching PMP entry and fails.
            check_fault(
                hart,
                bus,
                8,
                4092,
                store,
                jit,
                if store {
                    Exception::StoreAccessFault
                } else {
                    Exception::LoadAccessFault
                },
                VA + 4092,
            );
        }
    }
}

#[test]
fn device_or_unmapped_physical_second_page_is_silent() {
    for second in [0x1000_0000, DRAM_BASE + 65536] {
        for jit in [false, true] {
            for store in [false, true] {
                let (hart, mut bus) = filled_fixture(second, PERMS);
                let (device, log) = RecordingDevice::new(0xff);
                bus.attach(0x1000_0000, 4096, Box::new(device)).unwrap();
                check_fault(
                    hart,
                    bus,
                    8,
                    4092,
                    store,
                    jit,
                    if store {
                        Exception::StoreAccessFault
                    } else {
                        Exception::LoadAccessFault
                    },
                    VA + 4096,
                );
                assert!(log.borrow().reads.is_empty());
                assert!(log.borrow().writes.is_empty());
            }
        }
    }
}

#[test]
fn ordinary_aligned_and_one_page_misaligned_hints_remain() {
    for width in [1_u64, 2, 4, 8] {
        for offset in [128, 129] {
            let (mut hart, mut bus) = fixture(SECOND, PERMS);
            assert_eq!(
                hart.jit_store_with_ram_phys(&mut bus, VA + offset, -1, width as i32),
                Ok(Some(FIRST + offset))
            );
            assert_eq!(
                hart.jit_load(&mut bus, VA + offset, width.trailing_zeros() as i32),
                Ok(-1)
            );
        }
    }
}

#[test]
fn regression_guest_trace_and_state_digest() {
    struct Capture(Vec<TraceRecord>);
    impl TraceSink for Capture {
        fn retire(&mut self, record: &TraceRecord) {
            self.0.push(*record);
        }
    }
    let (mut hart, mut bus) = fixture(SECOND, PERMS);
    bus.store32(FIRST + 4092, 0x44332211).unwrap();
    bus.store32(SECOND, 0x88776655).unwrap();
    bus.store32(CODE, load_insn(3)).unwrap();
    bus.store32(CODE + 4, store_insn(8)).unwrap();
    hart.regs.write(6, VA + 4092);
    let mut trace = Capture(Vec::new());
    hart.step_traced(&mut bus, &mut trace).unwrap();
    assert_eq!(hart.regs.read(5), 0x8877665544332211);
    hart.regs.write(5, 0xfedcba9876543210);
    hart.step_traced(&mut bus, &mut trace).unwrap();
    assert_eq!(trace.0.len(), 2);
    assert_eq!(trace.0[0].rd, Some((5, 0x8877665544332211)));
    assert_eq!(trace.0[1].mem.unwrap().value, 0xfedcba9876543210);
    assert_eq!(bus.load32(FIRST + 4092).unwrap(), 0x76543210);
    assert_eq!(bus.load32(SECOND).unwrap(), 0xfedcba98);
    for record in trace.0 {
        println!("{record:?}");
    }
    let mut digest = Sha256::new();
    digest.update(hart.regs.pc.to_le_bytes());
    for r in 0..32 {
        digest.update(hart.regs.read(r).to_le_bytes());
    }
    digest.update(bus.ram().as_bytes());
    println!("guest pc+xregs+ram sha256={:x}", digest.finalize());
}
