//! Independent original MMIO count boundary. A sink observes controls, never replaces transport.
#[cfg(not(feature = "old-production"))]
#[path = "support/checkpoint_counts.rs"]
mod checkpoint_counts;

use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::dev::virtio::gpu::{
    GpuState, NullSink,
    capabilities::{FormatMask, HostLimits, QualifiedCapabilities},
    control3d::{Control3dError, Control3dEvent, Control3dSink},
    submit3d::{Submit3dMailbox, Submit3dRequest, Submit3dSink},
};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::{Machine, RunOutcome, bus::Bus, trace::HashSink};
const DESC: u64 = virt::DRAM_BASE + 0x10000;
const AVAIL: u64 = DESC + 0x1000;
const USED: u64 = DESC + 0x2000;
const REQUEST: u64 = DESC + 0x3000;
const RESPONSE: u64 = DESC + 0x4000;
const POPUP_FENCE: u64 = 0xd712_83ac_95f0_1404;
#[derive(Clone, Default)]
struct Controls(Rc<RefCell<Vec<Control3dEvent>>>);
impl Control3dSink for Controls {
    fn apply(&mut self, e: &Control3dEvent) -> Result<(), Control3dError> {
        self.0.borrow_mut().push(e.clone());
        Ok(())
    }
}
struct Submits;
impl Submit3dSink for Submits {
    fn begin_job(&mut self, _: &Submit3dRequest) -> Result<(), Control3dError> {
        panic!("Count-only fixture must not submit renderer work")
    }
    fn cancel_job(
        &mut self,
        _: wasm_vm_core::dev::virtio::gpu::submit3d::Submit3dKey,
    ) -> Result<(), Control3dError> {
        panic!("Count-only fixture must not cancel renderer work")
    }
}
#[derive(Clone, Copy, Debug)]
enum Profile {
    Production,
    Desktop,
    Private,
}
struct Rig {
    machine: Machine,
    state: Rc<RefCell<GpuState>>,
    controls: Controls,
    base: u64,
    next: u16,
}
fn qualification() -> QualifiedCapabilities {
    let mut formats = FormatMask::default();
    for f in [1, 2, 16, 67] {
        formats.insert(f).unwrap();
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
        formats.clone(),
        formats,
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap()
}
fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn literal(op: u32, payload: &[u32]) -> Vec<u8> {
    let mut b = vec![0; 24 + payload.len() * 4];
    b[..4].copy_from_slice(&op.to_le_bytes());
    for (i, v) in payload.iter().enumerate() {
        b[24 + i * 4..28 + i * 4].copy_from_slice(&v.to_le_bytes());
    }
    b
}
fn buffer(id: u32) -> Vec<u8> {
    literal(0x204, &[id, 0, 64, 16, 16, 1, 1, 1, 0, 0, 0, 0])
}
fn popup() -> Vec<u8> {
    let mut b = literal(0x204, &[104, 2, 67, 10, 24, 24, 1, 1, 0, 0, 0, 0]);
    b[4..8].copy_from_slice(&1u32.to_le_bytes());
    b[8..16].copy_from_slice(&POPUP_FENCE.to_le_bytes());
    b
}
impl Rig {
    fn new(profile: Profile, cached: bool) -> Self {
        let mut machine = Machine::new(8 * 1024 * 1024);
        machine.set_block_cache(cached);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let controls = Controls::default();
        let (_, mut state) = match profile {
            Profile::Production => machine.enable_virtio_gpu(Box::new(NullSink)),
            Profile::Desktop => machine.enable_virtio_gpu_standard_desktop_control3d_proof(
                Box::new(NullSink),
                Box::new(controls.clone()),
            ),
            Profile::Private => machine
                .enable_virtio_gpu_control3d_proof(Box::new(NullSink), Box::new(controls.clone())),
        }
        .unwrap();
        if matches!(profile, Profile::Production) {
            machine
                .attach_qualified_virgl(
                    Box::new(controls.clone()),
                    Box::new(Submits),
                    Submit3dMailbox::new(),
                    qualification(),
                )
                .unwrap();
            state = machine.virtio_gpu().unwrap().1;
        }
        state.borrow_mut().enable_command_trace();
        let base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000006f)
            .unwrap();
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        let mut r = Self {
            machine,
            state,
            controls,
            base,
            next: 0,
        };
        r.mmio(0x70, 3);
        r.mmio(0x24, 0);
        r.mmio(0x20, 1);
        r.mmio(0x24, 1);
        r.mmio(0x20, 1);
        r.mmio(0x70, 11);
        assert_ne!(r.machine.bus_mut().load32(base + 0x70).unwrap() & 8, 0);
        r.mmio(0x70, 15);
        r.mmio(0x30, 0);
        r.mmio(0x38, 8);
        for (o, a) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
            r.mmio(o, a as u32);
            r.mmio(o + 4, (a >> 32) as u32);
        }
        r.mmio(0x44, 1);
        r
    }
    fn mmio(&mut self, o: u64, v: u32) {
        self.machine.bus_mut().store32(self.base + o, v).unwrap();
    }
    fn command(&mut self, b: &[u8], expected: u32) -> Vec<u8> {
        for (i, v) in b.iter().enumerate() {
            self.machine
                .bus_mut()
                .store8(REQUEST + i as u64, *v)
                .unwrap();
        }
        for i in 0..1600 {
            self.machine.bus_mut().store8(RESPONSE + i, 0xa5).unwrap();
        }
        for (index, address, length, flags, next) in
            [(0, REQUEST, b.len(), 1, 1), (1, RESPONSE, 24, 2, 0)]
        {
            let at = DESC + index * 16;
            self.machine.bus_mut().store64(at, address).unwrap();
            self.machine
                .bus_mut()
                .store32(at + 8, length as u32)
                .unwrap();
            self.machine.bus_mut().store16(at + 12, flags).unwrap();
            self.machine.bus_mut().store16(at + 14, next).unwrap();
        }
        self.machine
            .bus_mut()
            .store16(AVAIL + 4 + 2 * u64::from(self.next % 8), 0)
            .unwrap();
        self.next += 1;
        self.machine
            .bus_mut()
            .store16(AVAIL + 2, self.next)
            .unwrap();
        self.mmio(0x50, 0);
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
        assert_eq!(self.machine.bus_mut().load16(USED + 2).unwrap(), self.next);
        let used = USED + 4 + 8 * u64::from((self.next - 1) % 8);
        assert_eq!(self.machine.bus_mut().load32(used).unwrap(), 0);
        assert_eq!(self.machine.bus_mut().load32(used + 4).unwrap(), 24);
        let response = (0..24)
            .map(|i| self.machine.bus_mut().load8(RESPONSE + i).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            word(&response, 0),
            expected,
            "literal request={b:02x?}, original response={response:02x?}"
        );
        let mut exact = b[..24].to_vec();
        exact[..4].copy_from_slice(&expected.to_le_bytes());
        assert_eq!(
            response, exact,
            "original flags/u64fence/context echoed exactly"
        );
        for i in 24..1600 {
            assert_eq!(
                self.machine.bus_mut().load8(RESPONSE + i).unwrap(),
                0xa5,
                "response tail untouched"
            );
        }
        response
    }
    fn trace(&mut self, label: &str, profile: Profile, cached: bool) {
        let mut trace = HashSink::default();
        assert_eq!(
            self.machine.run_traced(32, &mut trace),
            RunOutcome::MaxInstrs
        );
        assert_eq!(trace.retired(), 32);
        let state = self.state.borrow().control3d_snapshot().unwrap();
        eprintln!(
            "CRITIC_DESKTOP_COUNT phase={label} profile={profile:?} cached={cached} public={} logical={} gpu={} nextgen={} used={} trace32={:016x} architecture={}",
            state.resources.len(),
            state.logical_bytes,
            state.gpu_bytes,
            state.next_generation,
            self.next,
            trace.hash(),
            self.machine.snapshot().hex_digest()
        );
    }
}
#[test]
fn exact_recorded_popup_beyond_64_small_production_buffers() {
    for cached in [false, true] {
        let mut r = Rig::new(Profile::Production, cached);
        for id in 1..=64 {
            r.command(&buffer(id), 0x1100);
        }
        let before = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(before.resources.len(), 64);
        assert_eq!((before.logical_bytes, before.gpu_bytes), (1024, 1024));
        let host = r.controls.0.borrow().len();
        let packet = popup();
        assert_eq!(packet.len(), 72);
        let expected = if cfg!(feature = "old-production") {
            0x1201
        } else {
            0x1100
        };
        let response = r.command(&packet, expected);
        eprintln!("CRITIC_POPUP64 cached={cached} request={packet:02x?} response={response:02x?}");
        if cfg!(feature = "old-production") {
            assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
            assert_eq!(r.controls.0.borrow().len(), host);
            r.trace("old64-refusal", Profile::Production, cached);
            r.command(&literal(0x102, &[1, 0]), 0x1100);
            r.command(&packet, 0x1100);
        } else {
            assert_eq!(
                r.state
                    .borrow()
                    .control3d_snapshot()
                    .unwrap()
                    .resources
                    .len(),
                65
            );
            assert_eq!(r.controls.0.borrow().len(), host + 1);
            let accepted = r.state.borrow().control3d_snapshot().unwrap();
            r.command(&packet, 0x1203);
            assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), accepted);
            assert_eq!(r.controls.0.borrow().len(), host + 1);
            r.command(&literal(0x102, &[104, 0]), 0x1100);
            r.command(&packet, 0x1100);
        }
        let after = r.state.borrow().control3d_snapshot().unwrap();
        let found = after
            .resources
            .iter()
            .find(|s| s.identity.id == 104)
            .unwrap();
        assert_eq!(
            found.identity.generation,
            before.next_generation + u64::from(!cfg!(feature = "old-production"))
        );
        r.trace("popup-recovery", Profile::Production, cached);
    }
}
#[test]
fn isolated_profiles_keep_literal_16_and_64_count_guards() {
    for (profile, count) in [(Profile::Private, 16), (Profile::Desktop, 64)] {
        for cached in [false, true] {
            let mut r = Rig::new(profile, cached);
            for id in 1..=count {
                r.command(&buffer(id), 0x1100);
            }
            let before = r.state.borrow().control3d_snapshot().unwrap();
            let controls = r.controls.0.borrow().len();
            assert_eq!(before.resources.len(), count as usize);
            let response = r.command(&popup(), 0x1201);
            assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
            assert_eq!(r.controls.0.borrow().len(), controls);
            eprintln!(
                "CRITIC_PRIVATE_LIMIT profile={profile:?} cached={cached} count={count} response={response:02x?}"
            );
            r.command(&literal(0x102, &[1, 0]), 0x1100);
            r.command(&popup(), 0x1100);
            let after = r.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(after.resources.len(), count as usize);
            assert_eq!(
                after
                    .resources
                    .iter()
                    .find(|r| r.identity.id == 104)
                    .unwrap()
                    .identity
                    .generation,
                before.next_generation
            );
            r.trace("historical-recovery", profile, cached);
        }
    }
}

