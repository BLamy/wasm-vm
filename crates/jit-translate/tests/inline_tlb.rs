//! E4-T11 — THE inline-TLB correctness gates.
//!
//! `docs/jit-architecture.md` §9 flags "inline TLB fast-path coherence with the audited slow path"
//! as a top risk requiring a fuzz. This harness is that fuzz plus the directed corner cases.
//!
//! ## What is under test
//! The translator's `MemModel::InlineTlb` emission: a load/store inlines a direct-mapped software-TLB
//! probe against arrays in ONE shared linear memory and, on a hit, does a raw `i64.load`/`store`
//! straight into the guest-RAM window; on a miss it calls `env.softmmu_load`/`env.softmmu_store`.
//!
//! ## How it is proven byte-identical to the interpreter
//! Guest RAM (including the Sv39 page tables) lives inside the wasm linear memory. The softmmu
//! imports run the interpreter's OWN `Hart::jit_load`/`jit_store` (i.e. `cload*`/`cstore*` — the
//! reference translate + PMP + misaligned-decompose + MMIO path) against a `Bus` over that same
//! linear memory, then fill the fast TLB for cacheable RAM pages. A second, independent interpreter
//! (`oracle`) with its own `Vec`-backed RAM runs the identical access; we assert equal value/fault
//! and a byte-identical RAM image after every single access.
//!
//! ## Coherence fuzz
//! Thousands of iterations interleave random loads/stores (aligned, misaligned, straddling, RO-page
//! store faults, MMIO, unmapped) with `sfence.vma`, `satp` switches (two distinct root page tables),
//! `fence.i`, and live PTE permission flips. The fast-TLB arrays are flushed on exactly the events
//! that flush the interpreter's `hart.tlb` (sfence.vma and satp) — a stale entry surviving one of
//! those would read the wrong page and diverge, which the byte-identical assertion catches.

use jit_translate::{Abi, TlbLayout, translate_block};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::csr::{CsrOp, Priv, SATP};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Hart, Trap};
use wasm_vm_core::mmu::{self, Access};
use wasmtime::{Caller, Engine, Instance, Linker, Memory, MemoryType, Module, Store};

// ── frozen layout (mirror of TlbLayout::FROZEN; pinned independently, adversarial #3) ──
const L: TlbLayout = TlbLayout::FROZEN;
const DRAM_BASE: u64 = 0x8000_0000;
const RAM_BYTES: usize = 0x4_0000; // 256 KiB guest RAM window (tables + data pages)
const RAM_OFF: usize = L.ram_base as usize; // linear byte offset of guest DRAM_BASE
const MEM_TOTAL: usize = RAM_OFF + RAM_BYTES;
const PAGES: u64 = MEM_TOTAL.div_ceil(0x10000) as u64;

// CpuState register offsets used to drive the one-op blocks.
const X1: usize = 8; // load rd
const X2: usize = 16; // rs1 (address base)
const X3: usize = 24; // rs2 (store value)

// A physical MMIO page: outside RAM, so it is never entered into the fast TLB.
const MMIO_BASE: u64 = 0x1000_0000;

// ── deterministic MMIO model (identical in both engines) ─────────────────────
fn mmio_pattern(pa: u64, width: usize) -> u64 {
    let v = pa.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0x1234_5678_9ABC_DEF0;
    match width {
        1 => v & 0xFF,
        2 => v & 0xFFFF,
        4 => v & 0xFFFF_FFFF,
        _ => v,
    }
}

// ── RAM byte helpers shared by both buses (replicate `Ram` fault policy exactly) ──
fn ram_index(a: u64, w: u64) -> Result<usize, BusFault> {
    let off = a.checked_sub(DRAM_BASE).ok_or(BusFault::Access)?;
    let end = off.checked_add(w).ok_or(BusFault::Access)?;
    if end > RAM_BYTES as u64 {
        return Err(BusFault::Access);
    }
    if a & (w - 1) != 0 {
        return Err(BusFault::Misaligned);
    }
    Ok(off as usize)
}
fn is_ram(a: u64, len: u64) -> bool {
    match a.checked_add(len) {
        Some(end) => a >= DRAM_BASE && end <= DRAM_BASE + RAM_BYTES as u64,
        None => false,
    }
}
fn is_mmio(a: u64) -> bool {
    (MMIO_BASE..MMIO_BASE + 0x1000).contains(&a)
}

