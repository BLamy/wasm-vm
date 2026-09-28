# E5.5-T03u — independent predictions before implementation evidence

Prepared 2026-09-15 by `/root/fp_memory_critic`, the fresh verifier. The task
remains pending during this preparation. Reference checkout:
`0699e65ddf9cdf931ff5698c910a7047f1b88c45`. No T03u implementation diff or
execution evidence has been inspected. This document records falsifiable
predictions, not results. No task status or implementation source was changed.

Scope: the four scalar FP transfers and the existing RV64 compressed double
transfers, through the established memory authority and T03t FPR handoff. A
passing transfer proof cannot establish desktop responsiveness.

## Architectural predictions

- **P1 — FLW preserves all 32 payload bits and boxes exactly.** With RAM bytes
  `45 23 a1 ff`, `flw f0,0(x5)` must write `f0=0xffffffffffa12345`, including the
  signaling-NaN payload. `x0` stays zero and `x5` stays the address. A second
  vector `01 00 00 80` must produce `0xffffffff80000001`, not a host float or
  canonical NaN. Every other FPR remains bit-identical.
- **P2 — FSW is a raw low-word transfer.** With
  `f9=0x01234567ffa12345`, `fsw f9,0(x5)` must write exactly
  `45 23 a1 ff`, leave adjacent bytes unchanged, and preserve the malformed
  source box. It must not use the canonicalizing single-precision operand
  reader. The same indexed integer register contains a distinct sentinel.
- **P3 — FLD/FSD preserve all 64 bits.** Bytes
  `34 12 00 00 00 00 f0 7f` must load as `0x7ff0000000001234`, and storing that
  word must reproduce the eight bytes exactly. Also cover negative zero,
  all-ones, finite data, and a deliberately nonboxed word; no payload conversion
  or upper-word boxing is permitted.
- **P4 — FS and fcsr effects are exact.** From FS Initial/Clean/Dirty, a
  successful FLW/FLD writes the destination and leaves FS Dirty even when the
  loaded bits equal its old value. FSW/FSD preserve the incoming FS value.
  Every transfer preserves fflags and frm, including frm=5/6 (these transfers
  have no rounding operand). A faulting load does not dirty FS or write its
  destination.
- **P5 — FS Off wins before memory authority or devices.** Put an integer
  increment before the first transfer and point its base at unmapped RAM,
  misaligned MMIO, or a counting device. Expected: IllegalInstruction,
  precise FP instruction PC, integer prefix retired once, zero device reads
  and writes, unchanged FP state, reservation, and data bytes. Known raw
  vectors include `flw f0,0(x5)=0x0002a007`,
  `fsw f0,0(x5)=0x0002a027`, `fld f31,0(x5)=0x0002bf87`, and
  `fsd f31,0(x5)=0x01f2b027`; mtval is that original word.
- **P6 — compressed identity survives expansion.** Real fetched parcels
  `0x2000` (C.FLD f8,0(x8)), `0xa000` (C.FSD f8,0(x8)),
  `0x2002` (C.FLDSP f0,0(sp)), and `0xa002` (C.FSDSP f0,0(sp))
  advance by two bytes when successful. FS-Off mtval is the zero-extended
  16-bit parcel, never the 32-bit expansion. f0 is legal for C.FLDSP/C.FSDSP.
  Exercise both prime-register and SP forms, nonzero offsets, and maximum
  offsets: 248 for prime-register forms and 504 for SP forms.
- **P7 — integer and FP aliases remain separate.** Cover rd=rs1 for loads,
  rs1=rs2 for stores, f0/f31, x0 bases, and negative/wrapping effective-address
  additions. Address bases come only from X registers and transferred data
  only from F registers. In an instruction sequence that changes both x5 and
  f5, neither bank may overwrite the other or supply a stale address/value.

## Memory authority and precise retirement predictions

