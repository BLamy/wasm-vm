//! E2-T05 SBI TIME: bare-metal S-mode guests exercising `sbi_set_timer` end-to-end — real
//! ecalls, real STIP delivery through stvec, real sret returns.
//!
//! Guest skeleton: park in a `j .` loop with `sie.STIE` + `sstatus.SIE` on; the S-timer
//! interrupt vectors to a handler that bumps a counter register, re-arms or cancels, and
//! `sret`s back to the loop.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{Priv, SIP};
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
const CLOCK_DIV: u64 = 10; // mtime ticks once per 10 retirements — matters for deadlines

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
/// csrrw rd, csr, rs1
fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}
/// csrrs rd, csr, rs1 (rs1=x0 → plain read)
fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}
const ECALL: u32 = 0x0000_0073;
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F; // j .
const A0: u8 = 10;
const A6: u8 = 16;
const A7: u8 = 17;
const T0: u8 = 5;
const T3: u8 = 28; // interrupt counter
const T4: u8 = 29; // scause captured in handler

const CSR_SSTATUS: u32 = 0x100;
const CSR_SIE: u32 = 0x104;
const CSR_STVEC: u32 = 0x105;
const CSR_SCAUSE: u32 = 0x142;
const CSR_TIME: u32 = 0xC01;

/// Common harness: run `pre` instructions (the test scenario), with the standard handler at
/// `HANDLER` (counts into t3, captures scause into t4, cancels the timer, sret). Returns the
/// machine after `budget` instructions.
fn run_guest(pre: &[u32], budget: u64) -> Machine {
    const HANDLER_OFF: u64 = 0x800; // handler at KERNEL_BASE + 0x800
    let mut m = Machine::new(RAM);
    m.enable_clint(CLOCK_DIV);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);

    // Handler: t3 += 1; t4 = scause; set_timer(u64::MAX) to squelch; sret.
    // a7 = TIME (0x54494D45): lo12 = 0xD45 ≥ 0x800 → addi -0x2BB with hi20 = 0x54495.
    let lui = |rd: u8, imm20: u32| (imm20 << 12) | ((rd as u32) << 7) | 0b0110111;
    let handler: Vec<u32> = vec![
        addi(T3, T3, 1),          // count the delivery
        csrrs(T4, CSR_SCAUSE, 0), // capture scause (expect 5 | 1<<63)
        lui(A7, 0x54495),         // a7 = TIME (hi)
        addi(A7, A7, -0x2BB),     // a7 = 0x54494D45
        addi(A6, 0, 0),           // fid 0
        addi(A0, 0, -1),          // a0 = u64::MAX (cancel)
        ECALL,
        SRET,
    ];

    for (i, insn) in pre.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    for (i, insn) in handler.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + HANDLER_OFF + 4 * i as u64, *insn)
            .unwrap();
    }
    let outcome = m.run(budget);
    assert_eq!(
        outcome,
        RunOutcome::MaxInstrs,
        "guest parks; nothing escapes"
    );
    m
}

/// Prologue shared by scenarios: stvec=handler, sie.STIE=1, sstatus.SIE=1, then a7=TIME.
fn prologue() -> Vec<u32> {
    let lui = |rd: u8, imm20: u32| (imm20 << 12) | ((rd as u32) << 7) | 0b0110111;
    vec![
        // t0 = KERNEL_BASE + 0x800 = 0x80200800 (lui sign-extends; zext via slli/srli)
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011), // slli t0, t0, 32
        i_type(32, T0, 0b101, T0, 0b0010011), // srli t0, t0, 32
        csrrw(0, CSR_STVEC, T0),
        addi(T0, 0, 0x20), // STIE (bit 5)
        csrrs(0, CSR_SIE, T0),
        addi(T0, 0, 0x2), // SIE (bit 1)
        csrrs(0, CSR_SSTATUS, T0),
        // a7 = TIME
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
    ]
}

/// Acceptance #1 + latency: a PAST deadline (0 — mtime already ≥ 0 after the prologue)
/// delivers exactly one STIP promptly; scause = S-timer (5, interrupt bit set).
#[test]
fn past_deadline_fires_immediately_once() {
    let mut code = prologue();
    code.push(addi(A0, 0, 0)); // set_timer(0) — already in the past
    code.push(ECALL);
    code.push(JDOT);
    let m = run_guest(&code, 2000);
    assert_eq!(
        m.hart().regs.read(T3),
        1,
        "exactly one delivery (handler cancels)"
    );
    assert_eq!(
        m.hart().regs.read(T4),
        (1u64 << 63) | 5,
        "scause = supervisor timer interrupt"
    );
    assert_eq!(m.hart().csr.mode, Priv::S, "returned to S via sret");
}

