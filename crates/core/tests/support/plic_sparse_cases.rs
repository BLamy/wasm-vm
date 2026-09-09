use std::cell::RefCell;
use std::rc::Rc;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, PLIC_BASE};
use wasm_vm_core::csr::{MCAUSE, MCYCLE, MEPC, MINSTRET, MSTATUS, Priv};
use wasm_vm_core::dev::plic::PlicState;
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::VecSink;
use wasm_vm_core::{Machine, RunOutcome};

const NUM_SOURCES: usize = 32;
const NUM_CONTEXTS: usize = 2;
const SNAPSHOT_LEN: usize = 156;
const RAM: usize = 64 * 1024;

#[derive(Clone, Copy)]
struct RawState {
    priority: [u32; NUM_SOURCES],
    enable: [u32; NUM_CONTEXTS],
    threshold: [u32; NUM_CONTEXTS],
    level: u32,
    claimed: [u32; NUM_CONTEXTS],
}

impl RawState {
    const fn empty() -> Self {
        Self {
            priority: [0; NUM_SOURCES],
            enable: [0; NUM_CONTEXTS],
            threshold: [0; NUM_CONTEXTS],
            level: 0,
            claimed: [0; NUM_CONTEXTS],
        }
    }
}

fn encode(raw: &RawState) -> [u8; SNAPSHOT_LEN] {
    let mut out = [0; SNAPSHOT_LEN];
    let mut at = 0;
    for word in raw
        .priority
        .iter()
        .chain(raw.enable.iter())
        .chain(raw.threshold.iter())
        .chain(core::iter::once(&raw.level))
        .chain(raw.claimed.iter())
    {
        out[at..at + 4].copy_from_slice(&word.to_le_bytes());
        at += 4;
    }
    out
}

/// The deliberately old implementation: a test-only range scan over the raw snapshot fields.
/// It does not call `eip`, `claim`, or any production candidate helper.
fn old_best(raw: &RawState, context: usize) -> usize {
    let candidates = raw.level & !(raw.claimed[0] | raw.claimed[1]) & raw.enable[context];
    let threshold = raw.threshold[context];
    let mut best_id = 0;
    let mut best_priority = 0;
    for id in 1..NUM_SOURCES {
        if candidates & (1u32 << id) == 0 {
            continue;
        }
        let priority = raw.priority[id];
        if priority <= threshold {
            continue;
        }
        if priority > best_priority {
            best_priority = priority;
            best_id = id;
        }
    }
    best_id
}

fn claim_addr(context: usize) -> u64 {
    PLIC_BASE + 0x0020_0004 + 0x1000 * context as u64
}

fn threshold_addr(context: usize) -> u64 {
    PLIC_BASE + 0x0020_0000 + 0x1000 * context as u64
}

fn enable_addr(context: usize) -> u64 {
    PLIC_BASE + 0x2000 + 0x80 * context as u64
}

fn restore(state: &Rc<RefCell<PlicState>>, raw: &RawState) {
    state.borrow_mut().restore(&encode(raw)).unwrap();
}

fn plic_hits(machine: &mut Machine) -> u64 {
    machine
        .bus_mut()
        .device_hits()
        .into_iter()
        .find(|(base, _)| *base == PLIC_BASE)
        .map(|(_, hits)| hits)
        .expect("PLIC window is attached")
}

fn plic_read(machine: &mut Machine, address: u64) -> u32 {
    let before = plic_hits(machine);
    let value = machine.bus_mut().load32(address).unwrap();
    assert_eq!(plic_hits(machine), before + 1, "one PLIC read hit");
    value
}

fn plic_write(machine: &mut Machine, address: u64, value: u32) {
    let before = plic_hits(machine);
    machine.bus_mut().store32(address, value).unwrap();
    assert_eq!(plic_hits(machine), before + 1, "one PLIC write hit");
}

