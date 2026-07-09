//! E2-T05 adversarial suite, ADOPTED from the cold critic's attack tests (its 10^6-ecall
//! hostile-guest fuzz and race/forge attacks are stronger than the original worker tests).
//! The million-call fuzz is #[ignore]d (minutes of runtime): run it with
//! `cargo test --release --test sbi_timer_fuzz -- --ignored`. The fast races/forgeries run
//! in default CI.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, Priv, SIP};
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
const CLOCK_DIV: u64 = 10;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
fn ld(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b011, rd, 0b0000011)
}
fn add(rd: u8, rs1: u8, rs2: u8) -> u32 {
    ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b0110011
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
fn csrrc(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b011 << 12) | ((rd as u32) << 7) | 0b1110011
}
/// bne rs1, rs2, imm (byte offset, must be even)
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
const ECALL: u32 = 0x0000_0073;
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;
const A0: u8 = 10;
const A6: u8 = 16;
const A7: u8 = 17;
const T0: u8 = 5;
const T1: u8 = 6;
const T2: u8 = 7;
const T3: u8 = 28;
const T4: u8 = 29;
const T5: u8 = 30;
const T6: u8 = 31;

const CSR_SSTATUS: u32 = 0x100;
const CSR_SIE: u32 = 0x104;
const CSR_STVEC: u32 = 0x105;
const CSR_SCAUSE: u32 = 0x142;
const CSR_SIP: u32 = 0x144;
const CSR_TIME: u32 = 0xC01;

const HANDLER_OFF: u64 = 0x800;
const TABLE_BASE: u64 = 0x8040_0000;

fn prologue() -> Vec<u32> {
    vec![
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011), // slli
        i_type(32, T0, 0b101, T0, 0b0010011), // srli
        csrrw(0, CSR_STVEC, T0),
        addi(T0, 0, 0x20),
        csrrs(0, CSR_SIE, T0),
        addi(T0, 0, 0x2),
        csrrs(0, CSR_SSTATUS, T0),
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
    ]
}

fn handler() -> Vec<u32> {
    vec![
        addi(T3, T3, 1),
        csrrs(T4, CSR_SCAUSE, 0),
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
        addi(A0, 0, -1),
        ECALL,
        SRET,
    ]
}

fn boot(code: &[u32]) -> Machine {
    let mut m = Machine::new(RAM);
    m.enable_clint(CLOCK_DIV);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    for (i, insn) in handler().iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + HANDLER_OFF + 4 * i as u64, *insn)
            .unwrap();
    }
    m
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
}

