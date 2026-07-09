//! Verification-debt sweep (adversarial critic): hostile tests for E2-T15 (boot glue /
//! Image header), E2-T16 (goldfish RTC), E2-T17 (syscon finisher).

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::Cell;
use std::rc::Rc;

use wasm_vm_core::dev::rtc::{GoldfishRtc, WallClock};
use wasm_vm_core::dev::syscon::SysconFinisher;
use wasm_vm_core::mmio::{MmioDevice, Width};
use wasm_vm_core::{ExitReason, Machine};

const KERNEL_BASE: u64 = 0x8020_0000;
const RAM: usize = 64 * 1024 * 1024;

/// A minimal RISC-V Image header: `image_size` (LE u64) at offset 16, magic2 `RSC\x05`
/// at offset 0x38 — the two fields kernel_image_footprint keys off.
fn image_with_size(image_size: u64, file_len: usize) -> Vec<u8> {
    let mut img = vec![0u8; file_len.max(0x40)];
    img[16..24].copy_from_slice(&image_size.to_le_bytes());
    img[0x38..0x3c].copy_from_slice(b"RSC\x05");
    img
}

// ---------------------------------------------------------------- E2-T15 ----

/// ATTACK: a corrupt/hostile `image_size` chosen so `KERNEL_BASE + image_size` WRAPS u64
/// to an address back inside RAM (0x8001_0000): the 2 MiB round-up then lands the initrd
/// at KERNEL_BASE — exactly on top of the kernel. The boot assembler must reject this
/// header with an Err; it must not panic (debug) or silently corrupt the layout (release).
#[test]
fn hostile_image_size_wrap_is_rejected_not_wrapped() {
    // kernel_end target after wrap: 0x8001_0000 (inside RAM, below KERNEL_BASE).
    let image_size = 0x8001_0000u64.wrapping_sub(KERNEL_BASE); // huge (~2^64)
    let img = image_with_size(image_size, 0x1000);
    let initrd = vec![0xAAu8; 4096];
    let mut m = Machine::new(RAM);
    let r = m.place_and_boot(&img, Some(&initrd), "console=ttyS0");
    assert!(
        r.is_err(),
        "wrapping image_size must be rejected, got {:?}",
        r.map(|l| (l.kernel_end, l.initrd.map(|i| (i.start, i.end))))
    );
}

/// Boundary: a footprint that fills RAM exactly to the top is accepted (no initrd);
/// one byte more must fail. Checks the ram-ceiling guard for an off-by-one.
#[test]
fn image_size_ram_ceiling_is_exact() {
    let ram_top = 0x8000_0000u64 + RAM as u64;
    let fits = ram_top - KERNEL_BASE;
    let mut m = Machine::new(RAM);
    assert!(
        m.place_and_boot(&image_with_size(fits, 0x1000), None, "x")
            .is_ok(),
        "footprint flush to top-of-RAM must fit"
    );
    let mut m = Machine::new(RAM);
    assert!(
        m.place_and_boot(&image_with_size(fits + 1, 0x1000), None, "x")
            .is_err(),
        "footprint one byte past top-of-RAM must be rejected"
    );
}

/// Bad magic (one bit flipped) must fall back to file length — the header is untrusted.
#[test]
fn bad_magic_falls_back_to_file_len() {
    let mut img = image_with_size(u64::MAX, 0x1000); // hostile size...
    img[0x38] = b'r'; // ...but the magic is wrong, so it must be ignored
    let mut m = Machine::new(RAM);
    let layout = m
        .place_and_boot(&img, None, "x")
        .expect("boots on file_len");
    assert_eq!(layout.kernel_end, KERNEL_BASE + 0x1000);
}

// ---------------------------------------------------------------- E2-T16 ----

struct SteppingClock {
    t: Rc<Cell<u64>>,
    step: u64,
}
impl WallClock for SteppingClock {
    /// A hostile host clock that advances on EVERY read — the worst case for LOW/HIGH
    /// read coherency (any un-latched re-read is off by the step).
    fn now_ns(&self) -> u64 {
        let v = self.t.get();
        self.t.set(v + self.step);
        v
    }
}

/// ATTACK (task's own adversarial spec): step the clock 1 ms per READ and hammer
/// LOW→HIGH pairs across many 2^32 ns rollovers for 10^6 iterations. Any pair whose
/// combined value is ≥ 2^32 ns from the instant sampled at the LOW read refutes latching.
#[test]
fn rollover_hammer_1e6_reads_with_stepping_clock() {
    let t = Rc::new(Cell::new((1u64 << 32) - 500_000_000)); // just below a rollover
    let truth = Rc::clone(&t);
    let mut rtc = GoldfishRtc::new(Box::new(SteppingClock {
        t,
        step: 1_000_000, // 1 ms per read — LOW and HIGH reads see different host times
    }));
    for i in 0..1_000_000u64 {
        let sampled = truth.get(); // what the LOW read will observe
        let lo = rtc.read(0x00, Width::B4).unwrap();
        let hi = rtc.read(0x04, Width::B4).unwrap();
        let got = (hi << 32) | lo;
        assert!(
            got.abs_diff(sampled) < (1 << 32),
            "4.29s glitch at i={i}: got {got:#x}, sampled {sampled:#x}"
        );
        assert_eq!(got, sampled, "latch pair must equal the LOW-read instant");
    }
}