fn assert_claim_counts(state: &Rc<RefCell<PlicState>>, source31: u64) {
    let mut expected = [0u64; NUM_SOURCES];
    expected[31] = source31;
    assert_eq!(*state.borrow().claim_counts(), expected);
}

fn csr_read(machine: &mut Machine, address: u16) -> u64 {
    machine.hart_mut().csr.read(address)
}

fn explicit_cases() -> [RawState; 12] {
    let mut cases = [RawState::empty(); 12];

    // Empty, disabled, singleton-31, sparse, and dense candidate bitmaps.
    cases[1].priority[5] = u32::MAX;
    cases[1].level = 1 << 5;
    cases[2].priority[31] = u32::MAX;
    cases[2].enable = [1 << 31; NUM_CONTEXTS];
    cases[2].level = 1 << 31;
    cases[3].priority[1] = 4;
    cases[3].priority[7] = 4;
    cases[3].priority[31] = 9;
    cases[3].enable = [1 << 1 | 1 << 7 | 1 << 31; NUM_CONTEXTS];
    cases[3].level = cases[3].enable[0];
    cases[4].enable = [u32::MAX; NUM_CONTEXTS];
    cases[4].level = u32::MAX;
    for id in 1..NUM_SOURCES {
        cases[4].priority[id] = id as u32;
    }

    // Equal priorities, a masked low id followed by an eligible high id, zero, equality,
    // high-bit/full-width values, and hostile restored source-0 bytes.
    cases[5].priority[1] = 7;
    cases[5].priority[31] = 7;
    cases[5].enable = [1 << 1 | 1 << 31; NUM_CONTEXTS];
    cases[5].level = cases[5].enable[0];
    cases[6].priority[1] = 10;
    cases[6].priority[31] = 11;
    cases[6].enable = [1 << 1 | 1 << 31; NUM_CONTEXTS];
    cases[6].level = cases[6].enable[0];
    cases[6].threshold = [10; NUM_CONTEXTS];
    cases[7].priority[31] = 0;
    cases[7].enable = [1 << 31; NUM_CONTEXTS];
    cases[7].level = 1 << 31;
    cases[8].priority[31] = u32::MAX;
    cases[8].enable = [1 << 31; NUM_CONTEXTS];
    cases[8].level = 1 << 31;
    cases[8].threshold = [u32::MAX; NUM_CONTEXTS];
    cases[9].priority[1] = 0x8000_0000;
    cases[9].priority[31] = 0x8000_0001;
    cases[9].enable = [1 << 1 | 1 << 31; NUM_CONTEXTS];
    cases[9].level = cases[9].enable[0];
    cases[9].threshold = [0x8000_0000; NUM_CONTEXTS];
    cases[10].priority[0] = u32::MAX;
    cases[10].enable = [1; NUM_CONTEXTS];
    cases[10].level = 1;
    cases[11].priority[0] = u32::MAX;
    cases[11].priority[31] = u32::MAX - 1;
    cases[11].enable = [1 | 1 << 31; NUM_CONTEXTS];
    cases[11].level = cases[11].enable[0];

    cases
}

fn next_word(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    (*seed >> 16) as u32
}

fn stream_cases() -> ([RawState; 64], u64) {
    let initial_seed = 0xE526_0BAD_CAFE_1234;
    let mut seed = initial_seed;
    let mut cases = [RawState::empty(); 64];
    for raw in &mut cases {
        for priority in &mut raw.priority {
            *priority = next_word(&mut seed);
        }
        for enable in &mut raw.enable {
            *enable = next_word(&mut seed);
        }
        for threshold in &mut raw.threshold {
            *threshold = next_word(&mut seed);
        }
        raw.level = next_word(&mut seed);
        for claimed in &mut raw.claimed {
            *claimed = next_word(&mut seed);
        }
    }
    (cases, initial_seed)
}

