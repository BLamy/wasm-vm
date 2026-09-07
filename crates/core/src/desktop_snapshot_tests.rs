//! Deterministic native proof for the E5-T26a desktop envelope and quiesce gate.

use super::{
    DesktopSnapshot, DesktopSnapshotBuilder, DesktopSnapshotError, DeviceWork, FORMAT_VERSION,
    MAGIC, QuiescePermit, SnapshotQuiesce, SnapshotQuiesceDevice, section,
};
use alloc::vec::Vec;

fn hex(bytes: &[u8]) -> alloc::string::String {
    use core::fmt::Write as _;
    let mut out = alloc::string::String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn populated_blob() -> Vec<u8> {
    let mut builder = DesktopSnapshotBuilder::new(0x0102_0304_0506_0708);
    builder
        .section(section::GPU, FORMAT_VERSION, &[0x10, 0x20])
        .unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, &[0xaa, 0xbb, 0xcc])
        .unwrap();
    builder.finish().unwrap()
}

#[test]
fn empty_envelope_is_byte_exact_and_stably_digested() {
    let builder = DesktopSnapshotBuilder::new(0);
    let blob = builder.finish().unwrap();
    assert_eq!(
        hex(&blob),
        "57564d4445534b3101000000000000000000000000000000000000002ab0a2cb9302ed17af89f9729e19cac6eafa53319798a4dd6b8e53a88831ddcf"
    );
    let parsed = DesktopSnapshot::parse(&blob).unwrap();
    assert_eq!(parsed.boundary_id(), 0);
    assert!(parsed.sections().is_empty());
    assert_eq!(parsed.encode(), blob);
}

#[test]
fn populated_envelope_includes_versions_component_digests_and_stable_digest() {
    let blob = populated_blob();
    assert_eq!(
        hex(&blob),
        "57564d4445534b31010000000807060504030201020000005500000001000100020000003c274a8322731c85c4d7f7d35a8b13cbab3a57a14170cce898055f9744e6612410200200010003000000fa22dfe1da9013b3c1145040acae9089e0c08bc1c1a0719614f4b73add6f6ef5aabbccf1ffe130f510bb8f552082e4c49f377f211b94f308a34dc03085df15ec9625e9"
    );
    let parsed = DesktopSnapshot::parse(&blob).unwrap();
    assert_eq!(parsed.boundary_id(), 0x0102_0304_0506_0708);
    assert_eq!(parsed.sections().len(), 2);
    assert_eq!(
        parsed.section(section::GPU).unwrap().version,
        FORMAT_VERSION
    );
    assert_eq!(parsed.section(section::GPU).unwrap().payload, [0x10, 0x20]);
    assert_eq!(
        parsed.section(section::INPUT).unwrap().version,
        FORMAT_VERSION
    );
    assert_eq!(
        parsed.section(section::INPUT).unwrap().payload,
        [0xaa, 0xbb, 0xcc]
    );
    assert_eq!(parsed.encode(), blob);
}

