//! PLIC — the RISC-V Platform-Level Interrupt Controller (E1-T13), at `0x0C00_0000`.
//!
//! The front door every Level-2 device (UART, virtio) rings: it routes up to 32 external
//! interrupt sources through per-source priorities, per-context enable bits and priority
//! thresholds, and the claim/complete handshake, driving `mip.MEIP` (hart-0 M context) and
//! `mip.SEIP` (hart-0 S context). Layout + semantics follow riscv-plic-1.0.0 with the
//! QEMU-virt memory map Linux's device tree expects.
//!
//! ## Register map (contexts: hart0/M = 0, hart0/S = 1)
//! - **priority** `+0x0`: source `i` priority at `+4*i` (source 0 does not exist; priority 0
//!   disables a source). 32-bit R/W.
//! - **pending** `+0x1000`: read-only bitmap of gateway-pending sources (bit `i` = source `i`).
//! - **enable** `+0x2000 + 0x80*context`: per-context enable bitmap (one 32-bit word / 32 sources).
//! - **threshold** `+0x200000 + 0x1000*context`: a context ignores sources with priority ≤ threshold.
//! - **claim/complete** `+0x200000 + 0x1000*context + 4`: reading CLAIMS the highest-priority
//!   pending+enabled source above threshold (ties → lowest id) and clears its pending; writing
//!   COMPLETEs that id and re-opens its gateway.
//!
//! ## Gateway (level-triggered)
//! A source's pending bit is `level & !claimed` — asserted while the device holds the line high
//! and the source is not currently being serviced. CLAIM sets the per-context `claimed` bit
//! (dropping pending); COMPLETE clears it, so a still-high level re-pends (and a completed-from-
//! the-wrong-context or never-claimed id is ignored — the other context's gateway is untouched).

use alloc::rc::Rc;
use core::cell::RefCell;

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

/// Number of interrupt sources (source 0 is the reserved "no interrupt" id).
pub const NUM_SOURCES: usize = 32;
/// Interrupt contexts: hart-0 M-mode (0) and hart-0 S-mode (1).
pub const NUM_CONTEXTS: usize = 2;
/// The standard QEMU-virt PLIC window length (covers the used register banks with margin).
/// Re-exported from the authoritative [`crate::platform::virt`] map (E2-T01).
pub use crate::platform::virt::PLIC_LEN;

const PENDING_BASE: u64 = 0x1000;
const ENABLE_BASE: u64 = 0x2000;
const ENABLE_STRIDE: u64 = 0x80;
const CONTEXT_BASE: u64 = 0x0020_0000;
const CONTEXT_STRIDE: u64 = 0x1000;

/// PLIC register state shared with the [`crate::Machine`], which samples the per-context EIP
/// levels into `mip` each instruction boundary. Hart-0 M and S contexts only.
#[derive(Debug, Clone)]
pub struct PlicState {
    /// Per-source priority (index by source id; `[0]` unused). Priority 0 disables.
    priority: [u32; NUM_SOURCES],
    /// Per-context enable bitmap (bit `i` enables source `i` for that context).
    enable: [u32; NUM_CONTEXTS],
    /// Per-context priority threshold: sources with priority ≤ threshold are masked.
    threshold: [u32; NUM_CONTEXTS],
    /// Raw device input LEVELS (bit `i` = source `i` held high). Devices drive this.
    level: u32,
    /// Per-context "currently claimed, awaiting complete" bitmap — the closed gateways.
    claimed: [u32; NUM_CONTEXTS],
}

impl Default for PlicState {
    fn default() -> Self {
        Self {
            priority: [0; NUM_SOURCES],
            enable: [0; NUM_CONTEXTS],
            threshold: [0; NUM_CONTEXTS],
            level: 0,
            claimed: [0; NUM_CONTEXTS],
        }
    }
}

impl PlicState {
    /// The gateway-pending bitmap: a source is pending while its level is high and it is not
    /// currently claimed by any context (level-triggered gateway).
    pub fn pending(&self) -> u32 {
        self.level & !(self.claimed[0] | self.claimed[1])
    }

    /// Drive source `id` (1..=31) high or low — the [`IrqLine`] a device holds.
    pub fn set_level(&mut self, id: usize, high: bool) {
        if (1..NUM_SOURCES).contains(&id) {
            let bit = 1u32 << id;
            if high {
                self.level |= bit;
            } else {
                self.level &= !bit;
            }
        }
    }

    /// Is the external-interrupt line asserted for `context`? True while some pending+enabled
    /// source has priority strictly above the context threshold.
    pub fn eip(&self, context: usize) -> bool {
        self.best_source(context) != 0
    }

    /// The id the given context would claim: the highest-priority pending+enabled source above
    /// threshold, ties broken by lowest id; 0 if none.
    fn best_source(&self, context: usize) -> usize {
        let candidates = self.pending() & self.enable[context];
        let thresh = self.threshold[context];
        let mut best_id = 0usize;
        let mut best_prio = 0u32;
        for id in 1..NUM_SOURCES {
            if candidates & (1u32 << id) == 0 {
                continue;
            }
            let prio = self.priority[id];
            if prio <= thresh {
                continue; // masked by the threshold
            }
            // Strictly-greater keeps the FIRST (lowest-id) source on a priority tie.
            if prio > best_prio {
                best_prio = prio;
                best_id = id;
            }
        }
        best_id
    }

