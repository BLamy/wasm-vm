//! Critic-authored, literal byte oracle; compile against the frozen candidate core.
use wasm_vm_core::dev::virtio::gpu::protocol::{FORMAT_B8G8R8A8_UNORM, Rect};
use wasm_vm_core::dev::virtio::gpu::resources::{ResourceMap, TransferError};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const FULL: Rect = Rect {
    x: 0,
    y: 0,
    width: 4,
    height: 3,
};
const DEST: Rect = Rect {
    x: 1,
    y: 1,
    width: 2,
    height: 2,
};
const SINGLE: Rect = Rect {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
};

fn fixture() -> (SystemBus, ResourceMap) {
    let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
    // Three physical page crossings, discontiguous addresses, and a first source
    // pixel split over three entries. The oracle below is literal, not computed
    // by the same addressing algorithm as the implementation.
    let backing = vec![
        (DRAM_BASE + 0x1ffe, 4),
        (DRAM_BASE + 0x4007, 1),
        (DRAM_BASE + 0x6fff, 6),
        (DRAM_BASE + 0x9000, 2),
        (DRAM_BASE + 0xbffa, 14),
    ];
    let source: Vec<u8> = (1..=27).collect();
    let mut cursor = 0;
    for &(address, length) in &backing {
        let end = cursor + length as usize;
        bus.ram_mut()
            .write_slice(address, &source[cursor..end])
            .unwrap();
        cursor = end;
    }
    assert_eq!(cursor, 27);
    let mut map = ResourceMap::new();
    map.create(1, FORMAT_B8G8R8A8_UNORM, 4, 3).unwrap();
    map.attach_backing(1, backing).unwrap();
    map.get_mut(1).unwrap().host_pixels.fill(0xdead_beef);
    assert_eq!(map.get_mut(1).unwrap().flush_rect(FULL, true), FULL);
    (bus, map)
}

#[test]
fn literal_unaligned_source_crosses_sg_and_ram_pages_at_exact_end() {
    let (bus, mut map) = fixture();
    let before = bus.ram().as_bytes().to_vec();
    assert_eq!(map.transfer_to_host_2d(1, DEST, 3, &bus), Ok(()));
    let expected = [
        0xdead_beef,
        0xdead_beef,
        0xdead_beef,
        0xdead_beef,
        0xdead_beef,
        0x0706_0504,
        0x0b0a_0908,
        0xdead_beef,
        0xdead_beef,
        0x1716_1514,
        0x1b1a_1918,
        0xdead_beef,
    ];
    assert_eq!(&*map.get(1).unwrap().host_pixels, &expected);
    assert_eq!(map.get(1).unwrap().dirty_tile_count(), 1);
    assert_eq!(map.get_mut(1).unwrap().flush_rect(FULL, true), DEST);
    assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);
    assert_eq!(map.transfer_to_host_2d(1, DEST, 3, &bus), Ok(()));
    assert_eq!(map.get_mut(1).unwrap().flush_rect(SINGLE, true), SINGLE);
    assert_eq!(bus.ram().as_bytes(), before.as_slice());
    println!(
        "literal oracle: offset=3 dest=(1,1,2,2) backing=27 words=07060504,0b0a0908,17161514,1b1a1918"
    );
}

#[test]
fn invalid_tail_and_large_offsets_preserve_shadow_damage_and_guest_ram() {
    for offset in [4, 27, u64::MAX - 3, u64::MAX] {
        let (bus, mut map) = fixture();
        let before = bus.ram().as_bytes().to_vec();
        assert_eq!(
            map.transfer_to_host_2d(1, DEST, offset, &bus),
            Err(TransferError::InvalidParameter)
        );
        assert_eq!(&*map.get(1).unwrap().host_pixels, &[0xdead_beef; 12]);
        assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);
        assert_eq!(map.get_mut(1).unwrap().flush_rect(SINGLE, true), SINGLE);
        assert_eq!(bus.ram().as_bytes(), before.as_slice());
        println!("rejected offset={offset}, shadow/damage/RAM unchanged");
    }
}