#[test]
fn builder_rejects_duplicate_unknown_and_forward_sections() {
    let mut builder = DesktopSnapshotBuilder::new(1);
    builder.section(section::GPU, 1, b"one").unwrap();
    assert_eq!(
        builder.section(section::GPU, 1, b"two").unwrap_err(),
        DesktopSnapshotError::BuilderDuplicateSection { tag: section::GPU }
    );

    let mut unknown = DesktopSnapshotBuilder::new(1);
    assert_eq!(
        unknown.section(0x7fff, 1, b"unknown").unwrap_err(),
        DesktopSnapshotError::UnknownSection { tag: 0x7fff }
    );

    let mut newer = DesktopSnapshotBuilder::new(1);
    assert_eq!(
        newer
            .section(section::GPU, FORMAT_VERSION + 1, b"newer")
            .unwrap_err(),
        DesktopSnapshotError::UnsupportedSectionVersion {
            tag: section::GPU,
            found: FORMAT_VERSION + 1,
            supported: FORMAT_VERSION,
        }
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LiveMachine {
    applied_sections: u32,
    marker: u8,
}

fn restore_after_preflight(
    blob: &[u8],
    machine: &mut LiveMachine,
) -> Result<(), DesktopSnapshotError> {
    // This is the intended restore ordering: parse/validate the whole envelope first, then begin
    // touching live state. Any framing/version/digest refusal therefore leaves `machine` intact.
    let snapshot = DesktopSnapshot::parse(blob)?;
    machine.applied_sections = snapshot.sections().len() as u32;
    machine.marker = 0xA5;
    Ok(())
}

fn with_mutated_byte(mut blob: Vec<u8>, offset: usize, value: u8) -> Vec<u8> {
    blob[offset] = value;
    blob
}

#[test]
fn malformed_sections_fail_closed_before_live_state_mutation() {
    let valid = populated_blob();
    let mut machine = LiveMachine {
        applied_sections: 9,
        marker: 0x5a,
    };

    // The section table starts at byte 28.  These mutations intentionally leave the old digest in
    // place so the parser must report the earlier structural refusal, not accept a partial state.
    let cases = [
        (&valid[..valid.len() - 1], "truncated"),
        (
            &with_mutated_byte(valid.clone(), 28, 0x7f),
            "unknown_section",
        ),
        (
            &with_mutated_byte(valid.clone(), 30, 2),
            "unsupported_section_version",
        ),
        // First section is 40-byte header + 2-byte payload; second tag begins at 70.
        (
            &with_mutated_byte(valid.clone(), 70, section::GPU as u8),
            "duplicate_section",
        ),
    ];
    for (blob, code) in cases {
        let before = machine;
        let err = restore_after_preflight(blob, &mut machine).unwrap_err();
        assert_eq!(err.code(), code);
        assert_eq!(machine, before, "{code} must not mutate live state");
    }

    let mut bad_envelope_digest = valid;
    let last = bad_envelope_digest.len() - 1;
    bad_envelope_digest[last] ^= 1;
    let before = machine;
    let err = restore_after_preflight(&bad_envelope_digest, &mut machine).unwrap_err();
    assert_eq!(err, DesktopSnapshotError::EnvelopeDigestMismatch);
    assert_eq!(machine, before);
}

#[test]
fn parser_rejects_trailing_table_bytes_and_component_digest_tampering() {
    let valid = populated_blob();
    let mut trailing = valid.clone();
    trailing.insert(trailing.len() - 32, 0xee);
    assert_eq!(
        DesktopSnapshot::parse(&trailing),
        Err(DesktopSnapshotError::SectionTableLengthMismatch { remaining: 1 })
    );

    let mut component = valid;
    // The first payload digest starts at 28 + 8.
    component[36] ^= 1;
    assert_eq!(
        DesktopSnapshot::parse(&component),
        Err(DesktopSnapshotError::ComponentDigestMismatch { tag: section::GPU })
    );
}

#[derive(Debug)]
struct MockDevice {
    work: DeviceWork,
    completes_on_service: bool,
    service_calls: u32,
    abort_calls: u32,
    resume_calls: u32,
    usable: bool,
    ordinary_requests: u32,
}

impl MockDevice {
    fn queued() -> Self {
        Self {
            work: DeviceWork::Queued { count: 1 },
            completes_on_service: true,
            service_calls: 0,
            abort_calls: 0,
            resume_calls: 0,
            usable: true,
            ordinary_requests: 0,
        }
    }

    fn stuck_in_flight() -> Self {
        Self {
            work: DeviceWork::InFlight { count: 1 },
            completes_on_service: false,
            service_calls: 0,
            abort_calls: 0,
            resume_calls: 0,
            usable: false,
            ordinary_requests: 0,
        }
    }

    fn ordinary_request(&mut self) -> bool {
        if !self.usable || !matches!(self.work, DeviceWork::Idle) {
            return false;
        }
        self.ordinary_requests += 1;
        true
    }
}

impl SnapshotQuiesceDevice for MockDevice {
    fn snapshot_work(&self) -> DeviceWork {
        self.work
    }

    fn service_snapshot_boundary(&mut self) {
        self.service_calls += 1;
        if self.completes_on_service {
            self.work = DeviceWork::Idle;
        }
    }

    fn abort_snapshot(&mut self) {
        self.abort_calls += 1;
        // Abort returns descriptor ownership to the normal queue path. The pending operation is
        // discarded by this fixture, but the device itself remains usable for the next request.
        self.work = DeviceWork::Idle;
        self.usable = true;
    }

    fn resume_after_snapshot(&mut self) {
        self.resume_calls += 1;
        self.usable = true;
    }
}

#[test]
fn quiesce_waits_for_one_boundary_and_releases_cleanly() {
    let mut device = MockDevice::queued();
    let mut quiesce = SnapshotQuiesce::new(2);
    let permit = quiesce.request(&mut device).unwrap();
    assert_eq!(device.service_calls, 1);
    assert!(quiesce.is_active());
    assert_eq!(
        quiesce.request(&mut device),
        Err(DesktopSnapshotError::QuiesceAlreadyActive)
    );
    quiesce.release(&mut device, permit).unwrap();
    assert!(!quiesce.is_active());
    assert_eq!(device.resume_calls, 1);
    assert!(device.ordinary_request());
    assert_eq!(device.ordinary_requests, 1);
}

#[test]
fn in_flight_timeout_is_bounded_aborts_and_leaves_device_usable() {
    let mut device = MockDevice::stuck_in_flight();
    let mut quiesce = SnapshotQuiesce::new(3);
    let err = quiesce.request(&mut device).unwrap_err();
    assert_eq!(
        err,
        DesktopSnapshotError::QuiesceBudgetExhausted {
            passes: 3,
            work: DeviceWork::InFlight { count: 1 },
        }
    );
    assert_eq!(err.code(), "quiesce_budget_exhausted");
    assert_eq!(device.service_calls, 3);
    assert_eq!(device.abort_calls, 1);
    assert!(!quiesce.is_active());
    assert!(
        device.ordinary_request(),
        "abort must reopen ordinary queue use"
    );
}

#[test]
fn explicit_abort_is_idempotent_and_invalid_permits_are_rejected() {
    let mut device = MockDevice::queued();
    let mut quiesce = SnapshotQuiesce::new(1);
    let permit: QuiescePermit = quiesce.request(&mut device).unwrap();
    quiesce.abort(&mut device);
    quiesce.abort(&mut device);
    assert_eq!(device.abort_calls, 1);
    assert!(!quiesce.is_active());
    assert_eq!(
        quiesce.release(&mut device, permit),
        Err(DesktopSnapshotError::InvalidQuiescePermit)
    );
}

#[test]
fn bad_magic_and_forward_envelope_version_are_machine_readable() {
    let mut blob = populated_blob();
    blob[..MAGIC.len()].copy_from_slice(b"BADMAGIC");
    assert_eq!(
        DesktopSnapshot::parse(&blob).unwrap_err().code(),
        "bad_magic"
    );

    let mut blob = populated_blob();
    blob[8..10].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
    assert_eq!(
        DesktopSnapshot::parse(&blob).unwrap_err().code(),
        "unsupported_envelope_version"
    );
}
