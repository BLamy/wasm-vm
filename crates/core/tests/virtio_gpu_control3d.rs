//! Literal VirtIO packets through the Machine service boundary. The native sink
//! proves transport only; the separate browser acceptance supplies actual GL.
#![cfg(all(feature = "virgl-control-proof", not(feature = "zicsr-stub")))]

use std::{cell::RefCell, rc::Rc};

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::control3d::{
    Control3dError, Control3dEvent, Control3dOperation, Control3dSink,
};
use wasm_vm_core::dev::virtio::gpu::{GpuState, NullSink, VirtioGpu};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 4 * 1024 * 1024;
const DESC: u64 = virt::DRAM_BASE + 0x6000;
const AVAIL: u64 = virt::DRAM_BASE + 0x7000;
const USED: u64 = virt::DRAM_BASE + 0x8000;
const REQUEST: u64 = virt::DRAM_BASE + 0x10000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14000;
const BACKING: u64 = virt::DRAM_BASE + 0x20000;
const BACKING2: u64 = virt::DRAM_BASE + 0x30000;
const OK: u32 = 0x1100;
const UNSPEC: u32 = 0x1200;
const OOM: u32 = 0x1201;
const INVALID_RESOURCE: u32 = 0x1203;
const INVALID_CONTEXT: u32 = 0x1204;
const INVALID_PARAMETER: u32 = 0x1205;

