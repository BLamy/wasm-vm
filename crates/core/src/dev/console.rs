//! Stub write-only console (E0-T12): the output organ the capstone's "Hello from RV64"
//! travels through. A minimal 16550-shaped device at [`crate::bus::mmap::UART0_BASE`]
//! that forwards every byte written to offset 0 (the THR) to a host [`ConsoleSink`].
//!
//! Forward-compatibility: reads at offset 5 (LSR) return `0x60` = THR-empty (bit 5) +
//! transmitter-idle (bit 6), so a naive `while (!(lsr & 0x20));` polling loop always
//! sees "ready" and terminates. E2 replaces this stub with a full 16550 model at the
//! same base address — no guest relink. Spike has no device here, so E0-T20's
//! differential runs map this page as plain RAM on the Spike side (`spike -m`), keeping
//! instruction traces aligned while output only materializes on our side.
//!
//! The sink is a CORE trait (bet #2: the core stays browser-ignorant). The CLI provides
//! a stdout sink (std-only), the wasm crate a JS-callback sink (E0-T22).

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

/// Where console output goes. Buffering policy belongs to the SINK, not the device —
/// [`Uart0Stub`] never grows a buffer, so a hostile output flood costs O(1) device state.
pub trait ConsoleSink {
    /// Consume one output byte. Binary-safe: no UTF-8 validation, no newline translation.
    fn put_byte(&mut self, b: u8);
}

const THR: u64 = 0; // Transmitter Holding Register (write) / RBR (read) — offset 0
const LSR: u64 = 5; // Line Status Register — offset 5
const LSR_READY: u64 = 0x60; // THR empty (bit 5) | transmitter idle (bit 6)

/// Write-only 16550-stub console forwarding THR writes to a [`ConsoleSink`].
pub struct Uart0Stub<S: ConsoleSink> {
    sink: S,
    /// Bitmask of non-THR offsets already debug-logged — bounded (256 bits = 4×u64),
    /// so a guest hammering all 255 unused offsets in a loop cannot grow device state
    /// (adversarial angle 5). No logging backend until E0-T15; the mask is the
    /// once-per-offset dedup that logging will consult.
    logged: [u64; 4],
}

impl<S: ConsoleSink> Uart0Stub<S> {
    pub fn new(sink: S) -> Self {
        Self {
            sink,
            logged: [0; 4],
        }
    }

    /// Borrow the sink (e.g. to read a `VecSink`'s capture without unwrapping the box).
    pub fn sink(&self) -> &S {
        &self.sink
    }

    /// Mark `offset` as logged; returns true the FIRST time (once-per-offset dedup).
    fn note_offset(&mut self, offset: u64) -> bool {
        let i = (offset & 0xFF) as usize;
        let (w, bit) = (i / 64, 1u64 << (i % 64));
        let first = self.logged[w] & bit == 0;
        self.logged[w] |= bit;
        first
    }
}

impl<S: ConsoleSink> MmioDevice for Uart0Stub<S> {
    fn read(&mut self, offset: u64, _width: Width) -> Result<u64, BusFault> {
        // Only LSR reads back non-zero; everything else is 0. Reads never fault.
        Ok(if offset == LSR { LSR_READY } else { 0 })
    }

    fn write(&mut self, offset: u64, _width: Width, value: u64) -> Result<(), BusFault> {
        // THR: emit the low byte regardless of access width (a `sd` of an 8-byte word
        // emits ONE byte). Other offsets: ignored, noted once. Writes never fault.
        if offset == THR {
            self.sink.put_byte(value as u8);
        } else {
            let _first = self.note_offset(offset); // E0-T15 will log on `_first`
        }
        Ok(())
    }
}

/// Test-double sink capturing every byte, shared with the test via `Rc<RefCell<_>>`
/// (the device is boxed into the bus, so the capture must be reachable separately).
/// Lives in the crate (not behind `cfg(test)`) so wasm mirror tests and adversarial
/// verifiers share it.
#[derive(Clone, Default)]
pub struct VecSink {
    bytes: alloc::rc::Rc<core::cell::RefCell<alloc::vec::Vec<u8>>>,
}

impl VecSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// A snapshot of everything captured so far.
    pub fn captured(&self) -> alloc::vec::Vec<u8> {
        self.bytes.borrow().clone()
    }

    /// Number of bytes captured (without cloning the buffer).
    pub fn len(&self) -> usize {
        self.bytes.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.borrow().is_empty()
    }
}

impl ConsoleSink for VecSink {
    fn put_byte(&mut self, b: u8) {
        self.bytes.borrow_mut().push(b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::Bus;
    use crate::bus::mmap::{UART0_BASE, UART0_LEN};
    use crate::mmio::SystemBus;
    use crate::ram::Ram;
    use alloc::boxed::Box;

    fn bus_with_console() -> (SystemBus, VecSink) {
        let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
        let sink = VecSink::new();
        bus.attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(sink.clone())),
        )
        .unwrap();
        (bus, sink)
    }

    #[test]
    fn low_byte_emitted_at_every_write_width() {
        let (mut bus, sink) = bus_with_console();
        bus.store8(UART0_BASE, 0x41).unwrap();
        bus.store16(UART0_BASE, 0x4242).unwrap();
        bus.store32(UART0_BASE, 0x4343_4343).unwrap();
        bus.store64(UART0_BASE, 0x4141_4141_4141_4144).unwrap();
        // Each store emits exactly ONE byte (the low byte).
        assert_eq!(sink.captured(), [0x41, 0x42, 0x43, 0x44]);
    }

    #[test]
    fn lsr_reads_ready_thr_reads_zero_no_faults() {
        let (mut bus, _sink) = bus_with_console();
        // LSR is a byte register (offset 5); a naive polling loop reads it with lbu.
        assert_eq!(bus.load8(UART0_BASE + 5), Ok(0x60));
        assert_eq!(bus.load8(UART0_BASE), Ok(0));
        // An aligned word read at offset 4 sees offset 4 (not 5) → 0; reads never fault.
        assert_eq!(bus.load32(UART0_BASE + 4), Ok(0));
        // A word read at offset 5 is architecturally MISALIGNED (E0-T03 policy) —
        // faults before reaching the device, as it should.
        assert_eq!(bus.load32(UART0_BASE + 5), Err(BusFault::Misaligned));
    }

    #[test]
    fn other_offset_writes_ignored_and_logged_once() {
        let mut stub = Uart0Stub::new(VecSink::new());
        assert!(stub.note_offset(3), "first write to offset 3 logs");
        assert!(!stub.note_offset(3), "second write to offset 3 does not");
        assert!(stub.note_offset(255), "different offset logs");
        assert!(stub.sink().is_empty(), "non-THR writes emit nothing");
    }
}