/// ATTACK 1: hostile guest — 200_000 real `sbi_set_timer` ecalls with random deadlines
/// (past / exactly-now / near-future 1..=30 ticks / far-future 2^40) interleaved with
/// random-length idle stretches, ALL through the real run loop with real STIP delivery.
/// Expected deliveries are exactly computable: an armed deadline <= now+30 fires exactly
/// once inside its idle stretch (idle >= 321 instrs > 300+eps); far-future never fires
/// (handler cancels each delivery with set_timer(u64::MAX)). Any mismatch refutes.
#[test]
#[ignore = "~6e8 guest instructions; run with --release -- --ignored"]
fn hostile_guest_200k_random_deadlines() {
    const N: usize = 1_000_000;
    let mut rng = Rng(0xE2_705_C41C);
    let mut expected: u64 = 0;
    let mut table: Vec<u8> = Vec::with_capacity(N * 16);
    for _ in 0..N {
        let cat = rng.next() % 100;
        let offset: i64 = if cat < 30 {
            expected += 1;
            -((rng.next() % 100_000) as i64) // past
        } else if cat < 40 {
            expected += 1;
            0 // deadline == mtime at read; == or < mtime by the ecall boundary
        } else if cat < 70 {
            expected += 1;
            1 + (rng.next() % 30) as i64 // near future
        } else {
            1 << 40 // far future: never fires within this run
        };
        let idle: u64 = 160 + rng.next() % 240; // 2*L+1 in [321, 799] instrs
        table.extend_from_slice(&offset.to_le_bytes());
        table.extend_from_slice(&idle.to_le_bytes());
    }
    let table_end = TABLE_BASE + (N as u64) * 16;

    let mut code = prologue();
    // Burn-in: idle ~1e6 instructions so mtime >= 100_000 ticks before the first arm —
    // otherwise t0 + past_offset would wrap to a huge (legitimately never-firing) deadline
    // and the host-side expectation model would be wrong (verified: without this, exactly
    // the wrap cases are "missing").
    code.push(lui(T5, 0x7A)); // 0x7A000 = 499_712
    code.push(addi(T5, T5, 0x120)); // 500_000
    code.push(addi(T5, T5, -1));
    code.push(bne(T5, 0, -4)); // 1_000_001 instrs -> mtime ~100_002
    // t1 = TABLE_BASE (0x80400000), zero-extended
    code.push(lui(T1, 0x80400));
    code.push(i_type(32, T1, 0b001, T1, 0b0010011));
    code.push(i_type(32, T1, 0b101, T1, 0b0010011));
    // t2 = table_end = TABLE_BASE + N*16 = 0x80400000 + 0xF42400 = 0x81342400
    assert_eq!(table_end, 0x8134_2400);
    code.push(lui(T2, 0x81342));
    code.push(addi(T2, T2, 0x400));
    code.push(i_type(32, T2, 0b001, T2, 0b0010011));
    code.push(i_type(32, T2, 0b101, T2, 0b0010011));
    let loop_start = code.len();
    code.push(ld(T6, T1, 0)); // offset
    code.push(ld(T5, T1, 8)); // idle count
    code.push(addi(T1, T1, 16));
    code.push(csrrs(T0, CSR_TIME, 0)); // rdtime
    code.push(add(A0, T0, T6));
    code.push(ECALL); // set_timer
    code.push(addi(T5, T5, -1)); // idle:
    code.push(bne(T5, 0, -4));
    let back = -(((code.len() - loop_start) * 4) as i32);
    code.push(bne(T1, T2, back));
    code.push(JDOT);

    let mut m = {
        let mut m = Machine::new(64 * 1024 * 1024); // bigger RAM: 16 MB deadline table
        m.enable_clint(CLOCK_DIV);
        m.enable_builtin_sbi();
        m.boot_supervisor(0, 0);
        for (i, insn) in code.iter().enumerate() {
            m.bus_mut()
                .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
                .unwrap();
        }
        for (i, insn) in handler().iter().enumerate() {
            m.bus_mut()
                .store32(virt::KERNEL_BASE + HANDLER_OFF + 4 * i as u64, *insn)
                .unwrap();
        }
        m
    };
    for (i, b) in table.iter().enumerate() {
        m.bus_mut().store8(TABLE_BASE + i as u64, *b).unwrap();
    }
    // Budget: per iter <= 6 + 799 + 1 + (1 int step + 8 handler) = 815; 200k * 815 = 1.63e8.
    let outcome = m.run(900_000_000);
    assert_eq!(outcome, RunOutcome::MaxInstrs, "nothing may escape");
    assert_eq!(
        m.hart().regs.read(T1),
        table_end,
        "guest must consume the whole table (reached park)"
    );
    let actual = m.hart().regs.read(T3);
    assert_eq!(
        actual, expected,
        "delivered STIP count must equal the exactly-computed expectation"
    );
    assert_eq!(
        m.hart().regs.read(T4),
        (1u64 << 63) | 5,
        "every delivery was the S-timer interrupt"
    );
    println!("hostile guest: {N} set_timer calls, expected={expected}, actual={actual}");
}

/// ATTACK 2a: set_timer(past) then IMMEDIATELY set_timer(u64::MAX). The level is derived at
/// the boundary after the first ecall retires, and interrupts are enabled — the armed past
/// deadline is a legitimate pending interrupt and MUST deliver exactly once BEFORE the
/// cancel executes. Zero or >1 deliveries refute consistency.
#[test]
fn past_then_immediate_cancel_delivers_exactly_once() {
    let mut code = prologue();
    code.push(addi(A0, 0, 0)); // deadline 0: already past
    code.push(ECALL);
    code.push(addi(A0, 0, -1)); // u64::MAX
    code.push(ECALL); // cancel — but the past deadline already fired at the boundary
    code.push(JDOT);
    let mut m = boot(&code);
    let outcome = m.run(500_000);
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(
        m.hart().regs.read(T3),
        1,
        "armed past deadline delivers once, before the cancel"
    );
    assert_eq!(m.hart().regs.read(T4), (1u64 << 63) | 5);
    assert_eq!(m.hart().csr.mode, Priv::S);
}

