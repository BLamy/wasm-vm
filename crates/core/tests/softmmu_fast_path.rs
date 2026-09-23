//! Softmmu fast path (perf overhaul): differential proof that the hart's fast TLB is
//! behaviourally invisible.
//!
//! Two identical rigs run the same randomized operation stream: one with the fast path (the
//! default), one with [`Tlb::disable_fast_path`], so every access there takes the full slow path
//! (translation, `finish_leaf`, PMP, bus dispatch). After EVERY operation the rigs must agree on the
//! access result or trap (cause + tval), the architectural registers, the TLB walk AND hit counters,
//! device traffic and — periodically — every byte of RAM. The stream deliberately mixes everything
//! a fast entry must not survive: privilege / SUM / MXR / MPRV / MPP changes, satp switches through
//! a real `csrw satp`, all four SFENCE.VMA scopes, capacity evictions in one TLB set, page-table
//! edits WITHOUT a fence (stale translations must match exactly), whole-page and sub-page PMP
//! regions, armed debug triggers, D=0 / A=0 leaves, MMIO pages, misaligned and page-crossing
//! accesses, non-canonical addresses, and instruction fetches (incl. a page-straddling 32-bit op).
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS, Priv, TDATA1, TDATA2};
use wasm_vm_core::hart::{Hart, Trap};
use wasm_vm_core::mmio::{RecordingDevice, RecordingLog, SystemBus};
use wasm_vm_core::mmu::{self, Access};
use wasm_vm_core::ram::Ram;

const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const X: u64 = 1 << 3;
const U: u64 = 1 << 4;
const G: u64 = 1 << 5;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;

const RAM_BYTES: u64 = 16 << 20;
const MMIO_PA: u64 = 0x1000_0000;
const MMIO_LEN: u64 = 0x1000;

// Physical layout.
const ROOT1: u64 = DRAM_BASE + 0x20_0000;
const ROOT2: u64 = DRAM_BASE + 0x30_0000;
const DATA_PA: u64 = DRAM_BASE + 0x40_0000; // 32 data frames
const SUPER_PA: u64 = DRAM_BASE + 0x60_0000; // 2 MiB aligned
const CODE_PA: u64 = DRAM_BASE + 0x90_0000; // 2 code frames
const STUB_PA: u64 = DRAM_BASE + 0x95_0000; // M-mode `csrw satp, x5`

// Virtual layout.
const DATA_VA: u64 = 0x1000_0000; // 24 consecutive pages
const DATA_PAGES: u64 = 24;
const THRASH_VA: u64 = 0x2000_0000; // 8 pages, VPNs congruent mod 16 (one TLB set)
const THRASH_PAGES: u64 = 8;
const GLOBAL_VA: u64 = 0x3000_0000;
const SUPER_VA: u64 = 0x4000_0000;
const MMIO_VA: u64 = 0x5000_0000;
const UNMAPPED_VA: u64 = 0x6000_0000;
const CODE_VA: u64 = 0x7000_0000; // 2 pages: S-exec, then U-exec

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}

/// Deterministic xorshift64* stream.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len() as u64) as usize]
    }
}

/// Sv39 table builder with a bump allocator for pointer tables.
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
    fn leaf_slot(&mut self, bus: &mut impl Bus, va: u64, leaf_level: usize) -> u64 {
        let mut table = self.root;
        for level in ((leaf_level + 1)..=2usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let e = bus.load64(table + vpn * 8).unwrap();
            table = if e & V != 0 {
                (e >> 10) << 12
            } else {
                let t = self.next;
                self.next += 0x1000;
                bus.store64(table + vpn * 8, pte(t, V)).unwrap();
                t
            };
        }
        table + ((va >> (12 + leaf_level * 9)) & 0x1FF) * 8
    }
}

