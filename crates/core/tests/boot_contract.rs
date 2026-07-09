//! E2-T03 boot-contract prototypes (ADR 0002 evidence).
//!
//! Prototype (a) — built-in SBI: an S-mode payload entered per the boot contract makes the
//! kernel's first SBI call (Base probe) and receives the skeleton's NOT_SUPPORTED answer
//! without trapping; the reset-state table in the ADR is dumped and asserted here.
//!
//! Prototype (b) — OpenSBI as guest payload: `opensbi_fw_dynamic_boots` (ignored; needs the
//! QEMU-shipped fw_dynamic.elf, see `tools/adr0002_opensbi_probe.sh`) loads real OpenSBI,
//! hands it our E2-T02 DTB, and captures whatever it prints — the transcript quoted in the
//! ADR comes from that run.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, MEDELEG, MIDELEG, Priv, SATP, SSTATUS};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::fdt::{build_virt_dtb, dtb_placement};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::sbi::SBI_ERR_NOT_SUPPORTED;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 128 * 1024 * 1024;

fn rd_csr(m: &mut Machine, addr: u16) -> u64 {
    let save = m.hart().csr.mode;
    m.hart_mut().csr.mode = Priv::M;
    let v = m
        .hart_mut()
        .csr
        .access(addr, CsrOp::Set, 0, true, false, 0)
        .unwrap();
    m.hart_mut().csr.mode = save;
    v
}

/// I-type helper for the hand-assembled S-mode payload.
fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}

/// Prototype (a): enter S-mode per the contract, make the first SBI call, keep running.
#[test]
fn builtin_sbi_first_call_and_reset_state() {
    let mut m = Machine::new(RAM);
    m.enable_builtin_sbi();
    m.boot_supervisor(virt::BOOT_HART, 0x8600_0000);

    // ── The ADR's reset-state table, dumped from the live machine (charter item) ──
    assert_eq!(m.hart().csr.mode, Priv::S, "entered in S-mode");
    assert_eq!(m.hart().regs.pc, virt::KERNEL_BASE, "pc = KERNEL_BASE");
    assert_eq!(m.hart().regs.read(10), virt::BOOT_HART, "a0 = hartid");
    assert_eq!(m.hart().regs.read(11), 0x8600_0000, "a1 = DTB address");
    assert_eq!(rd_csr(&mut m, MIDELEG), 0x222, "mideleg: SSI/STI/SEI -> S");
    assert_eq!(
        rd_csr(&mut m, MEDELEG),
        0xB109,
        "medeleg: OpenSBI-equivalent set"
    );
    assert_eq!(rd_csr(&mut m, SATP), 0, "satp = Bare");
    assert_eq!(rd_csr(&mut m, SSTATUS) & 0x2, 0, "sstatus.SIE = 0");

    // ── The payload: li a7, 0x10 (Base EID); li a6, 0; ecall; li ra, 42; j . ──
    let code = [
        i_type(0x10, 0, 0b000, 17, 0b0010011), // addi a7, x0, 0x10
        i_type(0, 0, 0b000, 16, 0b0010011),    // addi a6, x0, 0
        0x0000_0073,                           // ecall
        i_type(42, 0, 0b000, 1, 0b0010011),    // addi ra, x0, 42  (proof we resumed)
        0x0000_006F,                           // j .
    ];
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }

    let outcome = m.run(64);
    assert_eq!(
        outcome,
        RunOutcome::MaxInstrs,
        "parked in `j .`, no escaping trap"
    );
    assert_eq!(
        m.hart().regs.read(10) as i64,
        SBI_ERR_NOT_SUPPORTED,
        "first SBI call answered NOT_SUPPORTED by the skeleton (a0)"
    );
    assert_eq!(m.hart().regs.read(11), 0, "a1 (value) = 0");
    assert_eq!(
        m.hart().regs.read(1),
        42,
        "execution RESUMED after the ecall"
    );
    assert_eq!(
        m.hart().csr.mode,
        Priv::S,
        "still in S-mode — no M-mode excursion"
    );
}

/// Prototype (b): boot REAL OpenSBI fw_dynamic with our DTB and capture its output.
///
/// Ignored by default: needs the QEMU-distribution ELF extracted from the toolchain image —
/// run `tools/adr0002_opensbi_probe.sh`, which extracts it and runs this test with
/// `WASM_VM_OPENSBI` set. The captured transcript is the ADR's option-(b) evidence.
#[test]
#[ignore = "needs fw_dynamic.elf (run tools/adr0002_opensbi_probe.sh)"]
fn opensbi_fw_dynamic_boots() {
    let path = std::env::var("WASM_VM_OPENSBI").expect("WASM_VM_OPENSBI=/path/to/fw_dynamic.elf");
    let fw = std::fs::read(&path).unwrap();

    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let sink = VecSink::new();
    let sink_reader = sink.clone();
    m.bus_mut()
        .attach(
            virt::UART0_BASE,
            virt::UART0_LEN,
            Box::new(Uart0Stub::new(sink)),
        )
        .unwrap();

    // Our E2-T02 DTB at the top of DRAM — OpenSBI generic parses THIS to find uart/clint/plic.
    let platform = Platform::new(RAM as u64);
    let dtb = build_virt_dtb(&platform, "console=ttyS0", None);
    let dtb_addr = dtb_placement(&platform, dtb.len() as u64).unwrap();
    for (i, b) in dtb.iter().enumerate() {
        m.bus_mut().store8(dtb_addr + i as u64, *b).unwrap();
    }

    // fw_dynamic handoff info (struct fw_dynamic_info, all XLEN words):
    // magic "OSBI", version 2, next_addr = KERNEL_BASE, next_mode = 1 (S), options 0, boot_hart 0.
    let info_addr = 0x8030_0000u64;
    for (i, v) in [0x4942_534Fu64, 2, virt::KERNEL_BASE, 1, 0, 0]
        .iter()
        .enumerate()
    {
        m.bus_mut().store64(info_addr + 8 * i as u64, *v).unwrap();
    }

    // Park the "kernel": `j .` at KERNEL_BASE so a successful handoff idles instead of
    // executing zeroes.
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();

    m.load_elf(&fw).expect("fw_dynamic.elf loads");
    // OpenSBI fw_* entry contract: a0 = hartid, a1 = DTB, a2 = fw_dynamic_info.
    m.hart_mut().regs.write(10, 0);
    m.hart_mut().regs.write(11, dtb_addr);
    m.hart_mut().regs.write(12, info_addr);

    let outcome = m.run(200_000_000);
    let bytes = sink_reader.captured();
    let text = String::from_utf8_lossy(&bytes);
    // The transcript IS the evidence — always print it for the ADR.
    println!("=== OpenSBI console output ({} bytes) ===", bytes.len());
    println!("{text}");
    println!(
        "=== outcome: {outcome:?}, final pc {:#x} ===",
        m.hart().regs.pc
    );
    assert!(
        text.contains("OpenSBI"),
        "expected the OpenSBI banner; got {} bytes: {text:?}",
        bytes.len()
    );
}
