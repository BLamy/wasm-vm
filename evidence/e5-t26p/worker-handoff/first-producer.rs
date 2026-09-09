//! Bounded E5-T26p evidence producer.
//!
//! This is deliberately an example, rather than a production helper or a test-only
//! accessor.  It uses only the public API that existed at the old E5-T26p baseline so
//! that the same source can be copied into an untouched archive and compared with the
//! candidate.  Assertions are independent architectural expectations; the ordinary /
//! cached and recording / untraced runs are additional parity observations.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::csr::INSTRET;
use wasm_vm_core::dev::console::{Uart0Stub, VecSink as ConsoleSink};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::VecSink;
use wasm_vm_core::{Machine, RunOutcome};

const RAM_BYTES: usize = 0x8000;
const CODE: u64 = DRAM_BASE;
const DATA: u64 = DRAM_BASE + 0x2000;
const CROSS_SCALAR: u64 = DRAM_BASE + 0x2ffe;
const CROSS: u64 = DRAM_BASE + 0x2ffc;
const BAD: u64 = DRAM_BASE + RAM_BYTES as u64 + 0x100;

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        write!(out, "{byte:02x}").unwrap();
    }
    out
}

fn hex_bytes(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(out, "{byte:02x}").unwrap();
    }
    out
}

fn diff_bytes(before: &[u8], after: &[u8]) -> String {
    let mut out = String::new();
    let mut i = 0usize;
    while i < before.len() {
        if before[i] == after[i] {
            i += 1;
            continue;
        }
        let start = i;
        while i < before.len() && before[i] != after[i] {
            i += 1;
        }
        if !out.is_empty() {
            out.push(',');
        }
        write!(
            out,
            "0x{:x}:{}",
            DRAM_BASE + start as u64,
            hex_bytes(&after[start..i])
        )
        .unwrap();
    }
    if out.is_empty() {
        "none".to_owned()
    } else {
        out
    }
}

fn reservation(hart: &Hart) -> String {
    match hart.resv {
        Some((addr, width)) => format!("0x{addr:016x}/{width}"),
        None => "none".to_owned(),
    }
}

fn trap_text(trap: Trap) -> String {
    format!("{:?},tval=0x{:016x}", trap.cause, trap.tval)
}

fn outcome_text(outcome: RunOutcome) -> String {
    match outcome {
        RunOutcome::Exited(code) => format!("exited=0x{code:x}"),
        RunOutcome::Trapped(trap) => format!("trapped={}", trap_text(trap)),
        RunOutcome::MaxInstrs => "max-instrs".to_owned(),
        RunOutcome::Reset(reason) => format!("reset={reason:?}"),
    }
}

fn trace_lines(sink: Option<&VecSink>) -> (usize, String, String) {
    let Some(sink) = sink else {
        return (0, "none".to_owned(), String::new());
    };
    let canonical = sink.canonical();
    (
        sink.records.len(),
        sha256_hex(canonical.as_bytes()),
        canonical,
    )
}

fn print_trace(sink: Option<&VecSink>) {
    let (count, digest, canonical) = trace_lines(sink);
    println!("TRACE_RECORDS={count}");
    println!("TRACE_SHA256={digest}");
    if sink.is_some() {
        print!("TRACE_CANONICAL_BEGIN\n{canonical}TRACE_CANONICAL_END\n");
    } else {
        println!("TRACE_CANONICAL=none");
    }
}

/// Public-Bus wrapper used only to make the direct-Hart fixture's ordering visible.
/// It logs all accesses (including instruction fetches); the UART byte stream below is
/// the separate, observable MMIO side-effect record.
struct LoggedBus {
    inner: SystemBus,
    events: Vec<String>,
}

impl LoggedBus {
    fn new(inner: SystemBus) -> Self {
        Self {
            inner,
            events: Vec::new(),
        }
    }

    fn load_text<T: std::fmt::LowerHex>(
        &mut self,
        kind: &str,
        addr: u64,
        result: Result<T, BusFault>,
    ) -> Result<T, BusFault> {
        match &result {
            Ok(value) => self
                .events
                .push(format!("{kind}@0x{addr:016x}=0x{value:x}")),
            Err(fault) => self
                .events
                .push(format!("{kind}@0x{addr:016x}=ERR:{fault:?}")),
        }
        result
    }