#[test]
fn invalid_later_backing_range_is_prevalidated_before_the_first_row() {
    let (bus, mut map) = fixture();
    map.get_mut(1).unwrap().backing[4] = (DRAM_BASE + (1 << 20) - 2, 14);
    assert_eq!(
        map.transfer_to_host_2d(1, DEST, 3, &bus),
        Err(TransferError::InvalidParameter)
    );
    assert_eq!(&*map.get(1).unwrap().host_pixels, &[0xdead_beef; 12]);
    assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);
    assert_eq!(map.get_mut(1).unwrap().flush_rect(SINGLE, true), SINGLE);
}

#[test]
fn detached_and_destination_bounds_do_not_mutate() {
    let (bus, mut map) = fixture();
    let outside = Rect {
        x: 3,
        y: 2,
        width: 2,
        height: 1,
    };
    assert_eq!(
        map.transfer_to_host_2d(1, outside, 0, &bus),
        Err(TransferError::InvalidParameter)
    );
    map.detach_backing(1).unwrap();
    assert_eq!(
        map.transfer_to_host_2d(1, DEST, 0, &bus),
        Err(TransferError::InvalidParameter)
    );
    assert_eq!(&*map.get(1).unwrap().host_pixels, &[0xdead_beef; 12]);
    assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);
    assert_eq!(map.get_mut(1).unwrap().flush_rect(SINGLE, true), SINGLE);
}

#[test]
fn zero_area_retains_checked_noop_behavior() {
    let (bus, mut map) = fixture();
    let empty = Rect {
        x: 4,
        y: 3,
        width: 0,
        height: 0,
    };
    assert_eq!(map.transfer_to_host_2d(1, empty, 27, &bus), Ok(()));
    assert_eq!(
        map.transfer_to_host_2d(1, empty, 28, &bus),
        Err(TransferError::InvalidParameter)
    );
    assert_eq!(&*map.get(1).unwrap().host_pixels, &[0xdead_beef; 12]);
    assert_eq!(map.get(1).unwrap().dirty_tile_count(), 0);
    assert_eq!(map.get_mut(1).unwrap().flush_rect(SINGLE, true), SINGLE);
}

#[test]
fn independent_sg_partition_seeds_preserve_the_literal_oracle() {
    for seed in [
        0x7c0f_11f2_9b47_a503u64,
        0x2ff4_d78a_94eb_6971,
        0xddd1_4532_23fe_aa19,
    ] {
        let mut random = seed;
        for case in 0..256 {
            let (mut bus, mut map) = fixture();
            let mut entries = Vec::new();
            let mut logical = 0usize;
            while logical < 27 {
                random ^= random << 13;
                random ^= random >> 7;
                random ^= random << 17;
                let length = (1 + random as usize % 7).min(27 - logical);
                // Put each independent span immediately before a different page boundary.
                let address = DRAM_BASE + 0x20000 + entries.len() as u64 * 0x2000 + 0xffe;
                let bytes: Vec<u8> = ((logical + 1)..=(logical + length))
                    .map(|byte| byte as u8)
                    .collect();
                bus.ram_mut().write_slice(address, &bytes).unwrap();
                entries.push((address, length as u32));
                logical += length;
            }
            map.attach_backing(1, entries).unwrap();
            assert_eq!(
                map.transfer_to_host_2d(1, DEST, 3, &bus),
                Ok(()),
                "seed={seed:x} case={case}"
            );
            assert_eq!(
                &*map.get(1).unwrap().host_pixels,
                &[
                    0xdead_beef,
                    0xdead_beef,
                    0xdead_beef,
                    0xdead_beef,
                    0xdead_beef,
                    0x0706_0504,
                    0x0b0a_0908,
                    0xdead_beef,
                    0xdead_beef,
                    0x1716_1514,
                    0x1b1a_1918,
                    0xdead_beef,
                ],
                "seed={seed:x} case={case}"
            );
        }
        println!("SG seed={seed:016x}: 256 independently partitioned literal cases passed");
    }
}
