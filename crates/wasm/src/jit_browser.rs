//! # `jit_browser` — E4-T29 Phase 2: the in-wasm (browser) compiled-block executor.
//!
//! The SECOND backend behind [`wasm_vm_core::jit::CompiledBlockExecutor`] (the first is the native
//! wasmtime-backed `wasm-vm-jit-runtime`). Where the native executor drives wasmtime, this one drives
//! the browser's own `WebAssembly.compile` / `WebAssembly.instantiate` (via `js_sys::WebAssembly`),
//! sharing the identical E4-T09 frozen ABI bytes produced by `jit-translate`. It runs inside the
//! `wasm-vm-wasm` module (which itself is the interpreter compiled to wasm), so a booted browser
//! guest executes translated blocks instead of only interpreting.
//!
//! ## How it mirrors `WasmtimeExecutor`'s obligations
//!
//! Every backend-agnostic obligation — physical-PC keying, page-granular SMC invalidation (E4-T17),
//! whole-batch retirement (E4-T19), the funcref-link-slot chaining table + unlink-completeness
//! (E4-T18), the budget/eviction state machine (E4-T20) — is **the same code** as the native
//! executor: it is pure bookkeeping with no engine dependency. Only three things differ, and they are
//! the only browser-specific pieces:
//!
//! 1. **compile + instantiate** — `WebAssembly.Module` + `WebAssembly.Instance` instead of
//!    `wasmtime::Module` + `Instance`. Both are synchronous (`js_sys::WebAssembly::Module::new` /
//!    `Instance::new`), which is legal off the main thread (the E4-T22 CPU worker) and fine for the
//!    per-block/per-batch module sizes.
//! 2. **the load/store/AMO/LR/SC imports** — plain JS functions (wasm-bindgen [`Closure`]s) that
//!    route through a thread-local raw pointer to the live [`Hart`]/[`SystemBus`] (mirroring the
//!    native `HostCtx`), calling the interpreter's OWN `Hart::jit_load`/`jit_store`/… so a JIT
//!    load/store is translated + PMP-checked + bus-routed byte-identically to the interpreter. A fault
//!    records the precise [`Trap`] and throws, unwinding the module call exactly like the native
//!    `Err`-unwind (E4-T12 precise memory-fault side-exit).
//! 3. **CpuState sync** — one stable `Uint8Array` view per batch bulk-copies the frozen handoff
//!    region, instead of crossing the JS boundary once per register.
//!
//! The default constructor uses the frozen [`MemModel::SoftmmuImports`](jit_translate::MemModel)
//! path, identical to the native executor. Production browser instances use
//! `MemModel::InlineTlb`: the outer wasm memory backs guest RAM and aligned, cacheable loads/stores
//! can avoid the JS import boundary. Raw stores append a bounded commit record in the handoff; the
//! executor applies reservation invalidation and SMC/DMA page logging before the next guest boundary.
//! The parity harness keeps the isolated SoftMMU mode available as a reference.

use alloc::boxed::Box;
use alloc::format;
use alloc::vec::Vec;
use core::cell::RefCell;
use std::collections::{HashMap, HashSet};

use jit_translate::{Abi, MemModel, TlbLayout, is_translatable, translate_batch};
use js_sys::{Function, Object, Reflect, Uint8Array, WebAssembly};
use wasm_bindgen::prelude::*;
use wasm_vm_core::Machine;
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::{Hart, Trap};
use wasm_vm_core::jit::{
    CHAIN_DEPTH_BUDGET_DEFAULT, CHAIN_DEPTH_HIST_LEN, ChainStats, CompiledBlockExecutor,
    CpuStateHandoff, EvictPolicy, ExitCode, JitCacheBudget, JitCacheStats, JitExit, abi,
};
use wasm_vm_core::mmio::SystemBus;

extern crate alloc;

const INLINE_TLB_ENTRIES: u32 = 256;
const INLINE_TLB_ARRAY_BYTES: u32 = INLINE_TLB_ENTRIES * TlbLayout::SLOT;
const INLINE_TLB_WORDS: usize = (INLINE_TLB_ARRAY_BYTES as usize * 3) / core::mem::size_of::<u64>();
const DIRECT_CHAIN_FUEL: u64 = 128;
const DYNAMIC_LINK_ENTRIES: usize = 4096;
const DYNAMIC_LINK_WORDS: usize = DYNAMIC_LINK_ENTRIES * 2;

#[derive(Clone, Copy, PartialEq, Eq)]
struct InlineTlbContext {
    satp: u64,
    mstatus: u64,
    mode: u8,
    flushes: u64,
    triggers_idle: bool,
}

/// The browser-only direct-mapped refill cache. The generated module imports the outer wasm
/// memory, so this allocation and the guest RAM `Vec` are both addressed by the same linear-memory
/// offsets. Only successful, aligned RAM accesses are published here; the interpreter remains the
/// authority for the refill and all non-RAM accesses.
struct InlineTlbCache {
    words: Box<[u64; INLINE_TLB_WORDS]>,
    layout: TlbLayout,
    context: Option<InlineTlbContext>,
}

impl InlineTlbCache {
    fn new(ram_host_ptr: usize, ram_len: usize, dram_base: u64) -> Result<Self, &'static str> {
        let ram_base = u32::try_from(ram_host_ptr).map_err(|_| "guest RAM is outside wasm32")?;
        let ram_end = ram_host_ptr
            .checked_add(ram_len)
            .ok_or("guest RAM linear-memory range overflowed")?;
        if ram_end > (u32::MAX as usize).saturating_add(1) {
            return Err("guest RAM does not fit in wasm32 linear memory");
        }

        let mut words = Box::new([0u64; INLINE_TLB_WORDS]);
        let base = u32::try_from(words.as_mut_ptr() as usize)
            .map_err(|_| "inline TLB allocation is outside wasm32")?;
        let write_base = base
            .checked_add(INLINE_TLB_ARRAY_BYTES)
            .ok_or("inline TLB layout overflowed")?;
        let exec_base = write_base
            .checked_add(INLINE_TLB_ARRAY_BYTES)
            .ok_or("inline TLB layout overflowed")?;
        let layout = TlbLayout {
            entries: INLINE_TLB_ENTRIES,
            read_base: base,
            write_base,
            exec_base,
            ram_base,
            dram_base,
        };
        Ok(Self {
            words,
            layout,
            context: None,
        })
    }

    fn context(hart: &Hart) -> InlineTlbContext {
        InlineTlbContext {
            satp: hart.csr.satp(),
            mstatus: hart.csr.mstatus,
            mode: match hart.csr.mode {
                wasm_vm_core::csr::Priv::U => 0,
                wasm_vm_core::csr::Priv::S => 1,
                wasm_vm_core::csr::Priv::M => 3,
            },
            flushes: hart.tlb.flush_count(),
            triggers_idle: hart.csr.triggers_idle(),
        }
    }

    fn reset(&mut self) {
        for word in self.words.iter_mut() {
            *word = 0;
        }
        self.context = None;
    }

    fn sync_context(&mut self, hart: &Hart) -> bool {
        let current = Self::context(hart);
        if self.context != Some(current) {
            for word in self.words.iter_mut() {
                *word = 0;
            }
            self.context = Some(current);
            return true;
        }
        false
    }

    fn fill(&mut self, va: u64, pa: u64, write: bool) {
        let Some(ram_offset) = pa.checked_sub(self.layout.dram_base) else {
            return;
        };
        let Some(target) = u64::from(self.layout.ram_base).checked_add(ram_offset) else {
            return;
        };
        if target > u64::from(u32::MAX) {
            return;
        }
        let slot = ((va >> 12) & u64::from(self.layout.entries - 1)) as usize;
        let array = if write {
            INLINE_TLB_ENTRIES as usize * 2
        } else {
            0
        };
        let index = array + slot * 2;
        self.words[index] = (va & !0xFFF) | TlbLayout::VALID as u64;
        self.words[index + 1] = target.wrapping_sub(va);
    }
}