// Independent offsets from Linux v6.1 include/uapi/linux/virtio_gpu.h and
// VirtIO 1.2 section 5.7. No production protocol encoder/constants decide bytes.
fn put32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
fn header(op: u32, ctx: u32, length: usize) -> Vec<u8> {
    let mut bytes = vec![0; length];
    put32(&mut bytes, 0, op);
    put32(&mut bytes, 16, ctx);
    bytes
}
fn context(id: u32) -> Vec<u8> {
    let mut bytes = header(0x200, id, 96);
    put32(&mut bytes, 24, 5);
    bytes[32..37].copy_from_slice(b"proof");
    bytes
}
fn resource(id: u32, target: u32, format: u32, bind: u32, width: u32, height: u32) -> Vec<u8> {
    let mut bytes = header(0x204, 0, 72);
    for (index, value) in [id, target, format, bind, width, height, 1, 1, 0, 0, 0, 0]
        .into_iter()
        .enumerate()
    {
        put32(&mut bytes, 24 + index * 4, value);
    }
    bytes
}
fn id_command(op: u32, ctx: u32, id: u32) -> Vec<u8> {
    let mut bytes = header(op, ctx, 32);
    put32(&mut bytes, 24, id);
    bytes
}
fn backing(id: u32, entries: &[(u64, u32)]) -> Vec<u8> {
    let mut bytes = id_command(0x106, 0, id);
    put32(&mut bytes, 28, entries.len() as u32);
    for &(addr, length) in entries {
        bytes.extend_from_slice(&addr.to_le_bytes());
        bytes.extend_from_slice(&length.to_le_bytes());
        bytes.extend_from_slice(&[0; 4]);
    }
    bytes
}
fn reply(request: &[u8], response: u32) -> Vec<u8> {
    let mut out = header(
        response,
        u32::from_le_bytes(request[16..20].try_into().unwrap()),
        24,
    );
    let fence = u32::from_le_bytes(request[4..8].try_into().unwrap()) & 1;
    put32(&mut out, 4, fence);
    if fence != 0 {
        out[8..16].copy_from_slice(&request[8..16]);
    }
    out[20] = request[20];
    out
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Default)]
struct Recorder {
    events: Vec<Control3dEvent>,
    fail_next: Option<Control3dError>,
}
struct Sink(Rc<RefCell<Recorder>>);
impl Control3dSink for Sink {
    fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError> {
        let mut state = self.0.borrow_mut();
        if let Some(error) = state.fail_next.take() {
            return Err(error);
        }
        state.events.push(event.clone());
        Ok(())
    }
}
struct Queue {
    machine: Machine,
    state: Rc<RefCell<GpuState>>,
    recorder: Rc<RefCell<Recorder>>,
    base: u64,
    next: u16,
    portable: bool,
}
impl Queue {
    fn new(proof: bool, negotiate: bool) -> Self {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let recorder = Rc::new(RefCell::new(Recorder::default()));
        let (_, state) = if proof {
            machine.enable_virtio_gpu_control3d_proof(
                Box::new(NullSink),
                Box::new(Sink(recorder.clone())),
            )
        } else {
            machine.enable_virtio_gpu(Box::new(NullSink))
        }
        .unwrap();
        let base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        let mut queue = Self {
            machine,
            state,
            recorder,
            base,
            next: 0,
            portable: false,
        };
        #[cfg(feature = "gpu-trace")]
        queue.state.borrow_mut().enable_command_trace();
        queue.configure();
        if negotiate {
            queue.negotiate();
        }
        queue
    }
    fn mmio(&mut self, offset: u64, value: u32) {
        self.machine
            .bus_mut()
            .store32(self.base + offset, value)
            .unwrap();
    }
    fn read_mmio(&mut self, offset: u64) -> u32 {
        self.machine.bus_mut().load32(self.base + offset).unwrap()
    }
    fn write(&mut self, addr: u64, bytes: &[u8]) {
        self.machine
            .bus_mut()
            .ram_mut()
            .write_slice(addr, bytes)
            .unwrap();
    }
    fn read(&mut self, addr: u64, length: usize) -> Vec<u8> {
        let mut bytes = vec![0; length];
        self.machine
            .bus_mut()
            .ram()
            .read_slice(addr, &mut bytes)
            .unwrap();
        bytes
    }
    fn configure(&mut self) {
        self.write(AVAIL, &[0; 40]);
        self.write(USED, &[0; 136]);
        self.mmio(0x30, 0);
        self.mmio(0x38, 16);
        for (offset, addr) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
            self.mmio(offset, addr as u32);
            self.mmio(offset + 4, (addr >> 32) as u32);
        }
        self.mmio(0x44, 1);
    }
    fn negotiate(&mut self) {
        self.mmio(0x70, 3);
        self.mmio(0x24, 0);
        self.mmio(0x20, 1); // Only VIRGL; CONTEXT_INIT and blob features stay off.
        self.mmio(0x24, 1);
        self.mmio(0x20, 1); // VERSION_1.
        self.mmio(0x70, 11);
        assert_ne!(self.read_mmio(0x70) & 8, 0);
        self.mmio(0x70, 15);
    }
    fn descriptor(
        &mut self,
        index: usize,
        addr: u64,
        length: u32,
        write: bool,
        next: Option<usize>,
    ) {
        let mut bytes = [0; 16];
        bytes[..8].copy_from_slice(&addr.to_le_bytes());
        put32(&mut bytes, 8, length);
        let flags: u16 = u16::from(write) * 2 + u16::from(next.is_some());
        bytes[12..14].copy_from_slice(&flags.to_le_bytes());
        bytes[14..16].copy_from_slice(&(next.unwrap_or(0) as u16).to_le_bytes());
        self.write(DESC + index as u64 * 16, &bytes);
    }
    fn submit_split(
        &mut self,
        request: &[u8],
        request_parts: &[usize],
        response_parts: &[usize],
    ) -> (Vec<u8>, u32) {
        assert_eq!(request_parts.iter().sum::<usize>(), request.len());
        self.write(REQUEST, request);
        self.write(RESPONSE, &[0xa5; 64]);
        let total = request_parts.len() + response_parts.len();
        assert!(total <= 16);
        let mut offset = 0;
        for (index, &length) in request_parts.iter().enumerate() {
            self.descriptor(
                index,
                REQUEST + offset,
                length as u32,
                false,
                Some(index + 1),
            );
            offset += length as u64;
        }
        offset = 0;
        for (part, &length) in response_parts.iter().enumerate() {
            let index = request_parts.len() + part;
            self.descriptor(
                index,
                RESPONSE + offset,
                length as u32,
                true,
                (index + 1 < total).then_some(index + 1),
            );
            offset += length as u64;
        }
        let ring = self.next % 16;
        self.machine
            .bus_mut()
            .store16(AVAIL + 4 + u64::from(ring) * 2, 0)
            .unwrap();
        self.next = self.next.wrapping_add(1);
        self.machine
            .bus_mut()
            .store16(AVAIL + 2, self.next)
            .unwrap();
        self.mmio(0x50, 0);
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
        assert_eq!(self.machine.bus_mut().load16(USED + 2).unwrap(), self.next);
        assert_eq!(
            self.machine
                .bus_mut()
                .load32(USED + 4 + u64::from(ring) * 8)
                .unwrap(),
            0
        );
        let used_len = self
            .machine
            .bus_mut()
            .load32(USED + 8 + u64::from(ring) * 8)
            .unwrap();
        (self.read(RESPONSE, 24), used_len)
    }
    fn expect(&mut self, label: &str, request: Vec<u8>, expected: u32) {
        let (response, length) = self.submit_split(&request, &[request.len()], &[24]);
        assert_eq!(length, 24, "{label} response length");
        assert_eq!(
            response,
            reply(&request, expected),
            "{label} entire independent response"
        );
        assert_eq!(
            self.read(RESPONSE + 24, 40),
            vec![0xa5; 40],
            "{label} response guard"
        );
        let snapshot = self.state.borrow().control3d_snapshot();
        let ring = format!(
            "{{\"descriptors\":{:?},\"avail\":{:?},\"used\":{:?}}}",
            hex(&self.read(DESC, 256)),
            hex(&self.read(AVAIL, 40)),
            hex(&self.read(USED, 136))
        );
        let prefix = if self.portable {
            "CONTROL3D_PORTABLE_RECORD"
        } else {
            "CONTROL3D_RECORD"
        };
        eprintln!(
            "{prefix} {{\"case\":{label:?},\"request\":{:?},\"response\":{:?},\"usedIndex\":{},\"ring\":{ring},\"machineDigest\":{:?},\"transportCanonical\":{:?},\"transportDigest\":{:?}}}",
            hex(&request),
            hex(&response),
            self.next,
            self.machine.snapshot().hex_digest(),
            snapshot
                .as_ref()
                .map(|s| hex(&s.canonical_bytes()))
                .unwrap_or_default(),
            snapshot
                .as_ref()
                .map(|s| s.hex_digest())
                .unwrap_or_default()
        );
    }
    fn unchanged(&mut self, label: &str, request: Vec<u8>, expected: u32) {
        let before = self
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .canonical_bytes();
        let calls = self.recorder.borrow().events.len();
        self.expect(label, request, expected);
        assert_eq!(
            self.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes(),
            before,
            "{label} transport unchanged"
        );
        assert_eq!(
            self.recorder.borrow().events.len(),
            calls,
            "{label} no sink mutation"
        );
    }
}