#[cfg(not(feature = "old-production"))]
#[test]
fn production_literal_512_resource_ceiling_refuses_before_effects() {
    for cached in [false, true] {
        let mut r = Rig::new(Profile::Production, cached);
        for id in 2000..2512 {
            r.command(&buffer(id), 0x1100);
        }
        let before = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(before.resources.len(), 512);
        assert_eq!((before.logical_bytes, before.gpu_bytes), (8192, 8192));
        let controls = r.controls.0.borrow().len();
        r.command(&popup(), 0x1201);
        assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
        assert_eq!(r.controls.0.borrow().len(), controls);
        r.command(&literal(0x102, &[2000, 0]), 0x1100);
        r.command(&popup(), 0x1100);
        let after = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(after.resources.len(), 512);
        assert_eq!((after.logical_bytes, after.gpu_bytes), (10480, 10480));
        assert_eq!(
            after
                .resources
                .iter()
                .find(|s| s.identity.id == 104)
                .unwrap()
                .identity
                .generation,
            before.next_generation
        );
        r.trace("production512-recovery", Profile::Production, cached);
    }
}

fn context_packet(op: u32, id: u32) -> Vec<u8> {
    let mut b = vec![0; if op == 0x200 { 96 } else { 24 }];
    b[..4].copy_from_slice(&op.to_le_bytes());
    b[16..20].copy_from_slice(&id.to_le_bytes());
    b
}

