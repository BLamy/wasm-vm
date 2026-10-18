use std::collections::BTreeMap;
use wasm_vm_storage::disk_root::*;
use wasm_vm_storage::session::*;
use wasm_vm_storage::{ImageManifest, Layout, OVERLAY_BLOCK, OverlayBackend, OverlayDelta};

const GOLDEN: &[u8] = include_bytes!("root-v1.json");
const GENERATION: u64 = 9_007_199_254_740_993;

pub fn snapshot_backends_require_durability_and_ownership() {
    let (image, _) = fixture();
    let mut overlay = wasm_vm_storage::WriteBackOverlay::new(&image);
    let queue = overlay.shared_queue();
    assert_eq!(overlay.snapshot_blocks(0), Some(vec![]));
    overlay.write_block(1, [17; OVERLAY_BLOCK]);
    assert!(overlay.snapshot_blocks(1).is_none());
    let persisted: Vec<_> = queue
        .borrow()
        .pending_flush()
        .iter()
        .map(|(i, g, _)| (*i, *g))
        .collect();
    queue.borrow_mut().mark_persisted(&persisted);
    {
        let _held = queue.borrow_mut();
        assert!(
            overlay.snapshot_blocks(1).is_none(),
            "borrowed durability queue must refuse without panicking"
        );
    }
    assert!(overlay.snapshot_blocks(0).is_none());
    let owned = overlay.snapshot_blocks(1).unwrap();
    overlay.write_block(1, [34; OVERLAY_BLOCK]);
    assert_eq!(owned, vec![(1, [17; OVERLAY_BLOCK])]);
    assert!(overlay.snapshot_blocks(1).is_none());
    let mut memory = wasm_vm_storage::MemOverlay::new(&image);
    assert_eq!(memory.snapshot_blocks(0), Some(vec![]));
    memory.write_block(0, [17; OVERLAY_BLOCK]);
    assert!(memory.snapshot_blocks(0).is_none());
    struct Unsupported(wasm_vm_storage::MemOverlay);
    impl OverlayBackend for Unsupported {
        fn dirty_block(&self, index: u64) -> Option<&[u8; OVERLAY_BLOCK]> {
            self.0.dirty_block(index)
        }
        fn write_block(&mut self, index: u64, bytes: [u8; OVERLAY_BLOCK]) {
            self.0.write_block(index, bytes);
        }
        fn commit(&mut self) -> Result<(), wasm_vm_storage::OverlayError> {
            self.0.commit()
        }
        fn base_binding(&self) -> &[u8; 32] {
            self.0.base_binding()
        }
        fn image_len(&self) -> u64 {
            self.0.image_len()
        }
    }
    let disk = wasm_vm_storage::OverlayDisk::attach(Unsupported(memory), &image).unwrap();
    assert!(
        disk.snapshot_delta(GENERATION, 2).is_none(),
        "unknown backends cannot claim an empty or partial capture"
    );
}

fn fixture() -> (ImageManifest, OverlayDelta) {
    let image = ImageManifest::from_image(&[0; 8192], 4096, Layout::Split).unwrap();
    let delta = OverlayDelta {
        image_len: image.image_len,
        base_binding: image.base_hash(),
        generation: GENERATION,
        blocks: vec![(0, [17; OVERLAY_BLOCK]), (1, [17; OVERLAY_BLOCK])],
    };
    (image, delta)
}

fn objects(deltas: &[&OverlayDelta]) -> BTreeMap<ContentHash, Vec<u8>> {
    deltas
        .iter()
        .flat_map(|delta| delta.blocks.iter())
        .map(|(_, bytes)| (ContentHash::of(bytes), bytes.to_vec()))
        .collect()
}

