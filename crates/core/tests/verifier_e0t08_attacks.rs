//! E0-T08 adversarial verifier attacks: negative-offset device-window routing,
//! device fault propagation through the hart, full-dump fault purity for every
//! memory-op shape, and a boundary sweep with the verifier's own bases.
use alloc::rc::Rc;
extern crate alloc;
use core::cell::RefCell;

use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::ram::Ram;

const RAM: u64 = 64 * 1024;
const RAM_END: u64 = DRAM_BASE + RAM;
const CODE: u64 = DRAM_BASE;
const DATA: u64 = DRAM_BASE + 0x1000;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}
fn load(f3: u32, rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, f3, rd, 0b0000011)
}

#[derive(Default)]
struct Log {
    reads: Vec<(u64, u64)>,       // (offset, width bytes)
    writes: Vec<(u64, u64, u64)>, // (offset, width bytes, value)
}

/// Records every invocation; reads return `read_val`; writes return `write_err`.
struct RecordingDevice {
    log: Rc<RefCell<Log>>,
    read_val: u64,
    write_err: Option<BusFault>,
}

impl MmioDevice for RecordingDevice {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.log.borrow_mut().reads.push((offset, width.bytes()));
        Ok(self.read_val)
    }
    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.log
            .borrow_mut()
            .writes
            .push((offset, width.bytes(), value));
        match self.write_err {
            Some(f) => Err(f),
            None => Ok(()),
        }
    }
}

const DEV_BASE: u64 = DRAM_BASE - 0x100; // window ends exactly at DRAM_BASE

fn machine_with_device(
    read_val: u64,
    write_err: Option<BusFault>,
) -> (SystemBus, Rc<RefCell<Log>>) {
    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
    let log = Rc::new(RefCell::new(Log::default()));
    bus.attach(
        DEV_BASE,
        0x100,
        Box::new(RecordingDevice {
            log: Rc::clone(&log),
            read_val,
            write_err,
        }),
    )
    .unwrap();
    (bus, log)
}

fn seeded(pc: u64) -> Hart {
    let mut h = Hart::new();
    h.regs.pc = pc;
    for n in 1..32u8 {
        h.regs
            .write(n, 0xA11C_E5E5_0000_0000 ^ (u64::from(n) * 0x0107_0B0D_1113));
    }
    h
}

