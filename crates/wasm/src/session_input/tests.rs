use super::*;
use sha2::{Digest, Sha256};
use wasm_vm_core::{
    RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
const BUF: u64 = BASE + 0x14000;
const COPY: u64 = BASE + 0x24000;
struct Rig {
    machine: Machine,
    uart: Rc<RefCell<Uart16550>>,
    pending: VecDeque<u8>,
    capture: InputCapture,
}
impl Rig {
    fn new(replay: bool) -> Self {
        let mut machine = Machine::new(16 << 20);
        machine.enable_clint(1);
        machine.enable_plic();
        let uart = machine.enable_uart16550();
        machine.enable_virtio_slots(None);
        machine.enable_virtio_keyboard();
        machine.enable_virtio_pointer();
        machine.start_session_clock(1).unwrap();
        Self {
            machine,
            uart,
            pending: VecDeque::new(),
            capture: InputCapture::new(replay),
        }
    }
    fn apply(&mut self, ch: u16, bytes: &[u8]) -> Result<Outcome, String> {
        self.capture.apply(
            InputContext {
                machine: &mut self.machine,
                pending: &mut self.pending,
                uart: &self.uart,
                transfers: None,
            },
            ch,
            bytes,
            self.capture.replay,
        )
    }
    fn queue(&mut self, slot: u64, count: u16) {
        let desc = BASE + 0x10000;
        let avail = BASE + 0x11000;
        let used = BASE + 0x12000;
        for i in 0..u64::from(count) {
            let d = desc + 16 * i;
            self.machine.bus_mut().store64(d, BUF + 8 * i).unwrap();
            self.machine.bus_mut().store32(d + 8, 8).unwrap();
            self.machine.bus_mut().store16(d + 12, 2).unwrap();
            self.machine
                .bus_mut()
                .store16(avail + 4 + 2 * i, i as u16)
                .unwrap();
        }
        self.machine.bus_mut().store16(avail + 2, count).unwrap();
        let mmio = 0x10001000 + slot * 0x1000;
        for (off, value) in [
            (0x30, 0),
            (0x38, 128),
            (0x80, desc),
            (0x90, avail),
            (0xa0, used),
            (0x44, 1),
            (0x50, 0),
        ] {
            self.machine
                .bus_mut()
                .store32(mmio + off, value as u32)
                .unwrap();
        }
    }
    fn observe(&mut self, source: u64, length: usize, name: &str) -> Vec<u8> {
        assert!(length <= 1024);
        let mut words = vec![0x13];
        for i in 0..length as u32 {
            words.push((i << 20) | (1 << 15) | (4 << 12) | (5 << 7) | 3);
            words.push(((i >> 5) << 25) | (5 << 20) | (2 << 15) | ((i & 31) << 7) | 0x23);
        }
        for (i, word) in words.iter().enumerate() {
            self.machine
                .bus_mut()
                .store32(BASE + 4 * i as u64, *word)
                .unwrap();
        }
        self.machine.hart_mut().regs.pc = BASE;
        self.machine.hart_mut().regs.write(1, source);
        self.machine.hart_mut().regs.write(2, COPY);
        let mut trace = Lines::default();
        assert_eq!(
            self.machine.run_traced(words.len() as u64, &mut trace),
            RunOutcome::MaxInstrs
        );
        let observed = (0..length)
            .map(|i| self.machine.bus_mut().load8(COPY + i as u64).unwrap())
            .collect::<Vec<_>>();
        artifact(&format!("{name}.trace"), trace.0);
        artifact(&format!("{name}.bin"), &observed);
        artifact(
            &format!("{name}.sha256"),
            format!("{:x}\n", Sha256::digest(&observed)),
        );
        artifact(
            &format!("{name}.resume"),
            self.machine.save_session_resume().unwrap(),
        );
        observed
    }
}
#[derive(Default)]
struct Lines(String);
impl TraceSink for Lines {
    fn retire(&mut self, r: &TraceRecord) {
        self.0.push_str(&fmt_canonical(r).to_string());
        self.0.push('\n');
    }
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_INPUT_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
#[test]
fn exact_modifier_release_and_duplicate_pointer_frames_reach_guest_dma() {
    for (channel, sync, slot, events, name) in [
        (
            KEY,
            KEY_SYNC,
            3,
            vec![(1, 42, 1), (1, 30, 1), (1, 30, 0), (1, 42, 0)],
            "keyboard-focus-release",
        ),
        (
            TABLET,
            TABLET_SYNC,
            4,
            vec![
                (3, 0, 125),
                (3, 0, 125),
                (3, 1, 711),
                (1, 272, 1),
                (1, 272, 0),
            ],
            "tablet-same-position",
        ),
        (
            MOUSE,
            MOUSE_SYNC,
            5,
            vec![(2, 0, -7), (2, 1, 3), (1, 272, 1), (1, 272, 0)],
            "relative-mouse",
        ),
    ] {
        let mut source = Rig::new(false);
        source.queue(slot, 128);
        let mut expected = vec![];
        source
            .apply(POINTER_MODE, &[u8::from(channel == MOUSE)])
            .unwrap();
        for (event_type, code, value) in events {
            let bytes = event_bytes(event_type, code, value);
            assert_eq!(source.apply(channel, &bytes).unwrap()[0], 0);
            source.apply(sync, &[]).unwrap();
            expected.extend(bytes);
            expected.extend([0; 8]);
        }
        let receipts = source.machine.take_session_deliveries().unwrap();
        for (i, r) in receipts.iter().enumerate() {
            assert_eq!(r.position.transition, 0);
            assert_eq!(r.position.sequence, i as u64 + 1);
            assert_eq!(r.position.ordinal, i as u32 + 1);
        }
        let observed = source.observe(BUF, expected.len(), name);
        assert_eq!(observed, expected);
        let mut replay = Rig::new(true);
        replay.queue(slot, 128);
        for r in receipts {
            let SessionEffect::HostInput { channel, bytes } = r.effect else {
                panic!()
            };
            assert_eq!(
                replay.apply(channel, &bytes).unwrap(),
                r.host_result.unwrap()
            );
        }
        replay.machine.take_session_deliveries().unwrap();
        assert_eq!(
            replay.observe(BUF, expected.len(), &format!("{name}-replay")),
            expected
        );
    }
}
#[test]
fn serial_offers_are_owned_but_only_fifo_batches_are_guest_delivery() {
    let mut rig = Rig::new(false);
    let original = (0..77u8).map(|i| i.wrapping_mul(13)).collect::<Vec<_>>();
    let mut offered = original.clone();
    assert_eq!(rig.apply(UART_OFFER, &offered).unwrap(), [0, 77, 77, 0]);
    offered.fill(255);
    let mut actual = vec![];
    for (index, chunk) in original.chunks(16).enumerate() {
        assert_eq!(rig.apply(UART_FEED, chunk).unwrap()[1], chunk.len() as u64);
        // Actual RV64 lbu reads the UART RBR. Each read removes a FIFO byte; host queue counts
        // alone cannot satisfy this assertion.
        let mut words = vec![];
        for i in 0..chunk.len() as u32 {
            words.push((1 << 15) | (4 << 12) | (5 << 7) | 3);
            words.push((5 << 20) | (2 << 15) | ((i & 31) << 7) | 0x23);
        }
        for (i, word) in words.iter().enumerate() {
            rig.machine
                .bus_mut()
                .store32(BASE + i as u64 * 4, *word)
                .unwrap();
        }
        rig.machine.hart_mut().regs.pc = BASE;
        rig.machine.hart_mut().regs.write(1, 0x10000000);
        rig.machine.hart_mut().regs.write(2, COPY);
        let mut trace = Lines::default();
        assert_eq!(
            rig.machine.run_traced(words.len() as u64, &mut trace),
            RunOutcome::MaxInstrs
        );
        artifact(&format!("uart-{index}.trace"), trace.0);
        actual.extend(
            (0..chunk.len()).map(|i| rig.machine.bus_mut().load8(COPY + i as u64).unwrap()),
        );
    }
    assert_eq!(actual, original);
    assert!(rig.pending.is_empty());
    artifact("uart-guest.bin", &actual);
    let receipts = rig.machine.take_session_deliveries().unwrap();
    assert_eq!(receipts.len(), 6);
    assert!(
        matches!(&receipts[0].effect,SessionEffect::HostInput{channel:UART_OFFER,bytes} if bytes==&original)
    );
    artifact(
        "uart-final.resume",
        rig.machine.save_session_resume().unwrap(),
    );
}
#[test]
fn bounded_ingress_failures_keep_prefix_and_replay_rejects_live_input() {
    let mut rig = Rig::new(false);
    for _ in 0..256 {
        rig.apply(POINTER_MODE, &[0]).unwrap();
    }
    assert!(rig.apply(KEY, &event_bytes(1, 30, 1)).is_err());
    assert_eq!(rig.machine.session_position().unwrap().sequence, 256);
    assert_eq!(
        rig.machine
            .keyboard_input()
            .unwrap()
            .borrow()
            .pending_events(),
        0
    );
    assert_eq!(rig.machine.take_session_deliveries().unwrap().len(), 256);
    let mut replay = Rig::new(true);
    assert!(
        replay
            .capture
            .apply(
                InputContext {
                    machine: &mut replay.machine,
                    pending: &mut replay.pending,
                    uart: &replay.uart,
                    transfers: None
                },
                UART_OFFER,
                b"hidden",
                false
            )
            .is_err()
    );
    assert!(replay.pending.is_empty());
    assert_eq!(replay.apply(LIFECYCLE, &[0]).unwrap()[0], 0);
    assert!(replay.capture.paused);
    replay.apply(LIFECYCLE, &[1]).unwrap();
    assert!(!replay.capture.paused);
    replay.apply(LIFECYCLE, &[2]).unwrap();
    assert!(replay.apply(UART_OFFER, b"late").is_err());
    for (channel, bytes) in [
        (DISPLAY, vec![0; 8]),
        (KEY, vec![0; 7]),
        (UPLOAD_PUSH, vec![0, 0, 0, 0, 2]),
        (17, vec![]),
    ] {
        assert!(validate(channel, &bytes).is_err());
    }
    assert!(upload_begin(0, "ok", 1, &"é".repeat(32)).is_err());
}

#[test]
fn rapid_make_break_bursts_retain_order_in_real_guest_ring() {
    let mut rig = Rig::new(false);
    rig.queue(3, 128);
    let mut sequence = 0;
    for pass in 0..6u16 {
        let mut expected = Vec::new();
        for _ in 0..32 {
            for value in [1, 0] {
                let bytes = event_bytes(1, 30, value);
                rig.apply(KEY, &bytes).unwrap();
                rig.apply(KEY_SYNC, &[]).unwrap();
                expected.extend(bytes);
                expected.extend([0; 8]);
            }
        }
        let receipts = rig.machine.take_session_deliveries().unwrap();
        assert_eq!(receipts.len(), 128);
        for r in receipts {
            sequence += 1;
            assert_eq!(r.position.sequence, sequence);
            assert_eq!(r.host_result.unwrap()[0], 0);
        }
        assert_eq!(
            rig.observe(BUF, 1024, &format!("rapid-typing-{pass}")),
            expected
        );
        if pass < 5 {
            rig.machine
                .bus_mut()
                .store16(BASE + 0x11002, (pass + 2) * 128)
                .unwrap();
            rig.machine.bus_mut().store32(0x10004050, 0).unwrap();
        }
    }
    assert_eq!(sequence, 768);
}

#[test]
fn oversized_and_forged_publication_frames_refuse_before_reserving() {
    let mut rig = Rig::new(false);
    let state = rig.machine.keyboard_input().unwrap();
    state.borrow_mut().set_pending_event_budget(200000);
    for _ in 0..131073 {
        assert!(state.borrow_mut().inject_event(1, 30, 1));
    }
    let before = rig.machine.session_position();
    assert!(rig.apply(KEY_SYNC, &[]).is_err());
    assert_eq!(rig.machine.session_position(), before);
    let mut forged = vec![0; 20];
    forged[..8].copy_from_slice(&536870912u64.to_le_bytes());
    forged[8..12].copy_from_slice(&536870912u32.to_le_bytes());
    assert!(validate(KEY_SYNC, &forged).is_err());
}

#[test]
fn inactive_or_diagnostic_mailboxes_refuse_input_before_device_mutation() {
    let mut rig = Rig::new(false);
    rig.machine
        .stage_session_effect(10, SessionEffect::ExternalPending(true))
        .unwrap();
    let before = rig.machine.session_position();
    assert!(rig.apply(UART_OFFER, b"hidden").is_err());
    assert_eq!(rig.machine.session_position(), before);
    assert!(rig.pending.is_empty());
    rig.machine = Machine::new(16384);
    assert!(rig.apply(UART_OFFER, b"inactive").is_err());
    assert!(rig.pending.is_empty());
}

#[test]
fn offered_agent_clipboard_prefix_reaches_the_actual_guest_port() {
    use wasm_vm_core::dev::virtio::console::{
        AGENT_RECEIVE_QUEUE as DATA, CONTROL_RECEIVE_QUEUE as RX, CONTROL_TRANSMIT_QUEUE as TX,
        ConsoleControl, VIRTIO_CONSOLE_DEVICE_READY, VIRTIO_CONSOLE_PORT_OPEN,
        VIRTIO_CONSOLE_PORT_READY,
    };
    let mut absent = Rig::new(false);
    assert_eq!(absent.apply(AGENT, b"absent").unwrap()[0], 1);
    assert_eq!(absent.apply(HELLO, &[]).unwrap()[0], 1);
    let mut rig = Rig::new(false);
    let (_, state) = rig.machine.enable_virtio_console();
    let mmio = 0x10008000;
    let addr = |base: u64, q: u32| BASE + base + u64::from(q) * 0x1000;
    for q in [RX, TX, DATA] {
        for (off, value) in [
            (0x30, u64::from(q)),
            (0x38, 8),
            (0x80, addr(0x50000, q)),
            (0x90, addr(0x60000, q)),
            (0xa0, addr(0x70000, q)),
            (0x44, 1),
        ] {
            rig.machine
                .bus_mut()
                .store32(mmio + off, value as u32)
                .unwrap();
        }
    }
    for i in 0..16 {
        rig.machine.bus_mut().store32(BASE + i * 4, 0x13).unwrap();
    }
    rig.machine.hart_mut().regs.pc = BASE;
    let descriptor = |m: &mut Machine, q: u32, i: u16, buffer: u64, len: u32, flags: u16| {
        let at = addr(0x50000, q) + u64::from(i) * 16;
        m.bus_mut().store64(at, buffer).unwrap();
        m.bus_mut().store32(at + 8, len).unwrap();
        m.bus_mut().store16(at + 12, flags).unwrap();
    };
    let post = |m: &mut Machine, q: u32, n: u16, head: u16| {
        let at = addr(0x60000, q);
        m.bus_mut()
            .store16(at + 4 + u64::from(n % 8) * 2, head)
            .unwrap();
        m.bus_mut().store16(at + 2, n + 1).unwrap();
        m.bus_mut().store32(mmio + 0x50, q).unwrap();
    };
    descriptor(&mut rig.machine, RX, 0, BASE + 0x81000, 64, 2);
    for (index, (id, kind)) in [
        (0, VIRTIO_CONSOLE_DEVICE_READY),
        (1, VIRTIO_CONSOLE_PORT_READY),
        (1, VIRTIO_CONSOLE_PORT_OPEN),
    ]
    .into_iter()
    .enumerate()
    {
        let at = BASE + 0x80000 + index as u64 * 0x20;
        for (i, b) in ConsoleControl::new(id, kind, 1)
            .to_bytes()
            .iter()
            .enumerate()
        {
            rig.machine.bus_mut().store8(at + i as u64, *b).unwrap();
        }
        descriptor(&mut rig.machine, TX, index as u16, at, 8, 0);
        post(&mut rig.machine, TX, index as u16, index as u16);
        post(&mut rig.machine, RX, index as u16, 0);
        assert_eq!(rig.machine.run(1), RunOutcome::MaxInstrs);
        if index == 0 {
            post(&mut rig.machine, RX, 1, 0);
            assert_eq!(rig.machine.run(1), RunOutcome::MaxInstrs);
        }
    }
    assert!(state.borrow().agent_ready_for_host());
    assert_eq!(rig.apply(HELLO, &[]).unwrap()[0], 0);
    state.borrow_mut().set_data_budget(3);
    let bytes = "clipboard:π".as_bytes();
    assert_eq!(rig.apply(AGENT, bytes).unwrap(), [2, 3, 0, 0]);
    assert_eq!(rig.apply(AGENT, b"overflow").unwrap(), [2, 0, 0, 0]);
    descriptor(&mut rig.machine, DATA, 0, BUF, 3, 2);
    post(&mut rig.machine, DATA, 0, 0);
    rig.machine.take_session_deliveries().unwrap();
    assert_eq!(rig.observe(BUF, 3, "agent-clipboard-prefix"), b"cli");
}

#[test]
fn whole_frame_drops_are_recorded_and_replay_without_guest_dma() {
    let mut source = Rig::new(false);
    source.queue(3, 128);
    source
        .machine
        .keyboard_input()
        .unwrap()
        .borrow_mut()
        .set_pending_event_budget(1);
    source.apply(KEY, &event_bytes(1, 30, 1)).unwrap();
    assert_eq!(source.apply(KEY_SYNC, &[]).unwrap(), [4, 0, 1, 2]);
    let receipts = source.machine.take_session_deliveries().unwrap();
    source.observe(BUF, 0, "dropped-frame");
    assert_eq!(source.machine.bus_mut().load16(BASE + 0x12002).unwrap(), 0);
    let mut replay = Rig::new(true);
    replay.queue(3, 128);
    replay
        .machine
        .keyboard_input()
        .unwrap()
        .borrow_mut()
        .set_pending_event_budget(1);
    for r in receipts {
        let SessionEffect::HostInput { channel, bytes } = r.effect else {
            panic!()
        };
        assert_eq!(
            replay.apply(channel, &bytes).unwrap(),
            r.host_result.unwrap()
        );
    }
    replay.machine.take_session_deliveries().unwrap();
    replay.observe(BUF, 0, "dropped-frame-replay");
    assert_eq!(replay.machine.bus_mut().load16(BASE + 0x12002).unwrap(), 0);
}
#[test]
fn owned_byte_pressure_refuses_before_a_fifth_offer_mutates_the_prefix() {
    let mut rig = Rig::new(false);
    let mut bytes = vec![41; 1 << 20];
    assert_eq!(
        rig.apply(UART_OFFER, &bytes).unwrap(),
        [0, 1048576, 1048576, 0]
    );
    for _ in 0..3 {
        assert_eq!(rig.apply(UART_OFFER, &bytes).unwrap(), [1, 0, 1048576, 0]);
    }
    let before = rig.machine.session_position();
    assert!(rig.apply(UART_OFFER, b"x").is_err());
    assert_eq!(rig.machine.session_position(), before);
    assert_eq!(rig.pending.len(), 1 << 20);
    bytes.fill(255);
    let receipts = rig.machine.take_session_deliveries().unwrap();
    assert_eq!(receipts.len(), 4);
    for r in receipts {
        assert!(
            matches!(r.effect,SessionEffect::HostInput{channel:UART_OFFER,bytes} if bytes.iter().all(|v|*v==41))
        );
    }
}
