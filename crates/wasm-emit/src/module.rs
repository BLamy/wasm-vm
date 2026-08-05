//! The [`ModuleBuilder`] — accumulates the module's declarations (types, imports, functions, table,
//! memory, globals, exports, element segments, code, optional start) and serializes them into a
//! valid WASM binary (Core Spec §5.5). Two things it gets right so callers cannot get them wrong:
//!
//! * **Canonical section order + size prefixes.** Sections are emitted strictly in id order
//!   (type=1 … code=10) and each is framed as `id, byte_length(LEB), content`. The byte length is
//!   the *final* content length, computed after the content is built — this is deliberately not the
//!   "compute-length-then-fixup" pattern the ticket's adversarial #1 warns about (a nested change
//!   invalidating a pre-computed prefix), because the prefix is only ever written once the bytes
//!   exist.
//! * **Index spaces respect imports.** Imported functions/tables/memories/globals occupy the low
//!   indices of their space; `add_function` etc. hand back indices that already account for the
//!   imports, so an emitted `call`/`global.get` names the intended entity.

use crate::leb128;
use crate::types::{GlobalType, MemType, TableType, ValType};
use alloc::string::String;
use alloc::vec::Vec;

/// A function type (signature): parameter types → result types (Spec §5.3.3).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FuncType {
    pub params: Vec<ValType>,
    pub results: Vec<ValType>,
}

impl FuncType {
    pub fn new(params: &[ValType], results: &[ValType]) -> Self {
        FuncType {
            params: params.to_vec(),
            results: results.to_vec(),
        }
    }
}

/// What an import brings in — selects which index space it lands in.
pub enum ImportDesc {
    Func(u32),
    Table(TableType),
    Memory(MemType),
    Global(GlobalType),
}

struct Import {
    module: String,
    name: String,
    desc: ImportDesc,
}

/// The kind byte of an export (Spec §5.5.10).
#[derive(Clone, Copy)]
pub enum ExportKind {
    Func = 0,
    Table = 1,
    Memory = 2,
    Global = 3,
}

struct Export {
    name: String,
    kind: ExportKind,
    index: u32,
}

struct Global {
    ty: GlobalType,
    /// The constant-init expression bytes (without the trailing `end`, which we append).
    init: Vec<u8>,
}

/// An active `funcref` element segment for table 0 — the block-chaining dispatch table's initial
/// contents (§4.4). Encoded in the flag-0 form: `i32.const offset`, then a vec of func indices.
struct Element {
    offset: i32,
    funcs: Vec<u32>,
}

/// Accumulates a module and serializes it. Add declarations, then call [`ModuleBuilder::finish`].
#[derive(Default)]
pub struct ModuleBuilder {
    types: Vec<FuncType>,
    imports: Vec<Import>,
    functions: Vec<u32>, // type index per defined function
    tables: Vec<TableType>,
    memories: Vec<MemType>,
    globals: Vec<Global>,
    exports: Vec<Export>,
    elements: Vec<Element>,
    code: Vec<Vec<u8>>, // one finished FuncBuilder body per defined function
    start: Option<u32>,

    // Import counts, to offset the defined-entity index spaces.
    imported_funcs: u32,
    imported_tables: u32,
    imported_mems: u32,
    imported_globals: u32,
}

