//! E3-T12b: the CPU architectural-state snapshot section — instruction-exact resume.
//!
//! Proof strategy (native, no boot): run a real riscv-tests program to some instruction count N,
//! snapshot (CPU + RAM via [`Machine::save_resume`]), then run M more instructions capturing the
//! [`HashSink`] rolling trace hash of every guest-visible retire. Restore the snapshot into a
//! DELIBERATELY DIRTY second machine (run to a different count, so its CPU *and* RAM differ) and run
//! the same M — the two trace hashes must be byte-identical. If ANY architectural field were omitted
//! from the CPU section, `Csrs::parse` would leave it at its reset default (not the snapshot value),
//! so the resumed trace would diverge — the diff refutes an incomplete inventory. Programs are chosen
//! to load-bearing-exercise the whole state: FP (f-regs/fcsr), atomics + LR/SC (the reservation),
//! and CSR/counter writes.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::path::PathBuf;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::resume::{ComponentSnapshot, SnapshotError};
use wasm_vm_core::trace::{HashSink, NullSink};

const RAM_BYTES: usize = 8 * 1024 * 1024;

fn bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin")
}
fn load(name: &str) -> Machine {
    let elf = std::fs::read(bin_dir().join(name)).unwrap_or_else(|_| panic!("missing {name}"));
    let mut m = Machine::new(RAM_BYTES);
    m.load_elf(&elf).expect("load_elf");
    m
}

// Programs that exercise distinct corners of the CPU state.
const WORKLOADS: &[&str] = &[
    "rv64ud-p-fmadd",  // f-registers + fcsr (fflags/frm)
    "rv64ua-p-lrsc",   // the LR/SC reservation (resv)
    "rv64mi-p-csr",    // machine CSRs (mstatus/mepc/mtvec/mscratch/… WARL table)
    "rv64mi-p-zicntr", // mcycle/minstret counters + counteren
];

/// AC1: the post-restore M-instruction trace is byte-identical to the uninterrupted continuation,
/// across several snapshot points N — including ones landing mid-atomic / mid-CSR-sequence.
#[test]
fn resume_trace_matches_continuation() {
    for name in WORKLOADS {
        for &n in &[37u64, 111, 233, 400] {
            let m_instrs = 220u64;

            // Reference: run N, snapshot, then run M capturing the continuation's trace.
            let mut a = load(name);
            let _ = a.run_traced(n, &mut NullSink);
            let blob = a.save_resume();
            let mut hc = HashSink::new();
            let _ = a.run_traced(m_instrs, &mut hc);

            // Restore into a DIRTY machine (advanced to a different count → different CPU+RAM), then
            // run the same M. A complete CPU section makes this reproduce the continuation exactly.
            let mut b = load(name);
            let _ = b.run_traced(n + 137, &mut NullSink);
            b.load_resume(&blob).expect("load_resume");
            let mut hr = HashSink::new();
            let _ = b.run_traced(m_instrs, &mut hr);

            assert_eq!(
                (hc.hash(), hc.retired()),
                (hr.hash(), hr.retired()),
                "{name} @N={n}: resumed trace diverged from the continuation (an omitted CPU field?)"
            );
        }
    }
}

/// AC2 (dirty-target restore): restoring a snapshot over arbitrary dirty state yields a CPU section
/// that re-serializes byte-identically to the snapshot — every field was overwritten exactly once.
#[test]
fn restore_over_dirty_state_is_byte_identical() {
    for name in WORKLOADS {
        let mut a = load(name);
        let _ = a.run_traced(321, &mut NullSink);
        let cpu = a.hart().to_snapshot();

        let mut b = load(name);
        let _ = b.run_traced(88, &mut NullSink); // different, dirty CPU state
        assert_ne!(
            b.hart().to_snapshot(),
            cpu,
            "{name}: precondition — states differ"
        );
        b.hart_mut().restore(&cpu).expect("restore");
        assert_eq!(
            b.hart().to_snapshot(),
            cpu,
            "{name}: restore did not reproduce the exact CPU state (a field not overwritten?)"
        );
    }
}