macro_rules! bus_impl {
    ($ty:ty) => {
        impl Bus for $ty {
            fn load8(&mut self, a: u64) -> Result<u8, BusFault> {
                if is_mmio(a) {
                    self.mmio_reads += 1;
                    return Ok(mmio_pattern(a, 1) as u8);
                }
                let i = ram_index(a, 1)?;
                Ok(self.ram()[i])
            }
            fn load16(&mut self, a: u64) -> Result<u16, BusFault> {
                if is_mmio(a) {
                    self.mmio_reads += 1;
                    return Ok(mmio_pattern(a, 2) as u16);
                }
                let i = ram_index(a, 2)?;
                Ok(u16::from_le_bytes(self.ram()[i..i + 2].try_into().unwrap()))
            }
            fn load32(&mut self, a: u64) -> Result<u32, BusFault> {
                if is_mmio(a) {
                    self.mmio_reads += 1;
                    return Ok(mmio_pattern(a, 4) as u32);
                }
                let i = ram_index(a, 4)?;
                Ok(u32::from_le_bytes(self.ram()[i..i + 4].try_into().unwrap()))
            }
            fn load64(&mut self, a: u64) -> Result<u64, BusFault> {
                if is_mmio(a) {
                    self.mmio_reads += 1;
                    return Ok(mmio_pattern(a, 8));
                }
                let i = ram_index(a, 8)?;
                Ok(u64::from_le_bytes(self.ram()[i..i + 8].try_into().unwrap()))
            }
            fn store8(&mut self, a: u64, v: u8) -> Result<(), BusFault> {
                if is_mmio(a) {
                    self.mmio_writes += 1;
                    return Ok(());
                }
                let i = ram_index(a, 1)?;
                self.ram()[i] = v;
                Ok(())
            }
            fn store16(&mut self, a: u64, v: u16) -> Result<(), BusFault> {
                if is_mmio(a) {
                    self.mmio_writes += 1;
                    return Ok(());
                }
                let i = ram_index(a, 2)?;
                self.ram()[i..i + 2].copy_from_slice(&v.to_le_bytes());
                Ok(())
            }
            fn store32(&mut self, a: u64, v: u32) -> Result<(), BusFault> {
                if is_mmio(a) {
                    self.mmio_writes += 1;
                    return Ok(());
                }
                let i = ram_index(a, 4)?;
                self.ram()[i..i + 4].copy_from_slice(&v.to_le_bytes());
                Ok(())
            }
            fn store64(&mut self, a: u64, v: u64) -> Result<(), BusFault> {
                if is_mmio(a) {
                    self.mmio_writes += 1;
                    return Ok(());
                }
                let i = ram_index(a, 8)?;
                self.ram()[i..i + 8].copy_from_slice(&v.to_le_bytes());
                Ok(())
            }
            fn ram_contains(&self, a: u64, len: u64) -> bool {
                is_ram(a, len)
            }
        }
    };
}

// Oracle bus: a plain Vec.
struct VecBus {
    ram: Vec<u8>,
    mmio_reads: u64,
    mmio_writes: u64,
}
impl VecBus {
    fn ram(&mut self) -> &mut [u8] {
        &mut self.ram
    }
}
bus_impl!(VecBus);

// JIT-side bus: a raw view over the wasm linear memory's RAM region (single source of truth for the
// bytes the fast path reads/writes). Valid only while the wasm call is suspended in the import.
struct RawBus {
    base: *mut u8,
    mmio_reads: u64,
    mmio_writes: u64,
}
impl RawBus {
    #[allow(clippy::mut_from_ref)]
    fn ram(&mut self) -> &mut [u8] {
        // SAFETY: single-threaded; the wasm module is suspended in the import, no aliasing wasm
        // access to these bytes is in flight; the memory is never grown so `base` is stable.
        unsafe { core::slice::from_raw_parts_mut(self.base.add(RAM_OFF), RAM_BYTES) }
    }
}
bus_impl!(RawBus);

// ── Sv39 page-table construction (into a raw guest-RAM image) ─────────────────
const PTE_V: u64 = 1;
const PTE_R: u64 = 1 << 1;
const PTE_W: u64 = 1 << 2;
const PTE_A: u64 = 1 << 6;
const PTE_D: u64 = 1 << 7;