// Instruction encodings (rd = x6, rs1 = x7 address, rs2 = x8 data).
const fn itype(funct3: u32, opcode: u32, imm: u32) -> u32 {
    (imm << 20) | (7 << 15) | (funct3 << 12) | (6 << 7) | opcode
}
const fn stype(funct3: u32) -> u32 {
    (8 << 20) | (7 << 15) | (funct3 << 12) | 0x23
}
const fn amo(funct5: u32, rs2: u32) -> u32 {
    (funct5 << 27) | (rs2 << 20) | (7 << 15) | (3 << 12) | (6 << 7) | 0x2F
}
const CODE: [u32; 9] = [
    itype(3, 0x03, 0), // ld x6, 0(x7)
    stype(3),          // sd x8, 0(x7)
    amo(0b00000, 8),   // amoadd.d x6, x8, (x7)
    amo(0b00010, 0),   // lr.d x6, (x7)
    amo(0b00011, 8),   // sc.d x6, x8, (x7)
    itype(2, 0x03, 0), // lw x6, 0(x7)
    stype(2),          // sw x8, 0(x7)
    itype(4, 0x03, 1), // lbu x6, 1(x7)
    stype(0),          // sb x8, 0(x7)
];
const CSRW_SATP_X5: u32 = (0x180 << 20) | (5 << 15) | (1 << 12) | 0x73;

struct Rig {
    hart: Hart,
    bus: SystemBus,
    log: Rc<RefCell<RecordingLog>>,
}

impl Rig {
    fn new(fast: bool) -> Self {
        let mut bus = SystemBus::new(Ram::new(RAM_BYTES as usize).unwrap());
        let (dev, log) = RecordingDevice::new(0x1122_3344_5566_7788);
        bus.attach(MMIO_PA, MMIO_LEN, Box::new(dev)).unwrap();
        let mut hart = Hart::new();
        if !fast {
            hart.tlb.disable_fast_path();
        }
        assert_eq!(hart.tlb.fast_path_enabled(), fast);
        Rig { hart, bus, log }
    }
}

/// The two rigs plus the shared page-table layout; every operation is applied to both.
struct Pair {
    rigs: [Rig; 2],
    /// Leaf PTE slots (physical) of every mapping, per table: (slot, pa, perms).
    leaves: Vec<(u64, u64, u64)>,
}

const DATA_PERMS: [u64; 12] = [
    V | R | W | A | D,
    V | R | A,
    V | R | W | A, // D = 0: stores fault (Svade)
    V | X | A,     // execute-only: loads need MXR
    V | R | X | A,
    V | R | W | U | A | D,
    V | R | U | A,
    V | R | W | U | A,
    V | X | U | A,
    V | W | A | D, // R=0 W=1: reserved → page fault
    V | R | W,     // A = 0: faults
    0,             // invalid
];