    fn store_text(
        &mut self,
        kind: &str,
        addr: u64,
        value: u64,
        result: Result<(), BusFault>,
    ) -> Result<(), BusFault> {
        let suffix = match result {
            Ok(()) => "OK".to_owned(),
            Err(fault) => format!("ERR:{fault:?}"),
        };
        self.events
            .push(format!("{kind}@0x{addr:016x}<=0x{value:016x}:{suffix}"));
        result
    }
}

impl Bus for LoggedBus {
    fn load8(&mut self, addr: u64) -> Result<u8, BusFault> {
        let r = self.inner.load8(addr);
        self.load_text("L8", addr, r)
    }
    fn load16(&mut self, addr: u64) -> Result<u16, BusFault> {
        let r = self.inner.load16(addr);
        self.load_text("L16", addr, r)
    }
    fn load32(&mut self, addr: u64) -> Result<u32, BusFault> {
        let r = self.inner.load32(addr);
        self.load_text("L32", addr, r)
    }
    fn load64(&mut self, addr: u64) -> Result<u64, BusFault> {
        let r = self.inner.load64(addr);
        self.load_text("L64", addr, r)
    }
    fn store8(&mut self, addr: u64, value: u8) -> Result<(), BusFault> {
        let r = self.inner.store8(addr, value);
        self.store_text("S8", addr, u64::from(value), r)
    }
    fn store16(&mut self, addr: u64, value: u16) -> Result<(), BusFault> {
        let r = self.inner.store16(addr, value);
        self.store_text("S16", addr, u64::from(value), r)
    }
    fn store32(&mut self, addr: u64, value: u32) -> Result<(), BusFault> {
        let r = self.inner.store32(addr, value);
        self.store_text("S32", addr, u64::from(value), r)
    }
    fn store64(&mut self, addr: u64, value: u64) -> Result<(), BusFault> {
        let r = self.inner.store64(addr, value);
        self.store_text("S64", addr, value, r)
    }
    fn ram_contains(&self, addr: u64, len: u64) -> bool {
        self.inner.ram_contains(addr, len)
    }
    fn prof_timer_now(&self) -> Option<u64> {
        self.inner.prof_timer_now()
    }
    fn prof_note_walk(&mut self, ns: u64) {
        self.inner.prof_note_walk(ns)
    }
}

struct DirectFixture {
    hart: Hart,
    bus: LoggedBus,
    before_hart: Vec<u8>,
    before_ram: Vec<u8>,
    console: ConsoleSink,
}

struct DirectResult {
    hart: Hart,
    bus: LoggedBus,
    before_ram: Vec<u8>,
    console: ConsoleSink,
    trap: Option<Trap>,
    retired: usize,
    trace: Option<VecSink>,
}

fn direct_fixture(words: &[u32], xseed: &[(u8, u64)], fseed: &[(u8, u64)]) -> DirectFixture {
    let console = ConsoleSink::new();
    let mut raw_bus = SystemBus::new(Ram::new(RAM_BYTES).unwrap());
    raw_bus
        .attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(console.clone())),
        )
        .unwrap();
    for (index, word) in words.iter().enumerate() {
        raw_bus.store32(CODE + 4 * index as u64, *word).unwrap();
    }
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    for &(reg, value) in xseed {
        hart.regs.write(reg, value);
    }
    for &(reg, value) in fseed {
        hart.fregs.write_raw(reg, value);
    }
    let mut bus = LoggedBus::new(raw_bus);
    bus.events.clear();
    let before_hart = hart.to_snapshot();
    let before_ram = bus.inner.ram().as_bytes().to_vec();
    DirectFixture {
        hart,
        bus,
        before_hart,
        before_ram,
        console,
    }
}

fn run_direct(mut fixture: DirectFixture, words: usize, record: bool) -> DirectResult {
    let mut trace = record.then(VecSink::new);
    let mut trap = None;
    let mut retired = 0;
    for _ in 0..words {
        let result = match trace.as_mut() {
            Some(sink) => fixture.hart.step_traced(&mut fixture.bus, sink),
            None => fixture.hart.step(&mut fixture.bus),
        };
        match result {
            Ok(()) => retired += 1,
            Err(value) => {
                trap = Some(value);
                break;
            }
        }
    }
    DirectResult {
        hart: fixture.hart,
        bus: fixture.bus,
        before_ram: fixture.before_ram,
        console: fixture.console,
        trap,
        retired,
        trace,
    }
}