/// Browser-only one-byte-per-guest-RAM-page hazard map. Inline stores can remain in a compiled
/// chain while their deferred host commit is pending unless the store targets a page containing
/// live compiled code. Keeping this bitmap in the outer wasm memory lets generated code make that
/// decision without another JS/Rust boundary crossing.
struct CompiledPageBitmap {
    bytes: Box<[u8]>,
    base: u32,
    dram_page: u64,
}

impl CompiledPageBitmap {
    fn new(ram_len: usize, dram_base: u64) -> Result<Self, &'static str> {
        let page_count = ram_len
            .checked_add(4095)
            .ok_or("compiled-page bitmap size overflowed")?
            / 4096;
        let mut bytes = vec![0u8; page_count].into_boxed_slice();
        let base = u32::try_from(bytes.as_mut_ptr() as usize)
            .map_err(|_| "compiled-page bitmap is outside wasm32")?;
        Ok(Self {
            bytes,
            base,
            dram_page: dram_base >> 12,
        })
    }

    fn base(&self) -> u32 {
        self.base
    }

    fn set(&mut self, page_frame: u64, live: bool) {
        let Some(index) = page_frame
            .checked_sub(self.dram_page)
            .and_then(|index| usize::try_from(index).ok())
        else {
            return;
        };
        if let Some(byte) = self.bytes.get_mut(index) {
            *byte = live as u8;
        }
    }
}

/// Browser-only direct-mapped cache for virtual `jalr` targets. Each 16-byte slot stores
/// `{virtual_pc, table_index_plus_one}` in the outer wasm memory. The generated module compares
/// both values before `call_indirect`; Rust owns publication and clears the slot before freeing or
/// remapping a compiled block.
struct DynamicLinkCache {
    words: Box<[u64; DYNAMIC_LINK_WORDS]>,
    slot_keys: Vec<Option<u64>>,
    virtual_to_phys: HashMap<u64, u64>,
    base: u32,
    mask: u32,
}

impl DynamicLinkCache {
    fn new() -> Result<Self, &'static str> {
        let mut words = Box::new([0u64; DYNAMIC_LINK_WORDS]);
        let base = u32::try_from(words.as_mut_ptr() as usize)
            .map_err(|_| "dynamic link table is outside wasm32")?;
        Ok(Self {
            words,
            slot_keys: vec![None; DYNAMIC_LINK_ENTRIES],
            virtual_to_phys: HashMap::new(),
            base,
            mask: (DYNAMIC_LINK_ENTRIES - 1) as u32,
        })
    }

    fn base(&self) -> u32 {
        self.base
    }

    fn mask(&self) -> u32 {
        self.mask
    }

    fn slot(&self, virtual_pc: u64) -> usize {
        (((virtual_pc >> 2) ^ (virtual_pc >> 12) ^ virtual_pc) & u64::from(self.mask)) as usize
    }

    fn publish(&mut self, virtual_pc: u64, physical_pc: u64, table_index: u32) {
        let slot = self.slot(virtual_pc);
        if let Some(old) = self.slot_keys[slot].replace(virtual_pc) {
            self.virtual_to_phys.remove(&old);
        }
        self.words[slot * 2] = virtual_pc.to_le();
        self.words[slot * 2 + 1] = u64::from(table_index).saturating_add(1).to_le();
        self.virtual_to_phys.insert(virtual_pc, physical_pc);
    }

    fn clear_virtual(&mut self, virtual_pc: u64) {
        let slot = self.slot(virtual_pc);
        if self.slot_keys[slot] == Some(virtual_pc) {
            self.words[slot * 2] = 0;
            self.words[slot * 2 + 1] = 0;
            self.slot_keys[slot] = None;
        }
        self.virtual_to_phys.remove(&virtual_pc);
    }

    fn clear_physical(&mut self, physical_pc: u64) {
        let virtuals: Vec<u64> = self
            .virtual_to_phys
            .iter()
            .filter_map(|(&virtual_pc, &physical)| (physical == physical_pc).then_some(virtual_pc))
            .collect();
        for virtual_pc in virtuals {
            self.clear_virtual(virtual_pc);
        }
    }

    fn reset(&mut self) {
        for word in self.words.iter_mut() {
            *word = 0;
        }
        for key in &mut self.slot_keys {
            *key = None;
        }
        self.virtual_to_phys.clear();
    }
}

// ── the live-guest bridge for the load/store/AMO/LR/SC imports ───────────────
//
// Exactly the native `HostCtx` pattern, but reached through a thread-local because the JS import
// closures cannot carry a Rust borrow across the JS boundary. The wasm module is single-threaded and
// cannot re-enter, so there is at most one live `run` call and one set of pointers at any instant.
struct HostCtx {
    hart: *mut Hart,
    bus: *mut SystemBus,
    inline_tlb: *mut InlineTlbCache,
    compiled_pages: *const HashMap<u64, usize>,
    chain_abort: *mut u8,
    /// The precise trap a faulting load/store/AMO produced (cause + `mtval`), recorded before the
    /// import throws. `None` means "no fault this call".
    trap: Option<Trap>,
}

thread_local! {
    static HOST: RefCell<HostCtx> = const { RefCell::new(HostCtx {
        hart: core::ptr::null_mut(),
        bus: core::ptr::null_mut(),
        inline_tlb: core::ptr::null_mut(),
        compiled_pages: core::ptr::null(),
        chain_abort: core::ptr::null_mut(),
        trap: None,
    }) };
}

#[wasm_bindgen(inline_js = r#"
export function throwJitMemFault() {
    throw null;
}

export function invokeJitBlock(run, stateBase) {
    try {
        return run(stateBase);
    } catch {
        return NaN;
    }
}
"#)]
extern "C" {
    #[wasm_bindgen(js_name = throwJitMemFault)]
    fn throw_jit_mem_fault();
    #[wasm_bindgen(js_name = invokeJitBlock)]
    fn invoke_jit_block(run: &Function, state_base: u32) -> f64;
}

#[cold]
fn throw_jit_sentinel() -> ! {
    throw_jit_mem_fault();
    // SAFETY: the inline JS function above unconditionally throws before it can return. Keeping the
    // sentinel entirely in JS avoids both Rust-string decoding and a leaked `JsValue` externref.
    unsafe { core::hint::unreachable_unchecked() }
}

