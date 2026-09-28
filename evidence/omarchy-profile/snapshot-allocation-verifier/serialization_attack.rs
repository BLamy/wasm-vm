#![allow(dead_code)]
extern crate alloc;

// The driver copies the exact frozen source into this path and records its hash.
#[path = "candidate-resume.rs"]
mod resume;

use resume::{RestoreDecision, SectionReader, SnapshotWriter};

fn next(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

fn main() {
    let lengths = [0usize, 1, 7, 8, 15, 31, 63, 127, 255, 4095, 4096, 65535, 65536, 131071];
    let mut serializations = 0usize;
    let mut checked_bytes = 0usize;
    for seed0 in [0x94f6_e651u64, 0x7184_331d, 0x6332_8547, 0x0f1d_927b] {
        let mut rng = seed0;
        let core = std::array::from_fn::<u8, 32, _>(|_| next(&mut rng) as u8);
        let base = std::array::from_fn::<u8, 32, _>(|_| next(&mut rng) as u8);
        let generation = next(&mut rng);
        let mut sections: Vec<(u32, Vec<u8>)> = Vec::new();
        for step in 0..48 {
            let n = if step == 0 { 131071 } else if step == 1 { 0 } else {
                lengths[(next(&mut rng) as usize) % lengths.len()]
            };
            let tag = 1 + ((next(&mut rng) >> 16) % 16) as u32;
            let data = (0..n).map(|_| next(&mut rng) as u8).collect::<Vec<_>>();
            sections.push((tag, data));
            let mut writer = SnapshotWriter::new(&core, &base, generation);
            // This oracle spells out the format, without SnapshotWriter helpers.
            let mut expected = vec![87, 86, 77, 82, 69, 83, 85, 49, 1, 0, 0, 0];
            expected.extend(core);
            expected.extend(base);
            expected.extend(generation.to_le_bytes());
            for (tag, payload) in &sections {
                writer.section(*tag, payload);
                expected.extend(tag.to_le_bytes());
                expected.extend((payload.len() as u32).to_le_bytes());
                expected.extend(payload);
            }
            let actual = writer.finish();
            assert_eq!(actual, expected, "byte oracle: seed {seed0:#x}, step {step}");
            assert!(actual.capacity() <= actual.len() + 4096,
                "geometric spare capacity: seed {seed0:#x}, step {step}, length {}, capacity {}",
                actual.len(), actual.capacity());
            let (header, reader) = SectionReader::new(&actual).unwrap();
            header.validate_for(&core, &base, generation).unwrap();
            let decoded = reader.collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(decoded.len(), sections.len());
            for (a, (tag, bytes)) in decoded.iter().zip(&sections) {
                assert_eq!(a.tag, *tag);
                assert_eq!(a.payload, bytes);
            }
            let mut foreign_core = core;
            foreign_core[step % 32] ^= 0x40;
            let mut foreign_base = base;
            foreign_base[(step * 7) % 32] ^= 0x02;
            assert_eq!(RestoreDecision::decide(Some(&actual), &foreign_core, &base, generation).code(), "foreign_build");
            assert_eq!(RestoreDecision::decide(Some(&actual), &core, &foreign_base, generation).code(), "foreign_image");
            assert_eq!(RestoreDecision::decide(Some(&actual), &core, &base, generation ^ 1).code(), "stale");
            if step == 1 || step == 47 {
                println!("seed={seed0:#x} sections={} bytes={} capacity={} framing=exact identities=refused",
                    sections.len(), actual.len(), actual.capacity());
            }
            serializations += 1;
            checked_bytes += actual.len();
        }
    }
    println!("PASS: serializations={serializations} compared_bytes={checked_bytes} independent_seeds=4");
}
