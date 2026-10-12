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
        Self::with_profile(proof, negotiate, false)
    }
    fn desktop(negotiate: bool) -> Self {
        Self::with_profile(true, negotiate, true)
    }
    fn with_profile(proof: bool, negotiate: bool, desktop: bool) -> Self {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let recorder = Rc::new(RefCell::new(Recorder::default()));
        let (_, state) = if desktop {
            machine.enable_virtio_gpu_standard_desktop_control3d_proof(
                Box::new(NullSink),
                Box::new(Sink(recorder.clone())),
            )
        } else if proof {
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
        #[cfg(feature = "trace")]
        {
            let mut trace = wasm_vm_core::trace::VecSink::new();
            assert_eq!(
                self.machine.run_traced(1, &mut trace),
                RunOutcome::MaxInstrs
            );
            assert_eq!(trace.records.len(), 1);
            eprintln!("CONTROL3D_GUEST_TRACE {}", trace.canonical().trim());
        }
        #[cfg(not(feature = "trace"))]
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
        self.record_case(label, &request, &response);
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
    }
    fn record_case(&mut self, label: &str, request: &[u8], response: &[u8]) {
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
        let response_guard = hex(&self.read(RESPONSE + 24, 40));
        eprintln!(
            "{prefix} {{\"case\":{label:?},\"request\":{:?},\"response\":{:?},\"usedIndex\":{},\"ring\":{ring},\"machineDigest\":{:?},\"transportCanonical\":{:?},\"transportDigest\":{:?},\"responseGuard\":{:?},\"sinkEvents\":{}}}",
            hex(request),
            hex(response),
            self.next,
            self.machine.snapshot().hex_digest(),
            snapshot
                .as_ref()
                .map(|s| hex(&s.canonical_bytes()))
                .unwrap_or_default(),
            snapshot
                .as_ref()
                .map(|s| s.hex_digest())
                .unwrap_or_default(),
            response_guard,
            self.recorder.borrow().events.len()
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



fn critic_split(q: &mut Queue, label: &str, request: Vec<u8>, expected: u32, split: usize) {
    let before = q.state.borrow().control3d_snapshot().unwrap().canonical_bytes();
    let sink = q.recorder.borrow().events.clone();
    let req_len = request.len();
    let cut = split % (req_len - 1) + 1;
    let response_cut = split % 23 + 1;
    let (response, used) = q.submit_split(&request, &[cut, req_len-cut], &[response_cut, 24-response_cut]);
    q.record_case(label, &request, &response);
    assert_eq!(used, 24);
    assert_eq!(response, reply(&request, expected));
    assert_eq!(q.read(RESPONSE+24, 40), vec![0xa5;40]);
    if expected != OK {
        assert_eq!(q.state.borrow().control3d_snapshot().unwrap().canonical_bytes(), before);
        assert_eq!(q.recorder.borrow().events, sink);
    }
}

#[test]
fn desktop_critic_positive_fields_unknown_words_and_independent_budgets() {
    let mut q = Queue::desktop(true);
    let id = 0xd510_0001;
    for format in [1,2,67] {
        for role in [2,8,10] {
            for hint in [0, 1<<18, 1<<20, (1<<18)|(1<<20)] {
                let p=resource(id,2,format,role|hint,3,7);
                critic_split(&mut q,"critic-positive-color",p,OK,(format+role+hint) as usize);
                assert_eq!(q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,84);
                q.expect("critic-positive-color-unref",id_command(0x102,0,id),OK);
            }
        }
        for bit in (0..32).filter(|bit| ![1,3,18,20].contains(bit)) {
            critic_split(&mut q,"critic-unknown-color-bit",resource(id,2,format,2|(1u32<<bit),3,7),INVALID_PARAMETER,bit);
        }
        for role in [0,1,9,1<<18,1<<20,u32::MAX] {
            q.unchanged("critic-invalid-color-role",resource(id,2,format,role,3,7),INVALID_PARAMETER);
        }
    }
    for role in [1,8,9] {
        critic_split(&mut q,"critic-positive-depth",resource(id,2,20,role,3,7),OK,role as usize);
        q.expect("critic-depth-unref",id_command(0x102,0,id),OK);
    }
    for bit in (0..32).filter(|bit| ![0,3].contains(bit)) {
        q.unchanged("critic-unknown-depth-bit",resource(id,2,20,9|(1u32<<bit),3,7),INVALID_PARAMETER);
    }
    for format in [0,3,16,17,18,21,126,233,u32::MAX] {
        q.unchanged("critic-unknown-format",resource(id,2,format,10,3,7),INVALID_PARAMETER);
    }
    for format in [1,2,67,20] {
        let role=if format==20 {9} else {10};
        for (w,h) in [(16384,1),(1,16384),(1024,1024)] {
            q.expect("critic-exact-color-dimension-resource",resource(id,2,format,role,w,h),OK);
            q.expect("critic-exact-color-unref",id_command(0x102,0,id),OK);
        }
        for (w,h,code) in [(0,1,INVALID_PARAMETER),(1,0,INVALID_PARAMETER),(16385,1,INVALID_PARAMETER),(1,16385,INVALID_PARAMETER),(1024,1025,OOM),(u32::MAX,u32::MAX,INVALID_PARAMETER)] {
            q.unchanged("critic-color-boundary-refusal",resource(id,2,format,role,w,h),code);
        }
        for (offset,value) in [(28,u32::MAX),(48,0),(48,2),(52,0),(52,2),(56,1),(60,1),(64,1),(68,u32::MAX),(16,0x31415926),(4,2),(20,1),(21,1)] {
            let mut p=resource(id,2,format,role,3,7);put32(&mut p,offset,value);
            critic_split(&mut q,"critic-malformed-field",p,INVALID_PARAMETER,offset);
        }
    }
    for role in [16,32,524288] {
        q.expect("critic-old-buffer-exact",resource(id,0,64,role,4194304,1),OK);
        q.expect("critic-old-buffer-unref",id_command(0x102,0,id),OK);
        q.unchanged("critic-old-buffer-plus-one",resource(id,0,64,role,4194305,1),OOM);
    }
    for capacity in 1..24 {
        let p=resource(id,2,1,10|(1<<18),3,7);
        let before=q.state.borrow().control3d_snapshot().unwrap().canonical_bytes();
        let sink=q.recorder.borrow().events.clone();
        let (reply,used)=q.submit_split(&p,&[17,55],&[capacity]);
        q.record_case("critic-short-response",&p,&reply);
        assert_eq!(used,0);assert_eq!(q.read(RESPONSE,64),vec![0xa5;64]);
        assert_eq!(q.state.borrow().control3d_snapshot().unwrap().canonical_bytes(),before);
        assert_eq!(q.recorder.borrow().events,sink);
    }
    q.expect("critic-recover-short-response",resource(id,2,1,10|(1<<18),3,7),OK);
    q.expect("critic-recover-short-unref",id_command(0x102,0,id),OK);
    for i in 0..8 { q.expect("critic-GPU-budget-exact",resource(id+i,2,[1,2,67,20][i as usize%4],if i%4==3 {9} else {10},1024,1024),OK); }
    assert_eq!(q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,33554432);
    q.unchanged("critic-GPU-byte-plus-one",resource(id+8,0,64,16,1,1),OOM);
    for i in 0..8 { q.expect("critic-GPU-budget-unref",id_command(0x102,0,id+i),OK); }
    for i in 0..8 {
        q.expect("critic-backing-staging",resource(id+i,0,64,524288,1,1),OK);
        q.expect("critic-backing-exact",backing(id+i,&[(virt::DRAM_BASE,4194304)]),OK);
    }
    assert_eq!(q.state.borrow().control3d_snapshot().unwrap().backing_bytes,33554432);
    q.expect("critic-backing-overflow-staging",resource(id+8,0,64,524288,1,1),OK);
    q.unchanged("critic-backing-aggregate-plus-one",backing(id+8,&[(BACKING2+113,1)]),OOM);
    q.unchanged("critic-backing-resource-plus-one",backing(id+8,&[(virt::DRAM_BASE,4194304),(BACKING2+113,1)]),OOM);
    for i in 0..9 {q.expect("critic-backing-final-unref",id_command(0x102,0,id+i),OK);}
    let empty=q.state.borrow().control3d_snapshot().unwrap();assert!(empty.resources.is_empty());assert_eq!((empty.logical_bytes,empty.gpu_bytes,empty.backing_bytes),(0,0,0));
}

#[test]
fn desktop_critic_three_fresh_ownership_schedules() {
    for seed in [0x31c7_u32,0xb92d,0xe563] {
        let mut q=Queue::desktop(true);
        let base=0xd520_0000+(seed<<8);let ctx=base+7;
        q.expect("critic-context-A",context(ctx),OK);
        q.expect("critic-context-B",context(ctx+1),OK);
        for i in 0..64u32 {
            let n=(i*37+seed)%64;let id=base+n*23;
            let mut packet=resource(id,2,[1,2,67,20][n as usize%4],if n%4==3 {9} else {2|(1<<18)|(1<<20)},3,2);
            put32(&mut packet,4,1);packet[8..16].copy_from_slice(&(0x5a71_9000_0000_0000u64+u64::from(id)).to_le_bytes());
            critic_split(&mut q,"critic-shuffled64",packet,OK,(seed+i) as usize);
            assert_eq!(q.state.borrow().control3d_snapshot().unwrap().resources.len(),i as usize+1);
        }
        q.unchanged("critic-independent65-refusal",resource(base+0x10000,2,1,2,3,2),OOM);
        let id=base;
        q.expect("critic-membership-A",id_command(0x202,ctx,id),OK);
        q.expect("critic-membership-B",id_command(0x202,ctx+1,id),OK);
        let pattern:Vec<u8>=(0..32).map(|i|(i as u8)^seed as u8).collect();q.write(BACKING+5,&pattern);
        q.expect("critic-overlapping-backing",backing(id,&[(BACKING+5,7),(BACKING+9,8),(BACKING+5,7)]),OK);
        let saved=q.recorder.borrow().events.last().unwrap().clone();
        if let Control3dOperation::AttachBacking{segments,..}=&saved.operation {
            assert_eq!(segments.iter().flat_map(|s|s.bytes.iter().copied()).collect::<Vec<_>>(),[&pattern[..7],&pattern[4..12],&pattern[..7]].concat());
            eprintln!("CRITIC_OWNED_BACKING seed={seed} {saved:?}");
        } else {panic!("expected owned backing");}
        q.write(BACKING+5,&[0xee;32]);q.write(REQUEST,&[0xdd;72]);
        assert_eq!(*q.recorder.borrow().events.last().unwrap(),saved,"guest/request mutations must not mutate owned event");
        let generation=q.state.borrow().control3d_snapshot().unwrap().resources.iter().find(|r|r.identity.id==id).unwrap().identity.generation;
        q.recorder.borrow_mut().fail_next=Some(Control3dError::OutOfMemory);
        q.unchanged("critic-unref-host-failure",id_command(0x102,0,id),OOM);
        q.expect("critic-unref-with-two-memberships",id_command(0x102,0,id),OK);
        q.recorder.borrow_mut().fail_next=Some(Control3dError::OutOfMemory);
        q.unchanged("critic-create-host-failure",resource(id,2,1,2,3,2),OOM);
        critic_split(&mut q,"critic-same-ID-recovery",resource(id,2,1,2,3,2),OK,seed as usize);
        let state=q.state.borrow().control3d_snapshot().unwrap();assert_eq!(state.resources.len(),64);assert_eq!(state.backing_bytes,0);
        assert!(state.resources.iter().find(|r|r.identity.id==id).unwrap().identity.generation>generation);
        assert!(state.contexts.iter().all(|c|c.resources.is_empty()));
        q.unchanged("critic-stale-A",id_command(0x203,ctx,id),INVALID_PARAMETER);
        q.unchanged("critic-stale-B",id_command(0x203,ctx+1,id),INVALID_PARAMETER);
        q.unchanged("critic-duplicate-live-ID",resource(id,2,1,2,3,2),INVALID_RESOURCE);
        q.expect("critic-fresh-membership",id_command(0x202,ctx,id),OK);
        let mut two=header(0x101,0,40);for (off,val) in [(24,id),(28,67),(32,2),(36,2)] {put32(&mut two,off,val);}
        q.unchanged("critic-2D-collision",two.clone(),INVALID_RESOURCE);
        q.expect("critic-release-for-2D",id_command(0x102,0,id),OK);
        q.expect("critic-2D-owns-ID",two,OK);
        q.unchanged("critic-3D-collision",resource(id,2,2,2,3,2),INVALID_RESOURCE);
        q.expect("critic-2D-unref",id_command(0x102,0,id),OK);
        let old=q.state.borrow().control3d_snapshot().unwrap();
        eprintln!("CRITIC_SINK_BEFORE_RESET seed={seed} {:?}",q.recorder.borrow().events);
        q.mmio(0x70,0);assert_eq!(q.machine.run(1),RunOutcome::MaxInstrs);
        let reset=q.state.borrow().control3d_snapshot().unwrap();assert!(reset.epoch>old.epoch);assert!(reset.contexts.is_empty()&&reset.resources.is_empty());assert_eq!((reset.logical_bytes,reset.gpu_bytes,reset.backing_bytes),(0,0,0));
        q.next=0;q.configure();q.negotiate();
        q.expect("critic-reset-retains-selected",resource(id,2,1,2|(1<<18)|(1<<20),3,2),OK);
        q.expect("critic-final-release",id_command(0x102,0,id),OK);
        eprintln!("CRITIC_SINK_AFTER_RESET seed={seed} {:?}",q.recorder.borrow().events);
    }
}