#[test]
fn control3d_default_and_unnegotiated_devices_fail_closed() {
    let mut ordinary = Queue::new(false, false);
    ordinary.mmio(0x14, 0);
    assert_eq!(ordinary.read_mmio(0x10) & 1, 0);
    assert_eq!(ordinary.read_mmio(0x10c), 0);
    assert!(!ordinary.state.borrow().control3d_proof_installed());
    ordinary.expect("default-context-disabled", context(2), UNSPEC);
    let mut proof = Queue::new(true, false);
    proof.mmio(0x14, 0);
    assert_eq!(proof.read_mmio(0x10) & 1, 1);
    assert_eq!(proof.read_mmio(0x10c), 0);
    proof.unchanged("unnegotiated-context-disabled", context(2), UNSPEC);
    proof.negotiate();
    proof.expect("negotiated-context", context(2), OK);
    for op in [0x205, 0x206, 0x207, 0x108, 0x109] {
        proof.unchanged("later-command-disabled", header(op, 0, 32), UNSPEC);
    }
}

#[test]
fn control3d_portable_cycles_owned_sg_and_id_reuse() {
    let mut q = Queue::new(true, true);
    q.portable = true;
    q.expect("portable-context-create", context(2), OK);
    for request in [
        resource(3, 0, 64, 16, 64, 1),
        resource(4, 0, 64, 32, 12, 1),
        resource(5, 2, 67, 10, 32, 32),
        resource(6, 2, 67, 10, 2, 2),
        resource(7, 0, 64, 524288, 1048576, 1),
    ] {
        q.expect("portable-resource-create", request, OK);
    }
    let pattern: Vec<u8> = (0..64).map(|v| v ^ 0x5a).collect();
    q.write(BACKING, &pattern[..7]);
    q.write(BACKING2, &pattern[7..]);
    q.expect(
        "portable-backing-split",
        backing(3, &[(BACKING, 7), (BACKING2, 57)]),
        OK,
    );
    let saved = q.recorder.borrow().events.last().unwrap().clone();
    match &saved.operation {
        Control3dOperation::AttachBacking { segments, .. } => {
            assert_eq!(
                segments
                    .iter()
                    .flat_map(|s| s.bytes.iter().copied())
                    .collect::<Vec<_>>(),
                pattern
            );
            assert_eq!(
                segments
                    .iter()
                    .map(|s| (s.addr, s.length))
                    .collect::<Vec<_>>(),
                [(BACKING, 7), (BACKING2, 57)]
            );
        }
        other => panic!("unexpected event {other:?}"),
    }
    q.write(BACKING, &[0xff; 7]);
    assert_eq!(
        q.recorder.borrow().events.last().unwrap(),
        &saved,
        "owned callback bytes survive guest source mutation"
    );
    for id in 3..=7 {
        q.expect("portable-context-attach", id_command(0x202, 2, id), OK);
    }
    q.unchanged(
        "duplicate-context-attach",
        id_command(0x202, 2, 3),
        INVALID_PARAMETER,
    );
    q.unchanged(
        "duplicate-backing-attach",
        backing(3, &[(BACKING, 7)]),
        INVALID_PARAMETER,
    );
    let old = q
        .state
        .borrow()
        .control3d_snapshot()
        .unwrap()
        .resources
        .iter()
        .find(|r| r.identity.id == 3)
        .unwrap()
        .identity;
    q.expect("portable-resource-unref", id_command(0x102, 0, 3), OK);
    q.expect("portable-resource-reuse", resource(3, 0, 64, 16, 64, 1), OK);
    let fresh = q
        .state
        .borrow()
        .control3d_snapshot()
        .unwrap()
        .resources
        .iter()
        .find(|r| r.identity.id == 3)
        .unwrap()
        .identity;
    assert_ne!(old.generation, fresh.generation);
    q.unchanged(
        "old-membership-does-not-attach-new-resource",
        id_command(0x203, 2, 3),
        INVALID_PARAMETER,
    );
    q.expect("fresh-membership", id_command(0x202, 2, 3), OK);
    q.expect("destroy-context-with-resources", header(0x201, 2, 24), OK);
    let state = q.state.borrow().control3d_snapshot().unwrap();
    assert!(state.contexts.is_empty());
    assert_eq!(state.resources.len(), 5);
    q.expect("context-id-reuse", context(2), OK);
    q.unchanged(
        "old-context-membership-gone",
        id_command(0x203, 2, 4),
        INVALID_PARAMETER,
    );
    for id in 3..=7 {
        q.expect("portable-final-unref", id_command(0x102, 0, id), OK);
    }
    q.expect("portable-final-context-destroy", header(0x201, 2, 24), OK);
    let state = q.state.borrow().control3d_snapshot().unwrap();
    assert!(state.contexts.is_empty() && state.resources.is_empty());
    assert_eq!(
        (state.logical_bytes, state.gpu_bytes, state.backing_bytes),
        (0, 0, 0)
    );
}