fn exercise_selector_and_claims(raw: &RawState) {
    let payload = encode(raw);
    assert_eq!(payload.len(), SNAPSHOT_LEN);
    for context in 0..NUM_CONTEXTS {
        let mut machine = Machine::new(RAM);
        let state = machine.enable_plic();
        restore(&state, raw);
        let expected = old_best(raw, context);
        let before = state.borrow().to_snapshot();
        let counts_before = *state.borrow().claim_counts();
        for _ in 0..3 {
            assert_eq!(state.borrow().eip(context), expected != 0);
        }
        assert_eq!(state.borrow().to_snapshot(), before, "EIP is pure");
        assert_eq!(
            *state.borrow().claim_counts(),
            counts_before,
            "EIP keeps counts"
        );

        let got = machine.bus_mut().load32(claim_addr(context)).unwrap() as usize;
        assert_eq!(got, expected, "context {context} old-oracle claim mismatch");
        let after = state.borrow().to_snapshot();
        let mut expected_after = *raw;
        if expected != 0 {
            expected_after.claimed[context] |= 1u32 << expected;
        }
        assert_eq!(after, encode(&expected_after), "claim gateway state");
        let counts = *state.borrow().claim_counts();
        for (id, count) in counts.iter().enumerate() {
            assert_eq!(
                *count,
                u64::from(expected != 0 && id == expected),
                "claim count source {id}"
            );
        }
    }
}

pub fn selector_snapshot_cases() {
    let explicit = explicit_cases();
    let (stream, seed) = stream_cases();
    for raw in &explicit {
        exercise_selector_and_claims(raw);
    }
    for raw in &stream {
        exercise_selector_and_claims(raw);
    }
    println!(
        "E5-T26o selector cases: seed=0x{seed:016x} explicit={} stream={} contexts={} total={}",
        explicit.len(),
        stream.len(),
        NUM_CONTEXTS,
        (explicit.len() + stream.len()) * NUM_CONTEXTS
    );
}

