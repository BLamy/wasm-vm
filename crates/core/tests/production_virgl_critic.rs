//! Independent boundary checks through the original Machine/MMIO/virtqueue path.
//! Host recorders observe controls; they do not emulate a graphics implementation.
#![cfg(all(feature = "virgl-renderer", not(feature = "zicsr-stub")))]

use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::virtio::gpu::{
    self, CursorState, FrameSink, GpuState, NullSink,
    capabilities::{FormatMask, HostLimits, QualifiedCapabilities},
    control3d::{Control3dError, Control3dEvent, Control3dOperation, Control3dSink},
    protocol as p,
    submit3d::{
        Submit3dBacking, Submit3dCompletion, Submit3dExchange, Submit3dMailbox, Submit3dRequest,
        Submit3dRows, Submit3dSink,
    },
};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome, bus::Bus};

const DESC: u64 = virt::DRAM_BASE + 0x10000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11000;
const USED: u64 = virt::DRAM_BASE + 0x12000;
const REQUEST: u64 = virt::DRAM_BASE + 0x13000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14000;
const BACKING: u64 = virt::DRAM_BASE + 0x20000;

fn caps() -> QualifiedCapabilities {
    let mut sampler = FormatMask::default();
    for f in [1, 2, 16, 67] {
        sampler.insert(f).unwrap();
    }
    QualifiedCapabilities::new(
        HostLimits {
            texture_2d: 8192,
            texture_3d: 256,
            texture_cube: 4096,
            array_layers: 1024,
            varying_vectors: 32,
            vertex_attributes: 16,
            uniform_block_bytes: 32768,
            uniform_alignment: 256,
            vertex_samplers: 32,
            fragment_samplers: 16,
            vertex_constant_vectors: 1024,
            fragment_constant_vectors: 1024,
            feedback_components: 128,
            samples: 4,
        },
        sampler.clone(),
        sampler,
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap()
}

#[derive(Clone, Default)]
struct ControlRecorder {
    events: Rc<RefCell<Vec<Control3dEvent>>>,
    fail_next: Rc<RefCell<Option<Control3dError>>>,
}
impl Control3dSink for ControlRecorder {
    fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError> {
        if let Some(error) = self.fail_next.borrow_mut().take() {
            return Err(error);
        }
        self.events.borrow_mut().push(event.clone());
        Ok(())
    }
}
#[derive(Clone, Default)]
struct SubmitRecorder(Rc<RefCell<Vec<Submit3dRequest>>>);
impl Submit3dSink for SubmitRecorder {
    fn begin_job(&mut self, r: &Submit3dRequest) -> Result<(), Control3dError> {
        self.0.borrow_mut().push(r.clone());
        Ok(())
    }
    fn cancel_job(&mut self, _: gpu::submit3d::Submit3dKey) -> Result<(), Control3dError> {
        Ok(())
    }
}
type CursorRecord = (CursorState, Vec<u32>);
#[derive(Clone, Default)]
struct CursorRecorder(Rc<RefCell<Vec<CursorRecord>>>);
impl FrameSink for CursorRecorder {
    fn flush(&mut self, _: Option<u32>, _: u32, _: p::Rect, _: u32, _: u32, _: &[u32]) {}
    fn clear(&mut self) {}
    fn cursor_state(&mut self, state: CursorState, _: Option<u32>, _: u32, _: u32, pixels: &[u32]) {
        self.0.borrow_mut().push((state, pixels.to_vec()));
    }
}

struct Rig {
    machine: Machine,
    base: u64,
    state: Rc<RefCell<GpuState>>,
    controls: ControlRecorder,
    submits: SubmitRecorder,
    mailbox: Submit3dMailbox,
    next: [u16; 2],
    request_base: u64,
}
impl Rig {
    fn unqualified() -> Self {
        let mut machine = Machine::new(8 * 1024 * 1024);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let (_, state) = machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let slot = machine.virtio_gpu().unwrap().0;
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        Self {
            machine,
            base: Platform::virtio_base(slot as u64),
            state,
            controls: ControlRecorder::default(),
            submits: SubmitRecorder::default(),
            mailbox: Submit3dMailbox::new(),
            next: [0; 2],
            request_base: REQUEST,
        }
    }
    fn qualified() -> Self {
        let mut rig = Self::unqualified();
        rig.attach().unwrap();
        rig.state = rig.machine.virtio_gpu().unwrap().1;
        rig
    }
    fn attach(&mut self) -> Result<(), &'static str> {
        self.machine.attach_qualified_virgl(
            Box::new(self.controls.clone()),
            Box::new(self.submits.clone()),
            self.mailbox.clone(),
            caps(),
        )
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
    fn negotiate(&mut self, virgl: bool) {
        self.mmio(0x70, 3);
        self.mmio(0x24, 0);
        self.mmio(0x20, if virgl { 1 } else { 0 });
        self.mmio(0x24, 1);
        self.mmio(0x20, 1);
        self.mmio(0x70, 11);
        assert_ne!(self.read_mmio(0x70) & 8, 0);
        self.mmio(0x70, 15);
    }
    fn configure(&mut self, queue: u32) {
        let delta = u64::from(queue) * 0x10000;
        self.mmio(0x30, queue);
        self.mmio(0x38, 8);
        for (offset, address) in [
            (0x80, DESC + delta),
            (0x90, AVAIL + delta),
            (0xa0, USED + delta),
        ] {
            self.mmio(offset, address as u32);
            self.mmio(offset + 4, (address >> 32) as u32);
        }
        self.mmio(0x44, 1);
    }
    fn publish(&mut self, queue: u32, request: &[u8], capacity: usize) {
        let delta = u64::from(queue) * 0x10000;
        for (i, b) in request.iter().enumerate() {
            self.machine
                .bus_mut()
                .store8(self.request_base + delta + i as u64, *b)
                .unwrap();
        }
        for i in 0..1600 {
            self.machine
                .bus_mut()
                .store8(RESPONSE + delta + i, 0xa5)
                .unwrap();
        }
        for (index, address, len, flags, next) in [
            (0, self.request_base + delta, request.len(), 1, 1),
            (1, RESPONSE + delta, capacity, 2, 0),
        ] {
            let at = DESC + delta + index * 16;
            self.machine.bus_mut().store64(at, address).unwrap();
            self.machine.bus_mut().store32(at + 8, len as u32).unwrap();
            self.machine.bus_mut().store16(at + 12, flags).unwrap();
            self.machine.bus_mut().store16(at + 14, next).unwrap();
        }
        let next = &mut self.next[queue as usize];
        self.machine
            .bus_mut()
            .store16(AVAIL + delta + 4 + 2 * u64::from(*next % 8), 0)
            .unwrap();
        *next += 1;
        self.machine
            .bus_mut()
            .store16(AVAIL + delta + 2, *next)
            .unwrap();
        self.mmio(0x50, queue);
        self.tick();
    }
    fn tick(&mut self) {
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
    }
    fn response(&mut self, queue: u32, written: usize) -> Vec<u8> {
        let delta = u64::from(queue) * 0x10000;
        assert_eq!(
            self.machine.bus_mut().load16(USED + delta + 2).unwrap(),
            self.next[queue as usize]
        );
        let used = USED + delta + 4 + 8 * u64::from((self.next[queue as usize] - 1) % 8);
        assert_eq!(
            self.machine.bus_mut().load32(used).unwrap(),
            0,
            "original descriptor head"
        );
        assert_eq!(
            self.machine.bus_mut().load32(used + 4).unwrap(),
            written as u32,
            "exact used extent"
        );
        for i in written..1600 {
            assert_eq!(
                self.machine
                    .bus_mut()
                    .load8(RESPONSE + delta + i as u64)
                    .unwrap(),
                0xa5,
                "response overrun at {i}"
            );
        }
        (0..written)
            .map(|i| {
                self.machine
                    .bus_mut()
                    .load8(RESPONSE + delta + i as u64)
                    .unwrap()
            })
            .collect()
    }
    fn command(&mut self, request: &[u8], capacity: usize, ty: u32, written: usize) -> Vec<u8> {
        self.publish(0, request, capacity);
        let bytes = self.response(0, written);
        if written >= 4 {
            assert_eq!(word(&bytes, 0), ty, "request={request:02x?}");
        }
        bytes
    }
}
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}
fn request(ty: u32, context: u32, words: &[u32]) -> Vec<u8> {
    let mut out = p::CtrlHeader {
        ty,
        ctx_id: context,
        ..Default::default()
    }
    .to_bytes()
    .to_vec();
    for value in words {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[cfg(feature = "gpu-trace")]
#[test]
fn original_rejected_transfer_trace_keeps_literal_payload_without_host_effects() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    r.state.borrow_mut().enable_command_trace();
    let words = [1, 2, 0, 3, 4, 1, 0xffff_fffc, 1, 777, 0, 12, 48];
    for ty in [p::CMD_TRANSFER_TO_HOST_3D, p::CMD_TRANSFER_FROM_HOST_3D] {
        r.publish(0, &request(ty, 0, &words), 24);
        let response = r.response(0, 24);
        let row = *r.state.borrow().command_trace().last().unwrap();
        assert_eq!(row.command_type, ty);
        assert_eq!(row.response_type, word(&response, 0));
        assert!(row.response_type >= p::RESP_ERR_UNSPEC);
        assert_eq!(row.resource_id, Some(777));
        assert_eq!(row.transfer_words, Some(words));
        assert!(r.submits.0.borrow().is_empty());
        assert!(r.controls.events.borrow().is_empty());
    }
    r.publish(0, &request(p::CMD_TRANSFER_TO_HOST_3D, 0, &[1, 2]), 24);
    r.response(0, 24);
    let row = *r.state.borrow().command_trace().last().unwrap();
    assert_eq!(row.transfer_words, None, "short SG body is not invented");
    assert_eq!(row.resource_id, None);
    assert_eq!(r.state.borrow().command_trace_dropped(), 0);
}
fn context(id: u32) -> Vec<u8> {
    let mut out = request(p::CMD_CTX_CREATE, id, &[0, 0]);
    out.resize(96, 0);
    out
}
fn create(id: u32) -> Vec<u8> {
    request(p::CMD_RESOURCE_CREATE_2D, 0, &[id, 1, 3, 2])
}
fn backing(id: u32) -> Vec<u8> {
    let mut out = request(p::CMD_RESOURCE_ATTACH_BACKING, 0, &[id, 1]);
    out.extend_from_slice(&BACKING.to_le_bytes());
    out.extend_from_slice(&24u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out
}

/// The real accepted head is parked until the independently held host mailbox
/// receives completion. This checks time/transport ownership, not GPU pixels.
#[test]
fn original_renderer_wait_preserves_wfi_deadline_until_completion_reset_or_loss() {
    renderer_host_wait(false);
}

#[test]
fn paced_renderer_wait_preserves_wfi_deadline_until_completion_reset_or_loss() {
    renderer_host_wait(true);
}

fn renderer_host_wait(paced: bool) {
    const DEADLINE: u64 = 500_000;
    const HANDLER: u64 = virt::KERNEL_BASE + 0x4000;
    for cached in [false, true] {
        for ending in ["success", "failure", "reset", "loss"] {
            let mut r = Rig::qualified();
            r.negotiate(true);
            r.configure(0);
            r.command(&context(1), 24, p::RESP_OK_NODATA, 24);
            r.command(&create(7), 24, p::RESP_OK_NODATA, 24);
            r.command(&backing(7), 24, p::RESP_OK_NODATA, 24);
            let mut transfer = request(p::CMD_TRANSFER_TO_HOST_2D, 0, &[0, 0, 3, 2]);
            transfer.extend_from_slice(&0u64.to_le_bytes());
            transfer.extend_from_slice(&7u32.to_le_bytes());
            transfer.extend_from_slice(&0u32.to_le_bytes());
            r.publish(0, &transfer, 24);
            let accepted = r.submits.0.borrow().last().unwrap().clone();
            assert_eq!(r.mailbox.inspect().active, Some(accepted.key));
            assert!(!r.mailbox.inspect().ready);
            assert_eq!(r.machine.bus_mut().load16(USED + 2).unwrap(), r.next[0] - 1);

            // Original guest WFI/JAL loop; timer is armed through its real MMIO.
            let clint = r.machine.enable_clint(64);
            if paced {
                struct Clock(Rc<std::cell::Cell<u64>>);
                impl wasm_vm_core::time::MonotonicClock for Clock {
                    fn now_nanos(&self) -> u64 {
                        self.0.get()
                    }
                }
                let host = Rc::new(std::cell::Cell::new(0));
                r.machine
                    .set_paced_icount_clock(Box::new(Clock(host.clone())))
                    .unwrap();
                // Make the idle ceiling exceed the timer. Only the original
                // active-job guard can prevent the pending transport's jump.
                host.set(1_000_000_000);
            }
            r.machine
                .bus_mut()
                .store64(virt::CLINT_BASE + 0x4000, DEADLINE)
                .unwrap();
            for (at, word) in [
                (virt::KERNEL_BASE, 0x1050_0073),
                (virt::KERNEL_BASE + 4, 0xffdf_f06f),
                (HANDLER, 0x0000_006f),
            ] {
                r.machine.bus_mut().store32(at, word).unwrap();
            }
            for (address, value) in [(MTVEC, HANDLER), (MIE, 1 << 7), (MSTATUS, 1 << 3)] {
                r.machine
                    .hart_mut()
                    .csr
                    .access(address, CsrOp::Write, value, false, false, 0)
                    .unwrap();
            }
            r.machine.set_block_cache(cached);
            r.machine.hart_mut().regs.pc = virt::KERNEL_BASE;
            let retired = r.machine.irq_stats().retired;
            assert_eq!(r.machine.run(20), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                0,
                "pending {ending}, cached={cached}: no idle clock jump"
            );
            assert_eq!(r.machine.irq_stats().retired, retired + 20);
            assert_ne!(r.machine.hart().regs.pc, HANDLER);
            assert_eq!(r.machine.bus_mut().load16(USED + 2).unwrap(), r.next[0] - 1);
            assert!(!r.mailbox.inspect().ready);
            // A rejected stale completion cannot release the host-wait guard.
            assert!(
                r.mailbox
                    .post(Submit3dCompletion {
                        key: accepted.key,
                        exchange_sequence: 1,
                        outcome: Ok(()),
                        gpu_complete: true,
                        applied_commands: 0,
                        draws: 0,
                    })
                    .is_err()
            );
            let mut trace = HashSink::new();
            assert_eq!(r.machine.run_traced(20, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(clint.borrow().mtime, 0);

            if ending == "reset" {
                r.mmio(0x70, 0);
                assert_eq!(r.mailbox.inspect().active, None);
            } else {
                if ending == "loss" {
                    assert!(r.state.borrow_mut().invalidate_renderer_qualification());
                    assert_eq!(r.read_mmio(0x10) & 1, 0);
                }
                let outcome = match ending {
                    "success" => Ok(()),
                    "failure" => Err(Control3dError::InvalidParameter),
                    "loss" => Err(Control3dError::BridgePoisoned),
                    _ => unreachable!(),
                };
                r.mailbox
                    .post(Submit3dCompletion {
                        key: accepted.key,
                        exchange_sequence: 0,
                        outcome,
                        gpu_complete: ending != "loss",
                        applied_commands: 0,
                        draws: 0,
                    })
                    .unwrap();
                assert!(r.mailbox.inspect().ready);
            }
            // The first WFI after the host turn regains ordinary timer behavior.
            assert_eq!(r.machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                DEADLINE,
                "settled {ending}, cached={cached}"
            );
            assert_eq!(r.mailbox.inspect().active, None);
            assert!(
                r.state
                    .borrow()
                    .submit3d_snapshot()
                    .unwrap()
                    .pending
                    .is_none()
            );
            if ending != "reset" {
                let response = r.response(0, 24);
                let expected = match ending {
                    "success" => p::RESP_OK_NODATA,
                    "failure" => p::RESP_ERR_INVALID_PARAMETER,
                    "loss" => p::RESP_ERR_UNSPEC,
                    _ => unreachable!(),
                };
                assert_eq!(word(&response, 0), expected);
            }
            assert_eq!(r.machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                r.machine.hart().regs.pc,
                HANDLER,
                "normal timer interrupt resumes"
            );
            assert_eq!(trace.retired(), 21);
            eprintln!(
                "WFI host wait: paced={paced}, cached={cached}, ending={ending}, parked_mtime=0, settled_mtime={DEADLINE}, retired={}, trace_retires={}, trace_hash={:016x}",
                r.machine.irq_stats().retired,
                trace.retired(),
                trace.hash()
            );
        }
    }
}

#[test]
fn original_multisample_metadata_accounts_native_samples_and_rejects_before_host_effects() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    let make = |samples, width, height| {
        request(
            p::CMD_RESOURCE_CREATE_3D,
            0,
            &[77, 2, 67, 2, width, height, 1, 1, 0, samples, 0, 0],
        )
    };
    for samples in [2, 4] {
        r.command(&make(samples, 9, 7), 24, p::RESP_OK_NODATA, 24);
        let state = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(state.logical_bytes, 9 * 7 * 4);
        assert_eq!(state.gpu_bytes, 9 * 7 * 4 * u64::from(samples));
        assert_eq!(state.resources[0].metadata.nr_samples, samples);
        assert_eq!(
            r.state.borrow().resources.len(),
            0,
            "no legacy CPU mirror for sample storage"
        );
        r.command(
            &request(p::CMD_RESOURCE_UNREF, 0, &[77, 0]),
            24,
            p::RESP_OK_NODATA,
            24,
        );
        let state = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!((state.logical_bytes, state.gpu_bytes), (0, 0));
    }
    for samples in [1, 3, 5, 8, u32::MAX] {
        let before = r.controls.events.borrow().len();
        let state = r.state.borrow().control3d_snapshot().unwrap();
        r.command(&make(samples, 9, 7), 24, p::RESP_ERR_INVALID_PARAMETER, 24);
        assert_eq!(r.controls.events.borrow().len(), before);
        assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), state);
    }
    // Exactly 32 MiB of native four-sample storage, with only 8 MiB of logical pixels.
    r.command(&make(4, 2048, 1024), 24, p::RESP_OK_NODATA, 24);
    assert_eq!(
        r.state.borrow().control3d_snapshot().unwrap().gpu_bytes,
        33_554_432
    );
    r.command(
        &request(p::CMD_RESOURCE_UNREF, 0, &[77, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    let before = r.controls.events.borrow().len();
    r.command(&make(4, 2048, 1025), 24, p::RESP_ERR_OUT_OF_MEMORY, 24);
    assert_eq!(r.controls.events.borrow().len(), before);
    assert_eq!(r.state.borrow().control3d_snapshot().unwrap().gpu_bytes, 0);
    // Mutate one original field at a time; every unsupported shape remains transport-only.
    for (word_index, value) in [
        (1, 0),
        (1, 3),
        (1, 4),
        (1, 7),
        (3, 8),
        (6, 2),
        (7, 2),
        (8, 1),
        (10, 1),
    ] {
        let mut bytes = make(4, 9, 7);
        let at = 24 + word_index * 4;
        bytes[at..at + 4].copy_from_slice(&u32::to_le_bytes(value));
        let before = r.controls.events.borrow().len();
        r.command(&bytes, 24, p::RESP_ERR_INVALID_PARAMETER, 24);
        assert_eq!(r.controls.events.borrow().len(), before);
        assert!(
            r.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .resources
                .is_empty()
        );
    }
}

#[test]
fn original_capset_queue_handshake_versions_and_response_extents() {
    let mut r = Rig::qualified();
    assert_eq!(r.read_mmio(0x10) & 1, 1);
    assert_eq!(r.read_mmio(0x10c), 1);
    r.negotiate(true);
    r.configure(0);
    let info = r.command(
        &request(p::CMD_GET_CAPSET_INFO, 0, &[0, 0]),
        1600,
        p::RESP_OK_CAPSET_INFO,
        40,
    );
    assert_eq!(
        &info[24..],
        &[2u32, 2, 1408, 0]
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>()
    );
    for version in 0..=2 {
        let mut req = request(p::CMD_GET_CAPSET, 0, &[2, version]);
        req[4..8].copy_from_slice(&p::FLAG_FENCE.to_le_bytes());
        req[8..16].copy_from_slice(&0x1234_5678_abcd_ef01u64.to_le_bytes());
        let response = r.command(&req, 1600, p::RESP_OK_CAPSET, 1432);
        assert_eq!(&response[4..16], &req[4..16], "original fence identity");
        assert_eq!(
            &response[24..],
            &caps().to_bytes(),
            "requested capset version {version}"
        );
    }
    for (ty, first, second) in [
        (p::CMD_GET_CAPSET_INFO, 1, 0),
        (p::CMD_GET_CAPSET_INFO, 0, 1),
        (p::CMD_GET_CAPSET, 0, 0),
        (p::CMD_GET_CAPSET, 1, 1),
        (p::CMD_GET_CAPSET, 3, 2),
        (p::CMD_GET_CAPSET, 2, 3),
        (p::CMD_GET_CAPSET, 2, u32::MAX),
    ] {
        r.command(
            &request(ty, 0, &[first, second]),
            1600,
            p::RESP_ERR_INVALID_PARAMETER,
            24,
        );
    }
    for (ty, success_extent) in [(p::CMD_GET_CAPSET_INFO, 40), (p::CMD_GET_CAPSET, 1432)] {
        let req = request(
            ty,
            0,
            if ty == p::CMD_GET_CAPSET {
                &[2, 1]
            } else {
                &[0, 0]
            },
        );
        for capacity in [1, 23, 24, success_extent - 1, success_extent] {
            let (written, response) = if capacity < 24 {
                (0, 0)
            } else if capacity < success_extent {
                (24, p::RESP_ERR_INVALID_PARAMETER)
            } else {
                (
                    success_extent,
                    if ty == p::CMD_GET_CAPSET {
                        p::RESP_OK_CAPSET
                    } else {
                        p::RESP_OK_CAPSET_INFO
                    },
                )
            };
            r.command(&req, capacity, response, written);
        }
    }
    assert!(
        r.controls.events.borrow().is_empty(),
        "capsets never use the control recorder"
    );
    assert!(
        r.submits.0.borrow().is_empty(),
        "capsets never submit renderer work"
    );
}

#[test]
fn malformed_capset_and_unnegotiated_guest_never_get_positive_caps() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    for mutation in 0..8 {
        let mut req = request(p::CMD_GET_CAPSET, 0, &[2, 1]);
        match mutation {
            0 => {
                req.truncate(31);
            }
            1 => {
                req.push(0);
            }
            2 => req[4..8].copy_from_slice(&2u32.to_le_bytes()),
            3 => req[16..20].copy_from_slice(&1u32.to_le_bytes()),
            4 => req[20] = 1,
            5 => req[21] = 1,
            6 => req[22] = 1,
            7 => req[23] = 1,
            _ => unreachable!(),
        }
        r.command(&req, 1600, p::RESP_ERR_INVALID_PARAMETER, 24);
    }
    let mut r = Rig::qualified();
    r.negotiate(false);
    r.configure(0);
    for req in [
        request(p::CMD_GET_CAPSET_INFO, 0, &[0, 0]),
        request(p::CMD_GET_CAPSET, 0, &[2, 1]),
    ] {
        r.command(&req, 1600, p::RESP_ERR_INVALID_PARAMETER, 24);
    }
    let mut r = Rig::unqualified();
    assert_eq!(r.read_mmio(0x10) & 1, 0, "NullSink cannot offer VIRGL");
    assert_eq!(r.read_mmio(0x10c), 0, "NullSink cannot offer capsets");
    r.negotiate(false);
    r.configure(0);
    for req in [
        request(p::CMD_GET_CAPSET_INFO, 0, &[0, 0]),
        request(p::CMD_GET_CAPSET, 0, &[2, 1]),
    ] {
        r.command(&req, 1600, p::RESP_ERR_UNSPEC, 24);
    }
}

#[test]
fn historical_renderer_proofs_cannot_publish_positive_production_capsets() {
    let mut machine = Machine::new(8 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    let controls = ControlRecorder::default();
    let submits = SubmitRecorder::default();
    let mailbox = Submit3dMailbox::new();
    let (_, state) = machine
        .enable_virtio_gpu_standard_stream_output_submit3d_proof(
            Box::new(NullSink),
            Box::new(controls.clone()),
            Box::new(submits.clone()),
            mailbox.clone(),
        )
        .unwrap();
    let base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    let mut r = Rig {
        machine,
        base,
        state,
        controls,
        submits,
        mailbox,
        next: [0; 2],
        request_base: REQUEST,
    };
    assert_eq!(
        r.read_mmio(0x10c),
        0,
        "proof admission cannot substitute for production qualification"
    );
    r.negotiate(true);
    r.configure(0);
    for req in [
        request(p::CMD_GET_CAPSET_INFO, 0, &[0, 0]),
        request(p::CMD_GET_CAPSET, 0, &[2, 1]),
    ] {
        r.command(&req, 1600, p::RESP_ERR_UNSPEC, 24);
    }
    assert!(
        !r.state.borrow_mut().invalidate_renderer_qualification(),
        "proof selector cannot impersonate a revocable production qualification"
    );
}

#[test]
fn machine_attachment_is_only_before_retirement_negotiation_and_ring_configuration() {
    let mut r = Rig::unqualified();
    let before = r.base;
    r.attach().unwrap();
    assert_eq!(
        Platform::virtio_base(r.machine.virtio_gpu().unwrap().0 as u64),
        before
    );
    assert_eq!(r.read_mmio(0x008), 16);
    assert_eq!(r.read_mmio(0x10) & 1, 1);
    assert!(
        r.attach().is_err(),
        "no replacing an already selected renderer"
    );
    let mut r = Rig::unqualified();
    r.tick();
    assert_eq!(
        r.attach(),
        Err("GPU must be attached before guest execution")
    );
    for (offset, value) in [
        (0x70, 1),
        (0x20, 1),
        (0x38, 8),
        (0x44, 1),
        (0x80, 1),
        (0x84, 1),
        (0x90, 1),
        (0x94, 1),
        (0xa0, 1),
        (0xa4, 1),
        (0x50, 0),
    ] {
        let mut r = Rig::unqualified();
        r.mmio(offset, value);
        assert!(
            r.attach().is_err(),
            "attachment after MMIO {offset:#x} = {value}"
        );
        assert_eq!(
            r.read_mmio(0x10) & 1,
            0,
            "failed attach preserves the old device"
        );
        assert_eq!(r.read_mmio(0x10c), 0);
    }
    let mut r = Rig::unqualified();
    r.mmio(0x30, 1);
    r.mmio(0x38, 8);
    assert!(
        r.attach().is_err(),
        "cursor queue configuration also forbids replacement"
    );
}

#[test]
fn legacy_creation_mirror_is_failure_atomic_and_backing_lifetime_tracks_gpu_owner() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    *r.controls.fail_next.borrow_mut() = Some(Control3dError::OutOfMemory);
    r.command(&create(7), 24, p::RESP_ERR_OUT_OF_MEMORY, 24);
    assert_eq!(r.state.borrow().resources.len(), 0);
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
    assert!(
        r.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .resources
            .is_empty()
    );
    r.command(&create(7), 24, p::RESP_OK_NODATA, 24);
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 24);
    let gpu_owner = r.state.borrow().control3d_snapshot().unwrap().resources[0].clone();
    assert_eq!(
        (gpu_owner.metadata.target, gpu_owner.metadata.flags),
        (2, 1)
    );
    r.command(&create(7), 24, p::RESP_ERR_INVALID_RESOURCE_ID, 24);
    assert_eq!(r.state.borrow().resources.len(), 1);
    r.command(&backing(7), 24, p::RESP_OK_NODATA, 24);
    assert_eq!(
        r.state.borrow().resources.get(7).unwrap().backing,
        [(BACKING, 24)]
    );
    assert!(
        r.state.borrow().control3d_snapshot().unwrap().resources[0]
            .backing
            .is_some()
    );
    r.command(
        &request(p::CMD_RESOURCE_DETACH_BACKING, 0, &[7, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    assert!(
        r.state
            .borrow()
            .resources
            .get(7)
            .unwrap()
            .backing
            .is_empty()
    );
    assert!(
        r.state.borrow().control3d_snapshot().unwrap().resources[0]
            .backing
            .is_none()
    );
    r.command(
        &request(p::CMD_RESOURCE_UNREF, 0, &[7, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
    assert!(
        r.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .resources
            .is_empty()
    );
    r.command(&create(7), 24, p::RESP_OK_NODATA, 24);
    assert!(
        r.state.borrow().control3d_snapshot().unwrap().resources[0]
            .identity
            .generation
            > gpu_owner.identity.generation
    );
    r.mmio(0x70, 0);
    r.tick();
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
    assert!(
        r.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .resources
            .is_empty()
    );
}

#[test]
fn original_legacy_dma_mirrors_exact_subrect_and_cursor_survives_qualification_loss() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    r.configure(1);
    let cursor = CursorRecorder::default();
    assert!(r.machine.replace_virtio_gpu_sink(Box::new(cursor.clone())));
    r.command(&context(1), 24, p::RESP_OK_NODATA, 24);
    r.command(&create(7), 24, p::RESP_OK_NODATA, 24);
    r.command(&backing(7), 24, p::RESP_OK_NODATA, 24);
    let pixels = [
        0x10203040u32,
        0x50607080,
        0x90a0b0c0,
        0xd0e0f000,
        0x11223344,
        0x55667788,
    ];
    for (i, v) in pixels.into_iter().enumerate() {
        r.machine
            .bus_mut()
            .store32(BACKING + i as u64 * 4, v)
            .unwrap();
    }
    // Original TRANSFER_TO_HOST_2D x=1,y=0,w=2,h=2, source offset=4.
    let mut transfer = request(p::CMD_TRANSFER_TO_HOST_2D, 0, &[1, 0, 2, 2]);
    transfer.extend_from_slice(&4u64.to_le_bytes());
    transfer.extend_from_slice(&7u32.to_le_bytes());
    transfer.extend_from_slice(&0u32.to_le_bytes());
    r.publish(0, &transfer, 24);
    assert_eq!(
        r.machine.bus_mut().load16(USED + 2).unwrap(),
        r.next[0] - 1,
        "head remains owned while GPU work is pending"
    );
    let accepted = r.submits.0.borrow().last().unwrap().clone();
    assert_eq!(accepted.header.ty, p::CMD_TRANSFER_TO_HOST_2D);
    let owner = accepted
        .resources
        .iter()
        .find(|v| v.identity.id == 7)
        .unwrap();
    let exchange = Submit3dExchange {
        key: accepted.key,
        exchange_sequence: 1,
        backing: Submit3dBacking {
            resource: owner.identity,
            generation: owner.backing.unwrap().generation,
        },
        rows: Submit3dRows {
            offset: 4,
            row_bytes: 8,
            row_stride: 12,
            row_count: 2,
        },
    };
    let gathered = r.machine.submit3d_gather(&exchange).unwrap();
    assert_eq!(
        gathered,
        [pixels[1], pixels[2], pixels[4], pixels[5]]
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        r.state
            .borrow()
            .resources
            .get(7)
            .unwrap()
            .host_pixels
            .as_ref(),
        &[0, pixels[1], pixels[2], 0, pixels[4], pixels[5]]
    );
    assert_eq!(
        r.state
            .borrow()
            .resources
            .get(7)
            .unwrap()
            .dirty_tile_count(),
        1,
        "the retained legacy pixels must participate in the existing CPU tile repair path"
    );
    r.mailbox
        .post(Submit3dCompletion {
            key: accepted.key,
            exchange_sequence: 1,
            outcome: Ok(()),
            gpu_complete: true,
            applied_commands: 0,
            draws: 0,
        })
        .unwrap();
    r.tick();
    r.response(0, 24);
    let update = p::UpdateCursor {
        header: p::CtrlHeader {
            ty: p::CMD_UPDATE_CURSOR,
            ..Default::default()
        },
        pos: p::CursorPos {
            scanout_id: 0,
            x: 30,
            y: 40,
            padding: 0,
        },
        resource_id: 7,
        hot_x: 1,
        hot_y: 1,
        padding: 0,
    }
    .to_bytes();
    r.publish(1, &update, 24);
    r.response(1, 24);
    let expected = vec![0, pixels[1], pixels[2], 0, pixels[4], pixels[5]];
    assert_eq!(cursor.0.borrow().last().unwrap().1, expected);
    assert!(r.state.borrow_mut().invalidate_renderer_qualification());
    assert_eq!(r.read_mmio(0x10) & 1, 0);
    assert_eq!(r.read_mmio(0x10c), 0);
    for req in [
        request(p::CMD_GET_CAPSET_INFO, 0, &[0, 0]),
        request(p::CMD_GET_CAPSET, 0, &[2, 1]),
    ] {
        r.command(&req, 1600, p::RESP_ERR_UNSPEC, 24);
    }
    r.publish(1, &update, 24);
    r.response(1, 24);
    assert_eq!(
        cursor.0.borrow().last().unwrap().1,
        expected,
        "cursor remains a CPU mirror after renderer loss"
    );
    r.command(
        &request(p::CMD_RESOURCE_UNREF, 0, &[7, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
    assert_eq!(
        cursor.0.borrow().last().unwrap().0.resource_id,
        0,
        "unref hides the cursor"
    );
    assert!(matches!(
        r.controls.events.borrow()[1].operation,
        Control3dOperation::CreateResource { .. }
    ));
}

#[test]
fn every_typed_host_floor_is_enforced_before_wire_caps_exist() {
    let baseline = HostLimits {
        texture_2d: 2048,
        texture_3d: 256,
        texture_cube: 2048,
        array_layers: 256,
        varying_vectors: 16,
        vertex_attributes: 16,
        uniform_block_bytes: 16384,
        uniform_alignment: 1,
        vertex_samplers: 16,
        fragment_samplers: 16,
        vertex_constant_vectors: 512,
        fragment_constant_vectors: 512,
        feedback_components: 64,
        samples: 4,
    };
    let construct = |limits, name: &str| {
        QualifiedCapabilities::new(
            limits,
            FormatMask::default(),
            FormatMask::default(),
            FormatMask::default(),
            FormatMask::default(),
            FormatMask::default(),
            name,
        )
    };
    assert!(construct(baseline.clone(), "GPU").is_ok());
    for index in 0..14 {
        let mut limits = baseline.clone();
        match index {
            0 => limits.texture_2d -= 1,
            1 => limits.texture_3d -= 1,
            2 => limits.texture_cube -= 1,
            3 => limits.array_layers -= 1,
            4 => limits.varying_vectors -= 1,
            5 => limits.vertex_attributes -= 1,
            6 => limits.uniform_block_bytes -= 1,
            7 => limits.uniform_alignment = 0,
            8 => limits.vertex_samplers -= 1,
            9 => limits.fragment_samplers -= 1,
            10 => limits.vertex_constant_vectors -= 1,
            11 => limits.fragment_constant_vectors -= 1,
            12 => limits.feedback_components -= 1,
            13 => limits.samples -= 1,
            _ => unreachable!(),
        }
        assert!(
            construct(limits, "GPU").is_err(),
            "host floor index {index}"
        );
    }
    let mut limits = baseline.clone();
    limits.uniform_alignment = 3;
    assert!(construct(limits, "GPU").is_err());
    for name in ["", "GPU\0alias", "GPUé", &"a".repeat(64)] {
        assert!(
            construct(baseline.clone(), name).is_err(),
            "identity {name:?}"
        );
    }
    assert!(construct(baseline, &"a".repeat(63)).is_ok());
}

#[test]
fn production_unref_uses_the_same_allocation_profile_as_create() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    for (id, target, format, width, height, depth, array) in [
        (40, 2, 67, 2048, 1024, 1, 1),
        (41, 7, 65, 4, 4, 1, 2),
        (42, 3, 65, 4, 4, 2, 1),
    ] {
        let create = request(
            p::CMD_RESOURCE_CREATE_3D,
            0,
            &[
                id, target, format, 8, width, height, depth, array, 0, 0, 0, 0,
            ],
        );
        r.command(&create, 24, p::RESP_OK_NODATA, 24);
        assert_eq!(
            r.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .resources
                .len(),
            1
        );
        r.command(
            &request(p::CMD_RESOURCE_UNREF, 0, &[id, 0]),
            24,
            p::RESP_OK_NODATA,
            24,
        );
        let state = r.state.borrow().control3d_snapshot().unwrap();
        assert!(state.resources.is_empty());
        assert_eq!((state.logical_bytes, state.gpu_bytes), (0, 0));
    }
}

#[test]
fn rejected_legacy_creates_and_backing_controls_preserve_both_owners() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    for req in [
        request(p::CMD_RESOURCE_CREATE_2D, 0, &[7, 3, 3, 2]),
        request(p::CMD_RESOURCE_CREATE_2D, 0, &[7, 1, 0, 2]),
        request(p::CMD_RESOURCE_CREATE_2D, 1, &[7, 1, 3, 2]),
    ] {
        r.command(&req, 24, p::RESP_ERR_INVALID_PARAMETER, 24);
        assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
        assert!(
            r.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .resources
                .is_empty()
        );
    }
    r.command(&create(7), 23, 0, 0);
    assert_eq!(r.state.borrow().resources.accounted_bytes(), 0);
    assert!(
        r.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .resources
            .is_empty()
    );
    r.command(&create(7), 24, p::RESP_OK_NODATA, 24);
    for (req, error) in [
        (backing(7), Control3dError::OutOfMemory),
        (
            request(p::CMD_RESOURCE_UNREF, 0, &[7, 0]),
            Control3dError::Unspecified,
        ),
    ] {
        let before = r.state.borrow().control3d_snapshot().unwrap();
        *r.controls.fail_next.borrow_mut() = Some(error);
        r.command(&req, 24, error.response_type(), 24);
        assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
        assert_eq!(r.state.borrow().resources.accounted_bytes(), 24);
        assert!(
            r.state
                .borrow()
                .resources
                .get(7)
                .unwrap()
                .backing
                .is_empty()
        );
    }
    r.command(&backing(7), 24, p::RESP_OK_NODATA, 24);
    let before = r.state.borrow().control3d_snapshot().unwrap();
    *r.controls.fail_next.borrow_mut() = Some(Control3dError::Unspecified);
    r.command(
        &request(p::CMD_RESOURCE_DETACH_BACKING, 0, &[7, 0]),
        24,
        p::RESP_ERR_UNSPEC,
        24,
    );
    assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
    assert_eq!(
        r.state.borrow().resources.get(7).unwrap().backing,
        [(BACKING, 24)]
    );
}

#[test]
fn capset_header_and_body_cross_original_scatter_gather_boundaries() {
    let mut r = Rig::qualified();
    r.negotiate(true);
    r.configure(0);
    let req = request(p::CMD_GET_CAPSET, 0, &[2, 1]);
    let input = [
        (virt::DRAM_BASE + 0x30000, &req[..17]),
        (virt::DRAM_BASE + 0x31000, &req[17..]),
    ];
    let output = [
        (virt::DRAM_BASE + 0x32000, 13usize),
        (virt::DRAM_BASE + 0x33000, 17),
        (virt::DRAM_BASE + 0x34000, 1402),
    ];
    for &(address, bytes) in &input {
        for (i, &byte) in bytes.iter().enumerate() {
            r.machine
                .bus_mut()
                .store8(address + i as u64, byte)
                .unwrap();
        }
    }
    for &(address, length) in &output {
        for i in 0..length + 8 {
            r.machine
                .bus_mut()
                .store8(address + i as u64, 0xa5)
                .unwrap();
        }
    }
    let descriptors = input.iter().map(|&(a, b)| (a, b.len(), 1u16)).chain(
        output
            .iter()
            .enumerate()
            .map(|(i, &(a, n))| (a, n, if i == 2 { 2 } else { 3 })),
    );
    for (i, (address, length, flags)) in descriptors.enumerate() {
        let at = DESC + i as u64 * 16;
        r.machine.bus_mut().store64(at, address).unwrap();
        r.machine.bus_mut().store32(at + 8, length as u32).unwrap();
        r.machine.bus_mut().store16(at + 12, flags).unwrap();
        r.machine
            .bus_mut()
            .store16(at + 14, if i == 4 { 0 } else { i as u16 + 1 })
            .unwrap();
    }
    r.machine.bus_mut().store16(AVAIL + 4, 0).unwrap();
    r.machine.bus_mut().store16(AVAIL + 2, 1).unwrap();
    r.mmio(0x50, 0);
    r.tick();
    assert_eq!(r.machine.bus_mut().load16(USED + 2).unwrap(), 1);
    assert_eq!(r.machine.bus_mut().load32(USED + 8).unwrap(), 1432);
    let mut body = Vec::new();
    for &(address, length) in &output {
        for i in 0..length {
            body.push(r.machine.bus_mut().load8(address + i as u64).unwrap());
        }
        for i in length..length + 8 {
            assert_eq!(r.machine.bus_mut().load8(address + i as u64).unwrap(), 0xa5);
        }
    }
    assert_eq!(word(&body, 0), p::RESP_OK_CAPSET);
    assert_eq!(&body[24..], caps().to_bytes());
}

#[test]
fn original_production_fragmented_backing_counts_are_bounded_and_atomic() {
    for count in [0usize, 256, 257, 420, 16_384, 16_385] {
        let mut r = Rig::qualified();
        r.request_base = virt::DRAM_BASE + 0x600000;
        r.negotiate(true);
        r.configure(0);
        r.command(
            &request(
                p::CMD_RESOURCE_CREATE_3D,
                0,
                &[77, 0, 64, 16, 65536, 1, 1, 1, 0, 0, 0, 0],
            ),
            24,
            p::RESP_OK_NODATA,
            24,
        );
        let mut bytes = request(p::CMD_RESOURCE_ATTACH_BACKING, 0, &[77, count as u32]);
        for i in 0..count {
            let address = BACKING + i as u64 * 16;
            let literal = [i as u8, (i >> 8) as u8, 0x3f, 0x7b];
            for (j, value) in literal.iter().enumerate() {
                r.machine
                    .bus_mut()
                    .store8(address + j as u64, *value)
                    .unwrap();
            }
            bytes.extend_from_slice(&address.to_le_bytes());
            bytes.extend_from_slice(&4u32.to_le_bytes());
            bytes.extend_from_slice(&0u32.to_le_bytes());
        }
        let valid = count > 0 && count <= 16_384;
        r.command(
            &bytes,
            24,
            if valid {
                p::RESP_OK_NODATA
            } else {
                p::RESP_ERR_INVALID_PARAMETER
            },
            24,
        );
        let state = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(
            state.backing_bytes,
            if valid { count as u64 * 4 } else { 0 }
        );
        assert_eq!(state.next_backing_generation, if valid { 2 } else { 1 });
        assert_eq!(
            state.resources[0].backing.as_ref().map(Vec::len),
            if valid { Some(count) } else { None }
        );
        if valid {
            let events = r.controls.events.borrow();
            let Control3dOperation::AttachBacking { segments, .. } =
                &events.last().unwrap().operation
            else {
                panic!("missing original attachment");
            };
            assert_eq!(segments.len(), count);
            for (i, segment) in segments.iter().enumerate() {
                assert_eq!(segment.addr, BACKING + i as u64 * 16);
                assert_eq!(segment.length, 4);
                assert_eq!(segment.bytes, [i as u8, (i >> 8) as u8, 0x3f, 0x7b]);
            }
        } else {
            assert_eq!(
                r.controls.events.borrow().len(),
                1,
                "refusal never publishes a partial attachment"
            );
            r.command(&backing(77), 24, p::RESP_OK_NODATA, 24);
            assert_eq!(
                r.state.borrow().control3d_snapshot().unwrap().backing_bytes,
                24
            );
        }
        let mut trace = HashSink::default();
        assert_eq!(r.machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
        eprintln!(
            "ORIGINAL_SG count={count} valid={valid} retired={} trace={:016x} state={}",
            trace.retired(),
            trace.hash(),
            state.hex_digest()
        );
    }
}

#[path = "production_gpu_checkpoint/mod.rs"]
mod gpu_checkpoint;