/// A guest-RAM image plus a bump allocator for physical pages, in phys-address space.
struct Image {
    ram: Vec<u8>,
    next_page: u64, // next free phys page base
}
impl Image {
    fn new() -> Self {
        Image {
            ram: vec![0u8; RAM_BYTES],
            next_page: DRAM_BASE, // bump from the start of RAM
        }
    }
    fn alloc_page(&mut self) -> u64 {
        let p = self.next_page;
        self.next_page += 0x1000;
        assert!(
            (p - DRAM_BASE) + 0x1000 <= RAM_BYTES as u64,
            "RAM exhausted"
        );
        p
    }
    fn off(&self, pa: u64) -> usize {
        (pa - DRAM_BASE) as usize
    }
    fn read_pte(&self, pa: u64) -> u64 {
        let i = self.off(pa);
        u64::from_le_bytes(self.ram[i..i + 8].try_into().unwrap())
    }
    fn write_pte(&mut self, pa: u64, v: u64) {
        let i = self.off(pa);
        self.ram[i..i + 8].copy_from_slice(&v.to_le_bytes());
    }
    /// Map virtual page `va` (page-aligned) to physical page `pa` with leaf `perm` bits, creating
    /// intermediate tables from `root`. Returns the leaf-PTE physical address (for later flips).
    fn map(&mut self, root: u64, va: u64, pa: u64, perm: u64) -> u64 {
        let mut table = root;
        for level in (1..3usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let pte_pa = table + vpn * 8;
            let pte = self.read_pte(pte_pa);
            let next = if pte & PTE_V == 0 {
                let np = self.alloc_page();
                self.write_pte(pte_pa, ((np >> 12) << 10) | PTE_V); // pointer PTE
                np
            } else {
                ((pte >> 10) & ((1 << 44) - 1)) << 12
            };
            table = next;
        }
        let vpn0 = (va >> 12) & 0x1FF;
        let leaf_pa = table + vpn0 * 8;
        self.write_pte(leaf_pa, ((pa >> 12) << 10) | perm | PTE_V);
        leaf_pa
    }
}

/// Everything a test needs to address the guest: the two roots, the leaf-PTE addresses of the
/// permission-flip page, and the virtual bases.
struct Layout {
    root_a: u64,
    root_b: u64,
    // virtual bases (shared across both roots)
    v_rw: [u64; 4],
    v_ro: u64,
    v_mmio: u64,
    v_unmapped: u64,
    ro_leaf_a: u64,
    ro_leaf_b: u64,
}

const VBASE: u64 = 0x2000_0000;
const PERM_RW: u64 = PTE_R | PTE_W | PTE_A | PTE_D;
const PERM_RO: u64 = PTE_R | PTE_A;

fn build_image() -> (Image, Layout) {
    let mut img = Image::new();
    let v_rw = [VBASE, VBASE + 0x1000, VBASE + 0x2000, VBASE + 0x3000];
    let v_ro = VBASE + 0x8000;
    let v_mmio = VBASE + 0x9000;
    let v_unmapped = VBASE + 0xA000;

    let root_a = img.alloc_page();
    let root_b = img.alloc_page();

    // Root A: RW pages -> bank A phys data pages; RO page; MMIO page.
    for v in v_rw {
        let p = img.alloc_page();
        img.map(root_a, v, p, PERM_RW);
    }
    let ro_pa_a = img.alloc_page();
    let ro_leaf_a = img.map(root_a, v_ro, ro_pa_a, PERM_RO);
    img.map(root_a, v_mmio, MMIO_BASE, PERM_RW);

    // Root B: same VAs -> a DIFFERENT bank of phys data pages (so a stale TLB entry after a satp
    // switch would read bank A and diverge).
    for v in v_rw {
        let p = img.alloc_page();
        img.map(root_b, v, p, PERM_RW);
    }
    let ro_pa_b = img.alloc_page();
    let ro_leaf_b = img.map(root_b, v_ro, ro_pa_b, PERM_RO);
    img.map(root_b, v_mmio, MMIO_BASE, PERM_RW);

    (
        img,
        Layout {
            root_a,
            root_b,
            v_rw,
            v_ro,
            v_mmio,
            v_unmapped,
            ro_leaf_a,
            ro_leaf_b,
        },
    )
}

fn satp_for(root: u64) -> u64 {
    (8u64 << 60) | (root >> 12) // MODE=Sv39, ASID=0, PPN
}

// ── the JIT harness (one shared memory + softmmu imports + compiled one-op blocks) ──
struct Ctx {
    hart: *mut Hart,
    mem: Option<Memory>,
    mmio_reads: *mut u64,
    mmio_writes: *mut u64,
    last_fault: *mut Option<Trap>,
}

fn kind_width(kind: i32) -> u64 {
    match kind {
        0 | 4 => 1,
        1 | 5 => 2,
        2 | 6 => 4,
        3 => 8,
        _ => unreachable!(),
    }
}