- **P8 — imported and inline paths agree.** Execute each transfer through real
  native generated modules, private browser modules, and the actual shared
  browser ABI. For aligned RAM, independently establish cold imported misses
  followed by warm inline hits; an installed module or final equal state alone
  does not prove a hit. Both paths yield P1–P7 state and exact byte ranges.
  Read-only translations may populate the read array but cannot authorize a
  write-array hit.
- **P9 — noncontiguous page crossings use both translations.** For an 8-byte
  access at VA `0x00400ffd`, map its first virtual page to physical
  `0x80004000` and its second to `0x80009000`. The payload in P3 occupies
  three bytes at `0x80004ffd..0x80004fff` and five bytes at
  `0x80009000..0x80009004`. Decoy bytes at the adjacent physical frame
  `0x80005000` remain untouched and are never substituted. Repeat a 4-byte
  crossing and both load/store directions.
- **P10 — second-fragment failure writes no data prefix.** Remove or deny the
  second P9 translation. FLD/FSD must return LoadPageFault/StorePageFault for
  an absent leaf, or LoadAccessFault/StoreAccessFault for denied RAM/PMP,
  with tval=`0x00401000`. No destination-FPR write, FS dirty transition,
  first-fragment data store, or reservation invalidation occurs. Page-table
  bookkeeping is not confused with a committed data transfer.
- **P11 — misaligned RAM uses the existing scalar policy.** Misaligned valid
  RAM transfers succeed with little-endian byte assembly/decomposition.
  Misaligned non-RAM/PMP-denied accesses produce access faults; unmapped
  crossings produce page faults. They do not acquire the atomic
  address-misaligned policy. Every fragment is checked before any store byte,
  and misaligned MMIO receives zero partial device accesses. An overflowing
  address range fails at the original address, without a wrapped prefix write.
- **P12 — PMP and context changes cannot inherit old authority.** Warm a
  transfer, then alter PMP, SATP/mapping, data privilege/MPRV, SUM/MXR, or a
  data trigger across the existing architectural boundary. The next FP
  transfer either uses the new authorized physical bytes or raises the same
  trap as the interpreter. It cannot reuse the old page/addend. A trigger at
  the address fires before its data access with unchanged destination/memory.
  Exercise the changed boundary, not unrelated CSR implementation semantics.
- **P13 — fault PC and retired prefix use the live virtual entry.** Reuse one
  physical compiled block under a distinct virtual PC, with an integer update,
  successful FP load/store, then a faulting FP transfer. Expected trap PC is
  the exact virtual offset of that last instruction (including preceding
  2-byte parcels); only the prefix retires. A machine run delivers the same
  mepc/sepc, cause, and tval as its interpreter oracle. No destination or
  instruction after the fault executes.
- **P14 — MMIO effects occur exactly once.** Use a device that records access
  count, width, offset, and value. Aligned FSW/FSD emits one B4/B8 write with
  the raw value; FLW/FLD emits one B4/B8 read. Put a later fault after the
  successful access and prove the first device side effect is not replayed.
  A faulting device access is attempted once and leaves later instructions
  unexecuted. Do not assert that a device's own attempted-access counter is
  rolled back on its returned fault.
- **P15 — reservation and code-write accounting survives raw stores.** Warm
  inline FSW/FSD then repeat with an overlapping LR reservation. After host
  commit, the reservation is gone and the exact physical code-write page is
  recorded. Nonoverlapping reservations survive; faulting stores preserve
  reservations. An atomic successor cannot consume a stale reservation while
  a raw-store log is pending. A store targeting live compiled code forces the
  authority boundary before stale code can execute.
- **P16 — store-log saturation and cross-page stores remain exact.** Exercise
  a full inline commit log, then one more FP store. Its imported fallback
  preserves raw data and accounting without losing or duplicating earlier
  records. A successful noncontiguous cross-page store records both physical
  pages and ends the chain at the established boundary; it cannot fabricate a
  single physical-page hint or enter an invalidated successor.

## Handoff, generated code, and evidence predictions