pub fn golden_exact_generation() {
    let (image, delta) = fixture();
    let root = DiskRoot::from_delta(&delta).unwrap();
    assert_eq!(root.to_bytes().unwrap(), GOLDEN);
    assert_eq!(DiskRoot::from_bytes(GOLDEN).unwrap(), root);
    assert_eq!(
        serde_json::to_string(&ContentHash::of(GOLDEN)).unwrap(),
        "\"677645dd573d01e6e1189fe1c04699123499ff03b4d3d707f4cf6ccde08bd1fc\""
    );
    assert_eq!(
        root.references().unwrap().len(),
        1,
        "duplicate bytes share one object"
    );
    let reordered = serde_json::to_string_pretty(
        &serde_json::from_str::<serde_json::Value>(&image.to_json()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        admit_json(GOLDEN, &reordered, &GENERATION.to_string()).unwrap(),
        GOLDEN
    );
    let refs: Vec<BlobRef> = serde_json::from_slice(&references_json(GOLDEN).unwrap()).unwrap();
    assert_eq!(refs, root.references().unwrap());
    let mut max = root;
    max.generation = ExactU64(u64::MAX);
    let bytes = max.to_bytes().unwrap();
    assert_eq!(DiskRoot::from_bytes(&bytes).unwrap().generation.0, u64::MAX);
    admit_json(&bytes, &image.to_json(), "18446744073709551615").unwrap();
}

pub fn private_forks_restore_in_reverse() {
    let (image, mut live) = fixture();
    let before = DiskRoot::from_delta(&live).unwrap();
    let before_bytes = before.to_bytes().unwrap();
    let mut data = objects(&[&live]);
    live.blocks[0].1.fill(34);
    live.generation += 1;
    let after = DiskRoot::from_delta(&live).unwrap();
    data.extend(objects(&[&live]));
    live.blocks[0].1.fill(51);
    live.generation += 1;
    for root in [&after, &before, &after, &before] {
        let mut fork = root
            .private_overlay(&image, root.generation.0, |r| Ok(data[&r.sha256].clone()))
            .unwrap();
        assert_eq!(
            fork.dirty_block(0).unwrap(),
            if root == &before {
                &[17; OVERLAY_BLOCK]
            } else {
                &[34; OVERLAY_BLOCK]
            }
        );
        fork.write_block(0, [68; OVERLAY_BLOCK]);
        assert_eq!(fork.dirty_block(0).unwrap(), &[68; OVERLAY_BLOCK]);
        assert_eq!(fork.dirty_block(1).unwrap(), &[17; OVERLAY_BLOCK]);
    }
    assert_eq!(before.to_bytes().unwrap(), before_bytes);
    assert_eq!(live.blocks[0].1, [51; OVERLAY_BLOCK]);
    assert_eq!(
        before
            .materialize(&image, GENERATION, |r| Ok(data[&r.sha256].clone()))
            .unwrap()
            .blocks[0]
            .1,
        [17; OVERLAY_BLOCK]
    );
}

pub fn identities_refuse_before_loading() {
    let (image, delta) = fixture();
    let root = DiskRoot::from_delta(&delta).unwrap();
    let mut foreign = image.clone();
    foreign.chunks[0] = "ab".repeat(32);
    let mut bad_size = image.clone();
    bad_size.image_len = 4096;
    bad_size.chunks.pop();
    let rechunked = ImageManifest::from_image(&[0; 8192], 8192, Layout::Split).unwrap();
    for (base, generation) in [
        (&foreign, GENERATION),
        (&bad_size, GENERATION),
        (&rechunked, GENERATION),
        (&image, GENERATION + 1),
    ] {
        let mut loads = 0;
        assert!(
            root.materialize(base, generation, |_| {
                loads += 1;
                Ok(vec![17; OVERLAY_BLOCK])
            })
            .is_err()
        );
        assert_eq!(loads, 0);
    }
    let mut invalid = image.clone();
    invalid.chunk_size = 0;
    assert!(root.admit(&invalid, GENERATION).is_err());
    for generation in [
        "9007199254740992",
        "09007199254740993",
        "-1",
        "1.0",
        "18446744073709551616",
        "",
    ] {
        assert!(
            admit_json(GOLDEN, &image.to_json(), generation).is_err(),
            "{generation}"
        );
    }
    assert!(admit_json(GOLDEN, "{}", &GENERATION.to_string()).is_err());
}

pub fn payload_failure_cannot_publish_a_partial_disk() {
    let (image, delta) = fixture();
    let root = DiskRoot::from_delta(&delta).unwrap();
    assert_eq!(
        root.materialize(&image, GENERATION, |_| Err(SessionError::MissingAsset(
            "block"
        ))),
        Err(SessionError::MissingAsset("block"))
    );
    for bytes in [
        vec![17; OVERLAY_BLOCK - 1],
        vec![18; OVERLAY_BLOCK],
        vec![17; OVERLAY_BLOCK + 1],
    ] {
        assert!(
            root.private_overlay(&image, GENERATION, |_| Ok(bytes.clone()))
                .is_err()
        );
    }
    let mut calls = 0;
    let result = root.private_overlay(&image, GENERATION, |_| {
        calls += 1;
        if calls == 1 {
            Ok(vec![17; OVERLAY_BLOCK])
        } else {
            Ok(vec![18; OVERLAY_BLOCK])
        }
    });
    assert!(result.is_err());
    assert_eq!(calls, 2);
    assert_eq!(root.to_bytes().unwrap(), GOLDEN);
}

pub fn schema_order_and_bounds() {
    let (_, delta) = fixture();
    let root = DiskRoot::from_delta(&delta).unwrap();
    let text = std::str::from_utf8(GOLDEN).unwrap();
    for bad in [
        format!("{text}\n"),
        text.replacen("\"major\":1", "\"major\":2", 1),
        text.replacen("\"minor\":0", "\"minor\":1", 1),
        text.replacen("\"blocks\":", "\"extra\":0,\"blocks\":", 1),
        text.replacen(
            "\"generation\":\"9007199254740993\"",
            "\"generation\":9007199254740993",
            1,
        ),
        text.replacen("\"index\":\"0\"", "\"index\":\"00\"", 1),
        text.replacen("\"base\":\"", "\"base\":\"A", 1),
    ] {
        assert!(DiskRoot::from_bytes(bad.as_bytes()).is_err(), "{bad}");
    }
    assert!(DiskRoot::from_bytes(&vec![b' '; MAX_DISK_ROOT_BYTES + 1]).is_err());
    for indices in [vec![1, 0], vec![0, 0], vec![0, 2], vec![u64::MAX]] {
        let mut bad = root.clone();
        bad.blocks = indices
            .into_iter()
            .map(|index| DiskBlock {
                index: ExactU64(index),
                sha256: ContentHash([17; 32]),
            })
            .collect();
        assert!(bad.to_bytes().is_err());
    }
    let mut bad = root.clone();
    bad.image_len = ExactU64(0);
    assert!(bad.validate().is_err());
    let mut many = root.clone();
    many.image_len = ExactU64(u64::MAX);
    many.blocks = (0..MAX_DISK_ROOT_BLOCKS + 1)
        .map(|index| DiskBlock {
            index: ExactU64(index as u64),
            sha256: ContentHash([17; 32]),
        })
        .collect();
    assert_eq!(
        many.validate(),
        Err(SessionError::TooLarge("disk root blocks"))
    );
    let mut tail = root;
    tail.image_len = ExactU64(4097);
    tail.validate().unwrap();
    tail.image_len = ExactU64(4096);
    assert!(tail.validate().is_err());
}

pub fn deleting_child_pins_preserves_shared_ancestors() {
    let (image, delta) = fixture();
    let parent = DiskRoot::from_delta(&delta).unwrap();
    let mut child_delta = delta.clone();
    child_delta.blocks[0].1.fill(34);
    let child = DiskRoot::from_delta(&child_delta).unwrap();
    let mut data = objects(&[&delta, &child_delta]);
    let both = live_references(&[parent.clone(), child.clone()]).unwrap();
    let survivors = live_references(std::slice::from_ref(&parent)).unwrap();
    assert_eq!(both.len(), 4);
    assert_eq!(survivors.len(), 2);
    data.retain(|hash, _| survivors.iter().any(|r| &r.sha256 == hash));
    let overlay = parent
        .private_overlay(&image, GENERATION, |r| {
            data.get(&r.sha256)
                .cloned()
                .ok_or(SessionError::MissingAsset("block"))
        })
        .unwrap();
    assert_eq!(overlay.dirty_block(1).unwrap(), &[17; OVERLAY_BLOCK]);
    assert!(
        child
            .materialize(&image, GENERATION, |r| data
                .get(&r.sha256)
                .cloned()
                .ok_or(SessionError::MissingAsset("block")))
            .is_err()
    );
    let mut conflict = child;
    conflict.blocks[0].sha256 = BlobRef::of(GOLDEN).sha256;
    assert!(matches!(
        live_references(&[parent, conflict]),
        Err(SessionError::LengthMismatch { .. })
    ));
}

// Thirty-two deterministic schedules vary blocks, values, capture positions and publication order.
// The independent oracle retains only each block's expected fill byte, never decoded root output.
pub fn seeded_interleavings_keep_owned_roots_stable() {
    let image = ImageManifest::from_image(&[0; 8 * OVERLAY_BLOCK], 4096, Layout::Split).unwrap();
    for seed in 1u64..=32 {
        let mut random = seed;
        let mut live = wasm_vm_storage::MemOverlay::new(&image);
        let mut expected = [None; 8];
        let mut captures = Vec::new();
        let mut data = BTreeMap::new();
        for step in 0..24 {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            let block = (random % 8) as usize;
            let value = (seed * 7 + step) as u8;
            live.write_block(block as u64, [value; OVERLAY_BLOCK]);
            expected[block] = Some(value);
            if (step + seed) % 5 == 0 || step == 23 {
                let delta = OverlayDelta {
                    image_len: image.image_len,
                    base_binding: image.base_hash(),
                    generation: GENERATION + step,
                    blocks: live.snapshot_blocks(8).unwrap(),
                };
                data.extend(objects(&[&delta]));
                captures.push((DiskRoot::from_delta(&delta).unwrap(), expected));
            }
        }
        let count = captures.len();
        captures.rotate_left(seed as usize % count);
        if seed & 1 == 1 {
            captures.reverse();
        }
        for (root, expected) in &captures {
            let before = root.to_bytes().unwrap();
            for pass in 0..2 {
                let mut fork = root
                    .private_overlay(&image, root.generation.0, |r| Ok(data[&r.sha256].clone()))
                    .unwrap();
                for (index, value) in expected.iter().enumerate() {
                    let expected = value.map(|v| [v; OVERLAY_BLOCK]);
                    assert_eq!(
                        fork.dirty_block(index as u64),
                        expected.as_ref(),
                        "seed {seed}"
                    );
                }
                fork.write_block((seed + pass) % 8, [255; OVERLAY_BLOCK]);
            }
            assert_eq!(root.to_bytes().unwrap(), before);
        }
        for (index, value) in expected.iter().enumerate() {
            let expected = value.map(|v| [v; OVERLAY_BLOCK]);
            assert_eq!(live.dirty_block(index as u64), expected.as_ref());
        }
    }
}