/// Run `f` against the live guest for a value-returning import (load/AMO/LR/SC). On a fault it records
/// the precise trap and throws a JS exception, which unwinds the compiled module call (a wasm trap)
/// so `execute` can side-exit precisely — the browser analogue of the native `Err`-unwind.
fn with_ctx<F>(f: F) -> i64
where
    F: FnOnce(&mut Hart, &mut SystemBus) -> Result<i64, Trap>,
{
    let (hart, bus) = HOST.with(|c| {
        let c = c.borrow();
        (c.hart, c.bus)
    });
    // SAFETY: `hart`/`bus` are set to live `&mut` borrows for the enclosing `run` call and cleared
    // immediately after it returns; the module is single-threaded and cannot re-enter, so there is
    // exactly one live mutable use at a time.
    let hart = unsafe { &mut *hart };
    let bus = unsafe { &mut *bus };
    match f(hart, bus) {
        Ok(v) => v,
        Err(t) => {
            HOST.with(|c| c.borrow_mut().trap = Some(t));
            throw_jit_sentinel()
        }
    }
}

fn load_width(kind: i32) -> u64 {
    match kind {
        0 | 4 => 1,
        1 | 5 => 2,
        2 | 6 => 4,
        3 => 8,
        _ => 0,
    }
}

fn mark_chain_abort() {
    let flag = HOST.with(|context| context.borrow().chain_abort);
    if !flag.is_null() {
        // SAFETY: the pointer is installed only for the duration of one non-reentrant compiled
        // call and points into the executor-owned, Box-stable chain header.
        unsafe { *flag = 1 };
    }
}

fn publish_inline_tlb(addr: u64, pa: u64, write: bool) {
    let cache = HOST.with(|context| context.borrow().inline_tlb);
    if !cache.is_null() {
        // SAFETY: the pointer is installed only for the duration of one non-reentrant compiled
        // call, and points at the executor-owned cache that outlives the import closure.
        unsafe { (*cache).fill(addr, pa, write) };
    }
}

fn with_ctx_load(addr: i64, kind: i32) -> i64 {
    with_ctx(|h, b| {
        let addr = addr as u64;
        let value = h.jit_load(b, addr, kind)?;
        let inline = HOST.with(|context| !context.borrow().inline_tlb.is_null());
        if inline {
            if h.csr.triggers_idle() {
                match h.jit_ram_phys(b, addr, load_width(kind), false) {
                    Ok(Some(pa)) => publish_inline_tlb(addr, pa, false),
                    _ => mark_chain_abort(),
                }
            } else {
                mark_chain_abort();
            }
        }
        Ok(value)
    })
}

fn with_ctx_store(addr: i64, val: i64, width: i32) {
    let addr = addr as u64;
    let barrier = with_ctx(|h, b| {
        let ram_phys = h.jit_store_with_ram_phys(b, addr, val, width)?;
        // A slow-path store is the write-TLB refill. Misaligned stores deliberately do not fill:
        // the generated fast path rejects them and a cross-page misaligned access cannot be
        // represented by one `{tag, addend}` slot.
        let aligned = width > 0
            && (addr & (u64::from(width as u32).saturating_sub(1))) == 0
            && addr
                .checked_add(u64::from(width as u32))
                .is_some_and(|end| (addr >> 12) == ((end - 1) >> 12));
        if aligned && let Some(pa) = ram_phys {
            publish_inline_tlb(addr, pa, true);
        }
        let touches_compiled_page = ram_phys.is_some_and(|pa| {
            HOST.with(|context| {
                let pages = context.borrow().compiled_pages;
                // SAFETY: the executor installs this pointer only for the duration of a compiled
                // call. The compiled-page map is not mutated while the call is in flight, so the
                // read is stable across the synchronous import.
                !pages.is_null() && unsafe { (*pages).contains_key(&(pa >> 12)) }
            })
        });
        // Non-RAM stores are MMIO or another host-visible boundary. A RAM store only needs to
        // stop a direct chain when it can invalidate code that is still live in this executor.
        Ok((ram_phys.is_none() || touches_compiled_page) as i64)
    });
    if barrier != 0 {
        mark_chain_abort();
    }
}

// ── registry entries (identical shape to the native executor, engine handle swapped) ──

/// One compiled block: its exported `run{n}` function, source page frame (page-granular
/// invalidation), and E4-T18/T19 chaining/batch identity. The batch owns the one shared state view.
struct Compiled {
    run: Function,
    page_frame: u64,
    table_index: u32,
    slot_base: u32,
    nslots: u8,
    batch_id: u32,
}

/// E4-T19 instance-registry entry — a live `WebAssembly.Instance` holding `members.len()` block
/// functions. Retains the instance + exports so the module is not GC'd while live.
struct Batch {
    members: Vec<u64>,
    est_bytes: u64,
    last_tick: u64,
    /// One exact view of `[abi::XREG_BASE, abi::HANDOFF_END)` for the private SoftMMU state
    /// memory. Inline-TLB batches import the outer memory and use the executor's shared handoff,
    /// so they have no private state view.
    state: Option<Uint8Array>,
    /// Kept alive so the instance (and its functions/memory) survive until the batch is retired.
    _instance: WebAssembly::Instance,
}

/// Rust-side transport image plus one retained JS view into the outer wasm module's linear memory.
/// The box pins the image's linear-memory offset across executor moves. A wasm memory growth detaches
/// the old ArrayBuffer, so transfers recreate the view only when its byte length becomes zero.
struct BrowserHandoff {
    // Drop the JS alias before releasing its Box-backed Rust allocation.
    view: Uint8Array,
    image: Box<CpuStateHandoff>,
}

impl BrowserHandoff {
    fn new() -> Self {
        let mut image = Box::new(CpuStateHandoff::default());
        let view = Self::view_for(image.as_mut());
        Self { view, image }
    }

    fn view_for(image: &mut CpuStateHandoff) -> Uint8Array {
        let memory = wasm_bindgen::memory().unchecked_into::<WebAssembly::Memory>();
        let byte_offset = image.as_mut_bytes().as_mut_ptr() as u32;
        Uint8Array::new_with_byte_offset_and_length(
            &memory.buffer(),
            byte_offset,
            abi::HANDOFF_LEN as u32,
        )
    }

    fn ensure_live_view(&mut self) {
        if self.view.byte_length() != abi::HANDOFF_LEN as u32 {
            self.view = Self::view_for(self.image.as_mut());
        }
    }

    fn copy_into_module(&mut self, state: &Uint8Array, hart: &Hart) {
        self.prepare(hart);
        self.ensure_live_view();
        state.set(self.view.as_ref(), 0);
    }

    fn prepare(&mut self, hart: &Hart) {
        self.image.prepare(hart);
    }

    fn state_base(&mut self) -> u32 {
        self.image.as_mut_bytes().as_mut_ptr() as u32
    }

    fn copy_from_module(&mut self, state: &Uint8Array, hart: &mut Hart) {
        // Imported guest accesses run in the outer wasm module and may grow its linear memory. Check
        // again after the compiled call before copying into the cached Rust-side transport image.
        self.ensure_live_view();
        // SAFETY INVARIANT: `image` is Box-stable and never replaced; typed-array `set` is
        // synchronous, and no Rust reference into `image` remains live across this JS mutation.
        self.view.set(state.as_ref(), 0);
        self.image.commit_registers(hart);
    }
}