    /// CLAIM for `context`: return the winning source id (0 if none) and close its gateway.
    fn claim(&mut self, context: usize) -> u32 {
        let id = self.best_source(context);
        if id != 0 {
            self.claimed[context] |= 1u32 << id;
        }
        id as u32
    }

    /// COMPLETE `id` for `context`: reopen the gateway ONLY if this context is the one that
    /// claimed it (a stale / wrong-context / never-claimed / out-of-range id is ignored).
    fn complete(&mut self, context: usize, id: u32) {
        if id == 0 || (id as usize) >= NUM_SOURCES {
            return; // out-of-range complete is a no-op (never masks a real source)
        }
        let bit = 1u32 << id;
        if self.claimed[context] & bit != 0 {
            self.claimed[context] &= !bit;
        }
    }
}

/// A handle a device holds to assert/deassert one PLIC source line.
#[derive(Clone)]
pub struct IrqLine {
    state: Rc<RefCell<PlicState>>,
    id: usize,
}

impl IrqLine {
    /// Raise or lower this source's level. A high level pends the source (if not being serviced).
    pub fn set(&self, high: bool) {
        self.state.borrow_mut().set_level(self.id, high);
    }
}

/// The memory-mapped PLIC device. Shares [`PlicState`] with the machine (which samples the EIP
/// levels into `mip`) via `Rc<RefCell<_>>`, the same pattern as the CLINT.
pub struct Plic {
    state: Rc<RefCell<PlicState>>,
}

impl Plic {
    /// Create the device plus the shared-state handle the machine keeps.
    pub fn new() -> (Self, Rc<RefCell<PlicState>>) {
        let state = Rc::new(RefCell::new(PlicState::default()));
        (
            Self {
                state: Rc::clone(&state),
            },
            state,
        )
    }

    /// An [`IrqLine`] for source `id` (1..=31) that a device can use to drive its interrupt.
    pub fn irq_line(state: &Rc<RefCell<PlicState>>, id: usize) -> IrqLine {
        IrqLine {
            state: Rc::clone(state),
            id,
        }
    }
}

impl MmioDevice for Plic {
    fn read(&mut self, offset: u64, _width: Width) -> Result<u64, BusFault> {
        let mut s = self.state.borrow_mut();
        // priority[i] at PRIORITY_BASE + 4*i.
        if offset < 0x1000 {
            let i = (offset / 4) as usize;
            return Ok(if i < NUM_SOURCES {
                u64::from(s.priority[i])
            } else {
                0
            });
        }
        // pending bitmap at PENDING_BASE (one word for 32 sources).
        if (PENDING_BASE..PENDING_BASE + 0x80).contains(&offset) {
            return Ok(if offset == PENDING_BASE {
                u64::from(s.pending())
            } else {
                0
            });
        }
        // enable bitmap at ENABLE_BASE + 0x80*context.
        if (ENABLE_BASE..ENABLE_BASE + ENABLE_STRIDE * NUM_CONTEXTS as u64).contains(&offset) {
            let ctx = ((offset - ENABLE_BASE) / ENABLE_STRIDE) as usize;
            let word = (offset - ENABLE_BASE) % ENABLE_STRIDE;
            return Ok(if ctx < NUM_CONTEXTS && word == 0 {
                u64::from(s.enable[ctx])
            } else {
                0
            });
        }
        // threshold (+0) and claim (+4) per context at CONTEXT_BASE + 0x1000*context.
        if offset >= CONTEXT_BASE {
            let ctx = ((offset - CONTEXT_BASE) / CONTEXT_STRIDE) as usize;
            let reg = (offset - CONTEXT_BASE) % CONTEXT_STRIDE;
            if ctx < NUM_CONTEXTS {
                return Ok(match reg {
                    0 => u64::from(s.threshold[ctx]),
                    4 => u64::from(s.claim(ctx)), // reading claims
                    _ => 0,
                });
            }
        }
        Ok(0)
    }

    fn write(&mut self, offset: u64, _width: Width, value: u64) -> Result<(), BusFault> {
        let mut s = self.state.borrow_mut();
        let v = value as u32;
        if offset < 0x1000 {
            let i = (offset / 4) as usize;
            if (1..NUM_SOURCES).contains(&i) {
                s.priority[i] = v; // source 0 priority is read-only 0
            }
            return Ok(());
        }
        // pending is read-only (gateway-driven).
        if (PENDING_BASE..PENDING_BASE + 0x80).contains(&offset) {
            return Ok(());
        }
        if (ENABLE_BASE..ENABLE_BASE + ENABLE_STRIDE * NUM_CONTEXTS as u64).contains(&offset) {
            let ctx = ((offset - ENABLE_BASE) / ENABLE_STRIDE) as usize;
            let word = (offset - ENABLE_BASE) % ENABLE_STRIDE;
            if ctx < NUM_CONTEXTS && word == 0 {
                s.enable[ctx] = v & !1; // source 0 is never enable-able
            }
            return Ok(());
        }
        if offset >= CONTEXT_BASE {
            let ctx = ((offset - CONTEXT_BASE) / CONTEXT_STRIDE) as usize;
            let reg = (offset - CONTEXT_BASE) % CONTEXT_STRIDE;
            if ctx < NUM_CONTEXTS {
                match reg {
                    0 => s.threshold[ctx] = v,
                    4 => s.complete(ctx, v), // writing completes
                    _ => {}
                }
            }
        }
        Ok(())
    }
}
