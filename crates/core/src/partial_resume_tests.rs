//! A partial block's continuation re-decodes an evicted decoded block from physical memory
//! (`rebuild_decoded_block_phys`). The continuation op is replayed from that block's cursor, so the
//! re-decoded block must be op-for-op the block the interpreter's own walk (`next_micro_op`)
//! builds at the same entry: compressed and 32-bit ops, the page edge, a page-straddling op, an
//! undecodable op and the 128-op cap all end the two walks at the same place.
use super::*;
use bus::{Bus, mmap::DRAM_BASE};

const NOP: u32 = 0x0000_0013;
const C_NOP: u16 = 0x0001;
const C_ADDI_X1_1: u16 = 0x0085; // c.addi x1, 1
const CSRR_MSCRATCH: u32 = 0x3400_21f3; // csrrs x3, mscratch, x0
const ADD_X2: u32 = 0x0011_0133; // add x2, x2, x1
const ILLEGAL: u32 = 0x0000_0000;

enum Parcel {
    Word(u32),
    Half(u16),
}

fn machine(base: u64, code: &[Parcel]) -> Machine {
    let mut m = Machine::new(64 * 1024);
    m.set_block_cache(true);
    let mut pa = base;
    for parcel in code {
        match *parcel {
            Parcel::Word(w) => {
                m.bus.store16(pa, w as u16).unwrap();
                m.bus.store16(pa + 2, (w >> 16) as u16).unwrap();
                pa += 4;
            }
            Parcel::Half(h) => {
                m.bus.store16(pa, h).unwrap();
                pa += 2;
            }
        }
    }
    m.bus.code_write_log_mut().clear();
    m
}

/// The interpreter's walk at `entry`, then the physical re-decode into a fresh cache.
fn walk_and_rebuild(base: u64, entry: u64, code: &[Parcel]) -> dispatch::DecodedBlock {
    let mut m = machine(base, code);
    m.hart.regs.pc = entry;
    m.next_micro_op(entry).unwrap();
    let walked = m
        .block_cache
        .get(entry)
        .expect("walk caches the block")
        .clone();
    m.set_block_cache_capacity(4096);
    assert!(m.block_cache.get(entry).is_none());
    assert!(m.rebuild_decoded_block_phys(entry));
    let rebuilt = m
        .block_cache
        .get(entry)
        .expect("rebuild caches the block")
        .clone();
    assert_eq!(rebuilt.ops, walked.ops, "ops at {entry:#x}");
    assert_eq!(rebuilt.total_len, walked.total_len, "length at {entry:#x}");
    assert_eq!(rebuilt.page_frame, walked.page_frame);
    rebuilt
}

#[test]
fn rebuild_matches_the_walk_for_mixed_width_ops_ending_in_a_csr_terminator() {
    let code = [
        Parcel::Half(C_ADDI_X1_1),
        Parcel::Word(ADD_X2),
        Parcel::Half(C_NOP),
        Parcel::Word(NOP),
        Parcel::Word(CSRR_MSCRATCH),
        Parcel::Word(NOP), // after the terminator: not part of the block
    ];
    let block = walk_and_rebuild(DRAM_BASE, DRAM_BASE, &code);
    assert_eq!(block.ops.len(), 5);
    assert_eq!(block.total_len, 2 + 4 + 2 + 4 + 4);
}

#[test]
fn rebuild_matches_the_walk_at_the_page_edge_and_before_a_straddling_op() {
    // Ends exactly at the page edge.
    let base = DRAM_BASE + 0x1000 - 8;
    let block = walk_and_rebuild(base, base, &[Parcel::Word(NOP), Parcel::Word(NOP)]);
    assert_eq!(block.ops.len(), 2);
    // A 32-bit op whose upper parcel is on the next page belongs to the next block.
    let base = DRAM_BASE + 0x2000 - 8;
    let block = walk_and_rebuild(
        base,
        base,
        &[
            Parcel::Word(NOP),
            Parcel::Half(C_NOP),
            Parcel::Word(ADD_X2),
            Parcel::Word(NOP),
        ],
    );
    assert_eq!(block.ops.len(), 2);
    assert_eq!(block.total_len, 6);
}

#[test]
fn rebuild_matches_the_walk_at_an_undecodable_op_and_the_op_cap() {
    let block = walk_and_rebuild(
        DRAM_BASE,
        DRAM_BASE,
        &[Parcel::Word(NOP), Parcel::Word(NOP), Parcel::Word(ILLEGAL)],
    );
    assert_eq!(block.ops.len(), 2);
    let code: alloc::vec::Vec<Parcel> = (0..200)
        .map(|i| {
            if i % 3 == 0 {
                Parcel::Half(C_NOP)
            } else {
                Parcel::Word(NOP)
            }
        })
        .collect();
    let block = walk_and_rebuild(DRAM_BASE, DRAM_BASE, &code);
    assert_eq!(block.ops.len(), dispatch::MAX_BLOCK_OPS);
}

#[test]
fn rebuild_refuses_an_entry_that_does_not_decode() {
    let mut m = machine(DRAM_BASE, &[Parcel::Word(ILLEGAL)]);
    assert!(!m.rebuild_decoded_block_phys(DRAM_BASE));
    assert!(m.block_cache.get(DRAM_BASE).is_none());
    // A 32-bit entry op straddling the page edge is never a cached (so never compiled) block.
    let edge = DRAM_BASE + 0x1000 - 2;
    let mut m = machine(edge, &[Parcel::Word(NOP)]);
    assert!(!m.rebuild_decoded_block_phys(edge));
}
