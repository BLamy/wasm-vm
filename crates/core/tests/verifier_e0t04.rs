//! E0-T04 adversarial verifier attack suite (fresh session, 2026-07-02).
//! Own constructions throughout — no worker fixtures reused.

use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::mmio::{AttachError, MmioDevice, RecordingDevice, SystemBus, Width};
use wasm_vm_core::ram::Ram;

const RAM_SIZE: u64 = 64 * 1024;
const RAM_END: u64 = DRAM_BASE + RAM_SIZE;

fn rec(
    v: u64,
) -> (
    Box<RecordingDevice>,
    std::rc::Rc<std::cell::RefCell<wasm_vm_core::mmio::RecordingLog>>,
) {
    let (d, l) = RecordingDevice::new(v);
    (Box::new(d), l)
}

// ---- P2: RAM-overlap aliasing --------------------------------------------

#[test]
fn p2_ram_overlap_attacks() {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    // Task attack 1: DRAM_BASE - 4, len 8 straddles RAM head.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(DRAM_BASE - 4, 8, d), Err(AttachError::Overlap));
    // Fully inside RAM.
    let (d, _) = rec(0);
    assert_eq!(
        bus.attach(DRAM_BASE + 0x100, 0x10, d),
        Err(AttachError::Overlap)
    );
    // Exactly == RAM extent.
    let (d, _) = rec(0);
    assert_eq!(
        bus.attach(DRAM_BASE, RAM_SIZE, d),
        Err(AttachError::Overlap)
    );
    // Last byte of window == last byte of RAM.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(RAM_END - 8, 8, d), Err(AttachError::Overlap));
    // Adjacent-before DRAM_BASE (touching, not overlapping) is LEGAL.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(DRAM_BASE - 0x10, 0x10, d), Ok(()));
    // Adjacent-after RAM end is LEGAL.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(RAM_END, 0x10, d), Ok(()));
}

#[test]
fn p2_zero_size_ram_frees_the_dram_range() {
    let mut bus = SystemBus::new(Ram::new(0).unwrap());
    let (d, log) = rec(0xAB);
    assert_eq!(bus.attach(DRAM_BASE, 0x1000, d), Ok(()));
    assert_eq!(bus.load8(DRAM_BASE + 5), Ok(0xAB));
    assert_eq!(log.borrow().reads, [(0x5, Width::B1)]);
}

#[test]
fn p2_ram_tail_past_u64_max_still_rejects_overlap() {
    // E0-T03 allows RAM whose (base + len) as u128 exceeds u64::MAX.
    let base = u64::MAX - 0xFFF;
    let mut bus = SystemBus::new(Ram::with_base(base, 0x2000).unwrap());
    // Window inside the u64-representable head of that RAM must be rejected.
    let (d, _) = rec(0);
    assert_eq!(
        bus.attach(u64::MAX - 0x100, 0x10, d),
        Err(AttachError::Overlap)
    );
    // Window straddling the RAM base must be rejected.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(base - 8, 16, d), Err(AttachError::Overlap));
    // Adjacent-before is legal.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(base - 0x10, 0x10, d), Ok(()));
}

// ---- P3: straddle silence -------------------------------------------------

#[test]
fn p3_first_byte_is_last_byte_of_window_zero_calls() {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (d, log) = rec(0);
    bus.attach(0x1000_0000, 0x100, d).unwrap();
    let last = 0x1000_00FF;
    assert_eq!(bus.load64(last), Err(BusFault::Access));
    assert_eq!(bus.load16(last), Err(BusFault::Access));
    assert_eq!(bus.store64(last, 1), Err(BusFault::Access));
    assert_eq!(
        log.borrow().reads.len() + log.borrow().writes.len(),
        0,
        "straddling access must never reach the device"
    );
}

#[test]
fn p3_novel_adjacent_windows_straddle_hits_neither_device() {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (d1, log1) = rec(0x11);
    let (d2, log2) = rec(0x22);
    // w1 = [0x1000_0000, 0x1000_0104), w2 = [0x1000_0104, 0x1000_0204): every byte
    // of an 8-byte access at 0x1000_0100 is MAPPED (4 in w1, 4 in w2) and the
    // address is 8-aligned — full-containment policy must still fault Access with
    // zero calls on BOTH devices.
    bus.attach(0x1000_0000, 0x104, d1).unwrap();
    bus.attach(0x1000_0104, 0x100, d2).unwrap();
    assert_eq!(bus.load64(0x1000_0100), Err(BusFault::Access));
    assert_eq!(bus.store64(0x1000_0100, 0xDEAD), Err(BusFault::Access));
    // Sanity: both windows individually reachable.
    assert_eq!(bus.load32(0x1000_0100), Ok(0x11)); // fully in w1
    assert_eq!(bus.load32(0x1000_0104), Ok(0x22)); // fully in w2
    let (r1, w1) = (log1.borrow().reads.len(), log1.borrow().writes.len());
    let (r2, w2) = (log2.borrow().reads.len(), log2.borrow().writes.len());
    assert_eq!((r1, w1), (1, 0), "w1 must see only the sanity load32");
    assert_eq!((r2, w2), (1, 0), "w2 must see only the sanity load32");
}

