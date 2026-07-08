//! ns16550a UART (E2-T07) at `platform::virt::UART0_BASE` — complete enough that Linux's
//! 8250 driver runs it as ttyS0 (console, getty, curses), including the THR-empty interrupt
//! dance half-baked emulated UARTs get wrong.
//!
//! Register file (byte-wide, reg-shift 0): RBR/THR/DLL(0), IER/DLM(1), IIR/FCR(2), LCR(3),
//! MCR(4), LSR(5), MSR(6), SCR(7); DLAB (LCR bit 7) banks the divisor latch over 0/1.
//!
//! **Interrupt-cause state machine** (IIR priority order, §16550 datasheet):
//!   1. `0x06` receiver line status (we raise it only for overrun, cleared by LSR read)
//!   2. `0x04` RX data available (FIFO level ≥ trigger; level condition)
//!   3. `0x0C` character timeout (FIFO non-empty below trigger, no RX/RBR activity for
//!      4 character times — Linux needs this for short lines)
//!   4. `0x02` THR empty — EDGE-ish: latched when THR *becomes* empty with ETBEI set (or
//!      when ETBEI is newly enabled with THR already empty); cleared by reading IIR when
//!      it is the highest-priority pending source (or by writing THR / clearing ETBEI).
//!
//! TX drains instantly (emulated output is infinitely fast) but THRE (LSR.5) and TEMT
//! (LSR.6) are modeled distinctly. The interrupt OUTPUT is a level (`irq_level`) wired to
//! PLIC IRQ 10; the run loop mirrors it every boundary and drives the character-timeout
//! clock via [`Uart16550::tick`] (deterministic — retire-driven, native == wasm).

use alloc::collections::VecDeque;
use alloc::vec::Vec;

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

/// RX FIFO depth (16550).
const FIFO_DEPTH: usize = 16;
/// Character-timeout in [`Uart16550::tick`] calls (one per retired instruction): a
/// deterministic stand-in for "4 character times". At any plausible instructions-per-baud
/// ratio this is short enough that Linux sees single keystrokes promptly.
const CHAR_TIMEOUT_TICKS: u32 = 1024;

// LSR bits.
const LSR_DR: u8 = 0x01;
const LSR_OE: u8 = 0x02;
const LSR_THRE: u8 = 0x20;
const LSR_TEMT: u8 = 0x40;
// IER bits.
const IER_ERBFI: u8 = 0x01; // RX data available
const IER_ETBEI: u8 = 0x02; // THR empty
const IER_ELSI: u8 = 0x04; // receiver line status
// IIR cause codes (bits 3:0; bit0=0 means "interrupt pending").
const IIR_NONE: u8 = 0x01;
const IIR_LINE_STATUS: u8 = 0x06;
const IIR_RX_AVAIL: u8 = 0x04;
const IIR_CHAR_TIMEOUT: u8 = 0x0C;
const IIR_THRE: u8 = 0x02;
/// IIR bits 7:6 when the FIFOs are enabled.
const IIR_FIFO_ENABLED: u8 = 0xC0;
// LCR.
const LCR_DLAB: u8 = 0x80;

/// The ns16550a device state. Output bytes are collected by the owner via
/// [`Uart16550::take_output`] (or a shared sink at the Machine layer); input arrives via
/// [`Uart16550::push_input`].
pub struct Uart16550 {
    // Register backing.
    ier: u8,
    fcr: u8,
    lcr: u8,
    mcr: u8,
    scr: u8,
    dll: u8,
    dlm: u8,
    // RX FIFO + line status.
    rx: VecDeque<u8>,
    overrun: bool,
    /// THRE interrupt latch (edge-ish; see module docs).
    thre_latched: bool,
    /// Ticks since the last RX activity (push or RBR read); drives character timeout.
    idle_ticks: u32,
    /// Character-timeout condition currently latched (cleared by RBR read / new data).
    timeout_latched: bool,
    /// Output bytes since the last drain.
    out: Vec<u8>,
}

impl Default for Uart16550 {
    fn default() -> Self {
        Self::new()
    }
}