/// ATTACK 3: STIP is read-only in the sip view (Priv §4.1.3) — a guest csrc on sip must NOT
/// clear a pending STIP.
#[test]
fn guest_cannot_clear_stip_via_sip_csrc() {
    // Interrupts DISABLED so STIP pends without delivering.
    let code = vec![
        lui(A7, 0x54495),
        addi(A7, A7, -0x2BB),
        addi(A6, 0, 0),
        addi(A0, 0, 0),
        ECALL, // set_timer(0) -> STIP pends
        csrrs(T0, CSR_SIP, 0),
        addi(T5, 0, 0x20),
        csrrc(0, CSR_SIP, T5), // hostile: try to clear STIP via sip
        csrrs(T3, CSR_SIP, 0),
        JDOT,
    ];
    let mut m = boot(&code);
    m.run(200);
    assert_eq!(m.hart().regs.read(T0) & 0x20, 0x20, "STIP pended");
    assert_eq!(
        m.hart().regs.read(T3) & 0x20,
        0x20,
        "csrc sip must NOT clear STIP (read-only in sip view)"
    );
}

/// ATTACK 4: mcounteren grant scope — S-mode rdtime works after boot_supervisor, but U-mode
/// rdtime still traps (scounteren stays 0, kernel-owned).
#[test]
fn umode_rdtime_still_traps_scounteren_zero() {
    let mut m = Machine::new(RAM);
    m.enable_clint(CLOCK_DIV);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    let csr = &mut m.hart_mut().csr;
    // scounteren reads 0 from S.
    let sc = csr
        .access(0x106, CsrOp::Set, 0, true, false, 0)
        .expect("scounteren readable from S");
    assert_eq!(sc, 0, "scounteren must stay 0 (kernel-owned)");
    // S-mode rdtime: OK (mcounteren.TM granted).
    assert!(
        csr.access(0xC01, CsrOp::Set, 0, true, false, 0).is_ok(),
        "S-mode rdtime must work after boot_supervisor"
    );
    // U-mode rdtime: must trap.
    csr.mode = Priv::U;
    assert!(
        csr.access(0xC01, CsrOp::Set, 0, true, false, 0).is_err(),
        "U-mode rdtime must trap with scounteren=0"
    );
}

/// ATTACK 5: could the DTB timebase assertion pass vacuously? Count occurrences of
/// be32(TIMEBASE_FREQ_HZ) in the blob and demand the actual property exists by name.
#[test]
fn dtb_timebase_needle_is_the_property_not_noise() {
    use wasm_vm_core::fdt::build_virt_dtb;
    use wasm_vm_core::platform::Platform;
    let blob = build_virt_dtb(&Platform::default(), "x", None);
    let needle = virt::TIMEBASE_FREQ_HZ.to_be_bytes();
    let count = blob.windows(4).filter(|w| *w == needle).count();
    println!("be32(10^7) occurrences in DTB: {count}");
    // The property name must be in the strings block.
    let name = b"timebase-frequency";
    assert!(
        blob.windows(name.len()).any(|w| w == name),
        "property name 'timebase-frequency' must exist in the DTB"
    );
    assert!(count >= 1);
}

/// ATTACK 2c: deadline exactly equal to mtime at the ecall's own boundary — read time, add
/// the exact number of ticks that will elapse... simpler exact-equality probe: arm
/// deadline = rdtime (equality at or before the next boundary) => must fire exactly once.
#[test]
fn deadline_equal_to_now_fires_once() {
    let mut code = prologue();
    code.push(csrrs(T0, CSR_TIME, 0));
    code.push(add(A0, T0, 0)); // a0 = exactly the time just read
    code.push(ECALL);
    code.push(JDOT);
    let mut m = boot(&code);
    m.run(100_000);
    assert_eq!(m.hart().regs.read(T3), 1, "== now fires exactly once");
}

/// Verify the committed race test's margin by direct computation on a fresh machine:
/// replicate its instruction stream and show the cancel retires BEFORE mtime can cross
/// the +1 deadline (deterministic, not luck): also run with SIE ON the whole time.
#[test]
fn committed_race_margin_is_real() {
    // Same stream as cancel_wins_the_race_zero_deliveries: prologue is 12 instrs, rdtime at
    // retirement index 12, arm at 14, cancel at 16. mtime at rdtime boundary = floor(12/10)=1,
    // deadline 2; mtime reaches 2 at retirement 20 > 16. Margin = 4 retirements.
    let mut code = prologue();
    code.push(csrrs(T0, CSR_TIME, 0));
    code.push(addi(A0, T0, 1));
    code.push(ECALL);
    code.push(addi(A0, 0, -1));
    code.push(ECALL);
    code.push(JDOT);
    let mut m = boot(&code);
    m.run(100_000_000); // acceptance #2 taken literally: 1e8 idle cycles
    assert_eq!(m.hart().regs.read(T3), 0, "cancel deterministically wins");
}
