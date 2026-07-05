//! E2-T05 OpenSBI timer differential, ADOPTED from the cold critic (E2-T05) — OpenSBI differential: the SAME S-mode timer stub run under
//! (a) our built-in SBI (level-derived STIP) and (b) real OpenSBI v1.3 fw_dynamic on this
//! emulator (M-mode mtimecmp/MTIP -> software-set STIP -> mideleg 0x222 delegation).
//! Guest-visible outcome (delivery count, scause, post-sret mode) must be identical.
//! Ignored by default; run with WASM_VM_OPENSBI=target/fw_dynamic.elf.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::Priv;
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::fdt::{build_virt_dtb, dtb_placement};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 128 * 1024 * 1024;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}
const ECALL: u32 = 0x0000_0073;
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;
const A0: u8 = 10;
const A6: u8 = 16;
const A7: u8 = 17;
const T0: u8 = 5;
const T3: u8 = 28; // delivery counter
const T4: u8 = 29; // scause
const T5: u8 = 30; // sip snapshot inside the handler

const CSR_SSTATUS: u32 = 0x100;
const CSR_SIE: u32 = 0x104;
const CSR_STVEC: u32 = 0x105;
const CSR_SCAUSE: u32 = 0x142;
const CSR_SIP: u32 = 0x144;
const CSR_TIME: u32 = 0xC01;
const HANDLER_OFF: u64 = 0x800;
const LOG_BASE: u64 = 0x8050_0000;
const S2: u8 = 18;

fn sd(rs2: u8, rs1: u8, imm: i32) -> u32 {
    let u = imm as u32;
    ((u >> 5) & 0x7F) << 25
        | (rs2 as u32) << 20
        | (rs1 as u32) << 15
        | 0b011 << 12
        | (u & 0x1F) << 7
        | 0b0100011
}

/// The stub: enable STIE+SIE, rdtime, set_timer(now + 200), park; handler counts the
/// delivery, snapshots scause and sip, cancels with set_timer(u64::MAX), sret to park.
fn stub() -> (Vec<u32>, Vec<u32>) {
    let code = vec![
        // Zero the observation registers — under OpenSBI handoff they hold junk.
        addi(T3, 0, 0),
        addi(T4, 0, 0),
        addi(T5, 0, 0),
        // s2 = LOG_BASE (delivery-timestamp log)
        lui(S2, 0x80500),
        i_type(32, S2, 0b001, S2, 0b0010011),
        i_type(32, S2, 0b101, S2, 0b0010011),
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011),
        i_type(32, T0, 0b101, T0, 0b0010011),
        csrrw(0, CSR_STVEC, T0),
        addi(T0, 0, 0x20),
        csrrs(0, CSR_SIE, T0),
        addi(T0, 0, 0x2),
        csrrs(0, CSR_SSTATUS, T0),
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
        csrrs(T0, CSR_TIME, 0),                // now
        i_type(200, T0, 0b000, A0, 0b0010011), // a0 = now + 200 ticks
        ECALL,                                 // sbi_set_timer
        JDOT,                                  // wait for the interrupt
    ];
    let handler = vec![
        addi(T3, T3, 1),
        csrrs(T0, CSR_TIME, 0),
        sd(T0, S2, 0),
        csrrs(T0, 0x141, 0), // sepc
        sd(T0, S2, 8),
        csrrs(T0, CSR_SCAUSE, 0),
        sd(T0, S2, 16),
        addi(S2, S2, 24),
        csrrs(T4, CSR_SCAUSE, 0),
        csrrs(T5, CSR_SIP, 0), // STIP visible in sip inside the handler
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
        addi(A0, 0, -1),
        ECALL, // cancel
        SRET,
    ];
    (code, handler)
}

fn plant(m: &mut Machine) {
    let (code, handler) = stub();
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    for (i, insn) in handler.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + HANDLER_OFF + 4 * i as u64, *insn)
            .unwrap();
    }
}

fn observe(m: &Machine, label: &str) -> (u64, u64, u64, Priv) {
    let t3 = m.hart().regs.read(T3);
    let t4 = m.hart().regs.read(T4);
    let t5 = m.hart().regs.read(T5) & 0x20;
    let mode = m.hart().csr.mode;
    println!(
        "{label}: deliveries={t3} scause={t4:#x} sip.STIP-in-handler={t5:#x} mode={mode:?} pc={:#x}",
        m.hart().regs.pc
    );
    (t3, t4, t5, mode)
}