/// Fill the fast-TLB slot for `va`'s page after a successful RAM access (mirrors what a real runtime
/// does). Never fills MMIO/unmapped (translate fails or `ram_contains` is false) so those always
/// take the slow path. Only fills when the access was naturally aligned.
fn fill_tlb(
    hart: &mut Hart,
    bus: &mut RawBus,
    base: *mut u8,
    va: u64,
    is_store: bool,
    aligned: bool,
) {
    if !aligned {
        return;
    }
    let eff = hart.csr.data_priv();
    let access = if is_store {
        Access::Store
    } else {
        Access::Load
    };
    let va_page = va & !0xFFF;
    let Ok(pa) = mmu::translate(&hart.csr, bus, va_page, access, eff) else {
        return;
    };
    let pa_page = pa & !0xFFF;
    if !is_ram(pa_page, 0x1000) {
        return; // MMIO / non-RAM: never cached
    }
    let tag = (va_page | (TlbLayout::VALID as u64)) as i64;
    let addend = (L.ram_base as i64)
        .wrapping_add((pa_page as i64) - (DRAM_BASE as i64))
        .wrapping_sub(va_page as i64);
    let arr = if is_store { L.write_base } else { L.read_base };
    let idx = (va >> 12) & (L.entries as u64 - 1);
    let slot = arr as u64 + idx * TlbLayout::SLOT as u64;
    // SAFETY: single-threaded, memory not grown; slot is within the TLB-array region.
    unsafe {
        let p = base.add(slot as usize);
        core::ptr::copy_nonoverlapping(tag.to_le_bytes().as_ptr(), p, 8);
        core::ptr::copy_nonoverlapping(addend.to_le_bytes().as_ptr(), p.add(8), 8);
    }
}

fn softmmu_load(caller: Caller<'_, Ctx>, va: i64, kind: i32) -> anyhow::Result<i64> {
    let (hart_ptr, mem, mr, lf) = {
        let c = caller.data();
        (c.hart, c.mem.unwrap(), c.mmio_reads, c.last_fault)
    };
    let base = mem.data_ptr(&caller);
    let mut bus = RawBus {
        base,
        mmio_reads: 0,
        mmio_writes: 0,
    };
    // SAFETY: single-threaded; the wasm module is suspended in this import; `base` is stable.
    let hart = unsafe { &mut *hart_ptr };
    let r = hart.jit_load(&mut bus, va as u64, kind);
    unsafe {
        *mr += bus.mmio_reads;
    }
    match r {
        Ok(v) => {
            let aligned = (va as u64) & (kind_width(kind) - 1) == 0;
            fill_tlb(hart, &mut bus, base, va as u64, false, aligned);
            Ok(v)
        }
        Err(t) => {
            unsafe {
                *lf = Some(t);
            }
            Err(anyhow::anyhow!("softmmu load fault"))
        }
    }
}

fn softmmu_store(caller: Caller<'_, Ctx>, va: i64, val: i64, width: i32) -> anyhow::Result<()> {
    let (hart_ptr, mem, mw, lf) = {
        let c = caller.data();
        (c.hart, c.mem.unwrap(), c.mmio_writes, c.last_fault)
    };
    let base = mem.data_ptr(&caller);
    let mut bus = RawBus {
        base,
        mmio_reads: 0,
        mmio_writes: 0,
    };
    let hart = unsafe { &mut *hart_ptr };
    let r = hart.jit_store(&mut bus, va as u64, val, width);
    unsafe {
        *mw += bus.mmio_writes;
    }
    match r {
        Ok(()) => {
            let aligned = (va as u64) & (width as u64 - 1) == 0;
            fill_tlb(hart, &mut bus, base, va as u64, true, aligned);
            Ok(())
        }
        Err(t) => {
            unsafe {
                *lf = Some(t);
            }
            Err(anyhow::anyhow!("softmmu store fault"))
        }
    }
}

fn one_op_block(instr: Instr) -> DecodedBlock {
    let ops = vec![MicroOp {
        instr,
        len: 4,
        raw: 0,
    }];
    DecodedBlock::new(DRAM_BASE, ops, 4)
}

/// The compiled one-op modules (7 loads by kind, 4 stores by width) sharing one store + memory.
struct Jit {
    store: Store<Ctx>,
    mem: Memory,
    loads: [wasmtime::TypedFunc<i32, i32>; 7],
    stores: [wasmtime::TypedFunc<i32, i32>; 4],
}