/// A byte that must be a 0/1 boolean, or a malformed payload.
fn bool_byte(b: u8) -> Option<bool> {
    match b {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

/// E3-T12: the ns16550a's full state round-trips — 7 registers + the 3 line-status latches +
/// `idle_ticks` + the (length-prefixed) RX FIFO and pending output buffer. The variable-length
/// FIFOs are decoded **fuzz-safely**: a length is bounded against the remaining bytes *before* any
/// allocation, `rx` is capped at the physical FIFO depth, and trailing bytes are rejected — so a
/// truncated/hostile payload is a typed error, never a panic or an over-allocation.
impl crate::resume::ComponentSnapshot for Uart16550 {
    const SECTION: u32 = crate::resume::section::UART;

    fn to_snapshot(&self) -> alloc::vec::Vec<u8> {
        let mut v = alloc::vec::Vec::with_capacity(14 + 8 + self.rx.len() + self.out.len());
        v.extend_from_slice(&[
            self.ier, self.fcr, self.lcr, self.mcr, self.scr, self.dll, self.dlm,
        ]);
        v.push(self.overrun as u8);
        v.push(self.thre_latched as u8);
        v.push(self.timeout_latched as u8);
        v.extend_from_slice(&self.idle_ticks.to_le_bytes());
        // rx FIFO (≤ FIFO_DEPTH, fits u32) then the pending output buffer, each length-prefixed.
        v.extend_from_slice(&(self.rx.len() as u32).to_le_bytes());
        v.extend(self.rx.iter().copied());
        v.extend_from_slice(&(self.out.len() as u32).to_le_bytes());
        v.extend_from_slice(&self.out);
        v
    }

    fn restore(&mut self, p: &[u8]) -> Result<(), crate::resume::SnapshotError> {
        let err = || crate::resume::SnapshotError::BadComponentState { tag: Self::SECTION };
        // Fixed prefix: 7 regs + 3 bool latches + u32 idle_ticks = 14 bytes, then the rx length word.
        if p.len() < 14 + 4 {
            return Err(err());
        }
        let [ier, fcr, lcr, mcr, scr, dll, dlm] = p[0..7].try_into().map_err(|_| err())?;
        let overrun = bool_byte(p[7]).ok_or_else(err)?;
        let thre_latched = bool_byte(p[8]).ok_or_else(err)?;
        let timeout_latched = bool_byte(p[9]).ok_or_else(err)?;
        let idle_ticks = u32::from_le_bytes(p[10..14].try_into().map_err(|_| err())?);

        let mut off = 14usize;
        // rx: length-prefixed, bounded by both the physical FIFO depth and the remaining bytes.
        // `checked_add` for the slice end so an attacker-controlled length can't overflow `usize`
        // (on wasm32 `usize` is 32-bit — a plain `off + len` with a ~4 GiB length would wrap and
        // slip past the `> p.len()` guard into an out-of-bounds slice).
        let rx_len = u32::from_le_bytes(p[off..off + 4].try_into().map_err(|_| err())?) as usize;
        off += 4;
        let rx_end = off.checked_add(rx_len).ok_or_else(err)?;
        if rx_len > FIFO_DEPTH || rx_end > p.len() {
            return Err(err());
        }
        let rx: VecDeque<u8> = p[off..rx_end].iter().copied().collect();
        off = rx_end;
        // out: length-prefixed, bounded by the remaining bytes (same overflow-safe check).
        if off + 4 > p.len() {
            return Err(err());
        }
        let out_len = u32::from_le_bytes(p[off..off + 4].try_into().map_err(|_| err())?) as usize;
        off += 4;
        let out_end = off.checked_add(out_len).ok_or_else(err)?;
        if out_end > p.len() {
            return Err(err());
        }
        let out = p[off..out_end].to_vec();
        off = out_end;
        // Canonical: no trailing bytes.
        if off != p.len() {
            return Err(err());
        }

        // Commit only after the whole payload parsed (all-or-nothing).
        *self = Uart16550 {
            ier,
            fcr,
            lcr,
            mcr,
            scr,
            dll,
            dlm,
            rx,
            overrun,
            thre_latched,
            idle_ticks,
            timeout_latched,
            out,
        };
        Ok(())
    }
}

impl Uart16550 {
    pub fn new() -> Self {
        Self {
            ier: 0,
            fcr: 0,
            lcr: 0,
            mcr: 0,
            scr: 0,
            dll: 0,
            dlm: 0,
            rx: VecDeque::new(),
            overrun: false,
            thre_latched: false,
            idle_ticks: 0,
            timeout_latched: false,
            out: Vec::new(),
        }
    }

    /// Host input: append to the RX FIFO. Bytes beyond 16 are DROPPED with LSR.OE set
    /// (16550 overrun semantics — the FIFO contents stay intact, new data is lost).
    pub fn push_input(&mut self, bytes: &[u8]) {
        for &b in bytes {
            if self.rx.len() >= FIFO_DEPTH {
                self.overrun = true;
            } else {
                self.rx.push_back(b);
            }
        }
        self.idle_ticks = 0;
        self.timeout_latched = false;
    }

    /// Free slots in the 16-byte RX FIFO — how many bytes [`Self::push_input`] can accept
    /// right now without dropping (setting LSR.OE). Hosts feeding scripted input use this to
    /// rate-limit to the guest's drain speed instead of flooding the FIFO.
    pub fn rx_free(&self) -> usize {
        FIFO_DEPTH.saturating_sub(self.rx.len())
    }

    /// Drain everything the guest transmitted since the last call.
    pub fn take_output(&mut self) -> Vec<u8> {
        core::mem::take(&mut self.out)
    }

    /// Advance the character-timeout clock one step (the run loop calls this per retired
    /// instruction). Latches the timeout condition when the FIFO is non-empty below the
    /// trigger level and idle long enough.
    pub fn tick(&mut self) {
        if !self.rx.is_empty() && !self.timeout_latched {
            self.idle_ticks = self.idle_ticks.saturating_add(1);
            if self.idle_ticks >= CHAR_TIMEOUT_TICKS {
                self.timeout_latched = true;
            }
        }
    }

    /// FCR trigger level in bytes (FCR bits 7:6) — 1/4/8/14.
    fn trigger_level(&self) -> usize {
        match self.fcr >> 6 {
            0 => 1,
            1 => 4,
            2 => 8,
            _ => 14,
        }
    }

    fn fifos_enabled(&self) -> bool {
        self.fcr & 0x01 != 0
    }

    fn lsr(&self) -> u8 {
        let mut v = LSR_THRE | LSR_TEMT; // TX drains instantly: both always set
        if !self.rx.is_empty() {
            v |= LSR_DR;
        }
        if self.overrun {
            v |= LSR_OE;
        }
        v
    }

    /// The highest-priority pending interrupt cause, per the 16550 priority table.
    fn pending_cause(&self) -> u8 {
        if self.ier & IER_ELSI != 0 && self.overrun {
            return IIR_LINE_STATUS;
        }
        if self.ier & IER_ERBFI != 0 {
            let avail = if self.fifos_enabled() {
                self.rx.len() >= self.trigger_level()
            } else {
                !self.rx.is_empty()
            };
            if avail {
                return IIR_RX_AVAIL;
            }
            if self.fifos_enabled() && self.timeout_latched && !self.rx.is_empty() {
                return IIR_CHAR_TIMEOUT;
            }
        }
        if self.ier & IER_ETBEI != 0 && self.thre_latched {
            return IIR_THRE;
        }
        IIR_NONE
    }

    /// The level on the interrupt line to the PLIC (IRQ 10): high iff any cause pends.
    pub fn irq_level(&self) -> bool {
        self.pending_cause() != IIR_NONE
    }

    fn read_reg(&mut self, offset: u64) -> u8 {
        match offset {
            0 => {
                if self.lcr & LCR_DLAB != 0 {
                    self.dll
                } else {
                    // RBR: pop the FIFO; RX activity resets the timeout clock.
                    self.idle_ticks = 0;
                    self.timeout_latched = false;
                    self.rx.pop_front().unwrap_or(0)
                }
            }
            1 => {
                if self.lcr & LCR_DLAB != 0 {
                    self.dlm
                } else {
                    self.ier
                }
            }
            2 => {
                let cause = self.pending_cause();
                // Reading IIR when THRE is the highest-priority source CLEARS the latch.
                if cause == IIR_THRE {
                    self.thre_latched = false;
                }
                let fifo_bits = if self.fifos_enabled() {
                    IIR_FIFO_ENABLED
                } else {
                    0
                };
                cause | fifo_bits
            }
            3 => self.lcr,
            4 => self.mcr,
            5 => {
                // Reading LSR clears the error bits (OE).
                let v = self.lsr();
                self.overrun = false;
                v
            }
            6 => 0, // MSR: no modem lines
            7 => self.scr,
            _ => 0,
        }
    }

    fn write_reg(&mut self, offset: u64, v: u8) {
        match offset {
            0 => {
                if self.lcr & LCR_DLAB != 0 {
                    self.dll = v;
                } else {
                    // THR: transmit. Drains instantly — THR immediately empty again, which
                    // RE-LATCHES the THRE interrupt if ETBEI is set (each written byte
                    // produces one THRE edge, exactly what the 8250 driver paces on).
                    self.out.push(v);
                    if self.ier & IER_ETBEI != 0 {
                        self.thre_latched = true;
                    }
                }
            }
            1 => {
                if self.lcr & LCR_DLAB != 0 {
                    self.dlm = v;
                } else {
                    let newly_enabled = v & IER_ETBEI != 0 && self.ier & IER_ETBEI == 0;
                    self.ier = v & 0x0F;
                    // Enabling ETBEI with THR already empty latches THRE immediately
                    // (16550 behavior the 8250 driver depends on to kick TX).
                    if newly_enabled {
                        self.thre_latched = true;
                    }
                    if v & IER_ETBEI == 0 {
                        self.thre_latched = false;
                    }
                }
            }
            2 => {
                // FCR: bit0 enable; bit1 clears RX FIFO; bit2 clears TX (instant anyway).
                self.fcr = v;
                if v & 0x02 != 0 {
                    self.rx.clear();
                    self.timeout_latched = false;
                    self.idle_ticks = 0;
                }
            }
            3 => self.lcr = v,
            4 => self.mcr = v,
            5 | 6 => {} // LSR/MSR read-only
            7 => self.scr = v,
            _ => {}
        }
    }
}

/// Bus adapter: the Machine shares the UART with the run loop (tick + irq level) via
/// `Rc<RefCell<_>>`, the same pattern as CLINT/PLIC shared state.
pub struct SharedUart(pub alloc::rc::Rc<core::cell::RefCell<Uart16550>>);

impl MmioDevice for SharedUart {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.0.borrow_mut().read(offset, width)
    }
    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.0.borrow_mut().write(offset, width, value)
    }
}