#[test]
fn p3_novel_device_window_into_ram_straddle() {
    // Window adjacent-before DRAM_BASE; a load64 at DRAM_BASE-4 spans window→RAM.
    // Both sides mapped; full containment in neither → Access, zero device calls,
    // and RAM byte-identical after the faulting store.
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (d, log) = rec(0);
    bus.attach(DRAM_BASE - 0x10, 0x10, d).unwrap();
    assert_eq!(bus.load64(DRAM_BASE - 4), Err(BusFault::Access));
    assert_eq!(bus.store64(DRAM_BASE - 4, u64::MAX), Err(BusFault::Access));
    assert_eq!(log.borrow().reads.len() + log.borrow().writes.len(), 0);
    assert_eq!(bus.load32(DRAM_BASE), Ok(0), "RAM head must be untouched");
}

// ---- P5: width forwarding across all 8 ops --------------------------------

#[test]
fn p5_all_eight_ops_forward_exact_width_one_call_each() {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (d, log) = rec(u64::MAX);
    bus.attach(0x1000_0000, 0x100, d).unwrap();
    assert_eq!(bus.load8(0x1000_0008), Ok(0xFF)); // masking of all-ones
    assert_eq!(bus.load16(0x1000_0010), Ok(0xFFFF));
    assert_eq!(bus.load32(0x1000_0020), Ok(0xFFFF_FFFF));
    assert_eq!(bus.load64(0x1000_0040), Ok(u64::MAX));
    bus.store8(0x1000_0001, 0x5A).unwrap();
    bus.store16(0x1000_0002, 0xCAFE).unwrap();
    bus.store32(0x1000_0004, 0xDEAD_BEEF).unwrap();
    bus.store64(0x1000_0048, 0x0123_4567_89AB_CDEF).unwrap();
    let log = log.borrow();
    assert_eq!(
        log.reads,
        [
            (0x08, Width::B1),
            (0x10, Width::B2),
            (0x20, Width::B4),
            (0x40, Width::B8)
        ]
    );
    assert_eq!(
        log.writes,
        [
            (0x01, Width::B1, 0x5A),
            (0x02, Width::B2, 0xCAFE),
            (0x04, Width::B4, 0xDEAD_BEEF),
            (0x48, Width::B8, 0x0123_4567_89AB_CDEF),
        ],
        "each store must arrive as exactly ONE call at its own width"
    );
}

// ---- P6: attach edge cases, typed errors, no panics ------------------------

#[test]
fn p6_attach_edges_typed_errors_no_panics() {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (d, _) = rec(0);
    assert_eq!(bus.attach(0x4000_0000, 0, d), Err(AttachError::ZeroLength));
    let (d, _) = rec(0);
    assert_eq!(
        bus.attach(u64::MAX - 2, 8, d),
        Err(AttachError::AddressOverflow)
    );
    let (d, _) = rec(0);
    // base + len == 2^64 exactly: documented unattachable (end-exclusive bound).
    assert_eq!(
        bus.attach(u64::MAX - 7, 8, d),
        Err(AttachError::AddressOverflow)
    );
    let (d, _) = rec(0);
    assert_eq!(
        bus.attach(u64::MAX, 1, d),
        Err(AttachError::AddressOverflow)
    );
    // len == u64::MAX with base 0: representable end, but overlaps RAM.
    let (d, _) = rec(0);
    assert_eq!(bus.attach(0, u64::MAX, d), Err(AttachError::Overlap));
    // len == u64::MAX with base 0 over a zero-size-RAM bus: LEGAL and routable.
    let mut empty = SystemBus::new(Ram::new(0).unwrap());
    let (d, log) = rec(0x77);
    assert_eq!(empty.attach(0, u64::MAX, d), Ok(()));
    assert_eq!(empty.load8(u64::MAX - 1), Ok(0x77)); // last byte of the window
    // u64::MAX - 8 is NOT 8-aligned; precedence check: in-window misaligned.
    assert_eq!(empty.load64(u64::MAX - 8), Err(BusFault::Misaligned));
    assert_eq!(empty.load64(0xFFFF_FFFF_FFFF_FFF0), Ok(0x77)); // aligned tail read
    assert_eq!(log.borrow().reads.len(), 2);
}

// ---- Novel: device fault does not corrupt masking path ----------------------

#[test]
fn novel_error_device_and_offset_relativity_at_extreme_base() {
    struct FlakyDev(u32);
    impl MmioDevice for FlakyDev {
        fn read(&mut self, offset: u64, _w: Width) -> Result<u64, BusFault> {
            self.0 += 1;
            if self.0 % 2 == 1 {
                Err(BusFault::Access)
            } else {
                Ok(offset)
            }
        }
        fn write(&mut self, _: u64, _: Width, _: u64) -> Result<(), BusFault> {
            Err(BusFault::Misaligned) // device-chosen fault must propagate verbatim
        }
    }
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    bus.attach(0xFFFF_FFFF_0000_0000, 0x1000, Box::new(FlakyDev(0)))
        .unwrap();
    assert_eq!(bus.load64(0xFFFF_FFFF_0000_0800), Err(BusFault::Access));
    assert_eq!(bus.load64(0xFFFF_FFFF_0000_0800), Ok(0x800)); // window-relative offset
    assert_eq!(
        bus.store8(0xFFFF_FFFF_0000_0001, 9),
        Err(BusFault::Misaligned)
    );
}
