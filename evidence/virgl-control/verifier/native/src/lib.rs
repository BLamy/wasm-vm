//! Independent verifier attacks: all writes stay in the verifier evidence tree.
//! Literal protocol offsets; no worker encoder, oracle, or queue helper is imported.
#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};
    use wasm_vm_core::dev::virtio::gpu::control3d::{
        Control3dError, Control3dEvent, Control3dOperation, Control3dSink,
    };
    use wasm_vm_core::dev::virtio::gpu::{GpuState, NullSink};
    use wasm_vm_core::platform::{Platform, virt};
    use wasm_vm_core::{Machine, RunOutcome, bus::Bus};

    const SIZE: usize = 4 * 1024 * 1024;
    const D: u64 = virt::DRAM_BASE + 0x9100;
    const A: u64 = virt::DRAM_BASE + 0xa100;
    const U: u64 = virt::DRAM_BASE + 0xb100;
    const REQUEST: u64 = virt::DRAM_BASE + 0x11000;
    const REPLY: u64 = virt::DRAM_BASE + 0x13000;
    fn put(bytes: &mut [u8], at: usize, n: u32) {
        bytes[at..at + 4].copy_from_slice(&n.to_le_bytes());
    }
    fn packet(op: u32, ctx: u32, size: usize) -> Vec<u8> {
        let mut b = vec![0; size];
        put(&mut b, 0, op);
        put(&mut b, 16, ctx);
        b
    }
    fn create(id: u32) -> Vec<u8> {
        let mut b = packet(0x204, 0, 72);
        for (i, n) in [id, 0, 64, 16, 96, 1, 1, 1, 0, 0, 0, 0].iter().enumerate() {
            put(&mut b, 24 + 4 * i, *n);
        }
        b
    }
    fn entries(id: u32, list: &[(u64, u32)]) -> Vec<u8> {
        let mut b = packet(0x106, 0, 32 + 16 * list.len());
        put(&mut b, 24, id);
        put(&mut b, 28, list.len() as u32);
        for (i, (addr, len)) in list.iter().enumerate() {
            let at = 32 + 16 * i;
            b[at..at + 8].copy_from_slice(&addr.to_le_bytes());
            put(&mut b, at + 8, *len);
        }
        b
    }
    struct Sink(
        Rc<RefCell<Vec<Control3dEvent>>>,
        Rc<RefCell<Option<Control3dError>>>,
    );
    impl Control3dSink for Sink {
        fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError> {
            if let Some(error) = self.1.borrow_mut().take() {
                return Err(error);
            }
            self.0.borrow_mut().push(event.clone());
            Ok(())
        }
    }
    struct Rig {
        machine: Machine,
        state: Rc<RefCell<GpuState>>,
        events: Rc<RefCell<Vec<Control3dEvent>>>,
        fault: Rc<RefCell<Option<Control3dError>>>,
        base: u64,
        next: u16,
    }
    impl Rig {
        fn new() -> Self {
            let mut machine = Machine::new(SIZE);
            machine.enable_plic();
            machine.enable_virtio_slots(None);
            let events = Rc::new(RefCell::new(Vec::new()));
            let fault = Rc::new(RefCell::new(None));
            let (_, state) = machine
                .enable_virtio_gpu_control3d_proof(
                    Box::new(NullSink),
                    Box::new(Sink(events.clone(), fault.clone())),
                )
                .unwrap();
            let base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
            machine
                .bus_mut()
                .store32(virt::KERNEL_BASE, 0x0000006f)
                .unwrap();
            machine.hart_mut().regs.pc = virt::KERNEL_BASE;
            let mut r = Self {
                machine,
                state,
                events,
                fault,
                base,
                next: 0,
            };
            r.mmio(0x70, 3);
            r.mmio(0x24, 0);
            r.mmio(0x20, 1);
            r.mmio(0x24, 1);
            r.mmio(0x20, 1);
            r.mmio(0x70, 11);
            r.mmio(0x70, 15);
            r.mmio(0x30, 0);
            r.mmio(0x38, 32);
            for (reg, addr) in [(0x80, D), (0x90, A), (0xa0, U)] {
                r.mmio(reg, addr as u32);
                r.mmio(reg + 4, (addr >> 32) as u32);
            }
            r.mmio(0x44, 1);
            r
        }
        fn mmio(&mut self, offset: u64, value: u32) {
            self.machine
                .bus_mut()
                .store32(self.base + offset, value)
                .unwrap();
        }
        fn write(&mut self, addr: u64, b: &[u8]) {
            self.machine
                .bus_mut()
                .ram_mut()
                .write_slice(addr, b)
                .unwrap();
        }
        fn read(&mut self, addr: u64, n: usize) -> Vec<u8> {
            let mut b = vec![0; n];
            self.machine
                .bus_mut()
                .ram()
                .read_slice(addr, &mut b)
                .unwrap();
            b
        }
        fn desc(&mut self, i: usize, addr: u64, n: usize, flags: u16, next: u16) {
            let mut b = [0; 16];
            b[..8].copy_from_slice(&addr.to_le_bytes());
            put(&mut b, 8, n as u32);
            b[12..14].copy_from_slice(&flags.to_le_bytes());
            b[14..16].copy_from_slice(&next.to_le_bytes());
            self.write(D + 16 * i as u64, &b);
        }
        fn queue(&mut self, b: &[u8], response: u64, split: usize) {
            self.write(REQUEST, b);
            self.desc(0, REQUEST, split, 1, 1);
            self.desc(1, REQUEST + split as u64, b.len() - split, 1, 2);
            self.desc(2, response, 9, 3, 3);
            self.desc(3, response + 9, 15, 2, 0);
            self.write(A + 4 + 2 * u64::from(self.next % 32), &0u16.to_le_bytes());
            self.next = self.next.wrapping_add(1);
            self.write(A + 2, &self.next.to_le_bytes());
            self.mmio(0x50, 0);
        }
        fn run(&mut self, expected: u32, response: u64, ctx: u32) {
            assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
            let mut expected_bytes = vec![0; 24];
            put(&mut expected_bytes, 0, expected);
            put(&mut expected_bytes, 16, ctx);
            assert_eq!(self.read(response, 24), expected_bytes, "literal response");
            assert_eq!(self.machine.bus_mut().load16(U + 2).unwrap(), self.next);
            let n = self
                .machine
                .bus_mut()
                .load32(U + 8 + 8 * u64::from((self.next - 1) % 32))
                .unwrap();
            assert_eq!(n, 24);
        }
        fn submit(&mut self, b: &[u8], response: u64, split: usize, expected: u32) {
            self.queue(b, response, split);
            self.run(
                expected,
                response,
                u32::from_le_bytes(b[16..20].try_into().unwrap()),
            );
        }
    }

    #[test]
    fn pending_command_survives_every_snapshot_refusal_without_quiesce_or_fallback() {
        let mut donor = Machine::new(SIZE);
        donor.hart_mut().regs.pc = virt::KERNEL_BASE + 128;
        donor
            .bus_mut()
            .store32(virt::DRAM_BASE + 0x33300, 0xa1b2c3d4)
            .unwrap();
        let valid = donor.save_resume().unwrap();
        let mut r = Rig::new();
        let mut request = packet(0x200, 71, 96);
        put(&mut request, 24, 4);
        request[32..36].copy_from_slice(b"crit");
        r.write(REPLY, &[0x7b; 24]);
        r.queue(&request, REPLY, 19);
        let before_ram = r.read(virt::DRAM_BASE, SIZE);
        let before_cpu = r.machine.snapshot().hex_digest();
        let before_control = r
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .canonical_bytes();
        assert!(r.machine.save_resume().is_err());
        assert!(r.machine.save_desktop_snapshot().is_err());
        assert!(r.machine.load_resume(&valid).is_err());
        assert!(r.machine.load_resume(&[]).is_err());
        assert!(
            r.machine
                .restore_desktop_snapshot(
                    &[],
                    wasm_vm_core::desktop_restore::DisplaySize {
                        width: 32,
                        height: 32
                    }
                )
                .is_err()
        );
        assert!(r.state.borrow().to_snapshot().is_err());
        assert!(r.state.borrow_mut().restore_snapshot(&[]).is_err());
        assert_eq!(
            r.read(virt::DRAM_BASE, SIZE),
            before_ram,
            "all RAM remains unchanged"
        );
        assert_eq!(r.machine.snapshot().hex_digest(), before_cpu);
        assert_eq!(
            r.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes(),
            before_control
        );
        assert!(r.events.borrow().is_empty());
        r.run(0x1100, REPLY, 71);
        assert_eq!(
            r.events.borrow().len(),
            1,
            "pending queue was not consumed by snapshot refusal"
        );
        println!(
            "P13 HELD pending command retained; full RAM and architectural/transport digests unchanged through seven refusals"
        );
    }

    #[test]
    fn reply_alias_and_late_invalid_sg_do_not_change_initial_owned_bytes() {
        for seed in [0x19u8, 0x67, 0xd3] {
            let mut r = Rig::new();
            r.submit(&create(93), REPLY, 13, 0x1100);
            let pattern: Vec<u8> = (0..80).map(|i| seed.wrapping_add((i * 29) as u8)).collect();
            r.write(REPLY, &pattern);
            let b = entries(93, &[(REPLY, 31), (REPLY + 7, 22), (REPLY + 63, 9)]);
            r.submit(&b, REPLY, 47, 0x1100);
            let event = r.events.borrow().last().unwrap().clone();
            let Control3dOperation::AttachBacking { segments, .. } = event.operation else {
                panic!("expected attach")
            };
            assert_eq!(segments[0].bytes, pattern[..31]);
            assert_eq!(segments[1].bytes, pattern[7..29]);
            assert_eq!(segments[2].bytes, pattern[63..72]);
            r.write(REPLY, &[0xee; 80]);
            assert_eq!(
                segments[0].bytes,
                pattern[..31],
                "owned sink data cannot become later DMA"
            );
            let mut detach = packet(0x107, 0, 32);
            put(&mut detach, 24, 93);
            r.submit(&detach, REPLY, 27, 0x1100);
            let before = r
                .state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes();
            let calls = r.events.borrow().len();
            let invalid = entries(
                93,
                &[(REPLY + 32, 16), (virt::DRAM_BASE + SIZE as u64 - 7, 8)],
            );
            r.submit(&invalid, REPLY, 33, 0x1205);
            assert_eq!(
                r.state
                    .borrow()
                    .control3d_snapshot()
                    .unwrap()
                    .canonical_bytes(),
                before
            );
            assert_eq!(r.events.borrow().len(), calls);
            r.submit(&entries(93, &[(REPLY + 32, 3)]), REPLY, 39, 0x1100);
            assert_eq!(
                r.state.borrow().control3d_snapshot().unwrap().backing_bytes,
                3,
                "short aggregate remains legal"
            );
            println!(
                "P08/P09 HELD seed={seed:02x}; alias SG copied before reply, invalid tail atomic, short valid recovery"
            );
        }
    }
    #[test]
    fn independent_padding_detach_and_sink_failures_cover_transaction_boundary() {
        let mut r = Rig::new();
        r.submit(&packet(0x200, 71, 96), REPLY, 17, 0x1100);
        r.submit(&create(93), REPLY, 11, 0x1100);
        for (opcode, ctx) in [(0x202, 71), (0x203, 71), (0x102, 0), (0x107, 0)] {
            let mut b = packet(opcode, ctx, 32);
            put(&mut b, 24, 93);
            put(&mut b, 28, 0x100);
            let before = r
                .state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes();
            let calls = r.events.borrow().len();
            r.submit(&b, REPLY, 29, 0x1205);
            assert_eq!(
                r.state
                    .borrow()
                    .control3d_snapshot()
                    .unwrap()
                    .canonical_bytes(),
                before
            );
            assert_eq!(r.events.borrow().len(), calls);
        }
        let mut detach = packet(0x107, 0, 32);
        put(&mut detach, 24, 93);
        r.submit(&detach, REPLY, 27, 0x1205);
        let error = r.state.borrow().to_snapshot().unwrap_err();
        assert_eq!(error.code(), "proof_3d_installed");
        for (error, wire) in [
            (Control3dError::InvalidContextId, 0x1204),
            (Control3dError::InvalidResourceId, 0x1203),
            (Control3dError::InvalidParameter, 0x1205),
            (Control3dError::OutOfMemory, 0x1201),
            (Control3dError::Unspecified, 0x1200),
            (Control3dError::BridgePoisoned, 0x1200),
        ] {
            let mut r = Rig::new();
            let before = r.state.borrow().control3d_snapshot().unwrap();
            *r.fault.borrow_mut() = Some(error);
            r.submit(&create(117), REPLY, 21, wire);
            let after = r.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(after.next_generation, before.next_generation);
            assert!(after.resources.is_empty());
            assert_eq!(after.gpu_bytes, 0);
            assert!(r.events.borrow().is_empty());
            if error == Control3dError::BridgePoisoned {
                assert!(after.poisoned);
                r.submit(&create(117), REPLY, 15, 0x1200);
                assert!(r.events.borrow().is_empty());
                r.mmio(0x70, 0);
                r.machine.run(1);
                assert!(!r.state.borrow().control3d_snapshot().unwrap().poisoned);
            } else {
                assert_eq!(after, before);
                r.submit(&create(117), REPLY, 15, 0x1100);
            }
            println!(
                "P10/P11 HELD sink_error={} wire={wire:04x}; no partial resource publication",
                error.code()
            );
        }
        // Reset ordinary failure is also uncertain; state must remain poisoned.
        let mut r = Rig::new();
        r.submit(&create(119), REPLY, 13, 0x1100);
        *r.fault.borrow_mut() = Some(Control3dError::Unspecified);
        r.mmio(0x70, 0);
        r.machine.run(1);
        let after = r.state.borrow().control3d_snapshot().unwrap();
        assert!(after.poisoned);
        assert!(after.resources.is_empty());
        assert_eq!(after.epoch, 2);
        r.mmio(0x70, 0);
        r.machine.run(1);
        assert!(!r.state.borrow().control3d_snapshot().unwrap().poisoned);
    }
    #[test]
    fn each_control_transaction_rolls_back_sink_failure_and_retries() {
        for opcode in [0x200, 0x201, 0x202, 0x203, 0x204, 0x106, 0x107, 0x102] {
            let mut r = Rig::new();
            r.submit(&packet(0x200, 71, 96), REPLY, 17, 0x1100);
            r.submit(&create(93), REPLY, 11, 0x1100);
            let mut attach = packet(0x202, 71, 32);
            put(&mut attach, 24, 93);
            r.submit(&attach, REPLY, 27, 0x1100);
            r.submit(&entries(93, &[(REPLY + 100, 3)]), REPLY, 31, 0x1100);
            let b = match opcode {
                0x200 => packet(opcode, 72, 96),
                0x201 => packet(opcode, 71, 24),
                0x204 => create(94),
                0x202 => {
                    r.submit(&packet(0x200, 72, 96), REPLY, 17, 0x1100);
                    let mut b = packet(opcode, 72, 32);
                    put(&mut b, 24, 93);
                    b
                }
                0x106 => {
                    let mut b = packet(0x107, 0, 32);
                    put(&mut b, 24, 93);
                    r.submit(&b, REPLY, 27, 0x1100);
                    entries(93, &[(REPLY + 100, 3)])
                }
                _ => {
                    let mut b = packet(opcode, if opcode == 0x203 { 71 } else { 0 }, 32);
                    put(&mut b, 24, 93);
                    b
                }
            };
            let before = r
                .state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes();
            let calls = r.events.borrow().len();
            *r.fault.borrow_mut() = Some(Control3dError::Unspecified);
            r.submit(&b, REPLY, 19, 0x1200);
            assert_eq!(
                r.state
                    .borrow()
                    .control3d_snapshot()
                    .unwrap()
                    .canonical_bytes(),
                before
            );
            assert_eq!(r.events.borrow().len(), calls);
            r.submit(&b, REPLY, 19, 0x1100);
            assert_eq!(r.events.borrow().len(), calls + 1);
            println!(
                "P10 HELD opcode={opcode:04x} expected sink failure atomic and retry successful"
            );
        }
        let mut r = Rig::new();
        r.submit(&create(93), REPLY, 13, 0x1100);
        r.submit(&packet(0x201, 71, 24), REPLY, 13, 0x1204);
        r.submit(&packet(0x201, 71, 25), REPLY, 13, 0x1205);
        let mut bad = packet(0x202, 71, 33);
        put(&mut bad, 24, 93);
        r.submit(&bad, REPLY, 13, 0x1205);
        let mut bad = packet(0x102, 0, 33);
        put(&mut bad, 24, 93);
        r.submit(&bad, REPLY, 13, 0x1205);
        let mut bad = packet(0x106, 0, 31);
        put(&mut bad, 24, 93);
        r.submit(&bad, REPLY, 13, 0x1205);
    }
}