pub fn hostile_restore_and_bus_sequence() {
    let mut machine = Machine::new(RAM);
    let state = machine.enable_plic();

    // Configure one held-high source through ordinary MMIO and enable it in both contexts.
    plic_write(&mut machine, PLIC_BASE + 4 * 31, 11);
    plic_write(&mut machine, enable_addr(0), 1 << 31);
    plic_write(&mut machine, enable_addr(1), 1 << 31);
    plic_write(&mut machine, threshold_addr(0), 0);
    plic_write(&mut machine, threshold_addr(1), 12);
    state.borrow_mut().set_level(31, true);
    assert!(state.borrow().eip(0));
    assert!(
        !state.borrow().eip(1),
        "context thresholds stay independent"
    );

    let before_queries = plic_hits(&mut machine);
    assert_eq!(plic_read(&mut machine, PLIC_BASE + 4 * 31), 11);
    assert_eq!(plic_read(&mut machine, PLIC_BASE + 0x1000), 1 << 31);
    assert_eq!(plic_read(&mut machine, enable_addr(0)), 1 << 31);
    assert_eq!(plic_read(&mut machine, threshold_addr(0)), 0);
    assert_eq!(plic_hits(&mut machine), before_queries + 4);
    let after_queries = plic_hits(&mut machine);
    assert!(state.borrow().eip(0));
    assert!(state.borrow().eip(0));
    assert_eq!(
        plic_hits(&mut machine),
        after_queries,
        "direct EIP has no bus hit"
    );

    let mut expected_hits = plic_hits(&mut machine);
    assert_eq!(plic_read(&mut machine, claim_addr(0)), 31);
    expected_hits += 1;
    assert_eq!(plic_hits(&mut machine), expected_hits);
    assert_claim_counts(&state, 1);
    assert_eq!(plic_read(&mut machine, claim_addr(1)), 0);
    expected_hits += 1;
    assert_eq!(plic_hits(&mut machine), expected_hits);
    assert_claim_counts(&state, 1);
    assert_eq!(state.borrow().pending() & (1 << 31), 0);

    for (context, id) in [(1, 31), (0, 0), (0, 99), (0, 5)] {
        plic_write(&mut machine, claim_addr(context), id);
        expected_hits += 1;
        assert_eq!(plic_hits(&mut machine), expected_hits);
        assert_claim_counts(&state, 1);
        assert_eq!(
            state.borrow().pending() & (1 << 31),
            0,
            "stale completion {context}/{id}"
        );
    }
    plic_write(&mut machine, claim_addr(0), 31);
    expected_hits += 1;
    assert_eq!(plic_hits(&mut machine), expected_hits);
    assert_eq!(state.borrow().pending() & (1 << 31), 1 << 31);
    assert_eq!(plic_read(&mut machine, claim_addr(0)), 31);
    expected_hits += 1;
    assert_eq!(plic_hits(&mut machine), expected_hits);
    assert_claim_counts(&state, 2);
    state.borrow_mut().set_level(31, false);
    plic_write(&mut machine, claim_addr(0), 31);
    expected_hits += 1;
    assert_eq!(plic_hits(&mut machine), expected_hits);
    assert_eq!(
        state.borrow().pending() & (1 << 31),
        0,
        "deasserted completion stays clear"
    );
    assert_claim_counts(&state, 2);
    let sequence_counts = *state.borrow().claim_counts();

    // Accepted snapshots may contain the same held-high claim in both banks. One completion
    // cannot reopen a gateway still claimed by the other context.
    let mut raw = RawState::empty();
    raw.priority[0] = u32::MAX;
    raw.priority[31] = 9;
    raw.enable = [1 | 1 << 31; NUM_CONTEXTS];
    raw.level = raw.enable[0];
    raw.claimed = [1 << 31; NUM_CONTEXTS];
    restore(&state, &raw);
    assert_eq!(state.borrow().to_snapshot(), encode(&raw));
    assert_eq!(plic_read(&mut machine, PLIC_BASE), u32::MAX);
    assert_eq!(plic_read(&mut machine, PLIC_BASE + 0x1000), 1);
    assert_eq!(plic_read(&mut machine, enable_addr(0)), 1 | 1 << 31);
    assert_eq!(plic_read(&mut machine, threshold_addr(0)), 0);
    assert_eq!(
        state.borrow().to_snapshot(),
        encode(&raw),
        "raw reads are observational"
    );
    assert_claim_counts(&state, 0);
    assert_eq!(plic_read(&mut machine, claim_addr(0)), 0);
    plic_write(&mut machine, claim_addr(0), 31);
    assert_eq!(state.borrow().pending() & (1 << 31), 0);
    assert_claim_counts(&state, 0);
    plic_write(&mut machine, claim_addr(1), 31);
    assert_eq!(state.borrow().pending() & (1 << 31), 1 << 31);
    assert_claim_counts(&state, 0);

    // MMIO context 2 remains the decoder's zero/no-op boundary, independent of direct eip's
    // indexing contract (checked by the native wrapper).
    let before = state.borrow().to_snapshot();
    assert_eq!(plic_read(&mut machine, threshold_addr(2)), 0);
    plic_write(&mut machine, threshold_addr(2), u32::MAX);
    assert_eq!(state.borrow().to_snapshot(), before);
    println!(
        "E5-T26o bus sequence: PLIC MMIO hits={} pre-restore claim_counts={sequence_counts:?} post-restore claim_counts={:?}",
        plic_hits(&mut machine),
        *state.borrow().claim_counts()
    );
}

#[cfg(not(target_arch = "wasm32"))]
pub fn invalid_context_eip_panics() {
    let empty = PlicState::default();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| empty.eip(2))).is_err());

    let mut machine = Machine::new(RAM);
    let state = machine.enable_plic();
    machine.bus_mut().store32(PLIC_BASE + 4 * 5, 1).unwrap();
    machine.bus_mut().store32(enable_addr(0), 1 << 5).unwrap();
    machine.bus_mut().store32(threshold_addr(0), 0).unwrap();
    state.borrow_mut().set_level(5, true);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| state.borrow().eip(2))).is_err()
    );
    println!("E5-T26o invalid direct contexts: empty+pending panic=2");
}

