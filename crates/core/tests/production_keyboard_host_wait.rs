//! Original input DMA lifecycles and deterministic idle-clock boundaries.
#![cfg(not(feature = "zicsr-stub"))]

use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::clint::ClintState;
use wasm_vm_core::dev::virtio::input::keyboard::KEYBOARD_VIRTIO_SLOT;
use wasm_vm_core::dev::virtio::input::{EV_KEY, InputState};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const DATA: u64 = virt::DRAM_BASE + 0x13_0000;
const HANDLER: u64 = virt::KERNEL_BASE + 0x4000;

struct Rig {
    machine: Machine,
    input: Option<Rc<RefCell<InputState>>>,
    clock: Rc<RefCell<ClintState>>,
    offered: u16,
}

impl Rig {
    fn new(keyboard: bool) -> Self {
        let mut machine = Machine::new(8 * 1024 * 1024);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let input = keyboard.then(|| machine.enable_virtio_keyboard().1);
        let clock = machine.enable_clint(64);
        let mut rig = Self {
            machine,
            input,
            clock,
            offered: 0,
        };
        if keyboard {
            for index in 0..8u64 {
                rig.machine
                    .bus_mut()
                    .store64(DESC + index * 16, DATA + index * 8)
                    .unwrap();
                rig.machine
                    .bus_mut()
                    .store32(DESC + index * 16 + 8, 8)
                    .unwrap();
                rig.machine
                    .bus_mut()
                    .store16(DESC + index * 16 + 12, 2)
                    .unwrap();
            }
            for (offset, value) in [
                (0x70, 3),
                (0x24, 1),
                (0x20, 1),
                (0x70, 11),
                (0x70, 15),
                (0x30, 0),
                (0x38, 8),
            ] {
                rig.write(offset, value);
            }
            for (offset, address) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
                rig.write(offset, address as u32);
                rig.write(offset + 4, (address >> 32) as u32);
            }
            rig.write(0x44, 1);
        }
        rig.machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        rig.machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        rig
    }
    fn write(&mut self, offset: u64, value: u32) {
        self.machine
            .bus_mut()
            .store32(
                Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64) + offset,
                value,
            )
            .unwrap();
    }
    fn edge(&mut self, value: i32, sync: bool) {
        let input = self.input.as_ref().unwrap();
        assert!(input.borrow_mut().inject_event(EV_KEY, 35, value));
        if sync {
            input.borrow_mut().sync();
        }
    }
    fn deliver(&mut self, count: u16) {
        for index in self.offered..self.offered + count {
            self.machine
                .bus_mut()
                .store16(AVAIL + 4 + u64::from(index % 8) * 2, index % 8)
                .unwrap();
        }
        self.offered += count;
        self.machine
            .bus_mut()
            .store16(AVAIL + 2, self.offered)
            .unwrap();
        self.write(0x50, 0);
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
        assert_eq!(
            self.machine.bus_mut().load16(USED + 2).unwrap(),
            self.offered
        );
        assert_eq!(self.input.as_ref().unwrap().borrow().pending_events(), 0);
    }
    fn idle(&mut self, cached: bool, initial: u64, deadline: u64, budget: u64) -> (u64, u64) {
        self.clock.borrow_mut().mtime = initial;
        self.machine
            .bus_mut()
            .store64(virt::CLINT_BASE + 0x4000, deadline)
            .unwrap();
        for (at, word) in [
            (virt::KERNEL_BASE, 0x1050_0073),
            (virt::KERNEL_BASE + 4, 0xffdf_f06f),
            (HANDLER, 0x0000_006f),
        ] {
            self.machine.bus_mut().store32(at, word).unwrap();
        }
        for (address, value) in [(MTVEC, HANDLER), (MIE, 1 << 7), (MSTATUS, 1 << 3)] {
            self.machine
                .hart_mut()
                .csr
                .access(address, CsrOp::Write, value, false, false, 0)
                .unwrap();
        }
        self.machine.set_block_cache(cached);
        self.machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        let mut trace = HashSink::new();
        assert_eq!(
            self.machine.run_traced(budget, &mut trace),
            RunOutcome::MaxInstrs
        );
        assert_eq!(trace.retired(), budget);
        (self.clock.borrow().mtime, trace.hash())
    }
}

#[test]
fn original_keyboard_lifecycle_preserves_wait_and_releases_idle_jump() {
    for cached in [false, true] {
        for initial in [0, 500_000] {
            let deadline = initial + 5_000_000_000;
            for phase in [
                "absent",
                "quiet",
                "refused",
                "staged",
                "pending",
                "delivered",
                "pending-break",
                "break",
                "pending-release-all",
                "release-all",
                "reset",
            ] {
                let mut r = Rig::new(phase != "absent");
                let waiting = matches!(
                    phase,
                    "staged" | "pending" | "delivered" | "pending-break" | "pending-release-all"
                );
                match phase {
                    "absent" | "quiet" => {}
                    "refused" => {
                        assert!(
                            !r.input
                                .as_ref()
                                .unwrap()
                                .borrow_mut()
                                .inject_event(EV_KEY, 35, 2)
                        );
                        r.input.as_ref().unwrap().borrow_mut().sync();
                    }
                    "staged" => r.edge(1, false),
                    "pending" => r.edge(1, true),
                    _ => {
                        r.edge(1, true);
                        r.deliver(2);
                        assert_eq!(r.machine.bus_mut().load16(DATA).unwrap(), EV_KEY);
                        assert_eq!(r.machine.bus_mut().load16(DATA + 2).unwrap(), 35);
                        assert_eq!(r.machine.bus_mut().load32(DATA + 4).unwrap(), 1);
                        match phase {
                            "delivered" => {}
                            "pending-break" => r.edge(0, true),
                            "break" => {
                                r.edge(0, true);
                                r.deliver(2);
                                assert_eq!(r.machine.bus_mut().load32(DATA + 20).unwrap(), 0);
                            }
                            "pending-release-all" | "release-all" => {
                                let report = r.input.as_ref().unwrap().borrow_mut().release_all();
                                assert_eq!(report.release_events.len(), 2);
                                assert_eq!(report.release_events[0].value, 0);
                                if phase == "release-all" {
                                    r.deliver(2);
                                }
                            }
                            "reset" => r.write(0x70, 0),
                            _ => unreachable!(),
                        }
                    }
                }
                let (actual, hash) = r.idle(cached, initial, deadline, 1);
                let expected = if waiting { initial } else { deadline };
                assert_eq!(
                    actual, expected,
                    "{phase},cached={cached},initial={initial}"
                );
                eprintln!(
                    "KEYBOARD_LIFECYCLE phase={phase} cached={cached} initial={initial} deadline={deadline} actual={actual} expected={expected} trace_retires=1 trace_hash={hash:016x}"
                );
            }
            let mut r = Rig::new(true);
            r.edge(1, true);
            r.deliver(2);
            let (actual, hash) = r.idle(cached, initial, deadline, 128);
            assert_eq!(
                actual,
                initial + 2,
                "normal retirement advances ICount with a held key"
            );
            eprintln!(
                "KEYBOARD_RETIRE cached={cached} initial={initial} actual={actual} trace_retires=128 trace_hash={hash:016x}"
            );
        }
    }
}