impl MmioDevice for Uart16550 {
    fn read(&mut self, offset: u64, _width: Width) -> Result<u64, BusFault> {
        Ok(u64::from(self.read_reg(offset & 0x7)))
    }
    fn write(&mut self, offset: u64, _width: Width, value: u64) -> Result<(), BusFault> {
        self.write_reg(offset & 0x7, value as u8);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fifo_on(u: &mut Uart16550, trigger_bits: u8) {
        u.write_reg(2, 0x01 | (trigger_bits << 6)); // FCR enable + trigger
    }

    /// DLAB banks DLL/DLM over offsets 0/1; clearing DLAB restores RBR/IER.
    #[test]
    fn dlab_banking() {
        let mut u = Uart16550::new();
        u.write_reg(3, LCR_DLAB);
        u.write_reg(0, 0x23); // DLL
        u.write_reg(1, 0x01); // DLM
        assert_eq!(u.read_reg(0), 0x23);
        assert_eq!(u.read_reg(1), 0x01);
        u.write_reg(3, 0x03); // 8n1, DLAB off
        u.write_reg(1, IER_ERBFI); // now IER
        assert_eq!(u.read_reg(1), IER_ERBFI);
        assert_eq!(u.dll, 0x23, "divisor survived");
    }

    /// THRE latch rules: newly-enabled ETBEI with empty THR latches; IIR read clears when
    /// THRE is highest; each THR write re-latches (one edge per byte).
    #[test]
    fn thre_interrupt_dance() {
        let mut u = Uart16550::new();
        assert!(!u.irq_level());
        u.write_reg(1, IER_ETBEI); // enable with THR empty → latch
        assert!(u.irq_level());
        assert_eq!(u.read_reg(2) & 0x0F, IIR_THRE);
        assert!(!u.irq_level(), "IIR read cleared THRE");
        assert_eq!(u.read_reg(2) & 0x0F, IIR_NONE);
        u.write_reg(0, b'x'); // THR write → drains instantly → re-latch
        assert!(u.irq_level());
        assert_eq!(u.take_output(), b"x");
        // Clearing ETBEI drops the latch.
        u.write_reg(1, 0);
        assert!(!u.irq_level());
    }

    /// IIR priority: RX-available beats THRE; line status (overrun) beats both.
    #[test]
    fn iir_priority_order() {
        let mut u = Uart16550::new();
        fifo_on(&mut u, 0); // trigger 1
        u.write_reg(1, IER_ERBFI | IER_ETBEI | IER_ELSI);
        assert_eq!(u.read_reg(2) & 0x0F, IIR_THRE, "only THRE so far");
        // But the read cleared it; push input → RX beats a re-latched THRE.
        u.write_reg(0, b'a'); // re-latch THRE
        u.push_input(b"z");
        assert_eq!(u.read_reg(2) & 0x0F, IIR_RX_AVAIL);
        // Overrun: flood 17 bytes → OE; line status is highest.
        u.push_input(&[0u8; 17]);
        assert_eq!(u.read_reg(2) & 0x0F, IIR_LINE_STATUS);
        // LSR read clears OE; RX-available takes over.
        let lsr = u.read_reg(5);
        assert_ne!(lsr & LSR_OE, 0);
        assert_eq!(u.read_reg(2) & 0x0F, IIR_RX_AVAIL);
        assert_ne!(u.read_reg(2) & IIR_FIFO_ENABLED, 0, "FIFO bits set");
    }

    /// Character timeout: input below the trigger level still interrupts after idle time.
    #[test]
    fn char_timeout_delivers_short_input() {
        let mut u = Uart16550::new();
        fifo_on(&mut u, 2); // trigger 8
        u.write_reg(1, IER_ERBFI);
        u.push_input(b"ab"); // 2 < 8: no RX-available
        assert_eq!(u.read_reg(2) & 0x0F, IIR_NONE);
        for _ in 0..CHAR_TIMEOUT_TICKS {
            u.tick();
        }
        assert_eq!(u.read_reg(2) & 0x0F, IIR_CHAR_TIMEOUT, "timeout fired");
        assert!(u.irq_level());
        // RBR read resets the timeout clock and (FIFO now 1 byte) it stays quiet until
        // idle again.
        assert_eq!(u.read_reg(0), b'a');
        assert_eq!(u.read_reg(2) & 0x0F, IIR_NONE);
        for _ in 0..CHAR_TIMEOUT_TICKS {
            u.tick();
        }
        assert_eq!(u.read_reg(2) & 0x0F, IIR_CHAR_TIMEOUT);
        assert_eq!(u.read_reg(0), b'b');
        assert!(!u.irq_level(), "FIFO empty → line low");
    }

    /// Overrun: 16-byte cap, new bytes dropped, FIFO contents intact, OE cleared by LSR read.
    #[test]
    fn overrun_caps_fifo_and_preserves_contents() {
        let mut u = Uart16550::new();
        fifo_on(&mut u, 0);
        let flood: Vec<u8> = (0u8..100).collect();
        u.push_input(&flood);
        assert_eq!(u.rx.len(), FIFO_DEPTH);
        assert_ne!(u.read_reg(5) & LSR_OE, 0, "OE set");
        assert_eq!(u.read_reg(5) & LSR_OE, 0, "OE cleared by the LSR read");
        // First 16 bytes intact, in order.
        for i in 0u8..16 {
            assert_eq!(u.read_reg(0), i, "byte {i} preserved");
        }
        assert_eq!(u.read_reg(5) & LSR_DR, 0, "drained");
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::{FIFO_DEPTH, Uart16550};
    use crate::resume::{ComponentSnapshot, SnapshotError, section};
    use alloc::vec::Vec;

    /// A UART with every field set to a distinct non-default value (incl. non-empty rx + out).
    fn distinctive() -> Uart16550 {
        let mut u = Uart16550::new();
        u.ier = 1;
        u.fcr = 2;
        u.lcr = 3;
        u.mcr = 4;
        u.scr = 5;
        u.dll = 6;
        u.dlm = 7;
        u.overrun = true;
        u.thre_latched = true;
        u.timeout_latched = true;
        u.idle_ticks = 0x1234_5678;
        u.rx = [0xAA, 0xBB, 0xCC].into_iter().collect();
        u.out = alloc::vec![0x11, 0x22, 0x33, 0x44];
        u
    }

    #[test]
    fn uart_state_round_trips_completely() {
        let u = distinctive();
        let bytes = u.to_snapshot();
        assert_eq!(Uart16550::SECTION, section::UART);

        let mut r = Uart16550::new();
        r.restore(&bytes).unwrap();
        // Re-serializing the restored device yields the identical bytes → every field survived.
        assert_eq!(r.to_snapshot(), bytes);
        // And spot-check the variable-length + latch fields explicitly.
        assert_eq!(r.rx, u.rx);
        assert_eq!(r.out, u.out);
        assert_eq!(r.idle_ticks, u.idle_ticks);
        assert!(r.overrun && r.thre_latched && r.timeout_latched);
        assert_eq!(r.ier, 1);
        assert_eq!(r.dlm, 7);

        // Empty rx + out also round-trip.
        let empty = Uart16550::new();
        let mut r2 = distinctive();
        r2.restore(&empty.to_snapshot()).unwrap();
        assert!(r2.rx.is_empty() && r2.out.is_empty());
    }

    #[test]
    fn uart_restore_rejects_malformed_payloads_without_mutating() {
        let bad = SnapshotError::BadComponentState { tag: section::UART };
        let good = distinctive().to_snapshot();

        // Too short (< fixed prefix + rx length word).
        let mut u = distinctive();
        assert_eq!(u.restore(&[0u8; 17]), Err(bad.clone()));

        // A non-boolean latch byte (overrun byte at index 7).
        let mut nonbool = alloc::vec![0u8; 18];
        nonbool[7] = 2;
        assert_eq!(u.restore(&nonbool), Err(bad.clone()));

        // An rx length beyond the physical FIFO depth.
        let mut over = alloc::vec![0u8; 14];
        over.extend_from_slice(&((FIFO_DEPTH as u32) + 1).to_le_bytes());
        assert_eq!(u.restore(&over), Err(bad.clone()));

        // An rx length that overruns the remaining bytes.
        let mut overrun_rx = alloc::vec![0u8; 14];
        overrun_rx.extend_from_slice(&3u32.to_le_bytes()); // claims 3 rx bytes, provides 0
        assert_eq!(u.restore(&overrun_rx), Err(bad.clone()));

        // A huge out_len (~4 GiB) with a short buffer — must be rejected fast, with NO usize
        // overflow (the wasm32 hazard), no OOB slice, no allocation.
        let mut huge_out = alloc::vec![0u8; 14];
        huge_out.extend_from_slice(&0u32.to_le_bytes()); // rx_len = 0
        huge_out.extend_from_slice(&u32::MAX.to_le_bytes()); // out_len = ~4 GiB, no data
        assert_eq!(u.restore(&huge_out), Err(bad.clone()));

        // Trailing bytes after a valid payload.
        let mut trailing = good.clone();
        trailing.push(0xFF);
        assert_eq!(u.restore(&trailing), Err(bad.clone()));

        // A failed restore left the device untouched (all-or-nothing).
        assert_eq!(u.ier, 1);
        assert_eq!(u.rx, distinctive().rx);
        // The valid payload still restores.
        assert_eq!(u.restore(&good), Ok(()));
    }

    #[test]
    fn uart_restore_never_panics_on_random_input() {
        let mut seed = 0xABCD_1234u32;
        let mut rng = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed
        };
        for _ in 0..5000 {
            let len = (rng() as usize) % 80;
            let junk: Vec<u8> = (0..len).map(|_| (rng() & 0xff) as u8).collect();
            let mut u = Uart16550::new();
            let _ = u.restore(&junk); // Ok or typed Err — never a panic
        }
    }
}