#[test]
fn control3d_packet_boundaries_metadata_and_error_recovery() {
    let mut q = Queue::new(true, true);
    q.unchanged("zero-context", context(0), INVALID_CONTEXT);
    for offset in [24, 28, 4, 20, 21] {
        let mut bytes = context(2);
        if offset == 24 {
            put32(&mut bytes, offset, 65);
        } else {
            bytes[offset] = 1;
        }
        q.unchanged("invalid-context-fields", bytes, INVALID_PARAMETER);
    }
    let ctx = context(2);
    for length in [24, 25, 31, 32, 95] {
        q.unchanged("short-context", ctx[..length].to_vec(), INVALID_PARAMETER);
    }
    let (response, len) = q.submit_split(&ctx, &[3, 22, 14, 57], &[7, 17]);
    assert_eq!((response, len), (reply(&ctx, OK), 24));
    q.unchanged("duplicate-context", context(2), INVALID_CONTEXT);
    let valid = resource(3, 2, 67, 10, 32, 32);
    for (offset, value) in [
        (24, 0),
        (28, 3),
        (32, 1),
        (36, 0),
        (40, 0),
        (44, 0),
        (48, 2),
        (52, 2),
        (56, 1),
        (60, 1),
        (64, 1),
        (68, 1),
        (16, 2),
    ] {
        let mut bytes = valid.clone();
        put32(&mut bytes, offset, value);
        q.unchanged(
            "invalid-resource-fields",
            bytes,
            if offset == 24 {
                INVALID_RESOURCE
            } else {
                INVALID_PARAMETER
            },
        );
    }
    for length in [24, 31, 40, 68, 71] {
        q.unchanged(
            "short-resource",
            valid[..length].to_vec(),
            INVALID_PARAMETER,
        );
    }
    q.expect("valid-resource-after-malformed", valid, OK);
    q.unchanged(
        "duplicate-resource",
        resource(3, 2, 67, 10, 32, 32),
        INVALID_RESOURCE,
    );
    q.unchanged(
        "missing-context-attach",
        id_command(0x202, 9, 3),
        INVALID_CONTEXT,
    );
    q.unchanged(
        "missing-resource-attach",
        id_command(0x202, 2, 9),
        INVALID_RESOURCE,
    );
    q.expect("valid-attach-after-errors", id_command(0x202, 2, 3), OK);
    q.expect("valid-detach", id_command(0x203, 2, 3), OK);
    q.unchanged(
        "duplicate-detach",
        id_command(0x203, 2, 3),
        INVALID_PARAMETER,
    );
}

