//! A `smoltcp::phy::Device` over two frame queues — the glue between the guest's ethernet world
//! (the E3-T13 `NetBackend` seam: plain `Vec<u8>` ethernet frames) and smoltcp. Guest→us frames are
//! pushed into `rx`; smoltcp's replies land in `tx` for us to hand back to the guest.

use std::collections::VecDeque;

use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::time::Instant;

/// Standard ethernet MTU for the guest link.
pub const MTU: usize = 1500;

/// A queue-backed ethernet device. `rx` = frames from the guest (we consume), `tx` = frames for the
/// guest (smoltcp produces).
pub struct SlirpDevice {
    pub(crate) rx: VecDeque<Vec<u8>>,
    pub(crate) tx: VecDeque<Vec<u8>>,
}

impl Default for SlirpDevice {
    fn default() -> Self {
        Self::new()
    }
}

impl SlirpDevice {
    pub fn new() -> Self {
        SlirpDevice {
            rx: VecDeque::new(),
            tx: VecDeque::new(),
        }
    }
}

/// Owns the received frame (so it doesn't borrow the device — lets `receive` also hand out a TX
/// token that borrows the tx queue).
pub struct SlirpRxToken(Vec<u8>);
/// Borrows the tx queue; on `consume` it appends the frame smoltcp built.
pub struct SlirpTxToken<'a>(&'a mut VecDeque<Vec<u8>>);

impl RxToken for SlirpRxToken {
    fn consume<R, F: FnOnce(&[u8]) -> R>(self, f: F) -> R {
        f(&self.0)
    }
}

impl TxToken for SlirpTxToken<'_> {
    fn consume<R, F: FnOnce(&mut [u8]) -> R>(self, len: usize, f: F) -> R {
        let mut buf = vec![0u8; len];
        let r = f(&mut buf);
        self.0.push_back(buf);
        r
    }
}

impl Device for SlirpDevice {
    type RxToken<'a> = SlirpRxToken;
    type TxToken<'a> = SlirpTxToken<'a>;

    fn receive(&mut self, _t: Instant) -> Option<(Self::RxToken<'_>, Self::TxToken<'_>)> {
        let frame = self.rx.pop_front()?;
        Some((SlirpRxToken(frame), SlirpTxToken(&mut self.tx)))
    }

    fn transmit(&mut self, _t: Instant) -> Option<Self::TxToken<'_>> {
        Some(SlirpTxToken(&mut self.tx))
    }

    fn capabilities(&self) -> DeviceCapabilities {
        let mut c = DeviceCapabilities::default();
        c.medium = Medium::Ethernet;
        c.max_transmission_unit = MTU;
        c
    }
}
