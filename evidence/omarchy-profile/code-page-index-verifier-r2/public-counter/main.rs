use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{BlockCache, DecodedBlock, MicroOp};
fn add(cache: &mut BlockCache, at: u64) {
    cache.insert(DecodedBlock::new(at, vec![MicroOp { instr: Instr::FenceI, len: 4, raw: 0x100f }], 4));
}
fn main() {
    let mut cache = BlockCache::with_capacity(8);
    add(&mut cache, 0x8000_60e2);
    cache.flush();
    add(&mut cache, 0x8000_605e);
    assert!(cache.flush_page(0x80006));
    assert_eq!(cache.invalidation_stats(), (1, 2));
    add(&mut cache, 0x8000_6062);
    cache.flush();
    add(&mut cache, 0x8000_608e);
    add(&mut cache, 0x8000_10ec);
    assert!(cache.flush_page(0x80006));
    println!("actual core public invalidation_stats={:?}", cache.invalidation_stats());
    assert_eq!(cache.invalidation_stats(), (2, 4), "consumed stale slot must not decrement a later stale generation's count");
}