impl Pair {
    fn new() -> Self {
        let mut pair = Pair {
            rigs: [Rig::new(true), Rig::new(false)],
            leaves: Vec::new(),
        };
        // Build the tables once on rig 0's bus, then copy RAM into rig 1 (identical bytes).
        let mut leaves = Vec::new();
        {
            let bus = &mut pair.rigs[0].bus;
            for (root, variant) in [(ROOT1, 0u64), (ROOT2, 1u64)] {
                let mut pt = Pt::new(root);
                for i in 0..DATA_PAGES {
                    let va = DATA_VA + i * 0x1000;
                    // The two tables map the data pages to different frames / permissions.
                    let pa = DATA_PA + ((i + variant * 7) % 32) * 0x1000;
                    let perms = DATA_PERMS[((i + variant * 5) % DATA_PERMS.len() as u64) as usize];
                    let slot = pt.leaf_slot(bus, va, 0);
                    bus.store64(slot, pte(pa, perms)).unwrap();
                    leaves.push((slot, pa, perms));
                }
                for k in 0..THRASH_PAGES {
                    let va = THRASH_VA + k * 0x10000;
                    let pa = DATA_PA + ((k + variant) % 32) * 0x1000;
                    let slot = pt.leaf_slot(bus, va, 0);
                    bus.store64(slot, pte(pa, V | R | W | A | D)).unwrap();
                    leaves.push((slot, pa, V | R | W | A | D));
                }
                let slot = pt.leaf_slot(bus, GLOBAL_VA, 0);
                bus.store64(slot, pte(DATA_PA + 0x1F000, V | R | W | G | A | D))
                    .unwrap();
                leaves.push((slot, DATA_PA + 0x1F000, V | R | W | G | A | D));
                let slot = pt.leaf_slot(bus, SUPER_VA, 1);
                bus.store64(slot, pte(SUPER_PA, V | R | W | X | A | D))
                    .unwrap();
                leaves.push((slot, SUPER_PA, V | R | W | X | A | D));
                let slot = pt.leaf_slot(bus, MMIO_VA, 0);
                bus.store64(slot, pte(MMIO_PA, V | R | W | A | D)).unwrap();
                leaves.push((slot, MMIO_PA, V | R | W | A | D));
                let slot = pt.leaf_slot(bus, CODE_VA, 0);
                bus.store64(slot, pte(CODE_PA, V | R | X | A)).unwrap();
                leaves.push((slot, CODE_PA, V | R | X | A));
                let slot = pt.leaf_slot(bus, CODE_VA + 0x1000, 0);
                let perms = if variant == 0 {
                    V | R | X | U | A
                } else {
                    V | R | X | A
                };
                bus.store64(slot, pte(CODE_PA + 0x1000, perms)).unwrap();
                leaves.push((slot, CODE_PA + 0x1000, perms));
            }
            // Code: the op table in both code frames, plus one 32-bit `ld` straddling the
            // boundary between them (low parcel at CODE_VA + 0xFFE).
            for frame in 0..2u64 {
                for (i, insn) in CODE.iter().enumerate() {
                    bus.store32(CODE_PA + frame * 0x1000 + i as u64 * 4, *insn)
                        .unwrap();
                }
            }
            let ld = CODE[0];
            bus.store16(CODE_PA + 0xFFE, ld as u16).unwrap();
            bus.store16(CODE_PA + 0x1000, (ld >> 16) as u16).unwrap();
            // The first op of frame 1 is now the straddle's high half; re-home frame 1's table
            // at offset 0x100 so it still has a complete op table.
            for (i, insn) in CODE.iter().enumerate() {
                bus.store32(CODE_PA + 0x1100 + i as u64 * 4, *insn).unwrap();
            }
            bus.store32(STUB_PA, CSRW_SATP_X5).unwrap();
            // Seed the data frames with a recognizable pattern.
            for off in (0..0x20_0000u64).step_by(8) {
                bus.store64(
                    DATA_PA + off,
                    (DATA_PA + off).wrapping_mul(0x9E37_79B9_7F4A_7C15),
                )
                .unwrap();
            }
        }
        let bytes = pair.rigs[0].bus.ram().as_bytes().to_vec();
        pair.rigs[1]
            .bus
            .ram_mut()
            .write_slice(DRAM_BASE, &bytes)
            .unwrap();
        pair.leaves = leaves;
        for rig in pair.rigs.iter_mut() {
            // PMP: entry 15 grants everything (lowest priority); entry 0 is the random region.
            rig.hart.csr.pmp.write_addr(15, (1 << 54) - 1);
            rig.hart.csr.pmp.write_cfg(2, 0x1Fu64 << 56);
            rig.hart.csr.mode = Priv::S;
        }
        pair.set_satp((8u64 << 60) | (1 << 44) | (ROOT1 >> 12));
        pair
    }

    /// Write satp by EXECUTING `csrw satp, x5` in M-mode (the real instruction path, including
    /// the hart's fast-TLB flush hook), then restore the previous privilege/pc/x5.
    fn set_satp(&mut self, satp: u64) {
        for rig in self.rigs.iter_mut() {
            let h = &mut rig.hart;
            let (mode, pc, x5) = (h.csr.mode, h.regs.pc, h.regs.read(5));
            h.csr.mode = Priv::M;
            h.regs.pc = STUB_PA;
            h.regs.write(5, satp);
            h.step(&mut rig.bus).expect("csrw satp from M");
            h.csr.mode = mode;
            h.regs.pc = pc;
            h.regs.write(5, x5);
        }
    }

    fn with_m<F: FnMut(&mut Hart)>(&mut self, mut f: F) {
        for rig in self.rigs.iter_mut() {
            let mode = rig.hart.csr.mode;
            rig.hart.csr.mode = Priv::M;
            f(&mut rig.hart);
            rig.hart.csr.mode = mode;
        }
    }

    fn both<T: PartialEq + std::fmt::Debug, F: FnMut(&mut Rig) -> T>(
        &mut self,
        what: &str,
        mut f: F,
    ) -> T {
        let a = f(&mut self.rigs[0]);
        let b = f(&mut self.rigs[1]);
        assert_eq!(a, b, "fast vs slow result diverged: {what}");
        a
    }

