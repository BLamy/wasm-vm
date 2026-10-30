use wasm_vm_storage::session::*;
use wasm_vm_storage::session_publication;
use wasm_vm_storage::session_witness::*;

fn row(n: u64) -> Witness {
    Witness {
        transition: ExactU64(n),
        phase: Phase::Before,
        ordinal: 0,
        sequence: ExactU64(0),
        retired: ExactU64(n),
        digest: [n as u8; 32],
    }
}
fn page(before: u32, previous: Option<BlobRef>, begin: u64, count: u64) -> WitnessPage {
    WitnessPage {
        version: 2,
        previous,
        before,
        rows: (begin..begin + count).map(row).collect(),
    }
}
fn fixture() -> SessionManifest {
    let mut value =
        SessionManifest::from_bytes(include_bytes!("session_manifest/fixtures/manifest-v1.json"))
            .unwrap();
    value.begin = row(0).position();
    value.end = value.begin;
    value.events.clear();
    value.checkpoints.truncate(1);
    value.checkpoints[0].position = value.begin;
    value.checkpoints[0].next_sequence = ExactU64(1);
    value.extensions = vec![Extension {
        kind: INITIAL_KIND.into(),
        required: false,
        bytes: serde_json::to_vec(&vec![row(0)]).unwrap(),
    }];
    value.validate().unwrap();
    value
}
fn committed(
    m: &mut SessionManifest,
    page: &WitnessPage,
    pages: u32,
    finished: bool,
) -> WitnessCommitment {
    let value = WitnessCommitment {
        version: 2,
        count: page.before + page.rows.len() as u32,
        pages,
        tail: BlobRef::of(&page.to_bytes().unwrap()),
        first: row(0),
        last: page.rows.last().unwrap().clone(),
        finished,
    };
    m.end = value.last.position();
    m.extensions.truncate(1);
    m.extensions.push(Extension {
        kind: KIND.into(),
        required: true,
        bytes: value.to_bytes().unwrap(),
    });
    value
}
#[test]
fn canonical_pages_bound_rows_bytes_coordinates_and_digest_shape() {
    let original = page(0, None, 0, 16).to_bytes().unwrap();
    assert_eq!(
        WitnessPage::from_bytes(&original)
            .unwrap()
            .to_bytes()
            .unwrap(),
        original
    );
    let mut attack = original.clone();
    attack.push(b' ');
    assert!(WitnessPage::from_bytes(&attack).is_err());
    assert!(WitnessPage::from_bytes(&vec![b' '; MAX_PAGE_BYTES + 1]).is_err());
    for variant in 0..10 {
        let mut p = page(0, None, 0, 2);
        match variant {
            0 => p.version = 1,
            1 => p.rows.clear(),
            2 => p.rows = (0..17).map(row).collect(),
            3 => p.before = 1,
            4 => p.rows.swap(0, 1),
            5 => p.rows[1] = p.rows[0].clone(),
            6 => p.rows[0].phase = Phase::Observe,
            7 => p.rows[0].phase = Phase::After,
            8 => p.rows[0].retired = ExactU64(1),
            _ => {
                p.before = u32::MAX;
                p.previous = Some(BlobRef::of(b"previous"));
            }
        }
        assert!(p.to_bytes().is_err(), "variant {variant}");
    }
    let bad = String::from_utf8(original)
        .unwrap()
        .replacen("\"digest\":[0,0", "\"digest\":[0", 1);
    assert!(WitnessPage::from_bytes(bad.as_bytes()).is_err());
    let mut p = page(16, Some(BlobRef::of(b"previous")), 16, 1);
    p.previous.as_mut().unwrap().length = ExactU64(8193);
    assert!(p.to_bytes().is_err());
    p.previous.as_mut().unwrap().length = ExactU64(1);
    p.before = MAX_WITNESSES as u32;
    assert!(p.to_bytes().is_err());
}
#[test]
fn required_commitment_discovers_tail_and_preserves_v1_extension_limit() {
    let old = fixture();
    let mut m = old.clone();
    let first = page(0, None, 0, 1);
    let c = committed(&mut m, &first, 1, false);
    m.validate().unwrap();
    assert_eq!(commitment(&m).unwrap(), Some(c.clone()));
    let runtime = RuntimeDescriptor {
        machine: m.machine.clone(),
        policy: m.policy.clone(),
        captured_inputs: m.policy.required_inputs.clone(),
    };
    assert!(matches!(
        m.admit(&runtime),
        Err(SessionError::UnsupportedRequired(_))
    ));
    assert!(
        session_publication::references(&m)
            .unwrap()
            .blobs
            .contains(&c.tail)
    );
    assert!(session_publication::check_append(&old, &m).is_err());
    for variant in 0..7 {
        let mut bad = m.clone();
        match variant {
            0 => bad.extensions[1].required = false,
            1 => bad.extensions[1].kind = "unknown-required-v2".into(),
            2 => bad.extensions[1].bytes = vec![0; 8193],
            3 => bad.extensions.swap(0, 1),
            4 => bad.extensions[0].bytes = serde_json::to_vec(&vec![row(1)]).unwrap(),
            5 => bad.policy.mode = RecordingMode::CapturePrefix,
            _ => bad.extensions[1].bytes.push(b' '),
        }
        assert!(bad.validate().is_err(), "variant {variant}");
    }
    let mut bad = m.clone();
    bad.assets[0].content.sha256 = c.tail.sha256;
    bad.machine.vm_build = c.tail.sha256;
    bad.assets[0].content.length = ExactU64(c.tail.length.0 + 1);
    assert!(session_publication::references(&bad).is_err());
    assert_eq!(old.extensions.len(), 1);
}
#[test]
fn scalar_append_requires_monotonic_counts_identity_and_terminal_immutability() {
    let mut old = fixture();
    let initial = committed(&mut old, &page(0, None, 0, 1), 1, false);
    let mut next = old.clone();
    let next_page = page(1, Some(initial.tail), 1, 16);
    let value = committed(&mut next, &next_page, 2, false);
    assert_eq!(session_publication::check_append(&old, &next), Ok(()));
    for variant in 0..6 {
        let mut bad = next.clone();
        let mut c = value.clone();
        match variant {
            0 => c.first.digest[0] ^= 1,
            1 => c.pages = 1,
            2 => c.count = 1,
            3 => c.last = row(18),
            4 => c.tail.length = ExactU64(8193),
            _ => c.finished = true,
        }
        if variant == 5 {
            bad.end = row(18).position();
        }
        match c.to_bytes() {
            Ok(bytes) => {
                bad.extensions[1].bytes = bytes;
                assert!(
                    session_publication::check_append(&old, &bad).is_err(),
                    "variant {variant}"
                );
            }
            Err(_) => continue,
        }
    }
    let mut finished = next.clone();
    let mut c = value;
    c.finished = true;
    finished.extensions[1].bytes = c.to_bytes().unwrap();
    assert_eq!(session_publication::check_append(&next, &finished), Ok(()));
    assert_eq!(
        session_publication::check_append(&finished, &finished),
        Ok(())
    );
    let mut bad = finished.clone();
    bad.end = row(17).position();
    assert!(session_publication::check_append(&finished, &bad).is_err());
    let mut bad = finished.clone();
    bad.extensions[1].bytes = committed(&mut next, &next_page, 2, false)
        .to_bytes()
        .unwrap();
    assert!(session_publication::check_append(&finished, &bad).is_err());
}