/// ATTACK: `date -s` to a time BEFORE the host clock (negative offset). The wrapping-u64
/// offset must represent it exactly and keep ticking forward from there.
#[test]
fn guest_set_time_backwards_negative_offset() {
    let host = Rc::new(Cell::new(1_800_000_000_000_000_000u64)); // ~2027 in ns
    struct M(Rc<Cell<u64>>);
    impl WallClock for M {
        fn now_ns(&self) -> u64 {
            self.0.get()
        }
    }
    let mut rtc = GoldfishRtc::new(Box::new(M(Rc::clone(&host))));
    let target = 1_000u64; // 1 µs past the 1970 epoch — far before host time
    rtc.write(0x04, Width::B4, target >> 32).unwrap(); // driver order: HIGH then LOW
    rtc.write(0x00, Width::B4, target & 0xffff_ffff).unwrap();
    let lo = rtc.read(0x00, Width::B4).unwrap();
    let hi = rtc.read(0x04, Width::B4).unwrap();
    assert_eq!((hi << 32) | lo, target, "backwards set lands exactly");
    // Host advances 5 s → guest advances 5 s from ITS time; host untouched.
    host.set(host.get() + 5_000_000_000);
    let lo = rtc.read(0x00, Width::B4).unwrap();
    let hi = rtc.read(0x04, Width::B4).unwrap();
    assert_eq!((hi << 32) | lo, target + 5_000_000_000);
}

/// QEMU-parity probe (task's adversarial spec): reading TIME_HIGH with NO preceding
/// TIME_LOW read returns the STALE latch (initially 0) — QEMU's goldfish_rtc only
/// refreshes `s->time` on a TIME_LOW read. Divergence observable to the driver refutes.
#[test]
fn time_high_without_low_returns_stale_latch() {
    let t = Rc::new(Cell::new((7u64 << 32) | 42));
    struct M(Rc<Cell<u64>>);
    impl WallClock for M {
        fn now_ns(&self) -> u64 {
            self.0.get()
        }
    }
    let mut rtc = GoldfishRtc::new(Box::new(M(t)));
    assert_eq!(
        rtc.read(0x04, Width::B4).unwrap(),
        0,
        "no LOW read yet → latch is its reset value, like QEMU"
    );
    let _ = rtc.read(0x00, Width::B4).unwrap(); // latch high=7
    assert_eq!(rtc.read(0x04, Width::B4).unwrap(), 7);
}

// ---------------------------------------------------------------- E2-T17 ----

/// QEMU masks the command with 0xffff (hw/misc/sifive_test.c): garbage in the upper
/// bits of a poweroff word still powers off, and a recognized code in the UPPER half
/// only is ignored. Both directions of the mask.
#[test]
fn syscon_command_mask_matches_qemu() {
    let (mut dev, cell) = SysconFinisher::new();
    dev.write(0, Width::B4, 0xABCD_5555).unwrap();
    assert_eq!(
        *cell.borrow(),
        Some(ExitReason::PowerOff),
        "upper 16 bits are don't-care for PASS, like QEMU's `val & 0xffff`"
    );
    let (mut dev, cell) = SysconFinisher::new();
    dev.write(0, Width::B4, 0x5555_0000).unwrap();
    assert_eq!(
        *cell.borrow(),
        None,
        "0x5555 in the UPPER half only is status 0 → ignored"
    );
}

/// QEMU's sifive_test only acts on a write at register offset 0 (`if (addr == 0)`);
/// a recognized value written elsewhere in the 0x1000 window is a guest error, ignored.
/// Our DTB's syscon-poweroff/reboot carry `offset = <0>`, so Linux always writes 0 —
/// but parity says other offsets must NOT power off the machine.
#[test]
fn syscon_write_at_nonzero_offset_is_ignored_qemu_parity() {
    let (mut dev, cell) = SysconFinisher::new();
    dev.write(4, Width::B4, 0x5555).unwrap();
    assert_eq!(
        *cell.borrow(),
        None,
        "0x5555 at offset 4 must be ignored (QEMU acts only at offset 0)"
    );
}

/// Hostile widths: a 1-byte write of 0x55 and an 8-byte write whose LOW word is junk
/// but HIGH word contains 0x5555 must not power off.
#[test]
fn syscon_hostile_widths_do_not_exit() {
    let (mut dev, cell) = SysconFinisher::new();
    dev.write(0, Width::B1, 0x55).unwrap();
    assert_eq!(*cell.borrow(), None, "byte write 0x55 is not a command");
    let (mut dev, cell) = SysconFinisher::new();
    dev.write(0, Width::B8, 0x0000_5555_0001_0000u64).unwrap();
    assert_eq!(
        *cell.borrow(),
        None,
        "0x5555 in the high u64 word only must not power off"
    );
}