    /// One directed aligned 8-byte load or store at `va` on both rigs, compared.
    fn access(&mut self, step: usize, va: u64, store: bool, what: &str) {
        let what = format!(
            "step {step}: {what} ({} @ {va:#x})",
            if store { "sd" } else { "ld" }
        );
        if store {
            let _ = self.both(&what, |r| {
                r.hart
                    .jit_store_with_ram_phys(&mut r.bus, va, 0x0BAD_F00D, 8)
                    .map_err(|t: Trap| (t.cause, t.tval))
            });
        } else {
            let _ = self.both(&what, |r| {
                r.hart
                    .jit_load(&mut r.bus, va, 3)
                    .map_err(|t: Trap| (t.cause, t.tval))
            });
        }
        self.check(step, &what, false);
    }

    fn check(&self, step: usize, what: &str, full: bool) {
        let (a, b) = (&self.rigs[0], &self.rigs[1]);
        let ctx = || format!("step {step}: {what}");
        assert!(
            a.hart.regs == b.hart.regs,
            "registers diverged at {}",
            ctx()
        );
        assert_eq!(
            a.hart.resv,
            b.hart.resv,
            "reservation diverged at {}",
            ctx()
        );
        assert_eq!(a.hart.csr, b.hart.csr, "CSRs diverged at {}", ctx());
        assert_eq!(a.hart.tlb.walks(), b.hart.tlb.walks(), "walks at {}", ctx());
        assert_eq!(a.hart.tlb.hits(), b.hart.tlb.hits(), "hits at {}", ctx());
        assert_eq!(
            a.log.borrow().reads,
            b.log.borrow().reads,
            "MMIO reads at {}",
            ctx()
        );
        assert_eq!(
            a.log.borrow().writes,
            b.log.borrow().writes,
            "MMIO writes at {}",
            ctx()
        );
        if full {
            assert!(
                a.bus.ram().as_bytes() == b.bus.ram().as_bytes(),
                "RAM diverged at {}",
                ctx()
            );
        }
    }
}

fn random_va(rng: &mut Rng) -> u64 {
    let base = match rng.below(12) {
        0..=4 => DATA_VA + rng.below(DATA_PAGES) * 0x1000,
        5 | 6 => THRASH_VA + rng.below(THRASH_PAGES) * 0x10000,
        7 => GLOBAL_VA,
        8 => SUPER_VA + rng.below(512) * 0x1000,
        9 => MMIO_VA,
        10 => {
            if rng.below(2) == 0 {
                UNMAPPED_VA
            } else {
                0x0000_4000_0000_0000 | DATA_VA // non-canonical for Sv39
            }
        }
        _ => {
            // Physical-looking addresses (meaningful under M / Bare identity).
            rng.pick(&[DATA_PA, SUPER_PA, MMIO_PA, CODE_PA, DATA_PA + 0x1F000])
        }
    };
    let off = match rng.below(8) {
        0 => 0xFF8 + rng.below(8), // page edge (misaligned wide accesses cross the page)
        1 => rng.below(0x1000),    // anything, often misaligned
        _ => rng.below(0x200) * 8, // aligned
    };
    base + off
}