- **P17 — direct successors see committed FP writes and unwind precisely.**
  For same- and cross-module links, load f31 in the root, use it in an FP store
  in a successor, then fault on a later FP load into f0. Expected: f31 and the
  store bytes survive; f0 retains its sentinel; fcsr remains unchanged except
  FS Dirty from the successful load; the total retired prefix and virtual
  fault PC are exact. The written-FPR mask must contain only executed writes.
- **P18 — transfer/move/interpreter alternation uses current bits.** Alternate
  new memory transfers with the T03t move subset and interpreter FPR changes.
  A new generated invocation must consume the current FPR values, including
  a same-address replacement with the same numeric version. Carry the
  unchanged T03t identity proof forward; directly exercise this task's new
  memory-source/destination use. Changing only FS to Off between warm calls
  must still enforce P5.
- **P19 — bounded novel attack: FP write across browser memory growth.** A
  compiled FP load writes a signaling payload, then a counting MMIO operation
  grows the outer wasm memory, then the block returns or a following transfer
  faults. Expected written-FPR readback, FS mask, trap prefix, raw payload,
  device count, and any committed RAM store stay exact after view refresh.
  This attacks the newly written FP handoff at a real browser import boundary.
- **P20 — independent generation and sabotage signal.** Vary at least three
  critic-owned seeds, addresses, raw bits, alias pairs, FS values and widths.
  Pair interpreter equivalence with explicit independent golden bytes so
  shared code cannot make a wrong conversion self-confirming. In isolated
  scratch code, flip one expected payload bit and require the named exact
  assertion to fail. No runtime sabotage is applied to the working checkout.
- **P21 — opcode boundary and source coverage are sufficient.** Inspect final
  generated modules for integer raw-bit memory operations and existing
  env.load/env.store imports. Rounded FP arithmetic and comparison remain
  unsupported. Audit every changed hunk against recorded execution, marking
  only declarative/configuration hunks as reasoned waivers. F32/F64 arithmetic
  or a more permissive FP-specific memory authority is a contradiction.
- **P22 — artifact and product evidence remains distinct.** The worker's
  frozen source, locally rebuilt wasm, browser guest-state digest, live ISA
  suite, capability screenshot, pristine clone, and Cloudflare bytes must
  agree with cited hashes. Record any unchanged broad-gauntlet/platform
  exceptions honestly. The actual physical-key nonce trial retains its
  120-second deadline and requires independent guest readback plus visible
  application response. On failure T03q remains gated, irrespective of a new
  frame or a passing opcode fixture.

## Existing boundary observations that shaped these predictions

These are pre-existing source observations, not findings against an unseen
T03u implementation:

- `crates/core/src/hart/mod.rs:1340` passes the original raw parcel separately
  from the decoded expansion; its FS check precedes all FP reads/accesses.
- `crates/core/src/hart/mod.rs:505` validates both misaligned physical
  fragments, including noncontiguous mappings and whole-range PMP matching
  when the two fragments happen to be contiguous. The older top-of-file and
  xlate alignment comments do not describe the current scalar misaligned path.
- `crates/core/src/hart/mod.rs:1099` centralizes imported-store reservation
  handling. The browser's shared raw-store path separately drains recorded
  VA/PA/width effects at `crates/wasm/src/jit_browser.rs:1641`.
- `crates/jit-translate/src/lib.rs:2856` captures both address and store value
  before selecting inline hit versus imported miss. Changing the source bank
  must preserve that common-path capture discipline.
- `crates/wasm/src/jit_browser.rs:791` deliberately declines a single-page
  hint for cross-page/misaligned stores, and its chain barrier covers non-RAM
  and live-code writes. The ordinary checked imports are the existing authority.
- `crates/core/src/decode_c.rs:227` permits C.FLDSP f0, whereas nearby integer
  C.LDSP x0 is reserved. Applying the integer zero-register rule to FP would be
  a semantic error.

Results will be appended only after task activation and a worker-announced
implementation/evidence head. No prediction above is yet HELD or FAILED.