fn emit_direct(name: &str, result: &DirectResult) {
    println!("CASE {name}");
    let hart_bytes = result.hart.to_snapshot();
    println!(
        "HART_SNAPSHOT_SHA256={} HART_SNAPSHOT_LEN={}",
        sha256_hex(&hart_bytes),
        hart_bytes.len()
    );
    let ram = result.bus.inner.ram().as_bytes();
    println!("RAM_SHA256={}", sha256_hex(ram));
    println!("RAM_CHANGED={}", diff_bytes(&result.before_ram, ram));
    match result.trap {
        Some(trap) => println!("RESULT=trap:{} RETIRED={}", trap_text(trap), result.retired),
        None => println!("RESULT=ok RETIRED={}", result.retired),
    }
    println!("RESERVATION={}", reservation(&result.hart));
    println!("MMIO_UART_ORDER={}", hex_bytes(&result.console.captured()));
    println!("BUS_EVENTS={}", result.bus.events.join(","));
    print_trace(result.trace.as_ref());
    println!("END_CASE");
}

fn expect_no_trap(result: &DirectResult, name: &str) {
    assert!(result.trap.is_none(), "{name}: unexpected trap");
}

fn i_type(imm: i32, rs1: u8, funct3: u32, rd: u8, opcode: u32) -> u32 {
    (((imm as u32) & 0xfff) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | (u32::from(rd) << 7)
        | opcode
}

fn s_type(imm: i32, rs2: u8, rs1: u8, funct3: u32, opcode: u32) -> u32 {
    let value = (imm as u32) & 0xfff;
    ((value >> 5) << 25)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | ((value & 0x1f) << 7)
        | opcode
}

fn branch(imm: i32, rs2: u8, rs1: u8, funct3: u32) -> u32 {
    let value = imm as u32;
    (((value >> 12) & 1) << 31)
        | (((value >> 5) & 0x3f) << 25)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | (((value >> 1) & 0xf) << 8)
        | (((value >> 11) & 1) << 7)
        | 0x63
}

fn csrr(rd: u8, csr: u16) -> u32 {
    (u32::from(csr) << 20) | (0b010 << 12) | (u32::from(rd) << 7) | 0x73
}

fn amo(funct5: u32, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct5 << 27)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | (u32::from(rd) << 7)
        | 0x2f
}

