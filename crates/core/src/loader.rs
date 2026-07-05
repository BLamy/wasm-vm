//! Dependency-free ELF64 loader for bare-metal riscv64 executables (E0-T10).
//!
//! Hand-rolled per the System V gABI (~200 lines) instead of pulling goblin/object:
//! must be no_std, panic-free on arbitrary garbage (this is a standing fuzz target),
//! and small enough to audit. Bare-metal convention: segments load at `p_paddr`, not
//! `p_vaddr` — Spike does the same, keeping differential traces aligned (E0-T20).
//!
//! CONTRACT — no partial writes: loading is two-pass. Pass 1 validates the header and
//! EVERY `PT_LOAD` segment (file ranges and RAM ranges, all checked u64 arithmetic);
//! pass 2 copies. On any `Err`, guest RAM is bit-identical to its pre-call state.
//!
//! Symbol lookup (`tohost`/`fromhost` for HTIF, E0-T11) is best-effort: a malformed
//! `.symtab`/`.strtab` yields `None`s, never an error and never a panic.

use crate::ram::Ram;

/// Result of a successful load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoadedImage {
    /// `e_entry` — where the hart's PC should start.
    pub entry: u64,
    /// Address of the `tohost` symbol, when present (HTIF, E0-T11).
    pub tohost: Option<u64>,
    /// Address of the `fromhost` symbol, when present.
    pub fromhost: Option<u64>,
}

/// Why an image was rejected. Precision matters: an x86-64 ELF must be rejected for
/// *machine*, an rv32 ELF for *class* (tested).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElfError {
    /// Not `\x7fELF`.
    BadMagic,
    /// `EI_CLASS != ELFCLASS64`.
    WrongClass,
    /// `EI_DATA != ELFDATA2LSB`.
    WrongEndian,
    /// `e_machine != EM_RISCV (243)`.
    WrongMachine,
    /// `e_type != ET_EXEC` (`ET_DYN` lands here too, deliberately, until PIE support).
    WrongType,
    /// Any file-side inconsistency: short buffer, tables or segments pointing past
    /// EOF, arithmetic that would overflow, `p_filesz > p_memsz`.
    Truncated,
    /// A `PT_LOAD` destination `[p_paddr, p_paddr + p_memsz)` does not fit in RAM.
    SegmentOutOfRam,
}

// ── bounds-checked little-endian readers (never panic) ──────────────────────

fn u16le(b: &[u8], off: usize) -> Result<u16, ElfError> {
    let s = b.get(off..off.checked_add(2).ok_or(ElfError::Truncated)?);
    let s = s.ok_or(ElfError::Truncated)?;
    Ok(u16::from_le_bytes([s[0], s[1]]))
}
fn u32le(b: &[u8], off: usize) -> Result<u32, ElfError> {
    let s = b.get(off..off.checked_add(4).ok_or(ElfError::Truncated)?);
    let s = s.ok_or(ElfError::Truncated)?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}
fn u64le(b: &[u8], off: usize) -> Result<u64, ElfError> {
    let s = b.get(off..off.checked_add(8).ok_or(ElfError::Truncated)?);
    let s = s.ok_or(ElfError::Truncated)?;
    Ok(u64::from_le_bytes([
        s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7],
    ]))
}

/// `u64` file offset+size → in-bounds `usize` range, or `Truncated`.
fn file_range(b: &[u8], off: u64, size: u64) -> Result<(usize, usize), ElfError> {
    let end = off.checked_add(size).ok_or(ElfError::Truncated)?;
    if end > b.len() as u64 {
        return Err(ElfError::Truncated);
    }
    Ok((off as usize, end as usize))
}

const PT_LOAD: u32 = 1;
const SHT_SYMTAB: u32 = 2;
const EM_RISCV: u16 = 243;
const ET_EXEC: u16 = 2;

struct Segment {
    file_off: u64,
    filesz: u64,
    paddr: u64,
    memsz: u64,
}