fn run_differential(seed: u64, steps: usize) {
    let mut rng = Rng(seed | 1);
    let mut p = Pair::new();
    let satps = [
        (8u64 << 60) | (1 << 44) | (ROOT1 >> 12),
        (8u64 << 60) | (2 << 44) | (ROOT2 >> 12),
        (8u64 << 60) | (2 << 44) | (ROOT1 >> 12), // ASID reuse with other tables
        0,                                        // Bare
    ];
    let mut max_live = 0usize;
    for step in 0..steps {
        let op = rng.below(100);
        let what: String;
        match op {
            // Loads through the shared checked path (the JIT import = the interpreter path).
            0..=29 => {
                let va = random_va(&mut rng);
                let kind = rng.below(7) as i32;
                what = format!("load kind {kind} @ {va:#x}");
                let _ = p.both(&what, |r| {
                    r.hart
                        .jit_load(&mut r.bus, va, kind)
                        .map_err(|t: Trap| (t.cause, t.tval))
                });
            }
            30..=49 => {
                let va = random_va(&mut rng);
                let width = rng.pick(&[1, 2, 4, 8]);
                let val = rng.next() as i64;
                what = format!("store w{width} @ {va:#x}");
                let _ = p.both(&what, |r| {
                    r.hart
                        .jit_store_with_ram_phys(&mut r.bus, va, val, width)
                        .map_err(|t: Trap| (t.cause, t.tval))
                });
            }
            // Execute a real instruction: exercises the fetch fast path plus the interpreter's
            // load/store/AMO/LR/SC arms.
            50..=61 => {
                let mode = p.rigs[0].hart.csr.mode;
                let (code_base, table) = match (mode, rng.below(3)) {
                    (Priv::M, _) => (CODE_PA, 0),
                    (_, 0) => (CODE_VA, 0),
                    _ => (CODE_VA + 0x1000, 0x100),
                };
                let pc = if rng.below(10) == 0 {
                    // The page-straddling `ld` (identity address under M).
                    (if mode == Priv::M { CODE_PA } else { CODE_VA }) + 0xFFE
                } else {
                    code_base + table + rng.below(CODE.len() as u64) * 4
                };
                let mut addr = random_va(&mut rng);
                if rng.below(4) != 0 {
                    addr &= !7;
                }
                let data = rng.next();
                what = format!("step pc {pc:#x} x7 {addr:#x} ({mode:?})");
                let _ = p.both(&what, |r| {
                    r.hart.regs.pc = pc;
                    r.hart.regs.write(7, addr);
                    r.hart.regs.write(8, data);
                    r.hart.step(&mut r.bus).map_err(|t: Trap| (t.cause, t.tval))
                });
            }
            62..=69 => {
                let mode = rng.pick(&[Priv::U, Priv::S, Priv::S, Priv::M]);
                what = format!("mode {mode:?}");
                for r in p.rigs.iter_mut() {
                    r.hart.csr.mode = mode;
                }
            }
            70..=77 => {
                // SUM(18) / MXR(19) / MPRV(17) / MPP(12:11) — the per-access context bits.
                let bit = rng.pick(&[18u32, 19, 17, 11, 12, 18, 19]);
                what = format!("toggle mstatus bit {bit}");
                p.with_m(|h| {
                    let v = h.csr.mstatus ^ (1 << bit);
                    h.csr
                        .access(MSTATUS, CsrOp::Write, v, false, true, 0)
                        .unwrap();
                });
            }
            78..=81 => {
                let satp = rng.pick(&satps);
                what = format!("csrw satp {satp:#x}");
                p.set_satp(satp);
            }
            82..=85 => {
                let va = random_va(&mut rng);
                let form = rng.below(4);
                let asid = rng.below(3);
                what = format!("sfence form {form} va {va:#x} asid {asid}");
                for r in p.rigs.iter_mut() {
                    match form {
                        0 => r.hart.tlb.sfence(None, None),
                        1 => r.hart.tlb.sfence(Some(va), None),
                        2 => r.hart.tlb.sfence(None, Some(asid)),
                        _ => r.hart.tlb.sfence(Some(va), Some(asid)),
                    }
                }
            }
            86..=90 => {
                // Edit a leaf WITHOUT a fence: resident translations must stay stale identically.
                let (slot, pa, _) = p.leaves[rng.below(p.leaves.len() as u64) as usize];
                let perms = rng.pick(&DATA_PERMS) | (rng.below(2) * G);
                let target = if rng.below(2) == 0 {
                    pa
                } else {
                    DATA_PA + rng.below(32) * 0x1000
                };
                what = format!("pte edit @ {slot:#x}");
                for r in p.rigs.iter_mut() {
                    r.bus.store64(slot, pte(target, perms)).unwrap();
                }
            }
            91..=95 => {
                // PMP entry 0: off, the whole frame, or the 8-byte chunk behind a pool VA. The
                // directed accesses around the change prove that (a) an entry published before
                // the change is not reused after it, and (b) an entry published next to a
                // sub-page region never authorizes an access inside it.
                let va = random_va(&mut rng) & !7;
                let store = rng.below(2) == 0;
                p.access(step, va, store, "pmp warm-up");
                let pa = {
                    let r = &mut p.rigs[1];
                    let eff = r.hart.csr.data_priv();
                    mmu::translate(&r.hart.csr, &mut r.bus, va, Access::Load, eff).ok()
                }
                .unwrap_or(DATA_PA + rng.below(32) * 0x1000 + (va & 0xFF8));
                let perms = rng.below(8);
                let (addr, a_field) = match rng.below(3) {
                    0 => (0, 0),
                    1 => (((pa & !0xFFF) >> 2) | 0x1FF, 3),
                    _ => ((pa & !7) >> 2, 3),
                };
                what = format!("pmp0 addr {addr:#x} a {a_field} perms {perms:#b} (va {va:#x})");
                for r in p.rigs.iter_mut() {
                    r.hart.csr.pmp.write_addr(0, addr);
                    r.hart.csr.pmp.write_cfg(0, (a_field << 3) | perms);
                }
                p.access(step, va, store, "after pmp change");
                p.access(step, va ^ 0x800, store, "pmp neighbour chunk");
                p.access(step, va, store, "pmp region after neighbour");
            }
            _ => {
                // Debug trigger on a pool address (load+store, S/U/M), or disarm. The directed
                // accesses prove an entry published while triggers were idle cannot bypass one.
                let va = random_va(&mut rng) & !7;
                let arm = rng.below(3) != 0;
                let store = rng.below(2) == 0;
                p.access(step, va, store, "trigger warm-up");
                what = format!("trigger arm={arm} @ {va:#x}");
                p.with_m(|h| {
                    let td1 = if arm {
                        (2u64 << 60) | (1 << 6) | (1 << 4) | (1 << 3) | 0b011
                    } else {
                        2u64 << 60
                    };
                    h.csr
                        .access(TDATA2, CsrOp::Write, va, false, true, 0)
                        .unwrap();
                    h.csr
                        .access(TDATA1, CsrOp::Write, td1, false, true, 0)
                        .unwrap();
                });
                p.access(step, va, store, "at trigger address");
            }
        }
        p.check(step, &what, step % 512 == 0);
        max_live = max_live.max(p.rigs[0].hart.tlb.fast_live_entries());
        assert_eq!(
            p.rigs[1].hart.tlb.fast_live_entries(),
            0,
            "the oracle rig must never publish a fast entry"
        );
    }
    p.check(steps, "final", true);
    // The comparison is only meaningful if the fast rig really ran on fast entries.
    assert!(
        max_live >= 8,
        "the fast path barely engaged (max {max_live} live entries)"
    );
}