#[cfg(not(feature = "old-production"))]
#[test]
fn production_literal_32_context_ceiling_refuses_before_effects() {
    for cached in [false, true] {
        let mut r = Rig::new(Profile::Production, cached);
        for id in 1000..1032 {
            r.command(&context_packet(0x200, id), 0x1100);
        }
        let before = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(before.contexts.len(), 32);
        let controls = r.controls.0.borrow().len();
        r.command(&context_packet(0x200, 1032), 0x1201);
        assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
        assert_eq!(r.controls.0.borrow().len(), controls);
        r.command(&context_packet(0x201, 1000), 0x1100);
        r.command(&context_packet(0x200, 1032), 0x1100);
        let after = r.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(after.contexts.len(), 32);
        assert_eq!(
            after
                .contexts
                .iter()
                .find(|s| s.identity.id == 1032)
                .unwrap()
                .identity
                .generation,
            before.next_generation
        );
        r.trace("production32-context-recovery", Profile::Production, cached);
    }
}

#[test]
fn isolated_profiles_keep_literal_eight_context_guard() {
    let mut profiles = vec![Profile::Private, Profile::Desktop];
    if cfg!(feature = "old-production") {
        profiles.push(Profile::Production);
    }
    for profile in profiles {
        for cached in [false, true] {
            let mut r = Rig::new(profile, cached);
            for id in 1..=8 {
                r.command(&context_packet(0x200, id), 0x1100);
            }
            let before = r.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(before.contexts.len(), 8);
            let controls = r.controls.0.borrow().len();
            r.command(&context_packet(0x200, 9), 0x1201);
            assert_eq!(r.state.borrow().control3d_snapshot().unwrap(), before);
            assert_eq!(r.controls.0.borrow().len(), controls);
            r.command(&context_packet(0x201, 1), 0x1100);
            r.command(&context_packet(0x200, 9), 0x1100);
            let after = r.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(after.contexts.len(), 8);
            assert_eq!(
                after
                    .contexts
                    .iter()
                    .find(|s| s.identity.id == 9)
                    .unwrap()
                    .identity
                    .generation,
                before.next_generation
            );
            r.trace("historical-eight-context-recovery", profile, cached);
        }
    }
}