/// Validate `bytes` as a bare-metal rv64 `ET_EXEC` image and load it into `ram`.
pub fn load_elf(bytes: &[u8], ram: &mut Ram) -> Result<LoadedImage, ElfError> {
    // ── ELF header (64 bytes) ────────────────────────────────────────────────
    if bytes.len() < 4 || bytes[0..4] != [0x7F, b'E', b'L', b'F'] {
        return Err(ElfError::BadMagic);
    }
    if bytes.len() < 64 {
        return Err(ElfError::Truncated);
    }
    if bytes[4] != 2 {
        return Err(ElfError::WrongClass);
    }
    if bytes[5] != 1 {
        return Err(ElfError::WrongEndian);
    }
    // Identity precision: check machine BEFORE type so an x86-64 shared object is
    // rejected for machine, matching the acceptance criteria's error-precision rule.
    let e_machine = u16le(bytes, 18)?;
    if e_machine != EM_RISCV {
        return Err(ElfError::WrongMachine);
    }
    let e_type = u16le(bytes, 16)?;
    if e_type != ET_EXEC {
        return Err(ElfError::WrongType);
    }
    let entry = u64le(bytes, 24)?;
    let e_phoff = u64le(bytes, 32)?;
    let e_shoff = u64le(bytes, 40)?;
    let e_phentsize = u64::from(u16le(bytes, 54)?);
    let e_phnum = u64::from(u16le(bytes, 56)?);
    let e_shentsize = u64::from(u16le(bytes, 58)?);
    let e_shnum = u64::from(u16le(bytes, 60)?);

    if e_phentsize < 56 {
        return Err(ElfError::Truncated);
    }

    // ── pass 1: parse + validate every PT_LOAD (no RAM writes yet) ──────────
    let mut segments: [Option<Segment>; 16] = Default::default();
    let mut nseg = 0usize;
    for i in 0..e_phnum {
        let ph = e_phoff
            .checked_add(i.checked_mul(e_phentsize).ok_or(ElfError::Truncated)?)
            .ok_or(ElfError::Truncated)?;
        let (ph, _) = file_range(bytes, ph, 56)?;
        if u32le(bytes, ph)? != PT_LOAD {
            continue;
        }
        let seg = Segment {
            file_off: u64le(bytes, ph + 8)?,
            paddr: u64le(bytes, ph + 24)?, // bare-metal: p_paddr, not p_vaddr
            filesz: u64le(bytes, ph + 32)?,
            memsz: u64le(bytes, ph + 40)?,
        };
        if seg.filesz > seg.memsz {
            return Err(ElfError::Truncated);
        }
        // File-side bounds.
        file_range(bytes, seg.file_off, seg.filesz)?;
        // RAM-side bounds: [paddr, paddr + memsz) must sit inside RAM.
        let ram_end = (ram.base() as u128) + (ram.len() as u128);
        let seg_end = (seg.paddr as u128) + (seg.memsz as u128);
        if (seg.paddr as u128) < (ram.base() as u128) || seg_end > ram_end {
            return Err(ElfError::SegmentOutOfRam);
        }
        if nseg >= segments.len() {
            return Err(ElfError::Truncated); // absurd segment count for bare metal
        }
        segments[nseg] = Some(seg);
        nseg += 1;
    }

    // ── pass 2: copy + BSS zero-fill (validation complete; cannot fail) ─────
    for seg in segments.iter().take(nseg).flatten() {
        let (a, b) = file_range(bytes, seg.file_off, seg.filesz)?; // revalidated, cheap
        if ram.write_slice(seg.paddr, &bytes[a..b]).is_err() {
            return Err(ElfError::SegmentOutOfRam); // unreachable after pass 1
        }
        // Zero-fill [paddr + filesz, paddr + memsz) in bounded chunks.
        let zeros = [0u8; 512];
        let mut at = seg.paddr.wrapping_add(seg.filesz);
        let mut remaining = seg.memsz - seg.filesz;
        while remaining > 0 {
            let n = remaining.min(zeros.len() as u64);
            if ram.write_slice(at, &zeros[..n as usize]).is_err() {
                return Err(ElfError::SegmentOutOfRam); // unreachable after pass 1
            }
            at = at.wrapping_add(n);
            remaining -= n;
        }
    }

    // ── best-effort symbol lookup (never errors, never panics) ──────────────
    let (tohost, fromhost) = find_htif_symbols(bytes, e_shoff, e_shentsize, e_shnum);

    Ok(LoadedImage {
        entry,
        tohost,
        fromhost,
    })
}

/// Scan `.symtab`/`.strtab` for `tohost`/`fromhost`. Any inconsistency → `None`s.
fn find_htif_symbols(
    bytes: &[u8],
    e_shoff: u64,
    e_shentsize: u64,
    e_shnum: u64,
) -> (Option<u64>, Option<u64>) {
    if e_shentsize < 64 {
        return (None, None);
    }
    let sh = |i: u64, field: usize| -> Option<u64> {
        let off = e_shoff.checked_add(i.checked_mul(e_shentsize)?)?;
        let off = usize::try_from(off).ok()?;
        u64le(bytes, off.checked_add(field)?).ok()
    };
    let sh32 = |i: u64, field: usize| -> Option<u32> {
        let off = e_shoff.checked_add(i.checked_mul(e_shentsize)?)?;
        let off = usize::try_from(off).ok()?;
        u32le(bytes, off.checked_add(field)?).ok()
    };

    let mut tohost = None;
    let mut fromhost = None;
    for i in 0..e_shnum.min(256) {
        if sh32(i, 4) != Some(SHT_SYMTAB) {
            continue;
        }
        let (Some(sym_off), Some(sym_size), Some(link)) = (sh(i, 24), sh(i, 32), sh32(i, 40))
        else {
            return (None, None);
        };
        // The linked string table section.
        let (Some(str_off), Some(str_size)) = (sh(u64::from(link), 24), sh(u64::from(link), 32))
        else {
            return (None, None);
        };
        let Ok((str_a, str_b)) = file_range(bytes, str_off, str_size) else {
            return (None, None);
        };
        let strtab = &bytes[str_a..str_b];

        let count = sym_size / 24;
        for s in 0..count.min(4096) {
            let Some(base) = sym_off.checked_add(s * 24) else {
                break;
            };
            let Ok((a, _)) = file_range(bytes, base, 24) else {
                break;
            };
            let (Ok(name_off), Ok(value)) = (u32le(bytes, a), u64le(bytes, a + 8)) else {
                break;
            };
            let name = name_at(strtab, name_off as usize);
            match name {
                Some(b"tohost") => tohost = Some(value),
                Some(b"fromhost") => fromhost = Some(value),
                _ => {}
            }
        }
    }
    (tohost, fromhost)
}

/// NUL-terminated name at `off` inside a string table; `None` if unterminated.
fn name_at(strtab: &[u8], off: usize) -> Option<&[u8]> {
    let tail = strtab.get(off..)?;
    let nul = tail.iter().position(|&b| b == 0)?;
    Some(&tail[..nul])
}