fn report_scalar_stores() {
    let cases: &[(&str, u32, &[(u8, u64)], &[(u8, u64)], u64, &[u8])] = &[
        (
            "scalar-sb-overlap",
            s_type(2, 3, 2, 0b000, 0x23),
            &[(2, DATA), (3, 0x1122_3344_5566_77ab)],
            &[][..],
            DATA + 2,
            &[0xab][..],
        ),
        (
            "scalar-sh-nonoverlap",
            s_type(8, 3, 2, 0b001, 0x23),
            &[(2, DATA), (3, 0x1122_3344_5566_beef)],
            &[][..],
            DATA + 8,
            &[0xef, 0xbe][..],
        ),
        (
            "scalar-sw-cross-page",
            s_type(0, 3, 2, 0b010, 0x23),
            &[(2, CROSS_SCALAR), (3, 0xdead_beef)],
            &[][..],
            CROSS_SCALAR,
            &[0xef, 0xbe, 0xad, 0xde][..],
        ),
        (
            "scalar-sd-nonoverlap",
            s_type(16, 3, 2, 0b011, 0x23),
            &[(2, DATA), (3, 0x0123_4567_89ab_cdef)],
            &[][..],
            DATA + 16,
            &[0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01][..],
        ),
        (
            "fp-fsw-overlap",
            s_type(2, 1, 2, 0b010, 0x27),
            &[(2, DATA)],
            &[(1, 0xffff_ffff_3f80_0000)],
            DATA + 2,
            &[0x00, 0x00, 0x80, 0x3f][..],
        ),
        (
            "fp-fsd-nonoverlap",
            s_type(16, 1, 2, 0b011, 0x27),
            &[(2, DATA)],
            &[(1, 0x0123_4567_89ab_cdef)],
            DATA + 16,
            &[0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01][..],
        ),
    ];
    for &(name, word, xseed, fseed, address, expected) in cases {
        let mut fixture = direct_fixture(&[word], xseed, fseed);
        fixture.hart.csr.mstatus |= 1 << 13;
        fixture.before_hart = fixture.hart.to_snapshot();
        fixture
            .bus
            .inner
            .ram_mut()
            .write_slice(DATA, &[0xaa; 32])
            .unwrap();
        fixture.before_ram = fixture.bus.inner.ram().as_bytes().to_vec();
        let result = run_direct(fixture, 1, true);
        expect_no_trap(&result, name);
        let ram = result.bus.inner.ram().as_bytes();
        let start = (address - DRAM_BASE) as usize;
        assert_eq!(&ram[start..start + expected.len()], expected, "{name}");
        if name == "scalar-sb-overlap" {
            assert_eq!(ram[start + 1], 0xaa, "SB wrote beyond its one byte");
            assert_eq!(result.hart.regs.read(0), 0, "x0 changed");
        }
        emit_direct(name, &result);
    }

    for (name, funct3, expected) in [
        ("scalar-fault-sd", 0b011, Exception::StoreAccessFault),
        ("fp-fault-fsd", 0b011, Exception::StoreAccessFault),
    ] {
        let word = if name.starts_with("fp-") {
            s_type(0, 1, 1, funct3, 0x27)
        } else {
            s_type(0, 3, 1, funct3, 0x23)
        };
        let mut fixture = direct_fixture(
            &[word],
            &[(1, BAD), (3, 0x0123_4567_89ab_cdef)],
            &[(1, 0x0123_4567_89ab_cdef)],
        );
        if name.starts_with("fp-") {
            fixture.hart.csr.mstatus |= 1 << 13;
            fixture.before_hart = fixture.hart.to_snapshot();
        }
        let result = run_direct(fixture, 1, true);
        assert_eq!(result.trap.unwrap().cause, expected, "{name}");
        assert_eq!(result.trap.unwrap().tval, BAD, "{name} tval");
        emit_direct(name, &result);
    }
}

