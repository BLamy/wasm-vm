#[cfg(test)]
mod tests {
    use wasm_vm_core::Machine;
    use wasm_vm_core::RunOutcome;
    use wasm_vm_core::bus::Bus;
    use wasm_vm_core::desktop_restore::DisplaySize;
    use wasm_vm_core::desktop_snapshot::{section, DesktopSnapshotBuilder, FORMAT_VERSION};
    use wasm_vm_core::dev::virtio::console::{
        AGENT_PORT_ID, AGENT_RECEIVE_QUEUE, AGENT_TRANSMIT_QUEUE, CONTROL_RECEIVE_QUEUE,
        CONTROL_TRANSMIT_QUEUE, ConsoleControl, VIRTIO_CONSOLE_DEVICE_READY,
        VIRTIO_CONSOLE_PORT_OPEN, VIRTIO_CONSOLE_PORT_READY, VIRTIO_CONSOLE_SLOT,
    };
    use wasm_vm_core::dev::virtio::gpu::{protocol, FrameSink, NullSink, Rect, VirtioGpu};
    use wasm_vm_core::dev::virtio::input::keyboard::KEY_A;
    use wasm_vm_core::dev::virtio::input::{InputDeviceSpec, VirtioInput, EV_KEY};
    use wasm_vm_core::dev::virtio::snd::{PcmParams, SndStatus, VirtioSnd};
    use wasm_vm_core::platform::{virt, Platform};

    const RAM: usize = 8 * 1024 * 1024;
    const QUEUE_SIZE: u16 = 8;
    const DESC_BASE: u64 = virt::DRAM_BASE + 0x10_000;
    const AVAIL_BASE: u64 = virt::DRAM_BASE + 0x20_000;
    const USED_BASE: u64 = virt::DRAM_BASE + 0x30_000;
    const DATA_BASE: u64 = virt::DRAM_BASE + 0x40_000;

    fn queue_addr(base: u64, queue: u32) -> u64 {
        base + u64::from(queue) * 0x1000
    }

    fn mmio_write(machine: &mut Machine, slot_base: u64, offset: u64, value: u32) {
        machine.bus_mut().store32(slot_base + offset, value).unwrap();
    }

    fn configure_queue(machine: &mut Machine, slot_base: u64, queue: u32) {
        let desc = queue_addr(DESC_BASE, queue);
        let avail = queue_addr(AVAIL_BASE, queue);
        let used = queue_addr(USED_BASE, queue);
        machine.bus_mut().store16(avail, 0).unwrap();
        machine.bus_mut().store16(avail + 2, 0).unwrap();
        machine.bus_mut().store16(used + 2, 0).unwrap();
        mmio_write(machine, slot_base, 0x30, queue);
        mmio_write(machine, slot_base, 0x38, u32::from(QUEUE_SIZE));
        mmio_write(machine, slot_base, 0x80, desc as u32);
        mmio_write(machine, slot_base, 0x84, (desc >> 32) as u32);
        mmio_write(machine, slot_base, 0x90, avail as u32);
        mmio_write(machine, slot_base, 0x94, (avail >> 32) as u32);
        mmio_write(machine, slot_base, 0xa0, used as u32);
        mmio_write(machine, slot_base, 0xa4, (used >> 32) as u32);
        mmio_write(machine, slot_base, 0x44, 1);
    }

    fn descriptor(
        machine: &mut Machine,
        queue: u32,
        index: u16,
        addr: u64,
        len: u32,
        flags: u16,
    ) {
        let base = queue_addr(DESC_BASE, queue) + 16 * u64::from(index);
        machine.bus_mut().store64(base, addr).unwrap();
        machine.bus_mut().store32(base + 8, len).unwrap();
        machine.bus_mut().store16(base + 12, flags).unwrap();
        machine.bus_mut().store16(base + 14, 0).unwrap();
    }

    fn post(machine: &mut Machine, queue: u32, ring_index: u16, descriptor_index: u16) {
        let avail = queue_addr(AVAIL_BASE, queue);
        machine
            .bus_mut()
            .store16(avail + 4 + 2 * u64::from(ring_index % QUEUE_SIZE), descriptor_index)
            .unwrap();
        machine.bus_mut().store16(avail + 2, ring_index + 1).unwrap();
    }

    fn kick(machine: &mut Machine, slot_base: u64, queue: u32) {
        mmio_write(machine, slot_base, 0x50, queue);
    }

    fn one_boundary(machine: &mut Machine) {
        assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
    }

    fn control(machine: &mut Machine, addr: u64, value: ConsoleControl) {
        for (offset, byte) in value.to_bytes().into_iter().enumerate() {
            machine.bus_mut().store8(addr + offset as u64, byte).unwrap();
        }
    }

