//! Independent original-input/clock boundary discovered by the stock desktop cold run.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::virtio::input::EV_KEY;
use wasm_vm_core::dev::virtio::input::keyboard::KEYBOARD_VIRTIO_SLOT;
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const DATA: u64 = virt::DRAM_BASE + 0x13_0000;
const HANDLER: u64 = virt::KERNEL_BASE + 0x4000;
const KEY_H: u16 = 35;

fn write(machine: &mut Machine, offset: u64, value: u32) {
    machine
        .bus_mut()
        .store32(
            Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64) + offset,
            value,
        )
        .unwrap();
}

#[test]
fn original_delivered_keyboard_make_preserves_host_turn_before_idle_jump() {
    let mut mismatches = Vec::new();
    for cached in [false, true] {
        for deadline in [500_000, 5_000_000_000] {
            for held in [false, true] {
                let mut machine = Machine::new(8 * 1024 * 1024);
                machine.enable_plic();
                machine.enable_virtio_slots(None);
                let (_, input, _) = machine.enable_virtio_keyboard();
                for index in 0..2u64 {
                    let descriptor = DESC + index * 16;
                    machine
                        .bus_mut()
                        .store64(descriptor, DATA + index * 8)
                        .unwrap();
                    machine.bus_mut().store32(descriptor + 8, 8).unwrap();
                    machine.bus_mut().store16(descriptor + 12, 2).unwrap();
                    machine
                        .bus_mut()
                        .store16(AVAIL + 4 + index * 2, index as u16)
                        .unwrap();
                }
                machine.bus_mut().store16(AVAIL + 2, 2).unwrap();
                for (offset, value) in [
                    (0x70, 3),
                    (0x24, 1),
                    (0x20, 1),
                    (0x70, 11),
                    (0x70, 15),
                    (0x30, 0),
                    (0x38, 8),
                ] {
                    write(&mut machine, offset, value);
                }
                for (offset, address) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
                    write(&mut machine, offset, address as u32);
                    write(&mut machine, offset + 4, (address >> 32) as u32);
                }
                write(&mut machine, 0x44, 1);
                if held {
                    assert!(input.borrow_mut().inject_event(EV_KEY, KEY_H, 1));
                    input.borrow_mut().sync();
                }
                machine
                    .bus_mut()
                    .store32(virt::KERNEL_BASE, 0x0000_006f)
                    .unwrap();
                machine.hart_mut().regs.pc = virt::KERNEL_BASE;
                write(&mut machine, 0x50, 0);
                assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
                let used = machine.bus_mut().load16(USED + 2).unwrap();
                assert_eq!(used, if held { 2 } else { 0 });
                if held {
                    let bytes: Vec<_> = (0..16)
                        .map(|at| machine.bus_mut().load8(DATA + at).unwrap())
                        .collect();
                    assert_eq!(bytes, [1, 0, 35, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                    assert_eq!(input.borrow().pending_events(), 0);
                }
                let clint = machine.enable_clint(64);
                machine
                    .bus_mut()
                    .store64(virt::CLINT_BASE + 0x4000, deadline)
                    .unwrap();
                for (at, instruction) in [
                    (virt::KERNEL_BASE, 0x1050_0073),
                    (virt::KERNEL_BASE + 4, 0xffdf_f06f),
                    (HANDLER, 0x0000_006f),
                ] {
                    machine.bus_mut().store32(at, instruction).unwrap();
                }
                for (address, value) in [(MTVEC, HANDLER), (MIE, 1 << 7), (MSTATUS, 1 << 3)] {
                    machine
                        .hart_mut()
                        .csr
                        .access(address, CsrOp::Write, value, false, false, 0)
                        .unwrap();
                }
                machine.set_block_cache(cached);
                machine.hart_mut().regs.pc = virt::KERNEL_BASE;
                let mut trace = HashSink::new();
                assert_eq!(machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
                let actual = clint.borrow().mtime;
                let expected = if held { 0 } else { deadline };
                eprintln!(
                    "KEYBOARD_WFI cached={cached} deadline={deadline} held={held} original_used={used} actual_mtime={actual} expected_mtime={expected} trace_retires={} trace_hash={:016x}",
                    trace.retired(),
                    trace.hash()
                );
                if actual != expected {
                    mismatches.push((cached, deadline, held, actual, expected));
                }
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "original delivered key must not skip its host release turn: {mismatches:?}"
    );
}

#[test]
fn two_original_keys_require_both_breaks_and_never_freeze_busy_retirement() {
    const BUSY: u64 = virt::KERNEL_BASE + 0x100;
    for cached in [false, true] {
        for initial in [37, 1_234_567] {
            let mut machine = Machine::new(8 * 1024 * 1024);
            machine.enable_plic();
            machine.enable_virtio_slots(None);
            let (_, input, _) = machine.enable_virtio_keyboard();
            for index in 0..8u64 {
                let descriptor = DESC + index * 16;
                machine
                    .bus_mut()
                    .store64(descriptor, DATA + index * 8)
                    .unwrap();
                machine.bus_mut().store32(descriptor + 8, 8).unwrap();
                machine.bus_mut().store16(descriptor + 12, 2).unwrap();
                machine
                    .bus_mut()
                    .store16(AVAIL + 4 + index * 2, index as u16)
                    .unwrap();
            }
            machine.bus_mut().store16(AVAIL + 2, 4).unwrap();
            for (offset, value) in [
                (0x70, 3),
                (0x24, 1),
                (0x20, 1),
                (0x70, 11),
                (0x70, 15),
                (0x30, 0),
                (0x38, 8),
            ] {
                write(&mut machine, offset, value);
            }
            for (offset, address) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
                write(&mut machine, offset, address as u32);
                write(&mut machine, offset + 4, (address >> 32) as u32);
            }
            write(&mut machine, 0x44, 1);
            for key in [30, 33] {
                assert!(input.borrow_mut().inject_event(EV_KEY, key, 1));
                input.borrow_mut().sync();
            }
            for (at, instruction) in [
                (BUSY, 0x0000_006f),
                (virt::KERNEL_BASE, 0x1050_0073),
                (virt::KERNEL_BASE + 4, 0xffdf_f06f),
                (HANDLER, 0x0000_006f),
            ] {
                machine.bus_mut().store32(at, instruction).unwrap();
            }
            machine.hart_mut().regs.pc = BUSY;
            write(&mut machine, 0x50, 0);
            assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
            assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 4);
            for (index, key) in [(0, 30), (2, 33)] {
                assert_eq!(machine.bus_mut().load16(DATA + index * 8).unwrap(), EV_KEY);
                assert_eq!(machine.bus_mut().load16(DATA + index * 8 + 2).unwrap(), key);
                assert_eq!(machine.bus_mut().load32(DATA + index * 8 + 4).unwrap(), 1);
            }
            let clint = machine.enable_clint(64);
            clint.borrow_mut().mtime = initial;
            let deadline = initial + 500_000;
            machine
                .bus_mut()
                .store64(virt::CLINT_BASE + 0x4000, deadline)
                .unwrap();
            for (address, value) in [(MTVEC, HANDLER), (MIE, 1 << 7), (MSTATUS, 1 << 3)] {
                machine
                    .hart_mut()
                    .csr
                    .access(address, CsrOp::Write, value, false, false, 0)
                    .unwrap();
            }
            machine.set_block_cache(cached);
            let mut trace = HashSink::new();
            assert_eq!(machine.run_traced(128, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                initial + 2,
                "busy clock with both keys"
            );
            machine.hart_mut().regs.pc = virt::KERNEL_BASE;
            assert_eq!(machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                initial + 2,
                "both keys still await host"
            );

            assert!(input.borrow_mut().inject_event(EV_KEY, 30, 0));
            input.borrow_mut().sync();
            machine.bus_mut().store16(AVAIL + 2, 6).unwrap();
            write(&mut machine, 0x50, 0);
            machine.hart_mut().regs.pc = BUSY;
            assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
            assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 6);
            assert_eq!(machine.bus_mut().load16(DATA + 4 * 8 + 2).unwrap(), 30);
            assert_eq!(machine.bus_mut().load32(DATA + 4 * 8 + 4).unwrap(), 0);
            assert_eq!(machine.run_traced(128, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(clint.borrow().mtime, initial + 4, "busy clock with one key");
            machine.hart_mut().regs.pc = virt::KERNEL_BASE;
            assert_eq!(machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                initial + 4,
                "one break cannot release the other key"
            );

            assert!(input.borrow_mut().inject_event(EV_KEY, 33, 0));
            input.borrow_mut().sync();
            machine.bus_mut().store16(AVAIL + 2, 8).unwrap();
            write(&mut machine, 0x50, 0);
            machine.hart_mut().regs.pc = BUSY;
            assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
            assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 8);
            assert_eq!(machine.bus_mut().load16(DATA + 6 * 8 + 2).unwrap(), 33);
            assert_eq!(machine.bus_mut().load32(DATA + 6 * 8 + 4).unwrap(), 0);
            assert_eq!(input.borrow().pending_events(), 0);
            machine.hart_mut().regs.pc = virt::KERNEL_BASE;
            assert_eq!(machine.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(
                clint.borrow().mtime,
                deadline,
                "both original breaks restore idle behavior"
            );
            assert_eq!(trace.retired(), 259);
            eprintln!(
                "KEYBOARD_TWO_KEYS cached={cached} initial={initial} busy_ticks=4 used=8 settled_mtime={deadline} trace_retires={} trace_hash={:016x}",
                trace.retired(),
                trace.hash()
            );
        }
    }
}