fn report_atomics() {
    let lr = amo(0b00010, 0b010, 5, 10, 0);
    let sc = amo(0b00011, 0b010, 5, 10, 6);
    let ordinary_store = s_type(0, 7, 10, 0b010, 0x23);

    let mut success = direct_fixture(&[lr, sc], &[(10, DATA), (6, 0x20)], &[]);
    success
        .bus
        .inner
        .store32(DATA, 0x10)
        .expect("seed atomic word");
    success.before_ram = success.bus.inner.ram().as_bytes().to_vec();
    let mut success = run_direct(success, 2, true);
    expect_no_trap(&success, "lr-sc-success");
    assert_eq!(success.hart.regs.read(5), 0, "SC success status");
    assert_eq!(success.hart.resv, None, "SC consumes reservation");
    assert_eq!(success.bus.inner.load32(DATA).unwrap(), 0x20);
    emit_direct("lr-sc-success", &success);

    let mut failure = direct_fixture(
        &[lr, ordinary_store, sc],
        &[(10, DATA), (6, 0x20), (7, 0x30)],
        &[],
    );
    failure.bus.inner.store32(DATA, 0x10).unwrap();
    failure.before_ram = failure.bus.inner.ram().as_bytes().to_vec();
    let mut failure = run_direct(failure, 3, true);
    expect_no_trap(&failure, "lr-sc-overlap-failure");
    assert_eq!(failure.hart.regs.read(5), 1, "SC failure status");
    assert_eq!(failure.bus.inner.load32(DATA).unwrap(), 0x30);
    emit_direct("lr-sc-overlap-failure", &failure);

    let mut align = direct_fixture(&[lr], &[(10, DATA + 2)], &[]);
    align.hart.resv = Some((DATA, 4));
    align.before_hart = align.hart.to_snapshot();
    let align = run_direct(align, 1, true);
    assert_eq!(align.trap.unwrap().cause, Exception::LoadAddrMisaligned);
    assert_eq!(align.trap.unwrap().tval, DATA + 2);
    assert_eq!(
        align.hart.resv,
        Some((DATA, 4)),
        "misaligned LR preserves resv"
    );
    emit_direct("lr-align-trap", &align);

    let mut sc_align = direct_fixture(&[sc], &[(10, DATA + 2), (6, 0x99)], &[]);
    sc_align.hart.resv = Some((DATA + 2, 4));
    sc_align.before_hart = sc_align.hart.to_snapshot();
    let sc_align = run_direct(sc_align, 1, true);
    assert_eq!(sc_align.trap.unwrap().cause, Exception::StoreAddrMisaligned);
    assert_eq!(sc_align.trap.unwrap().tval, DATA + 2);
    assert_eq!(sc_align.hart.resv, Some((DATA + 2, 4)));
    emit_direct("sc-align-trap-preserves-reservation", &sc_align);

    let mut sc_fault = direct_fixture(&[sc], &[(10, BAD), (6, 0x99)], &[]);
    sc_fault.hart.resv = Some((BAD, 4));
    sc_fault.before_hart = sc_fault.hart.to_snapshot();
    let sc_fault = run_direct(sc_fault, 1, true);
    assert_eq!(sc_fault.trap.unwrap().cause, Exception::StoreAccessFault);
    assert_eq!(sc_fault.trap.unwrap().tval, BAD);
    assert_eq!(
        sc_fault.hart.resv, None,
        "SC consumes before fallible store"
    );
    emit_direct("sc-access-fault-consumes-reservation", &sc_fault);

    let add = amo(0b00000, 0b010, 5, 10, 6);
    let mut amo_result = direct_fixture(&[add], &[(10, DATA), (6, 3)], &[]);
    amo_result.bus.inner.store32(DATA, 4).unwrap();
    amo_result.hart.resv = Some((DATA, 4));
    amo_result.before_hart = amo_result.hart.to_snapshot();
    amo_result.before_ram = amo_result.bus.inner.ram().as_bytes().to_vec();
    let mut amo_result = run_direct(amo_result, 1, true);
    expect_no_trap(&amo_result, "amoadd-old-new");
    assert_eq!(amo_result.hart.regs.read(5), 4, "AMO returns old value");
    assert_eq!(
        amo_result.bus.inner.load32(DATA).unwrap(),
        7,
        "AMO stores new value"
    );
    assert_eq!(amo_result.hart.resv, None, "AMO store invalidates overlap");
    emit_direct("amo-old-new", &amo_result);
}

fn report_trap_control() {
    let mut compressed = direct_fixture(&[0x0000_8000], &[], &[]);
    compressed.before_hart = compressed.hart.to_snapshot();
    let compressed = run_direct(compressed, 1, true);
    assert_eq!(
        compressed.trap.unwrap().cause,
        Exception::IllegalInstruction
    );
    assert_eq!(compressed.trap.unwrap().tval, 0x8000, "raw compressed tval");
    assert!(compressed.trace.as_ref().unwrap().records.is_empty());
    emit_direct("raw-compressed-trap-tval", &compressed);

    let words = [
        csrr(1, INSTRET),
        i_type(99, 0, 0, 0, 0x13), // x0 write is suppressed
        branch(8, 3, 3, 0),
        i_type(99, 0, 0, 4, 0x13), // skipped
        csrr(5, INSTRET),
        i_type(1, 5, 0, 6, 0x13),
    ];
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(false);
    for (index, word) in words.iter().enumerate() {
        machine
            .bus_mut()
            .store32(CODE + 4 * index as u64, *word)
            .unwrap();
    }
    machine.hart_mut().regs.pc = CODE;
    machine.hart_mut().regs.write(3, 1);
    let before_hart = machine.hart().to_snapshot();
    let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
    let mut sink = VecSink::new();
    let outcome = machine.run_traced(5, &mut sink);
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.read(0), 0, "x0 stays zero");
    assert_eq!(
        machine.hart().regs.read(1),
        0,
        "first instret read sees reset"
    );
    assert_eq!(machine.hart().regs.read(4), 0, "branch skipped instruction");
    assert_eq!(
        machine.hart().regs.read(5),
        3,
        "second instret read sees 3 retires"
    );
    assert_eq!(
        machine.hart().regs.read(6),
        4,
        "counter advances after read"
    );
    assert_eq!(machine.hart().regs.pc, CODE + 24);
    println!("CASE x0-counter-control-flow");
    let hart_bytes = machine.hart().to_snapshot();
    println!(
        "HART_SNAPSHOT_SHA256={} HART_SNAPSHOT_LEN={}",
        sha256_hex(&hart_bytes),
        hart_bytes.len()
    );
    println!(
        "RAM_SHA256={}",
        sha256_hex(machine.bus_mut().ram().as_bytes())
    );
    println!(
        "RAM_CHANGED={}",
        diff_bytes(&before_ram, machine.bus_mut().ram().as_bytes())
    );
    println!("RESULT={}", outcome_text(outcome));
    println!("RESERVATION={}", reservation(machine.hart()));
    println!("CONTROL_BEFORE_HART_SHA256={}", sha256_hex(&before_hart));
    print_trace(Some(&sink));
    println!("END_CASE");
}