#[test]
fn fast_path_is_indistinguishable_from_the_slow_path() {
    for seed in [1u64, 0xDEAD_BEEF, 0x005E_ED0F_FA57, 42, 7_777_777] {
        run_differential(seed, 20_000);
    }
}

/// The fast path must actually engage on the ordinary case (otherwise the differential above
/// proves nothing about it): repeated loads from one resident page are served without walks and
/// counted as hits, and a store to a D=0 page still faults after loads made the page resident.
#[test]
fn fast_path_engages_and_keeps_svade_store_faults() {
    let mut p = Pair::new();
    // DATA page 0 under ROOT1 is RW+A+D; page 2 is RW+A with D=0.
    let rig = &mut p.rigs[0];
    rig.hart.jit_load(&mut rig.bus, DATA_VA, 3).unwrap();
    let walks = rig.hart.tlb.walks();
    let hits = rig.hart.tlb.hits();
    for i in 0..100u64 {
        rig.hart.jit_load(&mut rig.bus, DATA_VA + i * 8, 3).unwrap();
    }
    assert_eq!(rig.hart.tlb.walks(), walks, "resident page never re-walks");
    assert_eq!(
        rig.hart.tlb.hits(),
        hits + 100,
        "every fast hit is a TLB hit"
    );
    let clean = DATA_VA + 2 * 0x1000;
    rig.hart.jit_load(&mut rig.bus, clean, 3).unwrap();
    rig.hart.jit_load(&mut rig.bus, clean, 3).unwrap();
    let err = rig.hart.jit_store(&mut rig.bus, clean, 1, 8).unwrap_err();
    assert_eq!(
        err.cause,
        wasm_vm_core::hart::Exception::StorePageFault,
        "a load-resident D=0 page still faults a store"
    );
}