impl ModuleBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Intern a function type, returning its type index (deduplicated).
    pub fn add_type(&mut self, ty: FuncType) -> u32 {
        if let Some(i) = self.types.iter().position(|t| *t == ty) {
            return i as u32;
        }
        self.types.push(ty);
        self.types.len() as u32 - 1
    }

    /// Import a function of type `type_idx`, returning its function index.
    pub fn import_func(&mut self, module: &str, name: &str, type_idx: u32) -> u32 {
        assert!(
            self.functions.is_empty(),
            "all imports must be declared before any defined function"
        );
        self.imports.push(Import {
            module: module.into(),
            name: name.into(),
            desc: ImportDesc::Func(type_idx),
        });
        let idx = self.imported_funcs;
        self.imported_funcs += 1;
        idx
    }

    /// Import a table (the JIT's dispatch `funcref` table), returning its table index.
    pub fn import_table(&mut self, module: &str, name: &str, ty: TableType) -> u32 {
        self.imports.push(Import {
            module: module.into(),
            name: name.into(),
            desc: ImportDesc::Table(ty),
        });
        let idx = self.imported_tables;
        self.imported_tables += 1;
        idx
    }

    /// Import the shared guest memory, returning its memory index.
    pub fn import_memory(&mut self, module: &str, name: &str, ty: MemType) -> u32 {
        self.imports.push(Import {
            module: module.into(),
            name: name.into(),
            desc: ImportDesc::Memory(ty),
        });
        let idx = self.imported_mems;
        self.imported_mems += 1;
        idx
    }

    /// Import a global, returning its global index.
    pub fn import_global(&mut self, module: &str, name: &str, ty: GlobalType) -> u32 {
        self.imports.push(Import {
            module: module.into(),
            name: name.into(),
            desc: ImportDesc::Global(ty),
        });
        let idx = self.imported_globals;
        self.imported_globals += 1;
        idx
    }

    /// Declare a defined function of type `type_idx`. Returns its function index (past the imports).
    /// The body must be supplied to [`ModuleBuilder::finish`]-time via [`ModuleBuilder::add_code`] in
    /// the same order — this call reserves the slot.
    pub fn add_function(&mut self, type_idx: u32) -> u32 {
        let idx = self.imported_funcs + self.functions.len() as u32;
        self.functions.push(type_idx);
        idx
    }

    /// Attach a finished function body (from `FuncBuilder::finish`). The Nth `add_code` pairs with
    /// the Nth `add_function`.
    pub fn add_code(&mut self, body: Vec<u8>) {
        self.code.push(body);
    }

    /// Define a table (usually the dispatch table is imported, but a module may own one).
    pub fn add_table(&mut self, ty: TableType) -> u32 {
        let idx = self.imported_tables + self.tables.len() as u32;
        self.tables.push(ty);
        idx
    }

    /// Define a memory.
    pub fn add_memory(&mut self, ty: MemType) -> u32 {
        let idx = self.imported_mems + self.memories.len() as u32;
        self.memories.push(ty);
        idx
    }

    /// Define a global with a constant-init expression (raw bytes, no trailing `end`).
    pub fn add_global(&mut self, ty: GlobalType, init: Vec<u8>) -> u32 {
        let idx = self.imported_globals + self.globals.len() as u32;
        self.globals.push(Global { ty, init });
        idx
    }

    /// Export an entity by name/kind/index.
    pub fn export(&mut self, name: &str, kind: ExportKind, index: u32) {
        self.exports.push(Export {
            name: name.into(),
            kind,
            index,
        });
    }

    /// Add an active `funcref` element segment initializing table 0 at `offset` with `funcs`.
    pub fn add_element(&mut self, offset: i32, funcs: &[u32]) {
        self.elements.push(Element {
            offset,
            funcs: funcs.to_vec(),
        });
    }

    /// Set the start function (Spec §5.5.9).
    pub fn set_start(&mut self, func_idx: u32) {
        self.start = Some(func_idx);
    }

    // ---- serialization ----

    /// Frame `content` as a section: `id`, its LEB byte length, then the content itself. The length
    /// is measured from the finished bytes, so no pre-computed prefix can go stale.
    fn emit_section(out: &mut Vec<u8>, id: u8, content: &[u8]) {
        if content.is_empty() {
            return;
        }
        out.push(id);
        leb128::write_u32(out, content.len() as u32);
        out.extend_from_slice(content);
    }

    /// Serialize the whole module to a `Vec<u8>`. Panics if `add_function`/`add_code` counts differ.
    pub fn finish(&self) -> Vec<u8> {
        assert_eq!(
            self.functions.len(),
            self.code.len(),
            "each declared function needs exactly one body (functions={}, bodies={})",
            self.functions.len(),
            self.code.len()
        );

        let mut out = Vec::with_capacity(64 + self.code.iter().map(|c| c.len() + 8).sum::<usize>());
        // Magic + version.
        out.extend_from_slice(b"\0asm");
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0x00]);

        let mut buf = Vec::with_capacity(256);

        // 1: type
        buf.clear();
        leb128::write_u32(&mut buf, self.types.len() as u32);
        for t in &self.types {
            buf.push(0x60); // functype tag
            leb128::write_u32(&mut buf, t.params.len() as u32);
            for p in &t.params {
                buf.push(p.byte());
            }
            leb128::write_u32(&mut buf, t.results.len() as u32);
            for r in &t.results {
                buf.push(r.byte());
            }
        }
        Self::emit_section(&mut out, 1, &buf);

        // 2: import
        buf.clear();
        leb128::write_u32(&mut buf, self.imports.len() as u32);
        for imp in &self.imports {
            Self::emit_name(&mut buf, &imp.module);
            Self::emit_name(&mut buf, &imp.name);
            match &imp.desc {
                ImportDesc::Func(t) => {
                    buf.push(0x00);
                    leb128::write_u32(&mut buf, *t);
                }
                ImportDesc::Table(tt) => {
                    buf.push(0x01);
                    tt.encode(&mut buf);
                }
                ImportDesc::Memory(mt) => {
                    buf.push(0x02);
                    mt.limits.encode(&mut buf);
                }
                ImportDesc::Global(gt) => {
                    buf.push(0x03);
                    gt.encode(&mut buf);
                }
            }
        }
        Self::emit_section(&mut out, 2, &buf);

        // 3: function (type indices of defined functions)
        buf.clear();
        leb128::write_u32(&mut buf, self.functions.len() as u32);
        for t in &self.functions {
            leb128::write_u32(&mut buf, *t);
        }
        Self::emit_section(&mut out, 3, &buf);

        // 4: table
        buf.clear();
        leb128::write_u32(&mut buf, self.tables.len() as u32);
        for tt in &self.tables {
            tt.encode(&mut buf);
        }
        Self::emit_section(&mut out, 4, &buf);

        // 5: memory
        buf.clear();
        leb128::write_u32(&mut buf, self.memories.len() as u32);
        for mt in &self.memories {
            mt.limits.encode(&mut buf);
        }
        Self::emit_section(&mut out, 5, &buf);

        // 6: global
        buf.clear();
        leb128::write_u32(&mut buf, self.globals.len() as u32);
        for g in &self.globals {
            g.ty.encode(&mut buf);
            buf.extend_from_slice(&g.init);
            buf.push(0x0b); // end of init expr
        }
        Self::emit_section(&mut out, 6, &buf);

        // 7: export
        buf.clear();
        leb128::write_u32(&mut buf, self.exports.len() as u32);
        for e in &self.exports {
            Self::emit_name(&mut buf, &e.name);
            buf.push(e.kind as u8);
            leb128::write_u32(&mut buf, e.index);
        }
        Self::emit_section(&mut out, 7, &buf);

        // 8: start
        if let Some(s) = self.start {
            buf.clear();
            leb128::write_u32(&mut buf, s);
            Self::emit_section(&mut out, 8, &buf);
        }

        // 9: element (active funcref segments for table 0, flag form 0)
        buf.clear();
        leb128::write_u32(&mut buf, self.elements.len() as u32);
        for el in &self.elements {
            leb128::write_u32(&mut buf, 0); // flags: active, table 0, funcref, elem-kind implicit
            buf.push(0x41); // i32.const
            leb128::write_i32(&mut buf, el.offset);
            buf.push(0x0b); // end of offset expr
            leb128::write_u32(&mut buf, el.funcs.len() as u32);
            for f in &el.funcs {
                leb128::write_u32(&mut buf, *f);
            }
        }
        Self::emit_section(&mut out, 9, &buf);

        // 10: code (each body already carries locals + instrs + terminating end)
        buf.clear();
        leb128::write_u32(&mut buf, self.code.len() as u32);
        for body in &self.code {
            leb128::write_u32(&mut buf, body.len() as u32);
            buf.extend_from_slice(body);
        }
        Self::emit_section(&mut out, 10, &buf);

        out
    }

    #[inline]
    fn emit_name(out: &mut Vec<u8>, s: &str) {
        leb128::write_u32(out, s.len() as u32);
        out.extend_from_slice(s.as_bytes());
    }
}
