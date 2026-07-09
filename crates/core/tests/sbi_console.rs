//! E2-T04 bare-metal S-mode console guest: prints via DBCN (buffer write + write_byte) and
//! the legacy path, and ECHOES input read via legacy getchar — the full ecall round trip
//! through the run-loop interception, not direct dispatcher calls.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::console::VecSink;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
/// Where the host pre-stores the DBCN buffer the guest prints.
const MSG_ADDR: u64 = virt::DRAM_BASE + 0x1000;
const MSG: &[u8] = b"dbcn:";

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
/// Materialize a 32-bit constant via lui+addi (handles the addi sign quirk).
fn li32(rd: u8, val: u32) -> [u32; 2] {
    let lo = (val & 0xFFF) as i32;
    let lo_signed = if lo >= 0x800 { lo - 0x1000 } else { lo };
    let hi = (val.wrapping_sub(lo_signed as u32)) >> 12;
    [lui(rd, hi), addi(rd, rd, lo_signed)]
}

const ECALL: u32 = 0x0000_0073;
const A0: u8 = 10;
const A1: u8 = 11;
const A2: u8 = 12;
const A6: u8 = 16;
const A7: u8 = 17;

#[test]
fn s_mode_guest_prints_dbcn_legacy_and_echoes_input() {
    let mut m = Machine::new(RAM);
    m.enable_builtin_sbi();
    let sink = VecSink::new();
    let out = sink.clone();
    m.sbi_set_console(Box::new(sink));
    m.sbi_push_input(b"C"); // the byte the guest will echo
    m.boot_supervisor(0, 0);

    for (i, b) in MSG.iter().enumerate() {
        m.bus_mut().store8(MSG_ADDR + i as u64, *b).unwrap();
    }

    // The S-mode program, executed via real ecalls through the run loop:
    //   DBCN console_write(len=5, MSG_ADDR)   -> "dbcn:"
    //   DBCN console_write_byte('A')          -> 'A'
    //   legacy putchar('B')                   -> 'B'
    //   legacy getchar()                      -> a0 = 'C' (host-queued)
    //   DBCN console_write_byte(a0)           -> echoes 'C'
    //   j .
    let mut code: Vec<u32> = Vec::new();
    // a7 = DBCN EID 0x4442434E
    code.extend(li32(A7, 0x4442_434E));
    code.push(addi(A6, 0, 0)); // fid 0 = console_write
    code.push(addi(A0, 0, MSG.len() as i32)); // num_bytes
    code.extend(li32(A1, MSG_ADDR as u32)); // base_lo (fits in 32 bits)
    // lui sign-extends on RV64 (bit 31 of MSG_ADDR is set) — zero-extend: slli/srli by 32.
    code.push(i_type(32, A1, 0b001, A1, 0b0010011)); // slli a1, a1, 32
    code.push(i_type(32, A1, 0b101, A1, 0b0010011)); // srli a1, a1, 32
    code.push(addi(A2, 0, 0)); // base_hi = 0
    code.push(ECALL);
    // DBCN write_byte('A'): fid 2, a0 = 'A'
    code.push(addi(A6, 0, 2));
    code.push(addi(A0, 0, 'A' as i32));
    code.push(ECALL);
    // legacy putchar('B'): eid 1 (a6 ignored)
    code.push(addi(A7, 0, 1));
    code.push(addi(A0, 0, 'B' as i32));
    code.push(ECALL);
    // legacy getchar -> a0
    code.push(addi(A7, 0, 2));
    code.push(ECALL);
    // save the byte to a3 THEN echo: DBCN write_byte(a3->a0)
    code.push(addi(13, A0, 0)); // a3 = a0 (the read byte)
    code.extend(li32(A7, 0x4442_434E));
    code.push(addi(A6, 0, 2));
    code.push(addi(A0, 13, 0)); // a0 = a3
    code.push(ECALL);
    code.push(0x0000_006F); // j .

    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }

    let outcome = m.run(4096);
    assert_eq!(
        outcome,
        RunOutcome::MaxInstrs,
        "parked cleanly after the ecalls"
    );
    assert_eq!(
        String::from_utf8_lossy(&out.captured()),
        "dbcn:ABC",
        "DBCN buffer write + write_byte + legacy putchar + echoed getchar byte, in order"
    );
    // Legacy getchar returned the byte in a0 and did NOT touch a1: a3 holds 'C'.
    assert_eq!(m.hart().regs.read(13), 'C' as u64);
}

/// Legacy calls must clobber ONLY a0: preload a1 with a sentinel, run legacy putchar via a
/// real ecall, and check a1 survived (DBCN, by contrast, overwrites a1 with `value`).
#[test]
fn legacy_preserves_a1_dbcn_overwrites_it() {
    let mut m = Machine::new(RAM);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);

    // a1 = 0x777 sentinel; legacy putchar('x'); j .
    let code: Vec<u32> = vec![
        addi(A1, 0, 0x777),
        addi(A7, 0, 1),
        addi(A0, 0, 'x' as i32),
        ECALL,
        0x0000_006F,
    ];
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    m.run(64);
    assert_eq!(m.hart().regs.read(A1), 0x777, "legacy left a1 alone");
    assert_eq!(m.hart().regs.read(A0), 0, "putchar returned 0 in a0");
}