fn i_type(imm: i32, rs1: u8, funct3: u32, rd: u8, opcode: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20)
        | ((rs1 as u32) << 15)
        | (funct3 << 12)
        | ((rd as u32) << 7)
        | opcode
}

fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0, rd, 0b0010011)
}

fn lui(rd: u8, immediate: u32) -> u32 {
    (immediate << 12) | ((rd as u32) << 7) | 0b0110111
}

fn auipc(rd: u8, immediate: u32) -> u32 {
    (immediate << 12) | ((rd as u32) << 7) | 0b0010111
}

fn lw(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b010, rd, 0b0000011)
}

fn sw(rs2: u8, rs1: u8, imm: i32) -> u32 {
    let encoded = (imm as u32) & 0xFFF;
    ((encoded >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (0b010 << 12)
        | ((encoded & 0x1F) << 7)
        | 0b0100011
}

fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}

fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}

pub fn encoded_guest_trace() {
    const HANDLER: u64 = DRAM_BASE + 0x100;
    const PARK: u64 = DRAM_BASE + 0x3c;
    const INT_MEI: u64 = (1u64 << 63) | 11;
    let mut machine = Machine::new(RAM);
    let state = machine.enable_plic();
    let setup = [
        auipc(5, 0),
        addi(5, 5, 0x100),
        csrrw(0, 0x305, 5), // mtvec = HANDLER
        addi(6, 0, -2048),
        csrrs(0, 0x304, 6), // mie.MEIE
        addi(6, 0, 8),
        csrrs(0, 0x300, 6), // mstatus.MIE
        lui(5, 0x0c000),
        addi(6, 0, 7),
        sw(6, 5, 4 * 31), // priority[31]
        lui(5, 0x0c002),
        lui(6, 0x80000),
        sw(6, 5, 0), // enable M context source 31
        lui(5, 0x0c200),
        sw(0, 5, 0), // threshold 0
        0x0000_006f, // jal x0, 0: precise interrupt boundary
    ];
    let handler = [
        lui(5, 0x0c200),
        lw(10, 5, 4), // claim source 31
        sw(10, 5, 4), // complete after the host deasserts the line
        addi(11, 10, 0),
        0x3020_0073, // mret
    ];
    for (index, instruction) in setup.iter().enumerate() {
        machine
            .bus_mut()
            .store32(DRAM_BASE + 4 * index as u64, *instruction)
            .unwrap();
    }
    for (index, instruction) in handler.iter().enumerate() {
        machine
            .bus_mut()
            .store32(HANDLER + 4 * index as u64, *instruction)
            .unwrap();
    }
    machine.hart_mut().regs.pc = DRAM_BASE;
    let mut trace = VecSink::new();
    assert_eq!(
        machine.run_traced(setup.len() as u64, &mut trace),
        RunOutcome::MaxInstrs
    );
    assert_eq!(machine.hart().regs.pc, PARK);

    state.borrow_mut().set_level(31, true);
    assert_eq!(machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.pc, HANDLER, "MEI routes to mtvec");
    assert_eq!(
        csr_read(&mut machine, MEPC),
        PARK,
        "mepc is the interrupted jal"
    );
    assert_eq!(
        csr_read(&mut machine, MCAUSE),
        INT_MEI,
        "mcause is machine external"
    );
    assert_eq!(machine.hart().csr.mode, Priv::M, "MEI stays in M mode");
    let trap_pc = machine.hart().regs.pc;
    let trap_mepc = csr_read(&mut machine, MEPC);
    let trap_mcause = csr_read(&mut machine, MCAUSE);
    let trap_mstatus = csr_read(&mut machine, MSTATUS);
    println!(
        "E5-T26o trap boundary: pc={:#x} mepc={:#x} mcause={:#x} mstatus={:#x} retired={}",
        trap_pc,
        trap_mepc,
        trap_mcause,
        trap_mstatus,
        trace.records.len()
    );
    assert_eq!(csr_read(&mut machine, MSTATUS), 0x0000_000a_0000_1880);

    assert_eq!(machine.run_traced(2, &mut trace), RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.pc, HANDLER + 8);
    assert_eq!(machine.hart().regs.read(10), 31, "guest claim id");
    assert_claim_counts(&state, 1);
    assert_eq!(
        state.borrow().pending() & (1 << 31),
        0,
        "claim closes gateway"
    );

    state.borrow_mut().set_level(31, false);
    assert_eq!(machine.run_traced(3, &mut trace), RunOutcome::MaxInstrs);
    assert_eq!(
        machine.hart().regs.pc,
        PARK,
        "mret returns to interrupted jal"
    );
    assert_eq!(machine.hart().regs.read(11), 31, "handler register effect");
    assert_eq!(csr_read(&mut machine, MSTATUS), 0x0000_000a_0000_0088);
    assert_eq!(machine.hart().csr.mode, Priv::M);
    assert_claim_counts(&state, 1);
    assert_eq!(state.borrow().pending() & (1 << 31), 0);
    assert_eq!(csr_read(&mut machine, MCYCLE), 21);
    assert_eq!(csr_read(&mut machine, MINSTRET), 21);

    let canonical = trace.canonical();
    let digest = machine.snapshot().hex_digest();
    println!(
        "E5-T26o guest trace ({} records):\n{canonical}digest={digest}",
        trace.records.len()
    );

    // Independent canonical encoding of the setup and handler words above.
    const EXPECTED_TRACE: &str = "core 0: 0x0000000080000000 (0x00000297) x5 0x0000000080000000\ncore 0: 0x0000000080000004 (0x10028293) x5 0x0000000080000100\ncore 0: 0x0000000080000008 (0x30529073)\ncore 0: 0x000000008000000c (0x80000313) x6 0xfffffffffffff800\ncore 0: 0x0000000080000010 (0x30432073)\ncore 0: 0x0000000080000014 (0x00800313) x6 0x0000000000000008\ncore 0: 0x0000000080000018 (0x30032073)\ncore 0: 0x000000008000001c (0x0c0002b7) x5 0x000000000c000000\ncore 0: 0x0000000080000020 (0x00700313) x6 0x0000000000000007\ncore 0: 0x0000000080000024 (0x0662ae23) mem 0x000000000c00007c 0x00000007\ncore 0: 0x0000000080000028 (0x0c0022b7) x5 0x000000000c002000\ncore 0: 0x000000008000002c (0x80000337) x6 0xffffffff80000000\ncore 0: 0x0000000080000030 (0x0062a023) mem 0x000000000c002000 0x80000000\ncore 0: 0x0000000080000034 (0x0c2002b7) x5 0x000000000c200000\ncore 0: 0x0000000080000038 (0x0002a023) mem 0x000000000c200000 0x00000000\ncore 0: 0x000000008000003c (0x0000006f)\ncore 0: 0x0000000080000100 (0x0c2002b7) x5 0x000000000c200000\ncore 0: 0x0000000080000104 (0x0042a503) x10 0x000000000000001f mem 0x000000000c200004\ncore 0: 0x0000000080000108 (0x00a2a223) mem 0x000000000c200004 0x0000001f\ncore 0: 0x000000008000010c (0x00050593) x11 0x000000000000001f\ncore 0: 0x0000000080000110 (0x30200073)\n";
    // Independent SHA-256 of zeroed 64 KiB RAM with the encoded words above.
    const EXPECTED_DIGEST: &str =
        "c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891";
    assert_eq!(trace.canonical(), EXPECTED_TRACE);
    assert_eq!(machine.snapshot().hex_digest(), EXPECTED_DIGEST);
}