#[test]
fn control3d_sg_bounds_aliases_short_lists_and_atomicity() {
    let mut q = Queue::new(true, true);
    q.expect("sg-resource", resource(3, 0, 64, 16, 64, 1), OK);
    q.write(BACKING, &[1, 2, 3, 4]);
    for entries in [
        vec![],
        vec![(BACKING, 0)],
        vec![(u64::MAX - 1, 4)],
        vec![(virt::DRAM_BASE - 1, 4)],
        vec![(virt::DRAM_BASE + RAM as u64 - 3, 4)],
        vec![(0x1000_0000, 4)],
        vec![(BACKING, 4), (u64::MAX, 1)],
    ] {
        q.unchanged("invalid-sg-range", backing(3, &entries), INVALID_PARAMETER);
    }
    let mut short = backing(3, &[(BACKING, 4)]);
    put32(&mut short, 28, 2);
    q.unchanged("short-sg-entry-list", short, INVALID_PARAMETER);
    let mut excessive = backing(3, &[]);
    put32(&mut excessive, 28, 257);
    q.unchanged("sg-entry-cap", excessive, INVALID_PARAMETER);
    let mut padded = backing(3, &[(BACKING, 4)]);
    put32(&mut padded, 44, 1);
    q.unchanged("sg-reserved-padding", padded, INVALID_PARAMETER);
    q.expect(
        "alias-short-aggregate-is-defined",
        backing(3, &[(BACKING, 4), (BACKING + 1, 3), (BACKING, 4)]),
        OK,
    );
    match &q.recorder.borrow().events.last().unwrap().operation {
        Control3dOperation::AttachBacking { segments, .. } => assert_eq!(
            segments
                .iter()
                .flat_map(|s| s.bytes.iter().copied())
                .collect::<Vec<_>>(),
            [1, 2, 3, 4, 2, 3, 4, 1, 2, 3, 4]
        ),
        other => panic!("unexpected {other:?}"),
    }
    q.expect("sg-detach", id_command(0x107, 0, 3), OK);
    q.expect(
        "sg-exact-end-of-ram",
        backing(3, &[(virt::DRAM_BASE + RAM as u64 - 4, 4)]),
        OK,
    );
}