/// Acceptance #2: cancel (u64::MAX) after a pending deadline ⇒ ZERO deliveries over a long
/// idle run. Race attack from the charter: arm 1 tick out, cancel immediately.
#[test]
fn cancel_wins_the_race_zero_deliveries() {
    let mut code = prologue();
    // rdtime t0; a0 = t0 + 1 (one tick out); set_timer; then IMMEDIATELY set_timer(MAX).
    code.push(csrrs(T0, CSR_TIME, 0));
    code.push(addi(A0, T0, 1));
    code.push(ECALL); // arm (1 tick away — with CLOCK_DIV=10 this is ~10 instructions off)
    code.push(addi(A0, 0, -1));
    code.push(ECALL); // cancel — replaces before any boundary can fire it
    code.push(JDOT);
    let m = run_guest(&code, 500_000); // long idle: any late delivery would land
    assert_eq!(
        m.hart().regs.read(T3),
        0,
        "late delivery after cancel = refutation"
    );
}

/// Acceptance #3: set_timer CLEARS an already-pending STIP without the guest touching sip.
#[test]
fn set_timer_clears_pending_stip() {
    // Run with interrupts DISABLED so STIP pends without delivering, then set a future
    // deadline and read sip: STIP must be gone.
    let lui = |rd: u8, imm20: u32| (imm20 << 12) | ((rd as u32) << 7) | 0b0110111;
    let mut code = vec![
        // a7 = TIME; set_timer(0) → STIP pends (SIE off, nothing delivers)
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
        addi(A0, 0, 0),
        ECALL,
        csrrs(T0, 0x144, 0), // t0 = sip (expect STIP set: bit 5)
        // set_timer(far future): a0 = 1 << 40
        addi(A0, 0, 1),
        i_type(40, A0, 0b001, A0, 0b0010011), // slli a0, a0, 40
        ECALL,
        csrrs(T3, 0x144, 0), // t3 = sip (expect STIP clear)
        JDOT,
    ];
    code.push(JDOT);
    let mut m = Machine::new(RAM);
    m.enable_clint(CLOCK_DIV);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    m.run(200);
    assert_eq!(
        m.hart().regs.read(T0) & 0x20,
        0x20,
        "STIP pended while blocked (sip bit 5)"
    );
    assert_eq!(
        m.hart().regs.read(T3) & 0x20,
        0,
        "set_timer(future) cleared STIP — guest never wrote sip"
    );
}

/// Acceptance #4: the DTB timebase and the run loop's mtime source are the same constant —
/// the DTB blob literally contains be32(TIMEBASE_FREQ_HZ) as the timebase-frequency value.
#[test]
fn dtb_timebase_is_the_single_constant() {
    use wasm_vm_core::fdt::build_virt_dtb;
    use wasm_vm_core::platform::Platform;
    let blob = build_virt_dtb(&Platform::default(), "x", None);
    let needle = virt::TIMEBASE_FREQ_HZ.to_be_bytes();
    assert!(
        blob.windows(4).any(|w| w == needle),
        "DTB must carry TIMEBASE_FREQ_HZ ({:#x}) big-endian",
        virt::TIMEBASE_FREQ_HZ
    );
}

/// +1000-tick deadline fires after ~1000*CLOCK_DIV retirements (delivery latency measured
/// in instructions via minstret-like budget bisection: it must NOT fire in the first 5000
/// instructions, and MUST have fired by 15000).
#[test]
fn future_deadline_fires_on_schedule() {
    let mut code = prologue();
    code.push(csrrs(T0, CSR_TIME, 0));
    code.push(i_type(1000, T0, 0b000, A0, 0b0010011)); // a0 = time + 1000
    code.push(ECALL);
    code.push(JDOT);
    // 1000 ticks * CLOCK_DIV(10) = ~10_000 instructions after arming.
    let early = run_guest(&code, 5_000);
    assert_eq!(early.hart().regs.read(T3), 0, "must not fire early");
    let late = run_guest(&code, 15_000);
    assert_eq!(
        late.hart().regs.read(T3),
        1,
        "must have fired by +15k instrs"
    );
}

/// sip.STIP is read-only to S for this device-driven level: the guest cannot csrs it on.
#[test]
fn guest_cannot_forge_stip() {
    let mut code = vec![
        addi(T0, 0, 0x20),
        csrrs(0, SIP as u32, T0), // attempt csrs sip, STIE bit
        csrrs(T3, SIP as u32, 0), // read back
        JDOT,
    ];
    code.push(JDOT);
    let mut m = Machine::new(RAM);
    m.enable_clint(CLOCK_DIV);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    m.run(100);
    assert_eq!(m.hart().regs.read(T3) & 0x20, 0, "STIP not guest-writable");
}