/// E4-T19 registry estimate: fixed per-Instance overhead beyond emitted code (dominated by the
/// module's one-page 64 KiB `CpuState` memory). Matches the native estimate so budgets behave the same.
const INSTANCE_OVERHEAD_BYTES: u64 = 64 * 1024;

/// E4-T19 default batching K (`docs/jit-architecture.md` §7). Matches the native default.
pub const DEFAULT_BATCH_SIZE: usize = 64;

/// E4-T18 dispatch-stub sentinel a link-slot holds when NOT linked (return to dispatch).
const STUB: u32 = u32::MAX;

/// The browser (`WebAssembly.compile`/`instantiate`) [`CompiledBlockExecutor`].
pub struct BrowserExecutor {
    /// The shared `{ env: { load, store, amo, lr, sc } }` import object handed to every instantiate.
    /// Inline-TLB instances additionally import the outer wasm memory as `env.mem`.
    imports: Object,
    /// The import closures, kept alive for the executor's lifetime (dropping them would invalidate
    /// the JS functions the live instances import).
    _closures_load: Closure<dyn FnMut(i64, i32) -> i64>,
    _closures_store: Closure<dyn FnMut(i64, i64, i32)>,
    _closures_amo: Closure<dyn FnMut(i64, i64, i32, i32) -> i64>,
    _closures_lr: Closure<dyn FnMut(i64, i32) -> i64>,
    _closures_sc: Closure<dyn FnMut(i64, i64, i32) -> i64>,
    /// Box-stable Rust image plus one cached outer-wasm view. The view is part of the executor's
    /// fixed externref floor and is refreshed only if outer memory growth detached it.
    handoff: BrowserHandoff,
    /// ABI selected for newly translated batches. The default constructor keeps the isolated
    /// SoftMMU state-memory backend for the native/browser parity harness; production wasm uses the
    /// imported-memory Inline-TLB backend.
    abi: Abi,
    inline_tlb: Option<InlineTlbCache>,
    dynamic_links: Option<DynamicLinkCache>,
    compiled_page_bitmap: Option<CompiledPageBitmap>,
    funcref_table: Option<WebAssembly::Table>,
    blocks: HashMap<u64, Compiled>,
    /// Reference counts of physical pages containing live compiled blocks. A successful ordinary
    /// RAM store can stay inside a chain unless it touches one of these pages; then the pending
    /// bus write log must be drained before another compiled successor is allowed to run.
    compiled_pages: HashMap<u64, usize>,
    executed_blocks: u64,
    retired_via_jit: u64,
    // ── E4-T18 chaining state (identical to native) ──
    chaining: bool,
    chain_depth_budget: u32,
    slots: Vec<u32>,
    table: Vec<Option<u64>>,
    phys_to_index: HashMap<u64, u32>,
    incoming: HashMap<u32, Vec<u32>>,
    free_table: Vec<u32>,
    free_slots1: Vec<u32>,
    free_slots2: Vec<u32>,
    stats: ChainStats,
    // ── E4-T19 batching + registry ──
    batch_size: usize,
    batches: HashMap<u32, Batch>,
    next_batch_id: u32,
    // ── E4-T20 budgets + eviction ──
    budget: JitCacheBudget,
    policy: EvictPolicy,
    clock: u64,
    generation: u64,
    evicted_phys: HashSet<u64>,
    evictions: u64,
    flushes: u64,
    retranslations: u64,
    installs: u64,
    newly_evicted: Vec<u64>,
}

impl Default for BrowserExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl BrowserExecutor {
    /// Build the isolated SoftMMU executor used by the parity harness and as a safe fallback.
    pub fn new() -> Self {
        Self::new_with_inline_tlb(None, None, None)
    }