struct ModeResult {
    mode: String,
    before_hart: Vec<u8>,
    before_ram: Vec<u8>,
    hart: Vec<u8>,
    ram: Vec<u8>,
    pc: u64,
    x1: u64,
    x4: u64,
    x5: u64,
    x6: u64,
    outcome: RunOutcome,
    trace: Option<VecSink>,
    uart: Vec<u8>,
    device_hits: Vec<(u64, u64)>,
}

fn run_mode(cache: bool, record: bool) -> ModeResult {
    let console = ConsoleSink::new();
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(cache);
    machine
        .bus_mut()
        .attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(console.clone())),
        )
        .unwrap();
    let words = [
        i_type(0x41, 0, 0, 1, 0x13),
        s_type(0, 1, 2, 0b000, 0x23),
        i_type(1, 0, 0, 3, 0x13),
        branch(8, 3, 3, 0),
        i_type(99, 0, 0, 4, 0x13),
        i_type(0, 0, 0, 0, 0x13),
        i_type(7, 0, 0, 5, 0x13),
        i_type(1, 5, 0, 6, 0x13),
    ];
    for (index, word) in words.iter().enumerate() {
        machine
            .bus_mut()
            .store32(CODE + 4 * index as u64, *word)
            .unwrap();
    }
    machine.hart_mut().regs.pc = CODE;
    machine.hart_mut().regs.write(2, UART0_BASE);
    let before_hart = machine.hart().to_snapshot();
    let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
    let trace = if record {
        let mut sink = VecSink::new();
        let outcome = machine.run_traced(7, &mut sink);
        (outcome, Some(sink))
    } else {
        (machine.run(7), None)
    };
    assert_eq!(trace.0, RunOutcome::MaxInstrs, "mode run outcome");
    assert_eq!(console.captured(), [0x41], "UART ordering/effect");
    assert_eq!(machine.hart().regs.read(0), 0);
    assert_eq!(machine.hart().regs.read(4), 0);
    assert_eq!(machine.hart().regs.read(5), 7);
    assert_eq!(machine.hart().regs.read(6), 8);
    assert_eq!(machine.hart().regs.pc, CODE + 0x20);
    if record {
        assert_eq!(trace.1.as_ref().unwrap().records.len(), 7);
    }
    ModeResult {
        mode: format!(
            "cache={} capture={}",
            if cache { "cached" } else { "ordinary" },
            if record { "recording" } else { "untraced" }
        ),
        before_hart,
        before_ram,
        hart: machine.hart().to_snapshot(),
        ram: machine.bus_mut().ram().as_bytes().to_vec(),
        pc: machine.hart().regs.pc,
        x1: machine.hart().regs.read(1),
        x4: machine.hart().regs.read(4),
        x5: machine.hart().regs.read(5),
        x6: machine.hart().regs.read(6),
        outcome: trace.0,
        trace: trace.1,
        uart: console.captured(),
        device_hits: machine.bus_mut().device_hits(),
    }
}