#[test]
#[ignore = "needs fw_dynamic.elf (WASM_VM_OPENSBI=target/fw_dynamic.elf)"]
fn same_stub_builtin_vs_opensbi() {
    // (a) built-in SBI path.
    let mut a = Machine::new(RAM);
    a.enable_clint(10);
    a.enable_builtin_sbi();
    a.boot_supervisor(0, 0);
    plant(&mut a);
    let out_a = a.run(2_000_000);
    assert_eq!(out_a, RunOutcome::MaxInstrs);
    let obs_a = observe(&a, "builtin ");

    // (b) real OpenSBI fw_dynamic, next_addr = the SAME stub.
    let path = std::env::var("WASM_VM_OPENSBI").expect("WASM_VM_OPENSBI=/path/to/fw_dynamic.elf");
    let fw = std::fs::read(&path).unwrap();
    let mut b = Machine::new(RAM);
    let clint = b.enable_clint(10);
    b.enable_plic();
    let sink = VecSink::new();
    let sink_reader = sink.clone();
    b.bus_mut()
        .attach(
            virt::UART0_BASE,
            virt::UART0_LEN,
            Box::new(Uart0Stub::new(sink)),
        )
        .unwrap();
    let platform = Platform::new(RAM as u64);
    let dtb = build_virt_dtb(&platform, "console=ttyS0", None);
    let dtb_addr = dtb_placement(&platform, dtb.len() as u64).unwrap();
    for (i, byte) in dtb.iter().enumerate() {
        b.bus_mut().store8(dtb_addr + i as u64, *byte).unwrap();
    }
    let info_addr = 0x8030_0000u64;
    for (i, v) in [0x4942_534Fu64, 2, virt::KERNEL_BASE, 1, 0, 0]
        .iter()
        .enumerate()
    {
        b.bus_mut().store64(info_addr + 8 * i as u64, *v).unwrap();
    }
    plant(&mut b);
    b.load_elf(&fw).expect("fw_dynamic.elf loads");
    b.hart_mut().regs.write(10, 0);
    b.hart_mut().regs.write(11, dtb_addr);
    b.hart_mut().regs.write(12, info_addr);
    let out_b = b.run(300_000_000);
    let text = String::from_utf8_lossy(&sink_reader.captured()).to_string();
    println!(
        "OpenSBI banner seen: {}",
        text.lines().next().unwrap_or("<none>")
    );
    assert!(text.contains("OpenSBI"), "OpenSBI must boot: {text:?}");
    assert_eq!(out_b, RunOutcome::MaxInstrs, "stub parks under OpenSBI");
    {
        let st = clint.borrow();
        println!("clint after run: mtime={:#x} mtimecmp={:?}", st.mtime, st);
    }
    let n = b.hart().regs.read(T3).min(20);
    for i in 0..n {
        use wasm_vm_core::bus::Bus;
        let ts = b.bus_mut().load64(LOG_BASE + 24 * i).unwrap();
        let sepc = b.bus_mut().load64(LOG_BASE + 24 * i + 8).unwrap();
        let scause = b.bus_mut().load64(LOG_BASE + 24 * i + 16).unwrap();
        println!("delivery[{i}]: mtime={ts} sepc={sepc:#x} scause={scause:#x}");
    }
    println!(
        "final s2={:#x} (LOG_BASE={LOG_BASE:#x}, so handler ran {} times by log-pointer)",
        b.hart().regs.read(S2),
        (b.hart().regs.read(S2).wrapping_sub(LOG_BASE)) / 24
    );
    let obs_b = observe(&b, "opensbi ");

    // Guest-visible behavior must be identical.
    assert_eq!(obs_a.0, 1, "builtin: exactly one delivery");
    assert_eq!(obs_b.0, 1, "opensbi: exactly one delivery");
    assert_eq!(obs_a.1, obs_b.1, "scause identical (S-timer, bit63|5)");
    assert_eq!(obs_a.1, (1u64 << 63) | 5);
    assert_eq!(obs_a.2, obs_b.2, "sip.STIP view inside handler identical");
    assert_eq!(obs_a.3, Priv::S);
    assert_eq!(obs_b.3, Priv::S);
}