#[test]
fn control3d_reply_preflight_allocation_failure_reset_and_snapshot() {
    for capacity in 1..24 {
        let mut q = Queue::new(true, true);
        let request = context(2);
        let before = q
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .canonical_bytes();
        let (_, used) = q.submit_split(&request, &[96], &[capacity]);
        assert_eq!(used, 0, "short response capacity {capacity}");
        assert_eq!(q.read(RESPONSE, 64), vec![0xa5; 64]);
        assert_eq!(
            q.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes(),
            before
        );
        assert!(q.recorder.borrow().events.is_empty());
        q.expect("valid-after-short-response", request, OK);
    }
    // The established queue walker treats zero-length descriptors as a queue
    // violation before the control handler. Preserve that fail-closed behavior.
    {
        let mut q = Queue::new(true, true);
        let before = q
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .canonical_bytes();
        q.write(REQUEST, &context(2));
        q.write(RESPONSE, &[0xa5; 64]);
        q.descriptor(0, REQUEST, 96, false, Some(1));
        q.descriptor(1, RESPONSE, 0, true, None);
        q.machine.bus_mut().store16(AVAIL + 2, 1).unwrap();
        q.mmio(0x50, 0);
        assert_eq!(q.machine.run(1), RunOutcome::MaxInstrs);
        assert_eq!(q.machine.bus_mut().load16(USED + 2).unwrap(), 0);
        assert_ne!(q.read_mmio(0x70) & 64, 0);
        assert!(q.recorder.borrow().events.is_empty());
        assert_eq!(q.read(RESPONSE, 64), vec![0xa5; 64]);
        assert_eq!(
            q.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes(),
            before
        );
    }
    let mut q = Queue::new(true, true);
    let normal = VirtioGpu::new_with_state()
        .1
        .borrow()
        .to_snapshot()
        .unwrap();
    assert!(
        q.state.borrow().to_snapshot().is_err(),
        "empty proof owner still denies snapshot"
    );
    assert!(q.state.borrow_mut().restore_snapshot(&normal).is_err());
    let machine_before = q.machine.snapshot().hex_digest();
    assert!(matches!(
        q.machine.save_resume(),
        Err(wasm_vm_core::resume::SnapshotError::BadComponentState { .. })
    ));
    assert!(matches!(
        q.machine.load_resume(&[]),
        Err(wasm_vm_core::resume::SnapshotError::BadComponentState { .. })
    ));
    assert!(q.machine.save_desktop_snapshot().is_err());
    assert!(matches!(
        q.machine.restore_desktop_snapshot(
            &[],
            wasm_vm_core::desktop_restore::DisplaySize {
                width: 32,
                height: 32
            }
        ),
        Err(
            wasm_vm_core::desktop_restore::DesktopRestoreError::CommitRefused {
                code: "proof_3d_installed"
            }
        )
    ));
    assert_eq!(
        q.machine.snapshot().hex_digest(),
        machine_before,
        "outer restore guards precede RAM/CPU mutation"
    );
    let (_, input) = wasm_vm_core::dev::virtio::input::VirtioInput::new_with_state(
        wasm_vm_core::dev::virtio::input::InputDeviceSpec::default(),
    );
    let (_, sound) = wasm_vm_core::dev::virtio::snd::VirtioSnd::new_with_state();
    let direct = wasm_vm_core::desktop_restore::VirtioDesktopRestoreBackend::new(
        q.state.clone(),
        input,
        sound,
    );
    assert!(matches!(direct, Err(error) if error.code() == "proof_3d_installed"));
    q.recorder.borrow_mut().fail_next = Some(Control3dError::OutOfMemory);
    q.unchanged(
        "renderer-allocation-failure",
        resource(3, 2, 67, 10, 32, 32),
        OOM,
    );
    q.expect(
        "renderer-allocation-recovery-same-id",
        resource(3, 2, 67, 10, 32, 32),
        OK,
    );
    q.expect("reset-context", context(2), OK);
    q.expect("reset-membership", id_command(0x202, 2, 3), OK);
    let old = q.state.borrow().control3d_snapshot().unwrap();
    q.mmio(0x70, 0);
    assert_eq!(q.machine.run(1), RunOutcome::MaxInstrs);
    let reset = q.state.borrow().control3d_snapshot().unwrap();
    assert!(reset.epoch > old.epoch);
    assert!(reset.contexts.is_empty() && reset.resources.is_empty());
    assert!(matches!(
        q.recorder.borrow().events.last().unwrap().operation,
        Control3dOperation::Reset
    ));
    assert!(
        q.state.borrow().to_snapshot().is_err(),
        "reset retains external proof owner"
    );
    q.next = 0;
    q.configure();
    q.negotiate();
    q.expect("context-after-reset", context(2), OK);
}

