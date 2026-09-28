use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{BlockCache, DecodedBlock, MicroOp};
fn main() {
    let mut cache = BlockCache::with_capacity(64);
    let op = MicroOp { instr: Instr::FenceI, len: 4, raw: 0x100f };
    cache.insert(DecodedBlock::new(0x8000_0000, vec![op], 4));
    cache.flush();
    cache.insert(DecodedBlock::new(0x8000_0002, vec![op], 4));
    assert!(cache.get(0x8000_0000).is_none());
    assert!(cache.get(0x8000_0002).is_some());
    assert!(cache.flush_page(0x8000_0000 >> 12));
    assert!(cache.get(0x8000_0002).is_none());
    println!("actual core public invalidation_stats={:?}", cache.invalidation_stats());
    assert_eq!(cache.invalidation_stats(), (1, 2), "task requires baseline counter parity");
}