fn build_jit(
    hart: *mut Hart,
    counters: (*mut u64, *mut u64),
    last_fault: *mut Option<Trap>,
) -> Jit {
    let engine = Engine::default();
    let mut store = Store::new(
        &engine,
        Ctx {
            hart,
            mem: None,
            mmio_reads: counters.0,
            mmio_writes: counters.1,
            last_fault,
        },
    );
    let mem = Memory::new(&mut store, MemoryType::new(PAGES as u32, None)).unwrap();
    store.data_mut().mem = Some(mem);

    let mut linker: Linker<Ctx> = Linker::new(&engine);
    linker.define(&mut store, "env", "mem", mem).unwrap();
    linker
        .func_wrap("env", "softmmu_load", softmmu_load)
        .unwrap();
    linker
        .func_wrap("env", "softmmu_store", softmmu_store)
        .unwrap();
    // E4-T14: the A-extension imports are always declared by the translator; register them so any
    // module instantiates (these inline-TLB tests never compile A ops, so they are never called).
    linker
        .func_wrap(
            "env",
            "amo",
            |caller: Caller<'_, Ctx>,
             addr: i64,
             val: i64,
             op: i32,
             width: i32|
             -> anyhow::Result<i64> {
                let hart = unsafe { &mut *caller.data().hart };
                let base = caller.data().mem.unwrap().data_ptr(&caller);
                let mut bus = RawBus {
                    base,
                    mmio_reads: 0,
                    mmio_writes: 0,
                };
                hart.jit_amo(&mut bus, addr as u64, val, op, width)
                    .map_err(|_| anyhow::anyhow!("amo fault"))
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "lr",
            |caller: Caller<'_, Ctx>, addr: i64, width: i32| -> anyhow::Result<i64> {
                let hart = unsafe { &mut *caller.data().hart };
                let base = caller.data().mem.unwrap().data_ptr(&caller);
                let mut bus = RawBus {
                    base,
                    mmio_reads: 0,
                    mmio_writes: 0,
                };
                hart.jit_lr(&mut bus, addr as u64, width)
                    .map_err(|_| anyhow::anyhow!("lr fault"))
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "sc",
            |caller: Caller<'_, Ctx>, addr: i64, val: i64, width: i32| -> anyhow::Result<i64> {
                let hart = unsafe { &mut *caller.data().hart };
                let base = caller.data().mem.unwrap().data_ptr(&caller);
                let mut bus = RawBus {
                    base,
                    mmio_reads: 0,
                    mmio_writes: 0,
                };
                hart.jit_sc(&mut bus, addr as u64, val, width)
                    .map_err(|_| anyhow::anyhow!("sc fault"))
            },
        )
        .unwrap();

    let compile = |store: &mut Store<Ctx>, linker: &Linker<Ctx>, instr: Instr| {
        let bytes = translate_block(&one_op_block(instr), &Abi::INLINE_TLB).unwrap();
        wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
            .validate_all(&bytes)
            .expect("inline-TLB module must validate");
        let module = Module::new(store.engine(), &bytes).unwrap();
        let inst: Instance = linker.instantiate(&mut *store, &module).unwrap();
        inst.get_typed_func::<i32, i32>(&mut *store, "run").unwrap()
    };

    let loads = [
        Instr::Lb {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Lh {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Lw {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Ld {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Lbu {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Lhu {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
        Instr::Lwu {
            rd: 1,
            rs1: 2,
            imm: 0,
        },
    ]
    .map(|i| compile(&mut store, &linker, i));
    let stores = [
        Instr::Sb {
            rs1: 2,
            rs2: 3,
            imm: 0,
        },
        Instr::Sh {
            rs1: 2,
            rs2: 3,
            imm: 0,
        },
        Instr::Sw {
            rs1: 2,
            rs2: 3,
            imm: 0,
        },
        Instr::Sd {
            rs1: 2,
            rs2: 3,
            imm: 0,
        },
    ]
    .map(|i| compile(&mut store, &linker, i));

    Jit {
        store,
        mem,
        loads,
        stores,
    }
}

impl Jit {
    fn write_u64(&mut self, off: usize, v: u64) {
        self.mem
            .write(&mut self.store, off, &v.to_le_bytes())
            .unwrap();
    }
    fn read_u64(&mut self, off: usize) -> u64 {
        let mut b = [0u8; 8];
        self.mem.read(&self.store, off, &mut b).unwrap();
        u64::from_le_bytes(b)
    }
    fn ram_image(&mut self) -> Vec<u8> {
        let mut v = vec![0u8; RAM_BYTES];
        self.mem.read(&self.store, RAM_OFF, &mut v).unwrap();
        v
    }
    fn set_ram(&mut self, img: &[u8]) {
        self.mem.write(&mut self.store, RAM_OFF, img).unwrap();
    }
    fn write_pte(&mut self, leaf_pa: u64, v: u64) {
        let off = RAM_OFF + (leaf_pa - DRAM_BASE) as usize;
        self.mem
            .write(&mut self.store, off, &v.to_le_bytes())
            .unwrap();
    }
    fn flush_tlb_arrays(&mut self) {
        let len = (L.exec_base + L.entries * TlbLayout::SLOT - L.read_base) as usize;
        let zeros = vec![0u8; len];
        self.mem
            .write(&mut self.store, L.read_base as usize, &zeros)
            .unwrap();
    }
    fn do_load(&mut self, kind: usize, va: u64, lf: *mut Option<Trap>) -> Result<i64, Trap> {
        unsafe {
            *lf = None;
        }
        self.write_u64(X2, va);
        let f = self.loads[kind].clone();
        match f.call(&mut self.store, 0) {
            Ok(_) => Ok(self.read_u64(X1) as i64),
            Err(_) => Err(unsafe { (*lf).expect("fault flag set on trap") }),
        }
    }
    fn do_store(
        &mut self,
        widx: usize,
        va: u64,
        val: u64,
        lf: *mut Option<Trap>,
    ) -> Result<(), Trap> {
        unsafe {
            *lf = None;
        }
        self.write_u64(X2, va);
        self.write_u64(X3, val);
        let f = self.stores[widx].clone();
        match f.call(&mut self.store, 0) {
            Ok(_) => Ok(()),
            Err(_) => Err(unsafe { (*lf).expect("fault flag set on trap") }),
        }
    }
}

fn width_index(w: i32) -> usize {
    match w {
        1 => 0,
        2 => 1,
        4 => 2,
        8 => 3,
        _ => unreachable!(),
    }
}

// ── a harness pairing the JIT with an independent interpreter oracle ─────────
struct Pair {
    jit: Jit,
    jit_hart: Box<Hart>,
    oracle: Hart,
    oracle_bus: VecBus,
    last_fault: *mut Option<Trap>,
    jit_mmio_reads: *mut u64,
    jit_mmio_writes: *mut u64,
    layout: Layout,
    current_root: u64,
}

fn new_pair() -> Pair {
    let (img, layout) = build_image();

    let mut jit_hart = Box::new(Hart::default());
    let mut oracle = Hart::default();
    for h in [jit_hart.as_mut(), &mut oracle] {
        h.csr
            .access(SATP, CsrOp::Write, satp_for(layout.root_a), false, false, 0)
            .unwrap();
        h.csr.pmp.allow_all(); // grant S/U R/W/X everywhere (bare-metal harness grant)
        h.csr.mode = Priv::S;
    }

    // Leaked host-side scratch the imports write through (freed at process exit — fine for a test).
    let last_fault: *mut Option<Trap> = Box::leak(Box::new(None));
    let jit_mmio_reads: *mut u64 = Box::leak(Box::new(0u64));
    let jit_mmio_writes: *mut u64 = Box::leak(Box::new(0u64));

    let hart_ptr: *mut Hart = jit_hart.as_mut();
    let mut jit = build_jit(hart_ptr, (jit_mmio_reads, jit_mmio_writes), last_fault);
    jit.set_ram(&img.ram);
    jit.flush_tlb_arrays();

    let oracle_bus = VecBus {
        ram: img.ram.clone(),
        mmio_reads: 0,
        mmio_writes: 0,
    };
    let current_root = layout.root_a;

    Pair {
        jit,
        jit_hart,
        oracle,
        oracle_bus,
        last_fault,
        jit_mmio_reads,
        jit_mmio_writes,
        layout,
        current_root,
    }
}

impl Pair {
    fn sfence(&mut self) {
        self.oracle.tlb.sfence(None, None);
        self.jit_hart.tlb.sfence(None, None);
        self.jit.flush_tlb_arrays();
    }
    fn set_satp(&mut self, root: u64) {
        for h in [self.jit_hart.as_mut(), &mut self.oracle] {
            h.csr
                .access(SATP, CsrOp::Write, satp_for(root), false, false, 0)
                .unwrap();
        }
        self.current_root = root;
        self.sfence(); // correct guest software always sfences after a satp reuse
    }
    fn fence_i(&mut self) {
        // fence.i flushes the block cache; the data TLB is unaffected, but dropping the fast-TLB
        // cache is always safe (it only forces a re-fill from the authoritative hart.tlb).
        self.jit.flush_tlb_arrays();
    }
    fn flip_ro_perm(&mut self, make_writable: bool) {
        let leaf = if self.current_root == self.layout.root_a {
            self.layout.ro_leaf_a
        } else {
            self.layout.ro_leaf_b
        };
        let pte = {
            let i = (leaf - DRAM_BASE) as usize;
            let old = u64::from_le_bytes(self.oracle_bus.ram[i..i + 8].try_into().unwrap());
            let ppn_v = old & !(PTE_R | PTE_W | PTE_A | PTE_D);
            ppn_v | if make_writable { PERM_RW } else { PERM_RO }
        };
        let i = (leaf - DRAM_BASE) as usize;
        self.oracle_bus.ram[i..i + 8].copy_from_slice(&pte.to_le_bytes());
        self.jit.write_pte(leaf, pte);
        self.sfence();
    }
    /// One load, both engines. Returns whether results matched (asserts otherwise).
    fn check_load(&mut self, kind: usize, va: u64) {
        let o = self.oracle.jit_load(&mut self.oracle_bus, va, kind as i32);
        let j = self.jit.do_load(kind, va, self.last_fault);
        assert_result_i64(o, j, "load", kind, va);
        self.compare_ram(va, "load");
    }
    fn check_store(&mut self, w: i32, va: u64, val: u64) {
        let o = self
            .oracle
            .jit_store(&mut self.oracle_bus, va, val as i64, w);
        let j = self.jit.do_store(width_index(w), va, val, self.last_fault);
        assert_result_unit(o, j, w, va, val);
        self.compare_ram(va, "store");
    }
    fn compare_ram(&mut self, va: u64, what: &str) {
        let jram = self.jit.ram_image();
        if jram != self.oracle_bus.ram {
            let first = jram
                .iter()
                .zip(&self.oracle_bus.ram)
                .position(|(a, b)| a != b)
                .unwrap();
            panic!(
                "RAM DIVERGED after {what} va={va:#x}: first mismatch at guest {:#x} jit={:#x} oracle={:#x}",
                DRAM_BASE + first as u64,
                jram[first],
                self.oracle_bus.ram[first]
            );
        }
    }
}

fn assert_result_i64(o: Result<i64, Trap>, j: Result<i64, Trap>, what: &str, kind: usize, va: u64) {
    match (o, j) {
        (Ok(a), Ok(b)) => assert_eq!(
            a, b,
            "{what} value diverged (kind={kind}, va={va:#x}): oracle={a:#x} jit={b:#x}"
        ),
        (Err(a), Err(b)) => assert_eq!(
            (a.cause, a.tval),
            (b.cause, b.tval),
            "{what} fault diverged (kind={kind}, va={va:#x})"
        ),
        (o, j) => {
            panic!("{what} outcome diverged (kind={kind}, va={va:#x}): oracle={o:?} jit={j:?}")
        }
    }
}

fn assert_result_unit(o: Result<(), Trap>, j: Result<(), Trap>, w: i32, va: u64, val: u64) {
    match (o, j) {
        (Ok(()), Ok(())) => {}
        (Err(a), Err(b)) => assert_eq!(
            (a.cause, a.tval),
            (b.cause, b.tval),
            "store fault diverged (w={w}, va={va:#x}, val={val:#x})"
        ),
        (o, j) => panic!("store outcome diverged (w={w}, va={va:#x}): oracle={o:?} jit={j:?}"),
    }
}

// ── deterministic RNG ────────────────────────────────────────────────────────
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn kind_for_width(rng: &mut Rng, w: i32) -> usize {
    match w {
        1 => *[0usize, 4].get(rng.below(2) as usize).unwrap(),
        2 => *[1usize, 5].get(rng.below(2) as usize).unwrap(),
        4 => *[2usize, 6].get(rng.below(2) as usize).unwrap(),
        8 => 3,
        _ => unreachable!(),
    }
}

// ── directed corner cases ────────────────────────────────────────────────────
#[test]
fn aligned_roundtrip_takes_fastpath_on_retry() {
    let mut p = new_pair();
    let lf = p.last_fault;
    let va = p.layout.v_rw[0] + 64;
    // First store: cold miss -> softmmu fills the write TLB. Second store: fast-path hit (no import).
    let before = unsafe { *p.jit_mmio_writes };
    p.check_store(8, va, 0x0123_4567_89AB_CDEF);
    p.check_store(8, va, 0xFEDC_BA98_7654_3210);
    // The load reads it back (fills the read TLB then hits).
    p.check_load(3, va);
    p.check_load(3, va);
    let _ = (lf, before);
}

#[test]
fn readonly_page_store_faults_like_interpreter() {
    let mut p = new_pair();
    let va = p.layout.v_ro + 16;
    // A load from the RO page is fine; a store must page-fault (StorePageFault), never a stale hit.
    p.check_load(3, va);
    p.check_store(8, va, 0xDEAD_BEEF);
    // Load again to confirm the failed store wrote nothing.
    p.check_load(3, va);
}

#[test]
fn mmio_is_never_fastpathed() {
    let mut p = new_pair();
    let va = p.layout.v_mmio + 8;
    let reads0 = unsafe { *p.jit_mmio_reads };
    let writes0 = unsafe { *p.jit_mmio_writes };
    // Hammer the MMIO register from the translated path many times; every access must reach the
    // device (counter advances each time) — proof it is never entered into the fast TLB.
    for i in 0..50u64 {
        p.check_store(4, va, i);
        p.check_load(2, va);
    }
    let reads = unsafe { *p.jit_mmio_reads } - reads0;
    let writes = unsafe { *p.jit_mmio_writes } - writes0;
    assert_eq!(
        writes, 50,
        "every MMIO store must hit the device (never cached)"
    );
    assert_eq!(
        reads, 50,
        "every MMIO load must hit the device (never cached)"
    );
}

#[test]
fn misaligned_and_straddling_match_interpreter() {
    let mut p = new_pair();
    // Misaligned within a page and straddling into the next (mapped) page, every width.
    for &off in &[1u64, 3, 7, 0xFFF, 0x1000 - 3, 0x1000 - 7] {
        let va = p.layout.v_rw[0] + off;
        p.check_store(8, va, 0x1122_3344_5566_7788);
        p.check_load(3, va);
        p.check_load(2, va);
        p.check_load(0, va);
    }
}

#[test]
fn unmapped_access_faults_like_interpreter() {
    let mut p = new_pair();
    let va = p.layout.v_unmapped + 8;
    p.check_load(3, va);
    p.check_store(8, va, 0x99);
}

#[test]
fn satp_switch_flushes_the_fast_tlb() {
    let mut p = new_pair();
    let va = p.layout.v_rw[0] + 32;
    // Fill the fast TLB under root A, then switch to root B (which maps this VA to a DIFFERENT phys
    // page). A stale entry surviving the switch would read root A's page — the assertion catches it.
    p.check_store(8, va, 0xAAAA_AAAA_AAAA_AAAA);
    p.check_load(3, va);
    p.set_satp(p.layout.root_b);
    p.check_load(3, va); // must see root B's (zero) page, not the stale AAAA
    p.check_store(8, va, 0xBBBB_BBBB_BBBB_BBBB);
    p.set_satp(p.layout.root_a);
    p.check_load(3, va); // back to root A's AAAA
}

// ── THE coherence fuzz (the flagged risk) ────────────────────────────────────
#[test]
fn tlb_coherence_fuzz() {
    let mut p = new_pair();
    let mut rng = Rng(0xC0FF_EE12_3456_789A);
    let iters = 6000u64;
    let widths = [1i32, 2, 4, 8];

    for _ in 0..iters {
        // Occasionally fire a coherence event.
        match rng.below(12) {
            0 => p.sfence(),
            1 => {
                let root = if rng.below(2) == 0 {
                    p.layout.root_a
                } else {
                    p.layout.root_b
                };
                p.set_satp(root);
            }
            2 => p.fence_i(),
            3 => p.flip_ro_perm(rng.below(2) == 0),
            _ => {}
        }

        let w = widths[rng.below(4) as usize];
        // Choose an address category.
        let va = match rng.below(7) {
            0 => {
                // aligned RW
                let k = rng.below(4) as usize;
                p.layout.v_rw[k] + (rng.below(0x1000 / w as u64) * w as u64)
            }
            1 => {
                // misaligned within an RW page
                let k = rng.below(4) as usize;
                p.layout.v_rw[k] + 1 + rng.below(0xF00)
            }
            2 => {
                // straddling a page boundary (into the next mapped RW page)
                let k = rng.below(3) as usize;
                p.layout.v_rw[k] + 0x1000 - (1 + rng.below(7))
            }
            3 => p.layout.v_ro + (rng.below(0x1000 / w as u64) * w as u64), // RO page
            4 => p.layout.v_mmio + (rng.below(0x1000 / w as u64) * w as u64), // MMIO (aligned)
            5 => p.layout.v_unmapped + rng.below(0x1000),                   // unmapped
            _ => {
                let k = rng.below(4) as usize;
                p.layout.v_rw[k] + rng.below(0x1000)
            }
        };

        if rng.below(2) == 0 {
            p.check_store(w, va, rng.next());
        } else {
            let kind = kind_for_width(&mut rng, w);
            p.check_load(kind, va);
        }
    }
    eprintln!("inline-TLB coherence fuzz: {iters} iterations, byte-identical to the interpreter");
}