/// AC2 (malformed leaves target unchanged): a truncated, over-long, or bit-flipped CPU payload is a
/// typed error and the hart is untouched — never half-applied.
#[test]
fn malformed_cpu_payload_is_rejected_and_leaves_hart_unchanged() {
    let mut m = load("rv64mi-p-csr");
    let _ = m.run_traced(250, &mut NullSink);
    let good = m.hart().to_snapshot();

    // Byte layout up to the WARL count is fixed: pc(8) + x1..31(31*8) + f0..31(32*8) + resv-tag(1)
    // [+9 if Some] + mode(1) + mstatus(8) + mcause(8) + fflags(1) + frm(1) + warl_count(4)… . This
    // CSR program does no LR/SC, so the reservation is None (1-byte tag) — assert it so the offsets
    // below are valid. A bit-flip in a DATA field (a reg/csr VALUE) is a valid-but-different payload
    // that correctly restores; only STRUCTURAL corruption is an error, so those are what we mutate.
    let resv_off = 8 + 31 * 8 + 32 * 8;
    assert_eq!(
        good[resv_off], 0,
        "precondition: no reservation held → 1-byte resv tag"
    );
    let mode_off = resv_off + 1;
    let warl_count_off = mode_off + 1 + 8 + 8 + 1 + 1;

    let mut mutants: Vec<Vec<u8>> = Vec::new();
    mutants.push(good[..good.len() - 1].to_vec()); // truncated → short read
    mutants.push({
        let mut v = good.clone();
        v.push(0);
        v
    }); // trailing garbage → finish() rejects
    mutants.push({
        let mut v = good.clone();
        v[mode_off] = 2; // 2 is not a valid Priv (U=0/S=1/M=3) → discriminant rejected
        v
    });
    mutants.push({
        let mut v = good.clone();
        // A wildly-large WARL count can't over-read or over-allocate — it errors, hart untouched.
        v[warl_count_off..warl_count_off + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        v
    });

    for (i, bad) in mutants.iter().enumerate() {
        let before = m.hart().to_snapshot();
        let r = m.hart_mut().restore(bad);
        assert!(
            matches!(r, Err(SnapshotError::BadComponentState { .. })),
            "mutant {i} should error"
        );
        assert_eq!(
            m.hart().to_snapshot(),
            before,
            "mutant {i} half-applied — hart mutated on error"
        );
    }
    // The good payload still restores cleanly afterward (the failed attempts left it usable).
    m.hart_mut().restore(&good).expect("good payload restores");
    assert_eq!(m.hart().to_snapshot(), good);
}

// ── AC1, timer-interrupt-placement leg ────────────────────────────────────────────────────────
// A snapshot taken with an S-timer ARMED (deadline in the CLINT, STIE/SIE enabled in the CPU) must,
// on restore, deliver that interrupt at the IDENTICAL instruction. This needs BOTH the CPU section
// (mie/mstatus, a7, regs) and the CLINT section (mtime/mtimecmp) restored together — drop either and
// the interrupt moves or vanishes and the trace diverges.
fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b0010011
}
fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn slli(rd: u8, rs1: u8, sh: u32) -> u32 {
    (sh << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b0010011
}
fn srli(rd: u8, rs1: u8, sh: u32) -> u32 {
    (sh << 20) | ((rs1 as u32) << 15) | (0b101 << 12) | ((rd as u32) << 7) | 0b0010011
}
fn bne(rs1: u8, rs2: u8, imm: i32) -> u32 {
    let u = imm as u32;
    ((u >> 12) & 1) << 31
        | ((u >> 5) & 0x3F) << 25
        | (rs2 as u32) << 20
        | (rs1 as u32) << 15
        | 0b001 << 12
        | ((u >> 1) & 0xF) << 8
        | ((u >> 11) & 1) << 7
        | 0b1100011
}

#[test]
fn resume_places_the_timer_interrupt_identically() {
    use wasm_vm_core::platform::virt;
    const ECALL: u32 = 0x0000_0073;
    const SRET: u32 = 0x1020_0073;
    const HANDLER_OFF: u64 = 0x400;
    const CLOCK_DIV: u64 = 10;
    const CSR_TIME: u32 = 0xC01;
    const CSR_STVEC: u32 = 0x105;
    const CSR_SIE: u32 = 0x104;
    const CSR_SSTATUS: u32 = 0x100;
    let (t0, t3, t5, a0, a6, a7) = (5u8, 28u8, 30u8, 10u8, 16u8, 17u8);

    // Program: enable S-timer interrupts, arm a deadline ~50 ticks out (≈500 retirements at
    // CLOCK_DIV=10), then spin. The handler bumps t3 (guest-visible in the trace) and re-arms MAX so
    // it fires once. stvec is set as an ABSOLUTE address (KERNEL_BASE+HANDLER_OFF, both aligned).
    let handler_addr = virt::KERNEL_BASE + HANDLER_OFF;
    let mut code: Vec<u32> = vec![
        lui(t0, (handler_addr >> 12) as u32),
        addi(t0, t0, (handler_addr & 0xFFF) as i32),
        // lui sign-extends bit 31 (KERNEL_BASE has it set) → zero-extend to a clean 64-bit address.
        slli(t0, t0, 32),
        srli(t0, t0, 32),
        csrrw(0, CSR_STVEC, t0),
        addi(t0, 0, 0x20),
        csrrs(0, CSR_SIE, t0), // sie.STIE
        addi(t0, 0, 0x2),
        csrrs(0, CSR_SSTATUS, t0), // sstatus.SIE
        lui(a7, 0x54495),
        addi(a7, a7, -0x2BB), // a7 = TIME (0x54494D45)
        addi(a6, 0, 0),
        csrrs(t0, CSR_TIME, 0), // t0 = rdtime
        addi(a0, t0, 50),       // deadline = now + 50 ticks
        ECALL,                  // sbi_set_timer(deadline)
        addi(t5, 0, 0),         // spin counter setup
        lui(t5, 1),             // t5 = 4096 → ~8k spin instrs (fire lands inside)
    ];
    let loop_start = code.len();
    code.push(addi(t5, t5, -1));
    let back = -(((code.len() - loop_start) * 4) as i32 + 4);
    code.push(bne(t5, 0, back));
    code.push(0x0000_006F); // jal x0, 0  (park)

    let handler: Vec<u32> = vec![
        addi(t3, t3, 1), // count deliveries
        lui(a7, 0x54495),
        addi(a7, a7, -0x2BB),
        addi(a6, 0, 0),
        addi(a0, 0, -1), // re-arm MAX → fire once
        ECALL,
        SRET,
    ];

    let build = || {
        let mut m = Machine::new(RAM_BYTES);
        m.enable_clint(CLOCK_DIV);
        m.enable_builtin_sbi();
        m.boot_supervisor(0, 0);
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
        m
    };

    // Snapshot at N=200 (timer armed, not yet fired), continue M=900 (crosses the delivery).
    let (n, m_instrs) = (200u64, 900u64);
    let mut a = build();
    let _ = a.run_traced(n, &mut NullSink);
    let blob = a.save_resume();
    let mut hc = HashSink::new();
    let _ = a.run_traced(m_instrs, &mut hc);

    // Restore into a dirty machine (run past the fire, then reset via load_resume), rerun M.
    let mut b = build();
    let _ = b.run_traced(n + 400, &mut NullSink);
    b.load_resume(&blob).expect("load_resume");
    let mut hr = HashSink::new();
    let _ = b.run_traced(m_instrs, &mut hr);

    assert_eq!(
        (hc.hash(), hc.retired()),
        (hr.hash(), hr.retired()),
        "resumed trace diverged across the timer interrupt (CLINT or CPU pending-state not restored?)"
    );
    // Non-vacuity: the continuation actually crossed a delivery (t3 was bumped by the handler).
    assert!(
        a.hart().regs.read(t3) >= 1,
        "precondition: the timer interrupt actually fired in M"
    );
}

/// Round-trip: a snapshot restored into a fresh machine re-serializes byte-identically (canonical,
/// complete encoding) and the whole-machine resume blob round-trips through save→load.
#[test]
fn whole_machine_resume_round_trips() {
    let mut a = load("rv64ud-p-fmadd");
    let _ = a.run_traced(500, &mut NullSink);
    let blob = a.save_resume();
    let cpu = a.hart().to_snapshot();

    let mut b = load("rv64ud-p-fmadd");
    let _ = b.run_traced(50, &mut NullSink);
    b.load_resume(&blob).expect("load_resume");
    assert_eq!(
        b.hart().to_snapshot(),
        cpu,
        "resumed CPU section differs after save/load"
    );
    assert_eq!(
        b.save_resume(),
        blob,
        "resume blob is not canonical across a round-trip"
    );
}