    /// Build the production executor. Compiled modules import the outer wasm memory so aligned
    /// RAM accesses can hit the generated inline TLB instead of crossing the JS import boundary.
    pub fn new_inline(machine: &Machine) -> Result<Self, &'static str> {
        let cache = InlineTlbCache::new(
            machine.ram_host_ptr(),
            machine.ram_len(),
            machine.ram_base(),
        )?;
        let dynamic_links = DynamicLinkCache::new()?;
        let compiled_page_bitmap = CompiledPageBitmap::new(machine.ram_len(), machine.ram_base())?;
        let mut executor =
            Self::new_with_inline_tlb(Some(cache), Some(dynamic_links), Some(compiled_page_bitmap));
        // Production Node startup has a wider working set than the small native/browser parity
        // harness. Keep the table/metadata caps unchanged, but allow a bounded wider code working
        // set so the documented 32 MiB default does not evict otherwise-hot short blocks mid-boot.
        executor.budget.max_batches = 1024;
        executor.budget.code_bytes = 64 * 1024 * 1024;
        Ok(executor)
    }

    fn new_with_inline_tlb(
        inline_tlb: Option<InlineTlbCache>,
        dynamic_links: Option<DynamicLinkCache>,
        compiled_page_bitmap: Option<CompiledPageBitmap>,
    ) -> Self {
        let funcref_table = dynamic_links.as_ref().map(|_| {
            let descriptor = Object::new();
            Reflect::set(
                &descriptor,
                &JsValue::from_str("element"),
                &JsValue::from_str("anyfunc"),
            )
            .unwrap_throw();
            Reflect::set(
                &descriptor,
                &JsValue::from_str("initial"),
                &JsValue::from_f64(1.0),
            )
            .unwrap_throw();
            WebAssembly::Table::new(&descriptor).unwrap_throw()
        });
        let abi = match (inline_tlb.as_ref(), dynamic_links.as_ref()) {
            (Some(cache), Some(links)) => Abi {
                mem: MemModel::InlineTlb,
                tlb: cache.layout,
                direct_chain: true,
                store_log_count: abi::CHAIN_STORE_COUNT,
                store_log_base: abi::CHAIN_STORE_BASE,
                store_log_capacity: abi::CHAIN_STORE_CAPACITY,
                dynamic_map_base: links.base(),
                dynamic_map_mask: links.mask(),
                dynamic_chain: true,
                chain_table: 0,
                code_pages_base: compiled_page_bitmap
                    .as_ref()
                    .map_or(0, CompiledPageBitmap::base),
                ..Abi::FROZEN
            },
            _ => Abi::FROZEN,
        };
        let load: Closure<dyn FnMut(i64, i32) -> i64> =
            Closure::new(|addr: i64, kind: i32| with_ctx_load(addr, kind));
        let store: Closure<dyn FnMut(i64, i64, i32)> =
            Closure::new(|addr: i64, val: i64, width: i32| with_ctx_store(addr, val, width));
        let amo: Closure<dyn FnMut(i64, i64, i32, i32) -> i64> =
            Closure::new(|addr: i64, val: i64, op: i32, width: i32| {
                let value = with_ctx(|h, b| h.jit_amo(b, addr as u64, val, op, width));
                mark_chain_abort();
                value
            });
        let lr: Closure<dyn FnMut(i64, i32) -> i64> = Closure::new(|addr: i64, width: i32| {
            let value = with_ctx(|h, b| h.jit_lr(b, addr as u64, width));
            mark_chain_abort();
            value
        });
        let sc: Closure<dyn FnMut(i64, i64, i32) -> i64> =
            Closure::new(|addr: i64, val: i64, width: i32| {
                let value = with_ctx(|h, b| h.jit_sc(b, addr as u64, val, width));
                mark_chain_abort();
                value
            });

        let env = Object::new();
        set_fn(&env, "load", &load);
        set_fn(&env, "store", &store);
        if inline_tlb.is_some() {
            // The inline-TLB translator still routes slow/miss paths through the
            // SoftMMU import ABI. Keep both names available so the same Rust
            // callbacks serve the fallback and inline memories.
            set_fn(&env, "softmmu_load", &load);
            set_fn(&env, "softmmu_store", &store);
        }
        set_fn(&env, "amo", &amo);
        set_fn(&env, "lr", &lr);
        set_fn(&env, "sc", &sc);
        if inline_tlb.is_some() {
            let memory = wasm_bindgen::memory();
            Reflect::set(&env, &JsValue::from_str("mem"), &memory).unwrap_throw();
        }
        if let Some(table) = &funcref_table {
            Reflect::set(&env, &JsValue::from_str("table"), table.as_ref()).unwrap_throw();
        }
        let imports = Object::new();
        Reflect::set(&imports, &JsValue::from_str("env"), &env).unwrap_throw();

        BrowserExecutor {
            imports,
            _closures_load: load,
            _closures_store: store,
            _closures_amo: amo,
            _closures_lr: lr,
            _closures_sc: sc,
            handoff: BrowserHandoff::new(),
            abi,
            inline_tlb,
            dynamic_links,
            compiled_page_bitmap,
            funcref_table,
            blocks: HashMap::new(),
            compiled_pages: HashMap::new(),
            executed_blocks: 0,
            retired_via_jit: 0,
            chaining: true,
            chain_depth_budget: CHAIN_DEPTH_BUDGET_DEFAULT,
            slots: Vec::new(),
            table: Vec::new(),
            phys_to_index: HashMap::new(),
            incoming: HashMap::new(),
            free_table: Vec::new(),
            free_slots1: Vec::new(),
            free_slots2: Vec::new(),
            stats: ChainStats::default(),
            batch_size: DEFAULT_BATCH_SIZE,
            batches: HashMap::new(),
            next_batch_id: 0,
            budget: JitCacheBudget::DEFAULT,
            policy: EvictPolicy::default(),
            clock: 0,
            generation: 0,
            evicted_phys: HashSet::new(),
            evictions: 0,
            flushes: 0,
            retranslations: 0,
            installs: 0,
            newly_evicted: Vec::new(),
        }
    }

    /// Directed-test hook for the cached-view invariant. The private SoftMMU memory must reject a
    /// one-page growth without detaching or replacing the retained handoff view's buffer.
    #[doc(hidden)]
    pub fn fixed_state_view_survives_rejected_growth(&self, phys_pc: u64) -> bool {
        let Some(compiled) = self.blocks.get(&phys_pc) else {
            return false;
        };
        let Some(batch) = self.batches.get(&compiled.batch_id) else {
            return false;
        };
        let exports = batch._instance.exports();
        let Some(memory) = Reflect::get(&exports, &JsValue::from_str("mem"))
            .ok()
            .and_then(|value| value.dyn_into::<WebAssembly::Memory>().ok())
        else {
            return false;
        };
        let Some(grow) = Reflect::get(memory.as_ref(), &JsValue::from_str("grow"))
            .ok()
            .and_then(|value| value.dyn_into::<Function>().ok())
        else {
            return false;
        };
        let Some(state) = batch.state.as_ref() else {
            return false;
        };
        let before_len = state.length();
        let before_buffer = state.buffer();
        let rejected = grow
            .call1(memory.as_ref(), &JsValue::from_f64(1.0))
            .is_err();
        let after_buffer = state.buffer();
        rejected
            && state.length() == before_len
            && Object::is(before_buffer.as_ref(), after_buffer.as_ref())
    }

    fn metadata_bytes_est(&self) -> u64 {
        let slots = (self.slots.len() * 4) as u64;
        let table = (self.table.len() * 8) as u64;
        let incoming: u64 = self.incoming.values().map(|v| (v.len() * 4) as u64).sum();
        slots + table + incoming
    }

    fn lru_victim(&self) -> Option<u32> {
        self.batches
            .iter()
            .min_by_key(|(id, b)| (b.last_tick, **id))
            .map(|(id, _)| *id)
    }

    /// E4-T20 — THE eviction correctness core (identical ordered path to the native executor), in
    /// this documented order: (1) unlink incoming + outgoing edges (E4-T18), (2) free the table entry
    /// / slot range, (3) clear the SMC page registration (drop from `blocks`), (4) drop the Instance
    /// references + decrement the registry, (5) bump the generation. Ordering is load-bearing (unlink
    /// BEFORE the table slot is freed).
    fn evict_batch(&mut self, batch_id: u32) -> bool {
        let Some(batch) = self.batches.remove(&batch_id) else {
            return false;
        };
        // Keep the batch's Instance + state view rooted until every member Function has been
        // removed. Then all K+2 browser roots die together at the explicit drop.
        for &phys in &batch.members {
            self.remove_block(phys);
            self.evicted_phys.insert(phys);
            self.newly_evicted.push(phys);
        }
        drop(batch);
        self.generation = self.generation.wrapping_add(1);
        self.evictions += 1;
        debug_assert!(!self.batches.contains_key(&batch_id));
        true
    }

    fn enforce_budget(&mut self, incoming_bytes: u64, incoming_batches: usize) {
        let bud = self.budget;
        let over_high = |s: &Self| {
            s.batches.len() + incoming_batches > bud.max_batches
                || s.estimated_bytes() + incoming_bytes > bud.code_bytes
                || s.table.len() > bud.table_slots
                || s.metadata_bytes_est() > bud.metadata_bytes
        };
        if !over_high(self) {
            return;
        }
        match self.policy {
            EvictPolicy::Flush => {
                let ids: Vec<u32> = self.batches.keys().copied().collect();
                for id in ids {
                    self.evict_batch(id);
                }
                self.flushes += 1;
            }
            EvictPolicy::BatchLru => {
                let low_batches = ((bud.max_batches * 3) / 4)
                    .min(bud.max_batches.saturating_sub(incoming_batches));
                let low_bytes = (bud.code_bytes / 4) * 3;
                while !self.batches.is_empty()
                    && (self.batches.len() + incoming_batches > low_batches
                        || self.estimated_bytes() + incoming_bytes > low_bytes
                        || self.table.len() > bud.table_slots
                        || self.metadata_bytes_est() > bud.metadata_bytes)
                {
                    let Some(victim) = self.lru_victim() else {
                        break;
                    };
                    self.evict_batch(victim);
                }
            }
        }
    }

    /// E4-T19: retire an entire batch (Module/Instance) when every member is invalidated. A
    /// cross-page batch can retain unaffected members; page invalidation handles that narrower
    /// case below without allowing a stale link into a removed function.
    fn retire_batch(&mut self, batch_id: u32) {
        if let Some(batch) = self.batches.remove(&batch_id) {
            for &phys in &batch.members {
                self.remove_block(phys);
            }
            drop(batch);
        }
    }

    fn nslots_for(block: &DecodedBlock) -> u8 {
        match block.ops.last().map(|o| &o.instr) {
            Some(
                Instr::Beq { .. }
                | Instr::Bne { .. }
                | Instr::Blt { .. }
                | Instr::Bge { .. }
                | Instr::Bltu { .. }
                | Instr::Bgeu { .. },
            ) => 2,
            _ => 1,
        }
    }

    fn alloc_block(&mut self, phys: u64, nslots: u8) -> (u32, u32) {
        let table_index = self.free_table.pop().unwrap_or_else(|| {
            let i = self.table.len() as u32;
            self.table.push(None);
            i
        });
        self.table[table_index as usize] = Some(phys);
        self.phys_to_index.insert(phys, table_index);
        let free = if nslots == 1 {
            &mut self.free_slots1
        } else {
            &mut self.free_slots2
        };
        let slot_base = match free.pop() {
            Some(b) => {
                for e in 0..u32::from(nslots) {
                    self.slots[(b + e) as usize] = STUB;
                }
                b
            }
            None => {
                let b = self.slots.len() as u32;
                for _ in 0..nslots {
                    self.slots.push(STUB);
                }
                b
            }
        };
        (table_index, slot_base)
    }

    /// E4-T18 unlink core — restore the dispatch stub in every incoming slot AND clear this block's
    /// own outgoing slots, then free its table index + slot range. Identical to the native executor.
    fn remove_block(&mut self, phys: u64) {
        let Some(c) = self.blocks.remove(&phys) else {
            return;
        };
        let mut page_became_empty = false;
        if let Some(count) = self.compiled_pages.get_mut(&c.page_frame) {
            if *count <= 1 {
                self.compiled_pages.remove(&c.page_frame);
                page_became_empty = true;
            } else {
                *count -= 1;
            }
        }
        if page_became_empty && let Some(bitmap) = self.compiled_page_bitmap.as_mut() {
            bitmap.set(c.page_frame, false);
        }
        let di = c.table_index;
        self.clear_table_entry(di);
        if let Some(links) = self.dynamic_links.as_mut() {
            links.clear_physical(phys);
        }
        if let Some(incoming) = self.incoming.remove(&di) {
            for s in incoming {
                if self.slots[s as usize] != STUB {
                    self.slots[s as usize] = STUB;
                    self.stats.links_cut += 1;
                }
            }
        }
        for e in 0..u32::from(c.nslots) {
            let s = c.slot_base + e;
            let cur = self.slots[s as usize];
            if cur != STUB {
                if let Some(v) = self.incoming.get_mut(&cur) {
                    v.retain(|x| *x != s);
                }
                self.slots[s as usize] = STUB;
                self.stats.links_cut += 1;
            }
        }
        self.table[di as usize] = None;
        self.phys_to_index.remove(&phys);
        self.free_table.push(di);
        if c.nslots == 1 {
            self.free_slots1.push(c.slot_base);
        } else {
            self.free_slots2.push(c.slot_base);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn invoke(
        run: &Function,
        state: Option<&Uint8Array>,
        handoff: &mut BrowserHandoff,
        hart: &mut Hart,
        bus: &mut SystemBus,
        inline_tlb: *mut InlineTlbCache,
        compiled_pages: *const HashMap<u64, usize>,
        chain_abort: *mut u8,
    ) -> Option<JitExit> {
        let state_base = if let Some(state) = state {
            handoff.copy_into_module(state, hart);
            0
        } else {
            handoff.prepare(hart);
            handoff.state_base()
        };
        HOST.with(|context| {
            let mut context = context.borrow_mut();
            context.hart = hart as *mut Hart;
            context.bus = bus as *mut SystemBus;
            context.inline_tlb = inline_tlb;
            context.compiled_pages = compiled_pages;
            context.chain_abort = chain_abort;
            context.trap = None;
        });
        // Keep the exception entirely in JS. Bringing a caught exception back as
        // `Result<JsValue, JsValue>` roots one externref per fault in wasm-bindgen's table.
        let returned = invoke_jit_block(run, state_base);
        let fault = HOST.with(|context| {
            let mut context = context.borrow_mut();
            context.hart = core::ptr::null_mut();
            context.bus = core::ptr::null_mut();
            context.inline_tlb = core::ptr::null_mut();
            context.compiled_pages = core::ptr::null();
            context.chain_abort = core::ptr::null_mut();
            context.trap.take()
        });
        Self::commit_raw_stores(handoff, hart, bus);
        let code = (!returned.is_nan()).then_some(returned as i32);
        let Some(code) = code else {
            if let Some(trap) = fault {
                if let Some(state) = state {
                    handoff.copy_from_module(state, hart);
                } else {
                    handoff.image.commit_registers(hart);
                }
                return Some(JitExit {
                    code: ExitCode::Trap,
                    next_pc: handoff.image.exit_pc(),
                    exit_info: trap.cause as u64,
                    trap: Some(trap),
                    retired: handoff.image.chain_retired(),
                });
            }
            // An unrecorded exception may have happened after an imported RAM/MMIO side effect.
            // Returning `None` would make core replay the block and duplicate it. HOST is already
            // cleared above, so fail closed without committing the module register image.
            throw_jit_sentinel();
        };

        if let Some(state) = state {
            handoff.copy_from_module(state, hart);
        } else {
            handoff.image.commit_registers(hart);
        }
        debug_assert_eq!(code, handoff.image.exit_reason());
        Some(JitExit {
            code: ExitCode::from_i32(code),
            next_pc: handoff.image.exit_pc(),
            exit_info: handoff.image.exit_info(),
            trap: None,
            retired: handoff.image.chain_retired(),
        })
    }

    /// Commit the side effects that raw inline-RAM stores cannot perform inside the generated
    /// module. The bytes are already in the shared guest RAM; this applies the two host-owned
    /// effects that the ordinary store path records: LR/SC reservation invalidation and physical
    /// code-write logging for page-granular JIT invalidation.
    fn commit_raw_stores(handoff: &mut BrowserHandoff, hart: &mut Hart, bus: &mut SystemBus) {
        let count = handoff.image.jit_store_count();
        if count == 0 {
            return;
        }
        if count > u64::from(abi::CHAIN_STORE_CAPACITY) {
            // Only generated code can write this header. A malformed count would make the host
            // lose a committed store, so fail closed rather than continue with partial accounting.
            throw_jit_sentinel();
        }
        for index in 0..count {
            let Some((addr, physical, width)) = handoff.image.jit_store_record(index) else {
                throw_jit_sentinel();
            };
            hart.note_jit_ram_store(addr, width);
            let Some(last) = physical.checked_add(width.saturating_sub(1)) else {
                throw_jit_sentinel();
            };
            bus.code_write_log_mut().push(physical >> 12);
            let last_frame = last >> 12;
            if last_frame != physical >> 12 {
                bus.code_write_log_mut().push(last_frame);
            }
        }
        handoff.image.clear_jit_store_log();
    }
}

/// Attach a closure to `obj[name]` as a plain JS function (the raw module imports it and calls it
/// with BigInt i64 args — the closure marshals them back to Rust `i64`).
fn set_fn<T: ?Sized>(obj: &Object, name: &str, closure: &Closure<T>) {
    Reflect::set(
        obj,
        &JsValue::from_str(name),
        closure.as_ref().unchecked_ref::<Function>(),
    )
    .unwrap_throw();
}

impl BrowserExecutor {
    fn publish_table_entry(&self, table_index: u32, run: &Function) {
        let Some(table) = &self.funcref_table else {
            return;
        };
        if table_index >= table.length() {
            table
                .grow(table_index.saturating_sub(table.length()).saturating_add(1))
                .unwrap_throw();
        }
        table.set(table_index, run).unwrap_throw();
    }

    fn clear_table_entry(&self, table_index: u32) {
        if let Some(table) = &self.funcref_table {
            table.set_raw(table_index, &JsValue::null()).unwrap_throw();
        }
    }
}

impl CompiledBlockExecutor for BrowserExecutor {
    fn install(&mut self, block: &DecodedBlock) {
        self.install_batch(core::slice::from_ref(block), &[[None, None]]);
    }

    fn install_batch(&mut self, blocks: &[DecodedBlock], intra: &[[Option<usize>; 2]]) {
        debug_assert_eq!(blocks.len(), intra.len());
        let keep: Vec<usize> = (0..blocks.len())
            .filter(|&i| !self.blocks.contains_key(&blocks[i].phys_start))
            .collect();
        let translatable: Vec<usize> = keep
            .into_iter()
            .filter(|&i| is_translatable(&blocks[i]))
            .collect();
        if translatable.is_empty() {
            return;
        }
        let mut new_local = alloc::vec![None; blocks.len()];
        for (nl, &oi) in translatable.iter().enumerate() {
            new_local[oi] = Some(nl);
        }
        let kept_blocks: Vec<DecodedBlock> =
            translatable.iter().map(|&i| blocks[i].clone()).collect();
        let kept_intra: Vec<[Option<usize>; 2]> = translatable
            .iter()
            .map(|&i| {
                let mut e = [None, None];
                for k in 0..2 {
                    e[k] = intra[i][k].and_then(|t| new_local.get(t).copied().flatten());
                }
                e
            })
            .collect();

        let bytes = match translate_batch(&kept_blocks, &self.abi, &kept_intra) {
            Ok(b) => b,
            Err(_) => {
                if kept_blocks.len() > 1 {
                    for b in &kept_blocks {
                        self.install_batch(core::slice::from_ref(b), &[[None, None]]);
                    }
                }
                return;
            }
        };
        let est_bytes = bytes.len() as u64 + INSTANCE_OVERHEAD_BYTES;
        self.enforce_budget(est_bytes, 1);

        // ── the browser-specific compile + instantiate ──
        let arr = Uint8Array::new_with_length(bytes.len() as u32);
        arr.copy_from(&bytes);
        let module = match WebAssembly::Module::new(arr.as_ref()) {
            Ok(m) => m,
            Err(_) => return,
        };
        let instance = match WebAssembly::Instance::new(&module, &self.imports) {
            Ok(i) => i,
            Err(_) => return,
        };
        let exports = instance.exports();
        let state = match self.abi.mem {
            MemModel::SoftmmuImports => {
                let mem = match Reflect::get(&exports, &JsValue::from_str("mem"))
                    .ok()
                    .and_then(|m| m.dyn_into::<WebAssembly::Memory>().ok())
                {
                    Some(m) => m,
                    None => return,
                };
                Some(Uint8Array::new_with_byte_offset_and_length(
                    &mem.buffer(),
                    abi::XREG_BASE,
                    abi::HANDOFF_LEN as u32,
                ))
            }
            MemModel::InlineTlb | MemModel::InlineTlbLoads => None,
        };

        let batch_id = self.next_batch_id;
        self.next_batch_id = self.next_batch_id.wrapping_add(1);
        let mut members = Vec::with_capacity(kept_blocks.len());
        for (nl, b) in kept_blocks.iter().enumerate() {
            let name = format!("run{nl}");
            let run = match Reflect::get(&exports, &JsValue::from_str(&name))
                .ok()
                .and_then(|f| f.dyn_into::<Function>().ok())
            {
                Some(f) => f,
                None => continue,
            };
            if self.evicted_phys.remove(&b.phys_start) {
                self.retranslations += 1;
            }
            self.installs += 1;
            let nslots = Self::nslots_for(b);
            let (table_index, slot_base) = self.alloc_block(b.phys_start, nslots);
            self.publish_table_entry(table_index, &run);
            self.blocks.insert(
                b.phys_start,
                Compiled {
                    run,
                    page_frame: b.page_frame,
                    table_index,
                    slot_base,
                    nslots,
                    batch_id,
                },
            );
            let page_was_empty = !self.compiled_pages.contains_key(&b.page_frame);
            *self.compiled_pages.entry(b.page_frame).or_default() += 1;
            if page_was_empty && let Some(bitmap) = self.compiled_page_bitmap.as_mut() {
                bitmap.set(b.page_frame, true);
            }
            members.push(b.phys_start);
        }
        if members.is_empty() {
            return;
        }
        self.batches.insert(
            batch_id,
            Batch {
                members,
                est_bytes,
                last_tick: self.clock,
                state,
                _instance: instance,
            },
        );
    }

    /// `WebAssembly.Module` construction is synchronous in this executor. Keep one host
    /// `runChunk` to eight validated block submissions total (across every periodic pump plus its final
    /// pump), so terminal input, output, and Worker RPC tasks regain the event loop between bounded
    /// compile bursts. Backlog remains queued and progresses on later chunks.
    fn max_translation_attempts_per_run(&self) -> usize {
        8
    }

    fn max_staged_nominations_per_run(&self) -> usize {
        64
    }

    fn set_batch_size(&mut self, k: usize) {
        self.batch_size = k.max(1);
    }

    fn batch_size(&self) -> usize {
        self.batch_size
    }

    fn module_count(&self) -> usize {
        self.batches.len()
    }

    fn estimated_bytes(&self) -> u64 {
        self.batches.values().map(|b| b.est_bytes).sum()
    }

    fn is_compiled(&self, phys_pc: u64) -> bool {
        self.blocks.contains_key(&phys_pc)
    }

    fn execute(&mut self, phys_pc: u64, hart: &mut Hart, bus: &mut SystemBus) -> Option<JitExit> {
        self.execute_with_budget(phys_pc, hart, bus, u64::MAX, DIRECT_CHAIN_FUEL, true)
    }

    fn execute_with_budget(
        &mut self,
        phys_pc: u64,
        hart: &mut Hart,
        bus: &mut SystemBus,
        remaining_work: u64,
        chain_budget: u64,
        allow_chaining: bool,
    ) -> Option<JitExit> {
        let context_changed = self
            .inline_tlb
            .as_mut()
            .is_some_and(|cache| cache.sync_context(hart));
        if context_changed && let Some(links) = self.dynamic_links.as_mut() {
            links.reset();
        }
        let inline_tlb = self
            .inline_tlb
            .as_mut()
            .map_or(core::ptr::null_mut(), |cache| cache as *mut InlineTlbCache);
        let compiled_pages = &self.compiled_pages as *const HashMap<u64, usize>;
        let direct_chaining = self.abi.direct_chain && self.chaining && allow_chaining;
        if self.abi.direct_chain {
            self.handoff
                .image
                .begin_chain(direct_chaining, chain_budget.min(remaining_work).max(1));
        }
        let chain_abort = if self.abi.direct_chain {
            self.handoff.image.chain_abort_ptr()
        } else {
            core::ptr::null_mut()
        };
        let exit = {
            let compiled = self.blocks.get(&phys_pc)?;
            let batch = self.batches.get_mut(&compiled.batch_id)?;
            // A miss is a pure interpreter fallback. Advance the LRU clock only after both the
            // block and its owning batch were found and a compiled call will actually be attempted.
            self.clock = self.clock.wrapping_add(1);
            batch.last_tick = self.clock;
            Self::invoke(
                &compiled.run,
                batch.state.as_ref(),
                &mut self.handoff,
                hart,
                bus,
                inline_tlb,
                compiled_pages,
                chain_abort,
            )
        };
        if exit.is_some() {
            self.executed_blocks += 1;
        }
        exit
    }

    fn invalidate_all(&mut self) {
        let live_links = self.slots.iter().filter(|&&s| s != STUB).count() as u64;
        self.stats.links_cut += live_links;
        let live_blocks: Vec<u64> = self.blocks.keys().copied().collect();
        for phys in live_blocks {
            self.remove_block(phys);
        }
        self.slots.clear();
        self.table.clear();
        self.phys_to_index.clear();
        self.incoming.clear();
        self.free_table.clear();
        self.free_slots1.clear();
        self.free_slots2.clear();
        self.batches.clear();
        if let Some(cache) = self.inline_tlb.as_mut() {
            cache.reset();
        }
        if let Some(links) = self.dynamic_links.as_mut() {
            links.reset();
        }
        self.generation = self.generation.wrapping_add(1);
        self.evicted_phys.clear();
    }

    fn link_dynamic_target(&mut self, virtual_pc: u64, phys_pc: u64) {
        let Some(table_index) = self
            .blocks
            .get(&phys_pc)
            .map(|compiled| compiled.table_index)
        else {
            if let Some(links) = self.dynamic_links.as_mut() {
                links.clear_virtual(virtual_pc);
            }
            return;
        };
        if let Some(links) = self.dynamic_links.as_mut() {
            links.publish(virtual_pc, phys_pc, table_index);
        }
    }

    fn invalidate_page(&mut self, frame: u64) {
        // E4-T19: a page-granular SMC store retires every member on the dirty page. If a compile
        // batch also contains disconnected members from other pages, retain those members and the
        // shared Module/Instance: `intra_edges_for_group` only creates direct calls for static edges
        // on the same page, so no surviving function can directly call a removed function. The
        // batch is dropped atomically when all of its members are on the invalidated page. In both
        // cases `remove_block` restores incoming links and clears dynamic targets before any table
        // entry is freed.
        let dead_batches: Vec<u32> = {
            let mut ids: Vec<u32> = self
                .blocks
                .values()
                .filter(|c| c.page_frame == frame)
                .map(|c| c.batch_id)
                .collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        for bid in dead_batches {
            let all_members_dead = self
                .blocks
                .values()
                .filter(|c| c.batch_id == bid)
                .all(|c| c.page_frame == frame);
            if all_members_dead {
                self.retire_batch(bid);
                continue;
            }

            let dead_members: Vec<u64> = self
                .blocks
                .iter()
                .filter(|(_, c)| c.batch_id == bid && c.page_frame == frame)
                .map(|(&phys, _)| phys)
                .collect();
            for phys in &dead_members {
                self.remove_block(*phys);
            }
            if let Some(batch) = self.batches.get_mut(&bid) {
                batch
                    .members
                    .retain(|phys| !dead_members.iter().any(|dead| dead == phys));
            }
        }
    }

    fn compiled_count(&self) -> usize {
        self.blocks.len()
    }

    fn executed_blocks(&self) -> u64 {
        self.executed_blocks
    }

    fn retired_via_jit(&self) -> u64 {
        self.retired_via_jit
    }

    fn note_jit_retired(&mut self, retired: u64) {
        self.retired_via_jit = self.retired_via_jit.wrapping_add(retired);
    }

    // ── E4-T18 chaining ──
    fn set_chaining(&mut self, on: bool) {
        self.chaining = on;
    }

    fn chaining(&self) -> bool {
        self.chaining
    }

    fn set_chain_depth_budget(&mut self, n: u32) {
        self.chain_depth_budget = n.max(1);
    }

    fn chain_depth_budget(&self) -> u32 {
        self.chain_depth_budget
    }

    fn link_edge(&mut self, from_phys: u64, edge: u8, to_phys: u64) {
        if !self.chaining {
            return;
        }
        let Some(&ti) = self.phys_to_index.get(&to_phys) else {
            return;
        };
        let (slot_base, nslots) = match self.blocks.get(&from_phys) {
            Some(c) => (c.slot_base, c.nslots),
            None => return,
        };
        if edge >= nslots {
            return;
        }
        let slot = slot_base + u32::from(edge);
        let cur = self.slots[slot as usize];
        if cur == ti {
            return;
        }
        if cur != STUB
            && let Some(v) = self.incoming.get_mut(&cur)
        {
            v.retain(|x| *x != slot);
        }
        self.slots[slot as usize] = ti;
        self.incoming.entry(ti).or_default().push(slot);
        self.stats.links_made += 1;
    }

    fn linked_target(&self, from_phys: u64, edge: u8) -> Option<u64> {
        let c = self.blocks.get(&from_phys)?;
        if edge >= c.nslots {
            return None;
        }
        let slot = self.slots[(c.slot_base + u32::from(edge)) as usize];
        if slot == STUB {
            return None;
        }
        self.table[slot as usize]
    }

    fn note_chain(&mut self, depth: u32) {
        self.stats.dispatch_entries += 1;
        if depth > self.stats.max_chain_depth {
            self.stats.max_chain_depth = depth;
        }
        let bucket = (depth as usize).min(CHAIN_DEPTH_HIST_LEN - 1);
        self.stats.depth_hist[bucket] += 1;
    }

    fn chain_stats(&self) -> ChainStats {
        self.stats
    }

    // ── E4-T20 budgets, eviction, stats ──
    fn set_jit_budget(&mut self, budget: JitCacheBudget) {
        self.budget = budget;
        self.enforce_budget(0, 0);
    }

    fn jit_budget(&self) -> JitCacheBudget {
        self.budget
    }

    fn set_evict_policy(&mut self, policy: EvictPolicy) {
        self.policy = policy;
    }

    fn evict_policy(&self) -> EvictPolicy {
        self.policy
    }

    fn jit_cache_stats(&self) -> JitCacheStats {
        JitCacheStats {
            code_bytes: self.estimated_bytes(),
            batches: self.batches.len(),
            table_slots: self.table.len(),
            metadata_bytes: self.metadata_bytes_est(),
            budget: self.budget,
            policy: self.policy,
            evictions: self.evictions,
            flushes: self.flushes,
            retranslations: self.retranslations,
            installs: self.installs,
            generation: self.generation,
        }
    }

    fn take_evicted(&mut self) -> Vec<u64> {
        core::mem::take(&mut self.newly_evicted)
    }

    fn evict_batch_containing(&mut self, phys_pc: u64) -> bool {
        let Some(bid) = self.blocks.get(&phys_pc).map(|c| c.batch_id) else {
            return false;
        };
        self.evict_batch(bid)
    }
}
