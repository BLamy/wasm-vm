//! E1-T09: the privilege/mstatus state machine must behave identically on wasm32.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::csr::{CsrOp, Csrs, MSTATUS, Priv, SSTATUS};

fn wr(c: &mut Csrs, addr: u16, v: u64) {
    let save = c.mode;
    c.mode = Priv::M;
    c.access(addr, CsrOp::Write, v, false, false, 0).unwrap();
    c.mode = save;
}
fn rd(c: &mut Csrs, addr: u16) -> u64 {
    let save = c.mode;
    c.mode = Priv::M;
    let v = c.access(addr, CsrOp::Set, 0, true, false, 0).unwrap();
    c.mode = save;
    v
}

#[wasm_bindgen_test]
fn mstatus_state_machine_on_wasm32() {
    let mut c = Csrs::at_reset();
    // Trap-entry then MRET round-trip (MPP=U path).
    wr(&mut c, MSTATUS, 1 << 3); // MIE=1
    c.trap_to_m(Priv::U);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & (1 << 3), 0, "MIE cleared");
    assert_eq!(m & (1 << 7), 1 << 7, "MPIE=old MIE");
    c.mret();
    assert_eq!(c.mode, Priv::U);
    assert_eq!(rd(&mut c, MSTATUS) & (1 << 3), 1 << 3, "MIE restored");

    // MPP=0b10 legalizes to U; UXL/SXL hardwired 0b10; SD from FS.
    wr(&mut c, MSTATUS, u64::MAX);
    let m = rd(&mut c, MSTATUS);
    assert_eq!((m >> 32) & 0b11, 0b10);
    assert_eq!((m >> 34) & 0b11, 0b10);
    assert_ne!(m & (1 << 63), 0);
    assert_eq!(m & 1, 0);

    // sstatus write touches only S-bits.
    let mut c = Csrs::at_reset();
    wr(&mut c, SSTATUS, u64::MAX);
    let m = rd(&mut c, MSTATUS);
    assert_eq!(m & (1 << 3), 0, "MIE untouched via sstatus");
    assert_eq!((m >> 11) & 0b11, 0, "MPP untouched");
    assert_eq!(m & (1 << 1), 1 << 1, "SIE set");
}