#[test]
fn control3d_shared_2d_namespace_and_2d_fences_are_preserved() {
    let mut q = Queue::new(true, true);
    let mut two = header(0x101, 0, 40);
    for (offset, value) in [(24, 3), (28, 67), (32, 2), (36, 2)] {
        put32(&mut two, offset, value);
    }
    put32(&mut two, 4, 1);
    two[8..16].copy_from_slice(&0x1122_3344_5566_7788u64.to_le_bytes());
    q.expect("2d-fenced-create", two, OK);
    q.unchanged(
        "3d-cannot-replace-2d",
        resource(3, 2, 67, 10, 2, 2),
        INVALID_RESOURCE,
    );
    assert_eq!(q.state.borrow().resources.get(3).unwrap().width, 2);
    q.expect("2d-unref", id_command(0x102, 0, 3), OK);
    q.expect("3d-after-2d-unref", resource(3, 2, 67, 10, 2, 2), OK);
    let mut two = header(0x101, 0, 40);
    for (offset, value) in [(24, 3), (28, 67), (32, 2), (36, 2)] {
        put32(&mut two, offset, value);
    }
    q.unchanged("2d-cannot-replace-3d", two, INVALID_RESOURCE);
    assert!(q.state.borrow().resources.get(3).is_none());
}

#[test]
fn control3d_budgets_are_bounded_before_publication() {
    // Null native sink proves the transport quota only; browser allocation is a
    // separate authority. These boundaries use literal task limits, not exports.
    let mut contexts = Queue::new(true, true);
    for id in 1..=8 {
        contexts.expect("context-budget-valid", context(id), OK);
    }
    contexts.unchanged("context-budget-plus-one", context(9), OOM);
    contexts.expect("context-budget-release", header(0x201, 8, 24), OK);
    contexts.expect("context-budget-recovery", context(9), OK);

    let mut resources = Queue::new(true, true);
    for id in 1..=16 {
        resources.expect(
            "resource-budget-valid",
            resource(id, 0, 64, 524288, 8, 1),
            OK,
        );
    }
    resources.unchanged(
        "resource-budget-plus-one",
        resource(17, 0, 64, 16, 8, 1),
        OOM,
    );
    resources.expect("resource-budget-release", id_command(0x102, 0, 16), OK);
    resources.expect(
        "resource-budget-recovery",
        resource(17, 0, 64, 16, 8, 1),
        OK,
    );

    let mut gpu = Queue::new(true, true);
    gpu.unchanged(
        "single-resource-budget-plus-one",
        resource(50, 0, 64, 16, 4194305, 1),
        OOM,
    );
    for id in 1..=8 {
        gpu.expect(
            "GPU-byte-budget-valid",
            resource(id, 2, 67, 10, 1024, 1024),
            OK,
        );
    }
    assert_eq!(
        gpu.state.borrow().control3d_snapshot().unwrap().gpu_bytes,
        33554432
    );
    gpu.unchanged(
        "GPU-byte-budget-plus-one",
        resource(9, 0, 64, 16, 1, 1),
        OOM,
    );
    gpu.expect("GPU-byte-budget-release", id_command(0x102, 0, 8), OK);
    gpu.expect(
        "GPU-byte-budget-recovery",
        resource(9, 2, 67, 10, 1024, 1024),
        OK,
    );

    let mut sg = Queue::new(true, true);
    sg.expect("SG-budget-resource", resource(1, 0, 64, 524288, 8, 1), OK);
    // 2 MiB ranges alias, intentionally. Every segment is RAM-contained; their
    // aggregate, not their union or logical resource size, consumes backing bytes.
    sg.expect(
        "SG-byte-budget-exact",
        backing(1, &[(virt::DRAM_BASE, 2097152), (virt::DRAM_BASE, 2097152)]),
        OK,
    );
    assert_eq!(
        sg.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .backing_bytes,
        4194304
    );
    sg.expect("SG-byte-budget-detach", id_command(0x107, 0, 1), OK);
    sg.unchanged(
        "SG-byte-budget-plus-one",
        backing(
            1,
            &[
                (virt::DRAM_BASE, 2097152),
                (virt::DRAM_BASE, 2097152),
                (BACKING, 1),
            ],
        ),
        OOM,
    );
    sg.expect("SG-byte-budget-recovery", backing(1, &[(BACKING, 4)]), OK);
}