    fn ready_transport(machine: &mut Machine, slot_base: u64) {
        mmio_write(machine, slot_base, 0x70, 4);
        let tx = DATA_BASE;
        let rx = DATA_BASE + 0x100;
        control(
            machine,
            tx,
            ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
        );
        descriptor(machine, CONTROL_TRANSMIT_QUEUE, 0, tx, 8, 0);
        descriptor(machine, CONTROL_RECEIVE_QUEUE, 0, rx, 128, 2);
        post(machine, CONTROL_TRANSMIT_QUEUE, 0, 0);
        post(machine, CONTROL_RECEIVE_QUEUE, 0, 0);
        kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
        kick(machine, slot_base, CONTROL_RECEIVE_QUEUE);
        one_boundary(machine);

        descriptor(machine, CONTROL_RECEIVE_QUEUE, 0, rx, 128, 2);
        post(machine, CONTROL_RECEIVE_QUEUE, 1, 0);
        one_boundary(machine);

        control(
            machine,
            tx + 0x20,
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_READY, 1),
        );
        descriptor(machine, CONTROL_TRANSMIT_QUEUE, 1, tx + 0x20, 8, 0);
        post(machine, CONTROL_TRANSMIT_QUEUE, 1, 1);
        kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
        one_boundary(machine);

        descriptor(machine, CONTROL_RECEIVE_QUEUE, 0, rx, 128, 2);
        post(machine, CONTROL_RECEIVE_QUEUE, 2, 0);
        one_boundary(machine);
        control(
            machine,
            tx + 0x40,
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
        );
        descriptor(machine, CONTROL_TRANSMIT_QUEUE, 2, tx + 0x40, 8, 0);
        post(machine, CONTROL_TRANSMIT_QUEUE, 2, 2);
        kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
        one_boundary(machine);
    }

    fn desktop_snapshot() -> Vec<u8> {
        let (_, gpu) = VirtioGpu::new_with_state();
        {
            let mut state = gpu.borrow_mut();
            state.set_display(1280, 720);
            let resource = state
                .resources
                .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 4, 2)
                .unwrap();
            resource.flush_rect(protocol::Rect { x: 0, y: 0, width: 4, height: 2 }, false);
            state.scanout_resource = Some(7);
        }
        let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
        let (_, sound) = VirtioSnd::new_with_state();
        let mut builder = DesktopSnapshotBuilder::new(0x26e0_0401);
        builder.section(section::GPU, FORMAT_VERSION, &gpu.borrow().to_snapshot().unwrap()).unwrap();
        builder.section(section::INPUT, FORMAT_VERSION, &input.borrow().to_snapshot().unwrap()).unwrap();
        builder.section(section::SOUND, FORMAT_VERSION, &sound.borrow().to_snapshot().unwrap()).unwrap();
        builder.section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes()).unwrap();
        builder.finish().unwrap()
    }

    fn machine() -> (Machine, std::rc::Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::console::ConsoleState>>) {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let (_, console) = machine.enable_virtio_console();
        machine.enable_virtio_keyboard();
        machine.enable_virtio_snd();
        machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let slot_base = Platform::virtio_base(VIRTIO_CONSOLE_SLOT as u64);
        for queue in [
            CONTROL_RECEIVE_QUEUE,
            CONTROL_TRANSMIT_QUEUE,
            AGENT_RECEIVE_QUEUE,
            AGENT_TRANSMIT_QUEUE,
        ] {
            configure_queue(&mut machine, slot_base, queue);
        }
        for offset in (0..32).step_by(4) {
            machine.bus_mut().store32(virt::DRAM_BASE + offset, 0x0000_0013).unwrap();
        }
        machine.hart_mut().regs.pc = virt::DRAM_BASE;
        ready_transport(&mut machine, slot_base);
        (machine, console)
    }

    #[derive(Clone)]
    struct CountingSink {
        frames: std::rc::Rc<std::cell::RefCell<u32>>,
        clears: std::rc::Rc<std::cell::RefCell<u32>>,
    }

    impl FrameSink for CountingSink {
        fn flush(
            &mut self,
            _scanout: Option<u32>,
            _format: u32,
            _rect: Rect,
            _resource_width: u32,
            _resource_height: u32,
            _pixels: &[u32],
        ) {
            *self.frames.borrow_mut() += 1;
        }

        fn clear(&mut self) {
            *self.clears.borrow_mut() += 1;
            *self.frames.borrow_mut() = 0;
        }
    }

    #[test]
    fn transport_ready_never_substitutes_for_application_hello() {
        let (mut machine, console) = machine();
        assert!(console.borrow().agent_ready_for_host());
        assert!(!console.borrow().agent_ready_for_restore());
        let error = machine
            .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
            .unwrap_err();
        assert_eq!(error.code(), "agent_refused");
        assert_eq!(machine.desktop_restore_host_state(), Default::default());
    }

    #[test]
    fn one_application_hello_cannot_be_reused_by_still_open_transport() {
        let (mut machine, console) = machine();
        machine.confirm_virtio_console_agent_hello().unwrap();
        machine
            .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
            .unwrap();
        assert!(console.borrow().agent_ready_for_host());
        assert!(!console.borrow().agent_ready_for_restore());
        let error = machine
            .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
            .unwrap_err();
        assert_eq!(error.code(), "agent_refused");
        assert_eq!(machine.desktop_restore_host_state(), Default::default());
    }

    #[test]
    fn host_disconnect_erases_the_application_hello_fence() {
        let (machine, console) = machine();
        assert_eq!(machine.confirm_virtio_console_agent_hello(), Some(1));
        assert!(console.borrow().agent_ready_for_restore());
        console.borrow_mut().set_host_connected(false);
        assert_eq!(console.borrow().application_hello_generation(), 0);
        assert!(!console.borrow().agent_ready_for_restore());
        assert_eq!(machine.confirm_virtio_console_agent_hello(), None);
        console.borrow_mut().set_host_connected(true);
        assert_eq!(machine.confirm_virtio_console_agent_hello(), None);
    }

    #[test]
    fn missing_agent_with_dirty_sink_input_and_sound_restores_power_on_state() {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let input = machine.enable_virtio_keyboard().1;
        let sound = machine.enable_virtio_snd().1;
        let frames = std::rc::Rc::new(std::cell::RefCell::new(0));
        let clears = std::rc::Rc::new(std::cell::RefCell::new(0));
        let (_, gpu) = machine
            .enable_virtio_gpu(Box::new(CountingSink {
                frames: std::rc::Rc::clone(&frames),
                clears: std::rc::Rc::clone(&clears),
            }))
            .unwrap();

        let cold_gpu = VirtioGpu::new_with_state().1.borrow().to_snapshot().unwrap();
        let cold_input = VirtioInput::new_with_state(InputDeviceSpec::default())
            .1
            .borrow()
            .to_snapshot()
            .unwrap();
        let cold_sound = VirtioSnd::new_with_state().1.borrow().to_snapshot().unwrap();

        gpu.borrow_mut().set_display(1920, 1080);
        gpu.borrow_mut().frame_sink.flush(
            Some(0),
            protocol::FORMAT_R8G8B8A8_UNORM,
            Rect { x: 0, y: 0, width: 1, height: 1 },
            1,
            1,
            &[0xff123456],
        );
        assert!(input.borrow_mut().inject_event(EV_KEY, KEY_A, 1));
        input.borrow_mut().sync();
        assert_eq!(sound.borrow_mut().stream.set_params(PcmParams::default()), SndStatus::Ok);
        assert_ne!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
        assert_ne!(input.borrow().to_snapshot().unwrap(), cold_input);
        assert_ne!(sound.borrow().to_snapshot().unwrap(), cold_sound);

        let error = machine
            .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
            .unwrap_err();
        assert_eq!(error.code(), "commit_refused");
        assert_eq!(*frames.borrow(), 0);
        assert!(*clears.borrow() >= 2);
        assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
        assert_eq!(input.borrow().to_snapshot().unwrap(), cold_input);
        assert_eq!(sound.borrow().to_snapshot().unwrap(), cold_sound);
        assert_eq!(machine.desktop_restore_host_state(), Default::default());
    }

    #[test]
    fn missing_gpu_early_refusal_restarts_present_agent_state() {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let (_, console) = machine.enable_virtio_console();
        machine.enable_virtio_keyboard();
        machine.enable_virtio_snd();
        let before = console.borrow().generation();
        let error = machine
            .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
            .unwrap_err();
        assert_eq!(error.code(), "commit_refused");
        assert_eq!(console.borrow().generation(), before + 1);
        assert_eq!(console.borrow().application_hello_generation(), 0);
        assert!(!console.borrow().agent_ready_for_restore());
        assert_eq!(machine.desktop_restore_host_state(), Default::default());
    }

    #[test]
    fn missing_input_and_sound_refusals_both_clear_the_live_sink() {
        for missing_input in [true, false] {
            let mut machine = Machine::new(RAM);
            machine.enable_plic();
            machine.enable_virtio_slots(None);
            if missing_input {
                machine.enable_virtio_snd();
            } else {
                machine.enable_virtio_keyboard();
            }
            let frames = std::rc::Rc::new(std::cell::RefCell::new(0));
            let clears = std::rc::Rc::new(std::cell::RefCell::new(0));
            let (_, gpu) = machine
                .enable_virtio_gpu(Box::new(CountingSink {
                    frames: std::rc::Rc::clone(&frames),
                    clears: std::rc::Rc::clone(&clears),
                }))
                .unwrap();
            gpu.borrow_mut().frame_sink.flush(
                Some(0),
                protocol::FORMAT_R8G8B8A8_UNORM,
                Rect { x: 0, y: 0, width: 1, height: 1 },
                1,
                1,
                &[0xffabcdef],
            );
            assert_eq!(*frames.borrow(), 1);
            assert!(machine
                .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
                .is_err());
            assert_eq!(*frames.borrow(), 0);
            assert!(*clears.borrow() >= 2);
            assert_eq!(machine.desktop_restore_host_state(), Default::default());
        }
    }
}
