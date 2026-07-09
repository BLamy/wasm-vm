//! E2-T06 adversarial suite, ADOPTED from the cold critic: the composed stale-TLB scenario
//! (the task's original deliverable) and the overflow attack that REFUTED round 1.
//! 1. Composed stale-TLB scenario THROUGH the SBI dispatch (the deliverable the worker
//!    deferred): Sv39 tables in RAM, satp on, load caches a translation, leaf PTE is
//!    remapped in RAM, guest issues the RFENCE sfence_vma ECALL, next load must see the
//!    NEW frame. Plus a no-fence control proving the test has teeth.
//! 2. Arithmetic-overflow attack on the per-page flush loop (start near u64::MAX).
//! 3. Targeted adversarial fuzz over IPI/RFENCE/HSM/SRST with invariants:
//!    invalid IPI never raises SSIP; invalid SRST never shuts the machine down.
//! 4. Linux boot-shaped probe sequence via real ecalls.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Priv, SATP};

const V: u64 = 1;
const R: u64 = 1 << 1;
const X: u64 = 1 << 3;
const A: u64 = 1 << 6;

const EID_IPI: u64 = 0x735049;
const EID_RFENCE: u64 = 0x52464E43;
const EID_HSM: u64 = 0x48534D;
const EID_SRST: u64 = 0x53525354;
const EID_BASE: u64 = 0x10;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}
fn set_csr(m: &mut Machine, a: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(a, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

struct Pt {
    root: u64,
    next: u64,
}
impl Pt {
    fn new(root: u64) -> Self {
        Pt {
            root,
            next: root + 0x1000,
        }
    }
    /// Maps va->pa and returns the PHYSICAL address of the leaf PTE slot.
    fn map(&mut self, m: &mut Machine, va: u64, pa: u64, perms: u64) -> u64 {
        let mut table = self.root;
        for level in (1..=2usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let e = m.bus_mut().load64(table + vpn * 8).unwrap();
            let next = if e & V != 0 {
                (e >> 10) << 12
            } else {
                let t = self.next;
                self.next += 0x1000;
                m.bus_mut().store64(table + vpn * 8, pte(t, V)).unwrap();
                t
            };
            table = next;
        }
        let vpn0 = (va >> 12) & 0x1FF;
        let slot = table + vpn0 * 8;
        m.bus_mut().store64(slot, pte(pa, perms)).unwrap();
        slot
    }
    fn satp(&self) -> u64 {
        (8u64 << 60) | (self.root >> 12)
    }
}

const VCODE: u64 = 0x1000_0000;
const VDATA: u64 = 0x2000_0000;

/// Paged S-mode machine with builtin SBI. Guest code: ld t3,0(t0); ecall; ld t4,0(t0); j .
/// Registers preloaded host-side (ecall args in a0..a5, EID/FID in a7/a6).
/// Returns (machine, leaf-PTE physical slot for VDATA, frame1 pa, frame2 pa).
fn paged_sbi_machine() -> (Machine, u64, u64, u64) {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.hart_mut().csr.pmp.allow_all();
    m.enable_builtin_sbi();
    let mut pt = Pt::new(DRAM_BASE + 0x20_0000);
    let pcode = DRAM_BASE + 0x30_0000;
    let frame1 = DRAM_BASE + 0x30_1000;
    let frame2 = DRAM_BASE + 0x30_2000;
    pt.map(&mut m, VCODE, pcode, V | R | X | A);
    let slot = pt.map(&mut m, VDATA, frame1, V | R | A);
    set_csr(&mut m, SATP, pt.satp());
    m.bus_mut().store64(frame1, 0x1111).unwrap();
    m.bus_mut().store64(frame2, 0x2222).unwrap();
    // ld t3(x28),0(t0=x5); ecall; ld t4(x29),0(t0); j .
    let ld = |rd: u32| (5u32 << 15) | (0b011 << 12) | (rd << 7) | 0x03;
    m.bus_mut().store32(pcode, ld(28)).unwrap();
    m.bus_mut().store32(pcode + 4, 0x0000_0073).unwrap();
    m.bus_mut().store32(pcode + 8, ld(29)).unwrap();
    m.bus_mut().store32(pcode + 12, 0x0000_006F).unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = VCODE;
    m.hart_mut().regs.write(5, VDATA); // t0 = load VA
    (m, slot, frame1, frame2)
}

fn set_ecall(m: &mut Machine, eid: u64, fid: u64, args: &[u64]) {
    m.hart_mut().regs.write(17, eid);
    m.hart_mut().regs.write(16, fid);
    for (i, a) in args.iter().enumerate() {
        m.hart_mut().regs.write(10 + i as u64 as u8, *a);
    }
}

/// THE deferred deliverable: page-granular sfence_vma through the SBI ecall drops the
/// stale leaf; the next load sees the NEW frame.
#[test]
fn composed_stale_tlb_page_granular_rfence_ecall() {
    let (mut m, slot, _f1, f2) = paged_sbi_machine();
    // sfence_vma(mask=1, base=0, start=VDATA, size=4096) — page-granular.
    set_ecall(&mut m, EID_RFENCE, 1, &[1, 0, VDATA, 4096, 0, 0]);
    m.run(1); // ld t3 — walks, caches leaf -> frame1
    assert_eq!(m.hart().regs.read(28), 0x1111, "first load: old frame");
    // Remap the leaf in RAM only (no architectural flush).
    m.bus_mut().store64(slot, pte(f2, V | R | A)).unwrap();
    m.run(3); // ecall (RFENCE), ld t4, j .
    assert_eq!(m.hart().regs.read(10), 0, "sfence_vma returned SBI_SUCCESS");
    assert_eq!(
        m.hart().regs.read(29),
        0x2222,
        "STALE TLB ENTRY SURVIVED the RFENCE ecall (refutation) — got {:#x}",
        m.hart().regs.read(29)
    );
}

/// Same with the full-flush arg form (start=0, size=u64::MAX).
#[test]
fn composed_stale_tlb_full_flush_rfence_ecall() {
    let (mut m, slot, _f1, f2) = paged_sbi_machine();
    set_ecall(&mut m, EID_RFENCE, 1, &[1, 0, 0, u64::MAX, 0, 0]);
    m.run(1);
    assert_eq!(m.hart().regs.read(28), 0x1111);
    m.bus_mut().store64(slot, pte(f2, V | R | A)).unwrap();
    m.run(3);
    assert_eq!(
        m.hart().regs.read(29),
        0x2222,
        "full flush must drop the stale leaf"
    );
}

/// sfence_vma_asid (FID 2) with asid=0 (the running ASID) must also drop the stale leaf.
#[test]
fn composed_stale_tlb_asid_rfence_ecall() {
    let (mut m, slot, _f1, f2) = paged_sbi_machine();
    set_ecall(&mut m, EID_RFENCE, 2, &[1, 0, VDATA, 4096, 0, 0]);
    m.run(1);
    assert_eq!(m.hart().regs.read(28), 0x1111);
    m.bus_mut().store64(slot, pte(f2, V | R | A)).unwrap();
    m.run(3);
    assert_eq!(
        m.hart().regs.read(29),
        0x2222,
        "asid-targeted flush must drop the leaf"
    );
}

/// TEETH: without a fence (ecall to an unknown EID), the second load MUST still see the
/// OLD frame — proving the TLB really caches and the tests above can fail.
#[test]
fn control_no_fence_second_load_is_stale() {
    let (mut m, slot, _f1, f2) = paged_sbi_machine();
    set_ecall(&mut m, 0xDEAD, 0, &[0, 0, 0, 0, 0, 0]); // NOT_SUPPORTED, no flush
    m.run(1);
    assert_eq!(m.hart().regs.read(28), 0x1111);
    m.bus_mut().store64(slot, pte(f2, V | R | A)).unwrap();
    m.run(3);
    assert_eq!(
        m.hart().regs.read(29),
        0x1111,
        "no fence -> load must be STALE; if 0x2222 the TLB is not caching and the \
         composed tests above prove nothing"
    );
}

/// Arg-marshalling probe: a page-granular flush of an UNRELATED VA should (with this
/// per-page implementation) leave VDATA stale. NOT a refutation if it over-flushes
/// (architecturally legal) — this is diagnostic for a start/size swap.
#[test]
fn page_granular_flush_of_unrelated_va_diagnostic() {
    let (mut m, slot, _f1, f2) = paged_sbi_machine();
    set_ecall(&mut m, EID_RFENCE, 1, &[1, 0, 0x3000_0000, 4096, 0, 0]);
    m.run(1);
    assert_eq!(m.hart().regs.read(28), 0x1111);
    m.bus_mut().store64(slot, pte(f2, V | R | A)).unwrap();
    m.run(3);
    let got = m.hart().regs.read(29);
    // 0x1111 = precise per-page flush (expected). 0x2222 = over-flush (legal, perf note).
    println!("unrelated-VA page flush left VDATA = {got:#x} (0x1111 = precise)");
    assert!(got == 0x1111 || got == 0x2222);
}

/// OVERFLOW ATTACK: sfence_vma with start near the top of the address space and a small
/// multi-page size — the per-page loop computes start + i*4096. In a debug build an
/// overflow panics, killing the whole VM on a guest-triggerable input
/// (top-of-kernel-address-space flushes are realistic: RISC-V Linux fixmap lives at
/// 0xFFFFFFFF_F...). Must return cleanly.
#[test]
fn rfence_start_near_u64_max_must_not_panic() {
    let (mut m, _slot, _f1, _f2) = paged_sbi_machine();
    set_ecall(
        &mut m,
        EID_RFENCE,
        1,
        &[1, 0, u64::MAX - 0xFFF, 0x2000, 0, 0], // 2 pages, second wraps
    );
    m.run(2); // ld + ecall — must not panic
    assert_eq!(m.hart().regs.read(10), 0, "returned (no panic)");
}

/// Simple S-mode machine (no paging) for ecall-invariant fuzzing.
fn flat_sbi_machine() -> Machine {
    let mut m = Machine::new(8 * 1024 * 1024);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    let base = 0x8020_0000u64;
    m.bus_mut().store32(base, 0x0000_0073).unwrap(); // ecall
    m.bus_mut().store32(base + 4, 0x0000_006F).unwrap(); // j .
    m
}

fn ecall_once(m: &mut Machine, eid: u64, fid: u64, args: &[u64; 6]) -> Option<(i64, i64)> {
    m.hart_mut().regs.pc = 0x8020_0000;
    set_ecall(m, eid, fid, &args[..]);
    match m.run(2) {
        wasm_vm_core::RunOutcome::Exited(_) => None, // machine shut down
        _ => Some((m.hart().regs.read(10) as i64, m.hart().regs.read(11) as i64)),
    }
}

/// Hostile targeted fuzz over the new EIDs with adversarial args + invariants:
/// - every return error in the spec range
/// - IPI with an INVALID mask never raises SSIP
/// - SRST args that are not a valid shutdown never end the run
#[test]
fn adversarial_grid_fuzz_invariants() {
    let mut m = flat_sbi_machine();
    let hot: [u64; 12] = [
        0,
        1,
        2,
        3,
        63,
        64,
        255,
        1 << 31,
        1 << 63,
        u64::MAX - 1,
        u64::MAX,
        0x8000_0000,
    ];
    let mut calls = 0u32;
    for eid in [EID_IPI, EID_RFENCE, EID_HSM, EID_SRST] {
        for fid in 0..8u64 {
            for &a0 in &hot {
                for &a1 in &hot {
                    for &a3 in &[0u64, 1, 4096, 0x2000, u64::MAX - 1, u64::MAX] {
                        let start = a0 ^ a1;
                        // (Round-1 refutation: this very combination panicked the per-page
                        // flush loop; the fix full-flushes on range overflow — UNMASKED.)
                        let args = [start, a1, start, a3, a1, 0];
                        let Some((err, _val)) = ecall_once(&mut m, eid, fid, &args) else {
                            // Run ended: only legal for a VALID SRST shutdown.
                            assert!(
                                eid == EID_SRST && fid == 0 && args[0] == 0 && args[1] <= 1,
                                "INVALID SRST args ({:#x},{:#x}) fid {fid} shut the machine down",
                                args[0],
                                args[1]
                            );
                            m = flat_sbi_machine();
                            continue;
                        };
                        calls += 1;
                        assert!(
                            (-9..=0).contains(&err),
                            "non-spec error {err} eid {eid:#x} fid {fid}"
                        );
                        if eid == EID_IPI && fid == 0 && err != 0 {
                            let mip = m.hart_mut().csr.read(0x344);
                            assert_eq!(mip & 0x2, 0, "invalid-mask IPI raised SSIP");
                        }
                        // Reset SSIP between iterations so the invariant stays sharp
                        // (host-side M-mode clear).
                        if eid == EID_IPI {
                            let saved = m.hart().csr.mode;
                            m.hart_mut().csr.mode = Priv::M;
                            m.hart_mut()
                                .csr
                                .access(0x344, CsrOp::Clear, 0x2, false, false, 0)
                                .unwrap();
                            m.hart_mut().csr.mode = saved;
                        }
                    }
                }
            }
        }
    }
    println!("grid calls executed: {calls}");
    assert!(calls > 25_000, "grid smaller than intended: {calls}");
}

/// SRST reason mapping through the run loop: NO_REASON -> Exited(0), SYSTEM_FAILURE ->
/// Exited(1); and the guest never executes the following instruction (poison probe via
/// a register that must stay 0).
#[test]
fn srst_reason_maps_to_exit_code_and_halts() {
    for (reason, code) in [(0u64, 0u64), (1, 1)] {
        let mut m = flat_sbi_machine();
        // Overwrite j . with addi x28,x0,7 as a poison-executed probe.
        let addi_t3 = (7u32 << 20) | (28 << 7) | 0x13;
        m.bus_mut().store32(0x8020_0004, addi_t3).unwrap();
        set_ecall(&mut m, EID_SRST, 0, &[0, reason, 0, 0, 0, 0]);
        assert_eq!(
            m.run(64),
            wasm_vm_core::RunOutcome::Exited(code),
            "reason {reason}"
        );
        assert_eq!(
            m.hart().regs.read(28),
            0,
            "instruction after shutdown ecall executed"
        );
    }
}

/// Linux boot-shaped sequence: probe every extension, self-IPI, sfence, get_status(0),
/// hart_start(0), suspend(retentive). Any value Linux would misread refutes.
#[test]
fn linux_boot_probe_sequence() {
    let mut m = flat_sbi_machine();
    for eid in [
        0x54494D45u64,
        EID_IPI,
        EID_RFENCE,
        EID_HSM,
        EID_SRST,
        0x4442434E,
    ] {
        let (err, val) = ecall_once(&mut m, EID_BASE, 3, &[eid, 0, 0, 0, 0, 0]).unwrap();
        assert_eq!((err, val), (0, 1), "probe({eid:#x}) must be (0,1)");
    }
    let (err, _) = ecall_once(&mut m, EID_IPI, 0, &[1, 0, 0, 0, 0, 0]).unwrap();
    assert_eq!(err, 0, "self-IPI");
    let (err, _) = ecall_once(&mut m, EID_RFENCE, 1, &[1, 0, 0, u64::MAX, 0, 0]).unwrap();
    assert_eq!(err, 0, "flush_tlb_all-shaped sfence");
    let (err, val) = ecall_once(&mut m, EID_HSM, 2, &[0, 0, 0, 0, 0, 0]).unwrap();
    assert_eq!(
        (err, val),
        (0, 0),
        "hart_get_status(0) must be STARTED for smp init"
    );
    let (err, _) = ecall_once(&mut m, EID_HSM, 0, &[0, 0x8020_0000, 0, 0, 0, 0]).unwrap();
    assert_eq!(err, -6, "hart_start(0) -> ALREADY_AVAILABLE");
    let (err, _) = ecall_once(&mut m, EID_HSM, 3, &[0, 0, 0, 0, 0, 0]).unwrap();
    assert_eq!(err, 0, "retentive suspend (cpuidle) succeeds");
    // hart_mask_base == -1 "all available harts" must be SUCCESS with mask ignored.
    let (err, _) = ecall_once(&mut m, EID_IPI, 0, &[0xFFFF, u64::MAX, 0, 0, 0, 0]).unwrap();
    assert_eq!(err, 0, "base==-1 all-harts shorthand");
}