/// Angle 3: rs1 = DRAM_BASE, imm = -1 → Access fault, tval = DRAM_BASE - 1,
/// no wrap, no device consultation when the access straddles the window edge.
#[test]
fn negative_offset_straddling_device_edge_faults_without_invoking_device() {
    let (mut bus, log) = machine_with_device(0xEE, None);
    // ld at DRAM_BASE-1: bytes span the device/RAM edge -> Access, device silent.
    bus.store32(CODE, load(0b011, 1, 2, -1)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    let t = h.step(&mut bus).unwrap_err();
    // E1-T25 (§3.7.1): DRAM_BASE-1 is byte-misaligned for an 8-byte ld, and misaligned
    // OUTRANKS the range/access fault — so the cause is LoadAddrMisaligned. The invariant
    // this test really guards is UNCHANGED and if anything stronger: the device is never
    // consulted, now because the misaligned pre-check fires before any bus/device access.
    // (A naturally-aligned access CANNOT straddle the aligned DRAM_BASE boundary, so every
    // straddle of it is necessarily misaligned.)
    assert_eq!(t.cause, Exception::LoadAddrMisaligned);
    assert_eq!(t.tval, DRAM_BASE - 1);
    assert_eq!(h.regs.pc, CODE, "pc moved");
    assert!(
        log.borrow().reads.is_empty(),
        "device consulted on straddle"
    );
    assert!(log.borrow().writes.is_empty());

    // sd at DRAM_BASE-1 likewise: misaligned (§3.7.1) → cause 6, device silent.
    bus.store32(CODE, s_type(-1, 3, 2, 0b011)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    let t = h.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::StoreAddrMisaligned);
    assert_eq!(t.tval, DRAM_BASE - 1);
    assert!(log.borrow().writes.is_empty(), "device write on straddle");
}

/// No device mapped: DRAM_BASE-1 must be a plain access fault (never wraps, never RAM).
#[test]
fn negative_offset_unmapped_faults_with_exact_tval() {
    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
    for (word, cause, ea) in [
        (
            load(0b000, 1, 2, -1),
            Exception::LoadAccessFault,
            DRAM_BASE - 1,
        ),
        (
            load(0b101, 1, 2, -2),
            Exception::LoadAccessFault,
            DRAM_BASE - 2,
        ),
        (
            load(0b011, 1, 3, -16),
            Exception::LoadAccessFault,
            DRAM_BASE - 8,
        ),
        (
            s_type(-4, 4, 2, 0b010),
            Exception::StoreAccessFault,
            DRAM_BASE - 4,
        ),
    ] {
        bus.store32(CODE, word).unwrap();
        let mut h = seeded(CODE);
        h.regs.write(2, DRAM_BASE);
        h.regs.write(3, DRAM_BASE + 8);
        let t = h.step(&mut bus).unwrap_err();
        assert_eq!(t.cause, cause, "{word:#010x}");
        assert_eq!(t.tval, ea, "{word:#010x}");
    }
}

/// Loads from a device window flow through the hart: value lands in rd with the
/// device result masked to the width, then sign/zero-extended per the opcode.
#[test]
fn device_load_lands_in_rd_masked_and_extended() {
    // Device returns all-ones beyond the width: masking must contain it.
    let (mut bus, log) = machine_with_device(0xFFFF_FFFF_FFFF_FF80, None);
    // lb from last device byte via negative offset: rs1=DRAM_BASE, imm=-1.
    bus.store32(CODE, load(0b000, 5, 2, -1)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    h.step(&mut bus).unwrap();
    assert_eq!(
        h.regs.read(5),
        0xFFFF_FFFF_FFFF_FF80,
        "lb sext of device 0x80"
    );
    assert_eq!(h.regs.pc, CODE + 4);
    assert_eq!(log.borrow().reads.as_slice(), &[(0xFF, 1)], "offset/width");

    // lbu of the same byte zero-extends the masked value.
    bus.store32(CODE, load(0b100, 6, 2, -1)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    h.step(&mut bus).unwrap();
    assert_eq!(h.regs.read(6), 0x80, "lbu zext of device byte");

    // lw from an aligned in-window address: masked to 32 bits then sign-extended.
    bus.store32(CODE, load(0b010, 7, 2, -8)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    h.step(&mut bus).unwrap();
    assert_eq!(
        h.regs.read(7),
        0xFFFF_FFFF_FFFF_FF80,
        "lw sext of masked device word"
    );
}

/// A device whose write returns Err(Access) must surface as cause 7 with
/// tval = the effective address, leaving regs and pc pure.
#[test]
fn device_write_error_propagates_as_store_access_fault_pure() {
    let (mut bus, log) = machine_with_device(0, Some(BusFault::Access));
    bus.store32(CODE, s_type(-8, 3, 2, 0b010)).unwrap(); // sw -> DEV last word
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    let before = format!("{}", h.regs);
    let pc0 = h.regs.pc;
    let t = h.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::StoreAccessFault);
    assert_eq!(t.tval, DRAM_BASE - 8);
    assert_eq!(h.regs.pc, pc0);
    assert_eq!(
        format!("{}", h.regs),
        before,
        "regs mutated by faulting device store"
    );
    assert_eq!(
        log.borrow().writes.len(),
        1,
        "device write should have been attempted once"
    );

    // Successful device write retires: pc advances, value+width recorded.
    let (mut bus, log) = machine_with_device(0, None);
    bus.store32(CODE, s_type(-4, 3, 2, 0b010)).unwrap();
    let mut h = seeded(CODE);
    h.regs.write(2, DRAM_BASE);
    h.regs.write(3, 0xDDCC_BBAA_0099_8877);
    h.step(&mut bus).unwrap();
    assert_eq!(h.regs.pc, CODE + 4);
    assert_eq!(
        log.borrow().writes.as_slice(),
        &[(0xFC, 4, 0x0099_8877)],
        "sw must pass the low 32 bits"
    );
}

/// Full-dump purity: every memory-op shape, misaligned AND access flavors, with
/// all 31 registers sentinel-seeded. Any register, pc, or RAM change refutes.
#[test]
fn every_memory_fault_shape_leaves_full_dump_untouched() {
    // (f3, is_load, misalignable)
    let loads: &[(u32, bool)] = &[
        (0b000, false), // lb: byte can't misalign
        (0b001, true),
        (0b010, true),
        (0b011, true),
        (0b100, false),
        (0b101, true),
        (0b110, true),
    ];
    let stores: &[(u32, bool)] = &[(0b000, false), (0b001, true), (0b010, true), (0b011, true)];

    let mut cases: Vec<(u32, Exception)> = Vec::new();
    for &(f3, mis) in loads {
        // access fault: rs1=x9 seeded to an unmapped hole
        cases.push((load(f3, 1, 9, 0), Exception::LoadAccessFault));
        if mis {
            // E1-T26: in-RAM misaligned now SUCCEEDS, so the misaligned-FAULT case uses
            // rs1=x10 = RAM_END-2, imm=1 → ea=RAM_END-1: misaligned AND straddling past RAM
            // (not decomposable) → *AddrMisaligned at every width >1.
            cases.push((load(f3, 1, 10, 1), Exception::LoadAddrMisaligned));
        }
    }
    for &(f3, mis) in stores {
        cases.push((s_type(0, 3, 9, f3), Exception::StoreAccessFault));
        if mis {
            cases.push((s_type(1, 3, 10, f3), Exception::StoreAddrMisaligned));
        }
    }

    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
    for i in 0..256u64 {
        bus.store8(DATA + i, (i as u8).wrapping_mul(101).wrapping_add(7))
            .unwrap();
    }
    for (word, cause) in cases {
        bus.store32(CODE, word).unwrap();
        let mut ram_before = vec![0u8; RAM as usize];
        bus.ram().read_slice(DRAM_BASE, &mut ram_before).unwrap();

        let mut h = seeded(CODE);
        h.regs.write(9, 0x4000); // unmapped hole
        h.regs.write(10, RAM_END - 2); // imm=1 → ea=RAM_END-1: misaligned + straddles past RAM
        let dump = format!("{}", h.regs);
        let t = h.step(&mut bus).unwrap_err();
        assert_eq!(t.cause, cause, "{word:#010x}");
        assert_eq!(h.regs.pc, CODE, "{word:#010x}: pc moved on fault");
        assert_eq!(
            format!("{}", h.regs),
            dump,
            "{word:#010x}: registers mutated"
        );

        let mut ram_after = vec![0u8; RAM as usize];
        bus.ram().read_slice(DRAM_BASE, &mut ram_after).unwrap();
        assert_eq!(ram_before, ram_after, "{word:#010x}: RAM mutated on fault");
    }
}

/// Boundary sweep with the verifier's own bases: reach RAM_END-w from a base far
/// below via a positive imm, and from above RAM_END via a negative imm.
#[test]
fn boundary_sweep_verifier_bases() {
    for &(lf3, sf3, w) in &[
        (0b000u32, 0b000u32, 1u64),
        (0b001, 0b001, 2),
        (0b010, 0b010, 4),
        (0b011, 0b011, 8),
    ] {
        let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
        let last = RAM_END - w;
        // reach `last` from below with imm=+w: rs1 = last - w
        bus.store32(CODE, load(lf3, 1, 2, w as i32)).unwrap();
        let mut h = seeded(CODE);
        h.regs.write(2, last - w);
        h.step(&mut bus)
            .unwrap_or_else(|t| panic!("w={w} last-slot load trapped {t:?}"));
        // one past from ABOVE ram end with negative imm: rs1 = RAM_END + w, imm = -(w as i32 - 1) - ...
        // ea = last + 1 = RAM_END - w + 1: rs1 = RAM_END, imm = 1 - w
        bus.store32(CODE, load(lf3, 1, 2, 1 - w as i32)).unwrap();
        let mut h = seeded(CODE);
        h.regs.write(2, RAM_END);
        let t = h.step(&mut bus).unwrap_err();
        // E1-T25 (§3.7.1): ea = RAM_END - w + 1. For w>1 this is misaligned (RAM_END is
        // 8-aligned) → LoadAddrMisaligned OUTRANKS the past-end access fault; for w==1 the
        // access is byte-aligned and simply past the end → LoadAccessFault.
        let expect_load = if w > 1 {
            Exception::LoadAddrMisaligned
        } else {
            Exception::LoadAccessFault
        };
        assert_eq!(t.cause, expect_load, "w={w}");
        assert_eq!(t.tval, last + 1, "w={w}");
        // store variants
        bus.store32(CODE, s_type(w as i32, 3, 2, sf3)).unwrap();
        let mut h = seeded(CODE);
        h.regs.write(2, last - w);
        h.regs.write(3, 0x55);
        h.step(&mut bus)
            .unwrap_or_else(|t| panic!("w={w} last-slot store trapped {t:?}"));
        bus.store32(CODE, s_type(1 - w as i32, 3, 2, sf3)).unwrap();
        let mut h = seeded(CODE);
        h.regs.write(2, RAM_END);
        let t = h.step(&mut bus).unwrap_err();
        // §3.7.1, mirror of the load: w>1 misaligned straddle → StoreAddrMisaligned;
        // w==1 aligned-past → StoreAccessFault.
        let expect_store = if w > 1 {
            Exception::StoreAddrMisaligned
        } else {
            Exception::StoreAccessFault
        };
        assert_eq!(t.cause, expect_store, "w={w}");
        assert_eq!(t.tval, last + 1, "w={w}");
    }
}