fn emit_mode(result: &ModeResult) {
    println!("CASE machine-matrix mode={}", result.mode);
    println!(
        "HART_SNAPSHOT_SHA256={} HART_SNAPSHOT_LEN={}",
        sha256_hex(&result.hart),
        result.hart.len()
    );
    println!("RAM_SHA256={}", sha256_hex(&result.ram));
    println!(
        "RAM_CHANGED={}",
        diff_bytes(&result.before_ram, &result.ram)
    );
    println!("RESULT={}", outcome_text(result.outcome));
    println!(
        "REGS=pc:0x{:016x},x1:0x{:016x},x4:0x{:016x},x5:0x{:016x},x6:0x{:016x}",
        result.pc, result.x1, result.x4, result.x5, result.x6
    );
    println!("MMIO_UART_ORDER={}", hex_bytes(&result.uart));
    let hits = result
        .device_hits
        .iter()
        .map(|(base, count)| format!("0x{base:016x}:{count}"))
        .collect::<Vec<_>>()
        .join(",");
    println!("MMIO_DEVICE_HITS={hits}");
    println!(
        "CONTROL_BEFORE_HART_SHA256={}",
        sha256_hex(&result.before_hart)
    );
    print_trace(result.trace.as_ref());
    println!("END_CASE");
}

fn report_machine_matrix() {
    let mut results = Vec::new();
    for cache in [false, true] {
        for record in [false, true] {
            let result = run_mode(cache, record);
            emit_mode(&result);
            results.push(result);
        }
    }
    let first = &results[0];
    for result in &results[1..] {
        assert_eq!(
            result.hart, first.hart,
            "matrix hart parity: {}",
            result.mode
        );
        assert_eq!(result.ram, first.ram, "matrix RAM parity: {}", result.mode);
        assert_eq!(
            result.uart, first.uart,
            "matrix MMIO parity: {}",
            result.mode
        );
        assert_eq!(result.outcome, first.outcome, "matrix outcome parity");
    }
}

fn run_smc_dma(cache: bool) -> ModeResult {
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(cache);
    let old_first = i_type(5, 0, 0, 1, 0x13);
    let old_second = i_type(6, 0, 0, 1, 0x13);
    let new_first = i_type(7, 0, 0, 1, 0x13);
    let new_second = i_type(1, 1, 0, 1, 0x13);
    machine.bus_mut().store32(CROSS, old_first).unwrap();
    machine.bus_mut().store32(CROSS + 4, old_second).unwrap();
    machine.hart_mut().regs.pc = CROSS;
    let before_hart = machine.hart().to_snapshot();
    let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.read(1), 5, "old first instruction");
    // This host-side public bus write models a DMA/device completion: SystemBus arms the
    // same physical-page write log that guest stores use, and Machine drains it at run entry.
    let patched = u64::from(new_first) | (u64::from(new_second) << 32);
    for (offset, byte) in patched.to_le_bytes().iter().copied().enumerate() {
        machine
            .bus_mut()
            .store8(CROSS + offset as u64, byte)
            .unwrap();
    }
    assert_eq!(machine.bus_mut().load32(CROSS).unwrap(), new_first);
    assert_eq!(machine.bus_mut().load32(CROSS + 4).unwrap(), new_second);
    machine.hart_mut().regs.pc = CROSS;
    let mut sink = VecSink::new();
    let outcome = machine.run_traced(2, &mut sink);
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(
        machine.hart().regs.read(1),
        8,
        "cross-page DMA patch took effect"
    );
    ModeResult {
        mode: format!(
            "{} capture=recording",
            if cache { "cached" } else { "ordinary" }
        ),
        before_hart,
        before_ram,
        hart: machine.hart().to_snapshot(),
        ram: machine.bus_mut().ram().as_bytes().to_vec(),
        pc: machine.hart().regs.pc,
        x1: machine.hart().regs.read(1),
        x4: machine.hart().regs.read(4),
        x5: machine.hart().regs.read(5),
        x6: machine.hart().regs.read(6),
        outcome,
        trace: Some(sink),
        uart: Vec::new(),
        device_hits: Vec::new(),
    }
}

fn report_smc_dma() {
    let ordinary = run_smc_dma(false);
    let cached = run_smc_dma(true);
    assert_eq!(ordinary.x1, 8);
    assert_eq!(cached.x1, 8);
    emit_mode(&ordinary);
    emit_mode(&cached);
    println!("SMC_DMA_CROSS_PAGE=0x{CROSS:016x}..0x{:016x}", CROSS + 7);
}

fn main() {
    println!("E5-T26P_BASELINE_V1");
    report_machine_matrix();
    report_scalar_stores();
    report_atomics();
    report_trap_control();
    report_smc_dma();
    println!("E5-T26P_BASELINE_DONE");
}
