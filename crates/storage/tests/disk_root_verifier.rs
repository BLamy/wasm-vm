//! Fresh-critic regression: equal generations never identify mutable disk contents.
use std::collections::{BTreeMap, BTreeSet};
use wasm_vm_storage::disk_root::{DiskRoot, live_references};
use wasm_vm_storage::session::{BlobRef, ContentHash, ExactU64, SessionError};
use wasm_vm_storage::{ImageManifest, Layout, OVERLAY_BLOCK, OverlayBackend, OverlayDelta};

#[test]
fn equal_generation_tail_and_shared_blocks_survive_sibling_reclamation() {
    let image =
        ImageManifest::from_image(&vec![0; 2 * OVERLAY_BLOCK + 1], 4096, Layout::Split).unwrap();
    let generation = u64::MAX;
    for seed in [0x91d3_u64, 0x715f_2c1d, 0xcafe_beef, 0xe904_5eed] {
        let mut random = seed;
        for round in 0..16 {
            random = random
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            let parent_byte = ((random >> 32) as u8) & 0x7f;
            let child_byte = parent_byte ^ 0x80;
            let delta = OverlayDelta {
                image_len: image.image_len,
                base_binding: image.base_hash(),
                generation,
                blocks: vec![
                    (0, [parent_byte; OVERLAY_BLOCK]),
                    (2, [parent_byte; OVERLAY_BLOCK]),
                ],
            };
            let parent = DiskRoot::from_delta(&delta).unwrap();
            let parent_bytes = parent.to_bytes().unwrap();
            let mut child_delta = delta.clone();
            child_delta.blocks[0].1.fill(child_byte);
            let child = DiskRoot::from_delta(&child_delta).unwrap();
            assert_eq!(child.generation, ExactU64(generation));
            assert_ne!(child.to_bytes().unwrap(), parent_bytes);
            assert_eq!(
                parent.references().unwrap().len(),
                1,
                "shared bytes deduplicate"
            );

            let mut objects: BTreeMap<_, _> = [&delta, &child_delta]
                .into_iter()
                .flat_map(|d| d.blocks.iter())
                .map(|(_, b)| (ContentHash::of(b), b.to_vec()))
                .collect();
            let both: BTreeSet<_> = live_references(&[child.clone(), parent.clone()])
                .unwrap()
                .into_iter()
                .map(|r| r.sha256)
                .collect();
            let survivors = live_references(std::slice::from_ref(&parent)).unwrap();
            assert!(survivors.iter().all(|r| both.contains(&r.sha256)));
            assert!(survivors.contains(&BlobRef::of(&parent_bytes)));
            let pinned: BTreeSet<_> = survivors.into_iter().map(|r| r.sha256).collect();
            objects.retain(|hash, _| pinned.contains(hash));

            // The oracle is chosen before producing roots; it never decodes their payloads.
            let mut owned = parent
                .private_overlay(&image, generation, |reference| {
                    objects
                        .get(&reference.sha256)
                        .cloned()
                        .ok_or(SessionError::MissingAsset("block"))
                })
                .unwrap();
            for index in [0, 2] {
                assert_eq!(
                    owned.dirty_block(index),
                    Some(&[parent_byte; OVERLAY_BLOCK]),
                    "independent fill oracle: seed {seed:x}, round {round}, block {index}"
                );
            }
            assert!(
                owned.dirty_block(1).is_none(),
                "untouched base block stays sparse"
            );
            owned.write_block(2, [child_byte; OVERLAY_BLOCK]);
            let again = parent
                .private_overlay(&image, generation, |reference| {
                    Ok(objects[&reference.sha256].clone())
                })
                .unwrap();
            assert_eq!(again.dirty_block(2), Some(&[parent_byte; OVERLAY_BLOCK]));
            assert_eq!(parent.to_bytes().unwrap(), parent_bytes);
            assert!(
                child
                    .materialize(&image, generation, |reference| {
                        objects
                            .get(&reference.sha256)
                            .cloned()
                            .ok_or(SessionError::MissingAsset("block"))
                    })
                    .is_err(),
                "reclaimed child-exclusive data must not alias parent data"
            );

            let mut calls = 0;
            for (manifest, expected_generation) in [
                (&image, generation - 1),
                (
                    &ImageManifest::from_image(
                        &vec![1; 2 * OVERLAY_BLOCK + 1],
                        4096,
                        Layout::Split,
                    )
                    .unwrap(),
                    generation,
                ),
            ] {
                assert!(
                    parent
                        .materialize(manifest, expected_generation, |_| {
                            calls += 1;
                            Ok(vec![parent_byte; OVERLAY_BLOCK])
                        })
                        .is_err()
                );
            }
            assert_eq!(
                calls, 0,
                "identity rejection must precede every object load"
            );
        }
    }
}
