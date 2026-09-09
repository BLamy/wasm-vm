//! Bounded E5-T26p evidence producer.
//!
//! This is deliberately an example, rather than a production helper or a test-only
//! accessor.  It uses only the public API that existed at the old E5-T26p baseline so
//! that the same source can be copied into an untouched archive and compared with the
//! candidate.  Assertions are independent architectural expectations; the ordinary /
//! cached and recording / untraced runs are additional parity observations.

use std::cell::RefCell;
use std::fmt::Write as _;
use std::rc::Rc;

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::csr::{INSTRET, MINSTRET};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink as ConsoleSink};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
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
const PROBE_BASE: u64 = 0x1000_1000;
const PROBE_LEN: u64 = 0x100;

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

#[derive(Default)]
struct MmioLog {
    events: Vec<String>,
    read_value: u64,
    fault_reads: bool,
    fault_writes: bool,
}

#[derive(Clone)]
struct PublicMmioRecorder {
    state: Rc<RefCell<MmioLog>>,
}

impl PublicMmioRecorder {
    fn new(state: Rc<RefCell<MmioLog>>) -> Self {
        Self { state }
    }
}

impl MmioDevice for PublicMmioRecorder {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        let mut state = self.state.borrow_mut();
        if state.fault_reads || offset == 0xf0 {
            state
                .events
                .push(format!("R{}@0x{offset:x}=ERR:Access", width.bytes()));
            Err(BusFault::Access)
        } else {
            let value = state.read_value & width.mask();
            state.events.push(format!(
                "R{}@0x{offset:x}=0x{value:0width$x}",
                width.bytes(),
                width = (width.bytes() * 2) as usize
            ));
            Ok(value)
        }
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        let mut state = self.state.borrow_mut();
        if state.fault_writes || offset == 0xf0 {
            state.events.push(format!(
                "W{}@0x{offset:x}<=0x{value:0width$x}:ERR:Access",
                width.bytes(),
                width = (width.bytes() * 2) as usize
            ));
            Err(BusFault::Access)
        } else {
            state.events.push(format!(
                "W{}@0x{offset:x}<=0x{value:0width$x}:OK",
                width.bytes(),
                width = (width.bytes() * 2) as usize
            ));
            Ok(())
        }
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

fn run_direct_fixture_modes<F, V>(name: &str, words: &[u32], setup: F, verify: V)
where
    F: Fn(&mut DirectFixture),
    V: Fn(&mut DirectResult),
{
    for record in [false, true] {
        let mut fixture = direct_fixture(words, &[], &[]);
        setup(&mut fixture);
        fixture.before_hart = fixture.hart.to_snapshot();
        fixture.before_ram = fixture.bus.inner.ram().as_bytes().to_vec();
        let mut result = run_direct(fixture, words.len(), record);
        verify(&mut result);
        emit_direct(
            &format!(
                "{name} direct={}",
                if record { "recording" } else { "unit" }
            ),
            &result,
        );
    }
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

fn jal(imm: i32, rd: u8) -> u32 {
    let value = imm as u32;
    (((value >> 20) & 1) << 31)
        | (((value >> 1) & 0x3ff) << 21)
        | (((value >> 11) & 1) << 20)
        | (((value >> 12) & 0xff) << 12)
        | (u32::from(rd) << 7)
        | 0x6f
}

fn csrr(rd: u8, csr: u16) -> u32 {
    (u32::from(csr) << 20) | (0b010 << 12) | (u32::from(rd) << 7) | 0x73
}

fn csrw(csr: u16, rs1: u8) -> u32 {
    (u32::from(csr) << 20) | (u32::from(rs1) << 15) | (0b001 << 12) | 0x73
}

fn load(funct3: u32, rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, funct3, rd, 0x03)
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
    type StoreCase = (
        &'static str,
        u32,
        &'static [(u8, u64)],
        &'static [(u8, u64)],
        u64,
        &'static [u8],
        Option<(u64, u8)>,
        Option<(u64, u8)>,
    );
    let cases: &[StoreCase] = &[
        (
            "scalar-sb-overlap",
            s_type(2, 3, 2, 0b000, 0x23),
            &[(2, DATA), (3, 0x1122_3344_5566_77ab)],
            &[][..],
            DATA + 2,
            &[0xab][..],
            Some((DATA, 4)),
            None,
        ),
        (
            "scalar-sh-nonoverlap",
            s_type(8, 3, 2, 0b001, 0x23),
            &[(2, DATA), (3, 0x1122_3344_5566_beef)],
            &[][..],
            DATA + 8,
            &[0xef, 0xbe][..],
            Some((DATA, 2)),
            Some((DATA, 2)),
        ),
        (
            "scalar-sw-cross-page",
            s_type(0, 3, 2, 0b010, 0x23),
            &[(2, CROSS_SCALAR), (3, 0xdead_beef)],
            &[][..],
            CROSS_SCALAR,
            &[0xef, 0xbe, 0xad, 0xde][..],
            Some((DATA, 4)),
            Some((DATA, 4)),
        ),
        (
            "scalar-sd-nonoverlap",
            s_type(16, 3, 2, 0b011, 0x23),
            &[(2, DATA), (3, 0x0123_4567_89ab_cdef)],
            &[][..],
            DATA + 16,
            &[0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01][..],
            Some((DATA, 8)),
            Some((DATA, 8)),
        ),
        (
            "fp-fsw-overlap",
            s_type(2, 1, 2, 0b010, 0x27),
            &[(2, DATA)],
            &[(1, 0xffff_ffff_3f80_0000)],
            DATA + 2,
            &[0x00, 0x00, 0x80, 0x3f][..],
            Some((DATA, 8)),
            None,
        ),
        (
            "fp-fsd-nonoverlap",
            s_type(16, 1, 2, 0b011, 0x27),
            &[(2, DATA)],
            &[(1, 0x0123_4567_89ab_cdef)],
            DATA + 16,
            &[0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01][..],
            Some((DATA, 8)),
            Some((DATA, 8)),
        ),
    ];
    // Every store width gets both outcomes, including the opposite reservation
    // relationship from the named initial case. Seed only aligned LR-sized granules.
    let variants = cases.iter().flat_map(
        |&(name, word, xseed, fseed, address, expected, initial_resv, final_resv)| {
            let alternate = if final_resv.is_none() {
                Some(((address + 16) & !7, 8))
            } else {
                Some((address & !7, 8))
            };
            [
                (
                    name.to_owned(),
                    word,
                    xseed,
                    fseed,
                    address,
                    expected,
                    initial_resv,
                    final_resv,
                ),
                (
                    format!("{name}-opposite-reservation"),
                    word,
                    xseed,
                    fseed,
                    address,
                    expected,
                    alternate,
                    if final_resv.is_none() {
                        alternate
                    } else {
                        None
                    },
                ),
            ]
        },
    );
    for (name, word, xseed, fseed, address, expected, initial_resv, final_resv) in variants {
        let name = name.as_str();
        for record in [false, true] {
            let mut fixture = direct_fixture(&[word], xseed, fseed);
            fixture.hart.csr.mstatus |= 1 << 13;
            fixture.hart.resv = initial_resv;
            fixture.before_hart = fixture.hart.to_snapshot();
            fixture
                .bus
                .inner
                .ram_mut()
                .write_slice(DATA, &[0xaa; 32])
                .unwrap();
            fixture.before_ram = fixture.bus.inner.ram().as_bytes().to_vec();
            let result = run_direct(fixture, 1, record);
            expect_no_trap(&result, name);
            let ram = result.bus.inner.ram().as_bytes();
            let start = (address - DRAM_BASE) as usize;
            assert_eq!(&ram[start..start + expected.len()], expected, "{name}");
            assert_eq!(result.hart.resv, final_resv, "{name}: reservation");
            if name == "scalar-sb-overlap" {
                assert_eq!(ram[start + 1], 0xaa, "SB wrote beyond its one byte");
                assert_eq!(result.hart.regs.read(0), 0, "x0 changed");
            }
            emit_direct(
                &format!(
                    "{name} direct={}",
                    if record { "recording" } else { "unit" }
                ),
                &result,
            );
        }

        let machine_results = run_machine_fixture(
            name,
            &[word],
            1,
            |machine| {
                machine.hart_mut().csr.mstatus |= 1 << 13;
                machine.hart_mut().resv = initial_resv;
                for &(reg, value) in xseed {
                    machine.hart_mut().regs.write(reg, value);
                }
                for &(reg, value) in fseed {
                    machine.hart_mut().fregs.write_raw(reg, value);
                }
                machine
                    .bus_mut()
                    .ram_mut()
                    .write_slice(DATA, &[0xaa; 32])
                    .unwrap();
            },
            |machine, outcome, _mmio| {
                assert_eq!(outcome, RunOutcome::MaxInstrs, "{name}: outcome");
                let ram = machine.bus_mut().ram().as_bytes().to_vec();
                let start = (address - DRAM_BASE) as usize;
                assert_eq!(&ram[start..start + expected.len()], expected, "{name}");
                assert_eq!(machine.hart().resv, final_resv, "{name}: reservation");
            },
        );
        assert_eq!(machine_results.len(), 4);
    }

    for (name, funct3, expected, fstore) in [
        ("scalar-fault-sd", 0b011, Exception::StoreAccessFault, false),
        ("fp-fault-fsd", 0b011, Exception::StoreAccessFault, true),
    ] {
        let word = if fstore {
            s_type(0, 1, 1, funct3, 0x27)
        } else {
            s_type(0, 3, 1, funct3, 0x23)
        };
        for record in [false, true] {
            let mut fixture = direct_fixture(
                &[word],
                &[(1, BAD), (3, 0x0123_4567_89ab_cdef)],
                &[(1, 0x0123_4567_89ab_cdef)],
            );
            if fstore {
                fixture.hart.csr.mstatus |= 1 << 13;
            }
            fixture.hart.resv = Some((DATA, 8));
            fixture.before_hart = fixture.hart.to_snapshot();
            let result = run_direct(fixture, 1, record);
            assert_eq!(result.trap.unwrap().cause, expected, "{name}");
            assert_eq!(result.trap.unwrap().tval, BAD, "{name} tval");
            assert_eq!(result.hart.resv, Some((DATA, 8)), "{name} reservation");
            emit_direct(
                &format!(
                    "{name} direct={}",
                    if record { "recording" } else { "unit" }
                ),
                &result,
            );
        }
        run_machine_fixture(
            name,
            &[word],
            1,
            |machine| {
                if fstore {
                    machine.hart_mut().csr.mstatus |= 1 << 13;
                    machine.hart_mut().fregs.write_raw(1, 0x0123_4567_89ab_cdef);
                }
                machine.hart_mut().regs.write(1, BAD);
                machine.hart_mut().regs.write(3, 0x0123_4567_89ab_cdef);
                machine.hart_mut().resv = Some((DATA, 8));
            },
            |machine, outcome, _mmio| {
                assert_eq!(
                    outcome,
                    RunOutcome::Trapped(Trap {
                        cause: expected,
                        tval: BAD
                    })
                );
                assert_eq!(machine.hart().resv, Some((DATA, 8)), "{name} reservation");
            },
        );
    }
}

fn report_atomics() {
    let lr = amo(0b00010, 0b010, 5, 10, 0);
    let sc = amo(0b00011, 0b010, 5, 10, 6);
    let ordinary_store = s_type(0, 7, 10, 0b010, 0x23);
    let lr_d = amo(0b00010, 0b011, 5, 10, 0);
    let sc_d = amo(0b00011, 0b011, 5, 10, 6);
    let ordinary_store_d = s_type(0, 7, 10, 0b011, 0x23);
    let add_w = amo(0b00000, 0b010, 5, 10, 6);
    let add_d = amo(0b00000, 0b011, 5, 10, 6);

    for (name, words, width, value, new_value) in [
        ("lr-sc-success", vec![lr, sc], 4u8, 0x20u64, 0x20u64),
        ("lr-sc-d-success", vec![lr_d, sc_d], 8, 0x20, 0x20),
    ] {
        run_direct_fixture_modes(
            name,
            &words,
            |fixture| {
                fixture.hart.regs.write(10, DATA);
                fixture.hart.regs.write(6, value);
                if width == 4 {
                    fixture.bus.inner.store32(DATA, 0x10).unwrap();
                } else {
                    fixture.bus.inner.store64(DATA, 0x10).unwrap();
                }
            },
            |result| {
                expect_no_trap(result, name);
                assert_eq!(result.hart.regs.read(5), 0);
                assert_eq!(result.hart.resv, None);
                let actual = if width == 4 {
                    result.bus.inner.load32(DATA).unwrap() as u64
                } else {
                    result.bus.inner.load64(DATA).unwrap()
                };
                assert_eq!(actual, new_value);
            },
        );
        run_machine_fixture(
            name,
            &words,
            2,
            |machine| {
                machine.hart_mut().regs.write(10, DATA);
                machine.hart_mut().regs.write(6, value);
                if width == 4 {
                    machine.bus_mut().store32(DATA, 0x10).unwrap();
                } else {
                    machine.bus_mut().store64(DATA, 0x10).unwrap();
                }
            },
            |machine, outcome, _| {
                assert_eq!(outcome, RunOutcome::MaxInstrs);
                assert_eq!(machine.hart().regs.read(5), 0);
                assert_eq!(machine.hart().resv, None);
                let actual = if width == 4 {
                    machine.bus_mut().load32(DATA).unwrap() as u64
                } else {
                    machine.bus_mut().load64(DATA).unwrap()
                };
                assert_eq!(actual, new_value);
            },
        );
    }

    for (name, words, width, intervening, expected) in [
        (
            "lr-sc-overlap-failure",
            vec![lr, ordinary_store, sc],
            4u8,
            ordinary_store,
            0x30u64,
        ),
        (
            "lr-sc-d-overlap-failure",
            vec![lr_d, ordinary_store_d, sc_d],
            8,
            ordinary_store_d,
            0x30,
        ),
    ] {
        let _ = intervening;
        run_direct_fixture_modes(
            name,
            &words,
            |fixture| {
                fixture.hart.regs.write(10, DATA);
                fixture.hart.regs.write(6, 0x20);
                fixture.hart.regs.write(7, 0x30);
                if width == 4 {
                    fixture.bus.inner.store32(DATA, 0x10).unwrap();
                } else {
                    fixture.bus.inner.store64(DATA, 0x10).unwrap();
                }
            },
            |result| {
                expect_no_trap(result, name);
                assert_eq!(result.hart.regs.read(5), 1);
                let actual = if width == 4 {
                    result.bus.inner.load32(DATA).unwrap() as u64
                } else {
                    result.bus.inner.load64(DATA).unwrap()
                };
                assert_eq!(actual, expected);
            },
        );
        run_machine_fixture(
            name,
            &words,
            3,
            |machine| {
                machine.hart_mut().regs.write(10, DATA);
                machine.hart_mut().regs.write(6, 0x20);
                machine.hart_mut().regs.write(7, 0x30);
                if width == 4 {
                    machine.bus_mut().store32(DATA, 0x10).unwrap();
                } else {
                    machine.bus_mut().store64(DATA, 0x10).unwrap();
                }
            },
            |machine, outcome, _| {
                assert_eq!(outcome, RunOutcome::MaxInstrs);
                assert_eq!(machine.hart().regs.read(5), 1);
                let actual = if width == 4 {
                    machine.bus_mut().load32(DATA).unwrap() as u64
                } else {
                    machine.bus_mut().load64(DATA).unwrap()
                };
                assert_eq!(actual, expected);
            },
        );
    }

    for (name, words, addr, resv, cause, tval) in [
        (
            "lr-align-trap",
            vec![lr],
            DATA + 2,
            Some((DATA, 4)),
            Exception::LoadAddrMisaligned,
            DATA + 2,
        ),
        (
            "lr-d-align-trap",
            vec![lr_d],
            DATA + 2,
            Some((DATA, 8)),
            Exception::LoadAddrMisaligned,
            DATA + 2,
        ),
        (
            "sc-align-trap-preserves-reservation",
            vec![sc],
            DATA + 2,
            Some((DATA + 2, 4)),
            Exception::StoreAddrMisaligned,
            DATA + 2,
        ),
        (
            "sc-d-align-trap-preserves-reservation",
            vec![sc_d],
            DATA + 2,
            Some((DATA + 2, 8)),
            Exception::StoreAddrMisaligned,
            DATA + 2,
        ),
    ] {
        run_direct_fixture_modes(
            name,
            &words,
            |fixture| {
                fixture.hart.regs.write(10, addr);
                fixture.hart.regs.write(6, 0x99);
                fixture.hart.resv = resv;
            },
            |result| {
                let trap = result.trap.unwrap();
                assert_eq!(trap.cause, cause);
                assert_eq!(trap.tval, tval);
                assert_eq!(result.hart.resv, resv);
            },
        );
        run_machine_fixture(
            name,
            &words,
            1,
            |machine| {
                machine.hart_mut().regs.write(10, addr);
                machine.hart_mut().regs.write(6, 0x99);
                machine.hart_mut().resv = resv;
            },
            |machine, outcome, _| {
                assert_eq!(outcome, RunOutcome::Trapped(Trap { cause, tval }));
                assert_eq!(machine.hart().resv, resv);
            },
        );
    }

    for (name, word, width, address, reservation_after) in [
        ("sc-access-fault-consumes-reservation", sc, 4u8, BAD, None),
        ("sc-d-access-fault-consumes-reservation", sc_d, 8, BAD, None),
    ] {
        run_direct_fixture_modes(
            name,
            &[word],
            |fixture| {
                fixture.hart.regs.write(10, address);
                fixture.hart.regs.write(6, 0x99);
                fixture.hart.resv = Some((address, width));
            },
            |result| {
                let trap = result.trap.unwrap();
                assert_eq!(trap.cause, Exception::StoreAccessFault);
                assert_eq!(trap.tval, BAD);
                assert_eq!(result.hart.resv, reservation_after);
            },
        );
        run_machine_fixture(
            name,
            &[word],
            1,
            |machine| {
                machine.hart_mut().regs.write(10, address);
                machine.hart_mut().regs.write(6, 0x99);
                machine.hart_mut().resv = Some((address, width));
            },
            |machine, outcome, _| {
                assert_eq!(
                    outcome,
                    RunOutcome::Trapped(Trap {
                        cause: Exception::StoreAccessFault,
                        tval: BAD,
                    })
                );
                assert_eq!(machine.hart().resv, reservation_after);
            },
        );
    }

    for (base_name, word, width, old, rhs, new_value) in [
        ("amo-w-old-new", add_w, 4u8, 4u64, 3u64, 7u64),
        ("amo-w-sign-extended-old", add_w, 4, 0xffff_fffe, 3, 1),
        ("amo-d-old-new", add_d, 8, 0x40, 3, 0x43),
    ] {
        for overlap in [false, true] {
            let name_owned = format!("{base_name}-overlap={overlap}");
            let name = name_owned.as_str();
            let initial_resv = Some((if overlap { DATA } else { DATA + 16 }, width));
            let final_resv = if overlap { None } else { initial_resv };
            let expected_rd = if width == 4 {
                old as u32 as i32 as i64 as u64
            } else {
                old
            };
            run_direct_fixture_modes(
                name,
                &[word],
                |fixture| {
                    fixture.hart.regs.write(10, DATA);
                    fixture.hart.regs.write(6, rhs);
                    fixture.hart.resv = initial_resv;
                    if width == 4 {
                        fixture.bus.inner.store32(DATA, old as u32).unwrap();
                    } else {
                        fixture.bus.inner.store64(DATA, old).unwrap();
                    }
                },
                |result| {
                    expect_no_trap(result, name);
                    assert_eq!(result.hart.regs.read(5), expected_rd);
                    assert_eq!(result.hart.resv, final_resv);
                    let actual = if width == 4 {
                        result.bus.inner.load32(DATA).unwrap() as u64
                    } else {
                        result.bus.inner.load64(DATA).unwrap()
                    };
                    assert_eq!(actual, new_value);
                },
            );
            run_machine_fixture(
                name,
                &[word],
                1,
                |machine| {
                    machine.hart_mut().regs.write(10, DATA);
                    machine.hart_mut().regs.write(6, rhs);
                    machine.hart_mut().resv = initial_resv;
                    if width == 4 {
                        machine.bus_mut().store32(DATA, old as u32).unwrap();
                    } else {
                        machine.bus_mut().store64(DATA, old).unwrap();
                    }
                },
                |machine, outcome, _| {
                    assert_eq!(outcome, RunOutcome::MaxInstrs);
                    assert_eq!(machine.hart().regs.read(5), expected_rd);
                    assert_eq!(machine.hart().resv, final_resv);
                    let actual = if width == 4 {
                        machine.bus_mut().load32(DATA).unwrap() as u64
                    } else {
                        machine.bus_mut().load64(DATA).unwrap()
                    };
                    assert_eq!(actual, new_value);
                },
            );
        }
    }

    for (name, word, width, cause, tval) in [
        (
            "lr-access-fault-preserves-reservation",
            lr,
            4u8,
            Exception::LoadAccessFault,
            BAD,
        ),
        (
            "lr-d-access-fault-preserves-reservation",
            lr_d,
            8,
            Exception::LoadAccessFault,
            BAD,
        ),
        (
            "amo-access-fault-preserves-reservation",
            add_w,
            4,
            Exception::StoreAccessFault,
            BAD,
        ),
        (
            "amo-d-access-fault-preserves-reservation",
            add_d,
            8,
            Exception::StoreAccessFault,
            BAD,
        ),
    ] {
        run_machine_fixture(
            name,
            &[word],
            1,
            |machine| {
                machine.hart_mut().regs.write(10, BAD);
                machine.hart_mut().regs.write(6, 1);
                machine.hart_mut().resv = Some((DATA, width));
            },
            |machine, outcome, _| {
                assert_eq!(outcome, RunOutcome::Trapped(Trap { cause, tval }));
                assert_eq!(machine.hart().resv, Some((DATA, width)));
            },
        );
    }
}

fn report_trap_control() {
    run_direct_fixture_modes(
        "raw-compressed-trap-tval",
        &[0x0000_8000],
        |_| {},
        |result| {
            let trap = result.trap.unwrap();
            assert_eq!(trap.cause, Exception::IllegalInstruction);
            assert_eq!(trap.tval, 0x8000);
            assert!(result.trace.is_none() || result.trace.as_ref().unwrap().records.is_empty());
        },
    );
    run_machine_fixture(
        "raw-compressed-trap-tval",
        &[0x0000_8000],
        1,
        |_| {},
        |machine, outcome, _| {
            assert_eq!(
                outcome,
                RunOutcome::Trapped(Trap {
                    cause: Exception::IllegalInstruction,
                    tval: 0x8000,
                })
            );
            assert_eq!(machine.hart().regs.pc, CODE);
        },
    );

    let words = [
        csrr(1, INSTRET),
        csrw(MINSTRET, 5),
        csrr(6, MINSTRET),
        i_type(99, 0, 0, 0, 0x13),
        branch(8, 3, 3, 0),
        i_type(99, 0, 0, 4, 0x13),
        csrr(7, MINSTRET),
        i_type(1, 7, 0, 8, 0x13),
    ];
    run_machine_fixture(
        "x0-counter-write-control-flow",
        &words,
        7,
        |machine| {
            machine.hart_mut().regs.write(3, 1);
            machine.hart_mut().regs.write(5, 100);
        },
        |machine, outcome, _| {
            assert_eq!(outcome, RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(0), 0);
            assert_eq!(machine.hart().regs.read(1), 0);
            assert_eq!(machine.hart().regs.read(4), 0);
            assert_eq!(machine.hart().regs.read(6), 100);
            assert_eq!(machine.hart().regs.read(7), 103);
            assert_eq!(machine.hart().regs.read(8), 104);
            assert_eq!(machine.hart().regs.pc, CODE + 32);
        },
    );
}

struct ModeResult {
    case: String,
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
    x7: u64,
    x8: u64,
    outcome: RunOutcome,
    trace: Option<VecSink>,
    uart: Vec<u8>,
    device_hits: Vec<(u64, u64)>,
    mmio: Vec<String>,
}

fn run_mode(cache: bool, record: bool) -> ModeResult {
    let console = ConsoleSink::new();
    let mmio_state = Rc::new(RefCell::new(MmioLog {
        read_value: 0x8877_6655_4433_2211,
        ..MmioLog::default()
    }));
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(cache);
    machine
        .bus_mut()
        .attach(
            PROBE_BASE,
            PROBE_LEN,
            Box::new(PublicMmioRecorder::new(mmio_state.clone())),
        )
        .unwrap();
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
    let mmio = mmio_state.borrow().events.clone();
    ModeResult {
        case: "machine-matrix".to_owned(),
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
        x7: machine.hart().regs.read(7),
        x8: machine.hart().regs.read(8),
        outcome: trace.0,
        trace: trace.1,
        uart: console.captured(),
        device_hits: machine.bus_mut().device_hits(),
        mmio,
    }
}

fn mode_label(cache: bool, record: bool) -> String {
    format!(
        "cache={} capture={}",
        if cache { "cached" } else { "ordinary" },
        if record { "recording" } else { "untraced" }
    )
}

fn capture_mode_result(
    case: &str,
    mode: (bool, bool),
    mut machine: Machine,
    before: (Vec<u8>, Vec<u8>),
    outcome: RunOutcome,
    trace: Option<VecSink>,
    io: (Vec<u8>, Vec<String>),
) -> ModeResult {
    let (cache, record) = mode;
    let (before_hart, before_ram) = before;
    let (uart, mmio) = io;
    let hart = machine.hart().to_snapshot();
    let ram = machine.bus_mut().ram().as_bytes().to_vec();
    ModeResult {
        case: case.to_owned(),
        mode: mode_label(cache, record),
        before_hart,
        before_ram,
        hart,
        ram,
        pc: machine.hart().regs.pc,
        x1: machine.hart().regs.read(1),
        x4: machine.hart().regs.read(4),
        x5: machine.hart().regs.read(5),
        x6: machine.hart().regs.read(6),
        x7: machine.hart().regs.read(7),
        x8: machine.hart().regs.read(8),
        outcome,
        trace,
        uart,
        device_hits: machine.bus_mut().device_hits(),
        mmio,
    }
}

fn run_machine_fixture<F, V>(
    case: &str,
    words: &[u32],
    budget: u64,
    setup: F,
    verify: V,
) -> Vec<ModeResult>
where
    F: Fn(&mut Machine),
    V: Fn(&mut Machine, RunOutcome, &[String]),
{
    let mut results = Vec::new();
    for cache in [false, true] {
        for record in [false, true] {
            let mmio_state = Rc::new(RefCell::new(MmioLog {
                read_value: 0x8877_6655_4433_2211,
                ..MmioLog::default()
            }));
            let console = ConsoleSink::new();
            let mut machine = Machine::new(RAM_BYTES);
            machine.set_jit(false);
            machine.set_block_cache(cache);
            machine
                .bus_mut()
                .attach(
                    PROBE_BASE,
                    PROBE_LEN,
                    Box::new(PublicMmioRecorder::new(mmio_state.clone())),
                )
                .unwrap();
            machine
                .bus_mut()
                .attach(
                    UART0_BASE,
                    UART0_LEN,
                    Box::new(Uart0Stub::new(console.clone())),
                )
                .unwrap();
            for (index, word) in words.iter().enumerate() {
                machine
                    .bus_mut()
                    .store32(CODE + 4 * index as u64, *word)
                    .unwrap();
            }
            machine.hart_mut().regs.pc = CODE;
            setup(&mut machine);
            let before_hart = machine.hart().to_snapshot();
            let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
            let (outcome, trace) = if record {
                let mut sink = VecSink::new();
                let outcome = machine.run_traced(budget, &mut sink);
                (outcome, Some(sink))
            } else {
                (machine.run(budget), None)
            };
            let mmio = mmio_state.borrow().events.clone();
            verify(&mut machine, outcome, &mmio);
            let result = capture_mode_result(
                case,
                (cache, record),
                machine,
                (before_hart, before_ram),
                outcome,
                trace,
                (console.captured(), mmio),
            );
            emit_mode(&result);
            results.push(result);
        }
    }
    let first = &results[0];
    for result in &results[1..] {
        assert_eq!(
            result.hart, first.hart,
            "{case}: hart parity {}",
            result.mode
        );
        assert_eq!(result.ram, first.ram, "{case}: RAM parity {}", result.mode);
        assert_eq!(
            result.mmio, first.mmio,
            "{case}: MMIO parity {}",
            result.mode
        );
        assert_eq!(result.outcome, first.outcome, "{case}: outcome parity");
    }
    results
}

fn emit_mode(result: &ModeResult) {
    println!("CASE {} mode={}", result.case, result.mode);
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
        "REGS=pc:0x{:016x},x1:0x{:016x},x4:0x{:016x},x5:0x{:016x},x6:0x{:016x},x7:0x{:016x},x8:0x{:016x}",
        result.pc, result.x1, result.x4, result.x5, result.x6, result.x7, result.x8
    );
    println!("MMIO_UART_ORDER={}", hex_bytes(&result.uart));
    let hits = result
        .device_hits
        .iter()
        .map(|(base, count)| format!("0x{base:016x}:{count}"))
        .collect::<Vec<_>>()
        .join(",");
    println!("MMIO_DEVICE_HITS={hits}");
    println!("MMIO_ORDER={}", result.mmio.join(","));
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

fn run_smc_dma(cache: bool, record: bool) -> ModeResult {
    let mmio_state = Rc::new(RefCell::new(MmioLog {
        read_value: 0x8877_6655_4433_2211,
        ..MmioLog::default()
    }));
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(cache);
    machine
        .bus_mut()
        .attach(
            PROBE_BASE,
            PROBE_LEN,
            Box::new(PublicMmioRecorder::new(mmio_state.clone())),
        )
        .unwrap();
    let old_first = i_type(5, 0, 0, 1, 0x13);
    let old_second = i_type(6, 0, 0, 1, 0x13);
    let new_first = i_type(7, 0, 0, 1, 0x13);
    let new_second = i_type(1, 1, 0, 1, 0x13);
    machine.bus_mut().store32(CROSS, old_first).unwrap();
    machine.bus_mut().store32(CROSS + 4, old_second).unwrap();
    machine.hart_mut().regs.pc = CROSS;
    let before_hart = machine.hart().to_snapshot();
    let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
    let mut trace = record.then(VecSink::new);
    let first = match trace.as_mut() {
        Some(sink) => machine.run_traced(1, sink),
        None => machine.run(1),
    };
    assert_eq!(first, RunOutcome::MaxInstrs);
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
    let outcome = match trace.as_mut() {
        Some(sink) => machine.run_traced(2, sink),
        None => machine.run(2),
    };
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(
        machine.hart().regs.read(1),
        8,
        "cross-page DMA patch took effect"
    );
    let mmio = mmio_state.borrow().events.clone();
    capture_mode_result(
        "smc-dma-host",
        (cache, record),
        machine,
        (before_hart, before_ram),
        outcome,
        trace,
        (Vec::new(), mmio),
    )
}

fn run_guest_smc(cache: bool, record: bool) -> ModeResult {
    let mmio_state = Rc::new(RefCell::new(MmioLog {
        read_value: 0x8877_6655_4433_2211,
        ..MmioLog::default()
    }));
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_jit(false);
    machine.set_block_cache(cache);
    machine
        .bus_mut()
        .attach(
            PROBE_BASE,
            PROBE_LEN,
            Box::new(PublicMmioRecorder::new(mmio_state.clone())),
        )
        .unwrap();
    let old_first = i_type(5, 0, 0, 1, 0x13);
    let old_return = jal((CODE as i64 - (CROSS + 4) as i64) as i32, 0);
    let new_first = i_type(7, 0, 0, 1, 0x13);
    let new_second = i_type(1, 1, 0, 1, 0x13);
    let patched = u64::from(new_first) | (u64::from(new_second) << 32);
    let words = [
        s_type(0, 3, 2, 0b011, 0x23),
        jal((CROSS as i64 - (CODE + 4) as i64) as i32, 0),
    ];
    for (index, word) in words.iter().enumerate() {
        machine
            .bus_mut()
            .store32(CODE + 4 * index as u64, *word)
            .unwrap();
    }
    machine.bus_mut().store32(CROSS, old_first).unwrap();
    machine.bus_mut().store32(CROSS + 4, old_return).unwrap();
    machine.hart_mut().regs.pc = CROSS;
    machine.hart_mut().regs.write(2, CROSS);
    machine.hart_mut().regs.write(3, patched);
    let before_hart = machine.hart().to_snapshot();
    let before_ram = machine.bus_mut().ram().as_bytes().to_vec();
    let mut trace = record.then(VecSink::new);
    let warm = match trace.as_mut() {
        Some(sink) => machine.run_traced(2, sink),
        None => machine.run(2),
    };
    assert_eq!(warm, RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.read(1), 5, "SMC warm old instruction");
    let outcome = match trace.as_mut() {
        Some(sink) => machine.run_traced(4, sink),
        None => machine.run(4),
    };
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(machine.hart().regs.read(1), 8, "guest SMC patch");
    assert_eq!(machine.bus_mut().load32(CROSS).unwrap(), new_first);
    assert_eq!(machine.bus_mut().load32(CROSS + 4).unwrap(), new_second);
    let mmio = mmio_state.borrow().events.clone();
    capture_mode_result(
        "smc-guest-cross-page",
        (cache, record),
        machine,
        (before_hart, before_ram),
        outcome,
        trace,
        (Vec::new(), mmio),
    )
}

fn report_smc_dma() {
    let mut dma_results = Vec::new();
    let mut guest_results = Vec::new();
    for cache in [false, true] {
        for record in [false, true] {
            let dma = run_smc_dma(cache, record);
            assert_eq!(dma.x1, 8);
            emit_mode(&dma);
            dma_results.push(dma);
            let guest = run_guest_smc(cache, record);
            assert_eq!(guest.x1, 8);
            emit_mode(&guest);
            guest_results.push(guest);
        }
    }
    for result in dma_results.iter().skip(1) {
        assert_eq!(result.hart, dma_results[0].hart);
        assert_eq!(result.ram, dma_results[0].ram);
    }
    for result in guest_results.iter().skip(1) {
        assert_eq!(result.hart, guest_results[0].hart);
        assert_eq!(result.ram, guest_results[0].ram);
    }
    println!("SMC_DMA_CROSS_PAGE=0x{CROSS:016x}..0x{:016x}", CROSS + 7);
}

fn report_mmio_recorder() {
    let words = [
        s_type(0, 3, 2, 0b000, 0x23),
        s_type(2, 3, 2, 0b001, 0x23),
        s_type(4, 3, 2, 0b010, 0x23),
        s_type(8, 3, 2, 0b011, 0x23),
        load(0b000, 4, 2, 0),
    ];
    run_machine_fixture(
        "mmio-recorder-width-order",
        &words,
        5,
        |machine| {
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().regs.write(3, 0x8877_6655_4433_2211);
        },
        |machine, outcome, mmio| {
            assert_eq!(outcome, RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(4), 0x11);
            assert_eq!(
                mmio,
                [
                    "W1@0x0<=0x11:OK",
                    "W2@0x2<=0x2211:OK",
                    "W4@0x4<=0x44332211:OK",
                    "W8@0x8<=0x8877665544332211:OK",
                    "R1@0x0=0x11",
                ]
            );
        },
    );

    let fp_words = [s_type(0, 1, 2, 0b010, 0x27), s_type(8, 1, 2, 0b011, 0x27)];
    run_machine_fixture(
        "mmio-recorder-fp-widths",
        &fp_words,
        2,
        |machine| {
            machine.hart_mut().csr.mstatus |= 1 << 13;
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().fregs.write_raw(1, 0x8877_6655_4433_2211);
        },
        |_machine, outcome, mmio| {
            assert_eq!(outcome, RunOutcome::MaxInstrs);
            assert_eq!(
                mmio,
                ["W4@0x0<=0x44332211:OK", "W8@0x8<=0x8877665544332211:OK",]
            );
        },
    );

    let lr_sc_words = [amo(0b00010, 0b010, 5, 2, 0), amo(0b00011, 0b010, 5, 2, 6)];
    run_machine_fixture(
        "mmio-recorder-lr-sc",
        &lr_sc_words,
        2,
        |machine| {
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().regs.write(6, 0x99);
        },
        |machine, outcome, mmio| {
            assert_eq!(outcome, RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(5), 0);
            assert_eq!(mmio, ["R4@0x0=0x44332211", "W4@0x0<=0x00000099:OK",]);
        },
    );

    let amo_words = [amo(0b00000, 0b010, 5, 2, 6)];
    run_machine_fixture(
        "mmio-recorder-amo",
        &amo_words,
        1,
        |machine| {
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().regs.write(6, 3);
        },
        |machine, outcome, mmio| {
            assert_eq!(outcome, RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(5), 0x4433_2211);
            assert_eq!(mmio, ["R4@0x0=0x44332211", "W4@0x0<=0x44332214:OK",]);
        },
    );

    let fault_word = s_type(0xf0, 3, 2, 0b010, 0x23);
    run_machine_fixture(
        "mmio-recorder-fault",
        &[fault_word],
        1,
        |machine| {
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().regs.write(3, 0xdead_beef);
            machine.hart_mut().resv = Some((DATA, 4));
        },
        |machine, outcome, mmio| {
            assert_eq!(
                outcome,
                RunOutcome::Trapped(Trap {
                    cause: Exception::StoreAccessFault,
                    tval: PROBE_BASE + 0xf0,
                })
            );
            assert_eq!(machine.hart().resv, Some((DATA, 4)));
            assert_eq!(mmio, ["W4@0xf0<=0xdeadbeef:ERR:Access"]);
        },
    );

    let read_fault_word = load(0b010, 4, 2, 0xf0);
    run_machine_fixture(
        "mmio-recorder-read-fault",
        &[read_fault_word],
        1,
        |machine| {
            machine.hart_mut().regs.write(2, PROBE_BASE);
            machine.hart_mut().resv = Some((DATA, 4));
        },
        |machine, outcome, mmio| {
            assert_eq!(
                outcome,
                RunOutcome::Trapped(Trap {
                    cause: Exception::LoadAccessFault,
                    tval: PROBE_BASE + 0xf0,
                })
            );
            assert_eq!(machine.hart().resv, Some((DATA, 4)));
            assert_eq!(mmio, ["R4@0xf0=ERR:Access"]);
        },
    );
}

fn report_pmp_faulting_overlaps() {
    for (kind, opcode, widths) in [
        ("scalar", 0x23, &[0u32, 1, 2, 3][..]),
        ("fp", 0x27, &[2u32, 3][..]),
    ] {
        for &funct3 in widths {
            let word = s_type(0, 3, 2, funct3, opcode);
            let name = format!("{kind}-pmp-fault-overlap-width={}", 1u8 << funct3);
            run_machine_fixture(
                &name,
                &[word],
                1,
                |machine| {
                    let hart = machine.hart_mut();
                    hart.regs.write(2, DATA);
                    hart.regs.write(3, 0x8877_6655_4433_2211);
                    hart.fregs.write_raw(3, 0x8877_6655_4433_2211);
                    hart.resv = Some((DATA, 8));
                    // M-mode fetch still succeeds; MPRV uses S privilege for data,
                    // with no PMP grants. The fault overlaps the live reservation.
                    hart.csr.mstatus =
                        (hart.csr.mstatus & !(3 << 11)) | (1 << 11) | (1 << 13) | (1 << 17);
                },
                |machine, outcome, mmio| {
                    assert_eq!(
                        outcome,
                        RunOutcome::Trapped(Trap {
                            cause: Exception::StoreAccessFault,
                            tval: DATA,
                        })
                    );
                    assert_eq!(machine.hart().resv, Some((DATA, 8)));
                    assert_eq!(machine.hart().regs.pc, CODE);
                    assert_eq!(machine.hart_mut().csr.read(MINSTRET), 0);
                    assert_eq!(&machine.bus_mut().ram().as_bytes()[0x2000..0x2008], &[0; 8]);
                    assert!(mmio.is_empty());
                },
            );
        }
    }
}

pub fn main() {
    println!("E5-T26P_BASELINE_V1");
    report_machine_matrix();
    report_scalar_stores();
    report_atomics();
    report_trap_control();
    report_mmio_recorder();
    report_pmp_faulting_overlaps();
    report_smc_dma();
    println!("E5-T26P_BASELINE_DONE");
}
