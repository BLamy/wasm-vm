//! Ordinary in-memory component proofs for owned network boundaries.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_clock::{SessionDelivery, SessionEffect},
    session_network::{NetworkEvent as Event, SendResult},
    trace::{TraceRecord, TraceSink, fmt_canonical},
};

const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-network-capture.bin");
const WFI: u64 = BASE + 0x60000;
const DEADLINE: u64 = 1_000_000;

#[derive(Default)]
struct Trace(String);
impl TraceSink for Trace {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push_str(&fmt_canonical(record).to_string());
        self.0.push('\n');
    }
}
fn fixture(replay: bool) -> Machine {
    let mut m = Machine::new(1 << 20);
    m.enable_clint(1);
    m.start_session_clock(1).unwrap();
    m.enable_session_network(replay).unwrap();
    m.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
    m.hart_mut().regs.pc = BASE;
    m
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_NETWORK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir).join("components");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
fn capture(m: &mut Machine, event: Event) -> SessionDelivery {
    let id = match &event {
        Event::Send { request, .. } => Some(request.id),
        _ => None,
    };
    let lease = m.lease_session_network(id).unwrap();
    m.complete_session_network(&lease, event).unwrap();
    let rows = m.take_session_deliveries().unwrap();
    assert_eq!(rows.len(), 1);
    rows.into_iter().next().unwrap()
}
fn wfi(m: &mut Machine) {
    // wfi; addi x1,x1,1. An idle advance consumes a transition without retiring
    // the addi; outstanding owned work must instead allow that next instruction.
    m.bus_mut().store32(WFI, 0x1050_0073).unwrap();
    m.bus_mut().store32(WFI + 4, 0x0010_8093).unwrap();
    m.hart_mut().regs.pc = WFI;
    m.bus_mut().store64(0x0200_4000, DEADLINE).unwrap();
}
fn until(m: &mut Machine, target: u64, budget: u64, trace: &mut Trace) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(
            m.run_session_until_traced(target, budget, trace),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}

#[test]
fn owned_external_pending_and_guest_tx_gate_wfi_idle_advance() {
    let mut summary = String::new();
    for guest_tx in [false, true] {
        for pending in [false, true] {
            let mut m = fixture(false);
            if guest_tx {
                assert_eq!(m.run_session_until(1024, 1024), Ok(RunOutcome::MaxInstrs));
                if !pending {
                    let request = m.session_network_requests().unwrap().remove(0);
                    capture(
                        &mut m,
                        Event::Send {
                            request,
                            result: SendResult::Sent,
                        },
                    );
                }
            } else {
                capture(&mut m, Event::Pending(pending));
            }
            wfi(&mut m);
            let begin = m.session_position().unwrap();
            let frame = m.save_session_resume().unwrap();
            let mut trace = Trace::default();
            until(&mut m, begin.transition + 2, 8, &mut trace);
            let end = m.session_position().unwrap();
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-before.resume"),
                &frame,
            );
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-after.resume"),
                m.save_session_resume().unwrap(),
            );
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}.trace"),
                &trace.0,
            );
            summary.push_str(&format!(
                "tx={guest_tx} pending={pending} begin={begin:?} end={end:?} mtime={} x1={}\n",
                m.clint_mtime(),
                m.hart().regs.read(1)
            ));
            artifact("wfi-summary.txt", &summary);
            assert_eq!(
                end.retired - begin.retired,
                if pending { 2 } else { 1 },
                "owned work skipped at tx={guest_tx} pending={pending}"
            );
            assert_eq!(
                m.clint_mtime(),
                if pending { begin.retired + 2 } else { DEADLINE }
            );
            assert_eq!(trace.0.lines().count(), if pending { 2 } else { 1 });
            let mut r = fixture(true);
            r.load_session_resume(&frame).unwrap();
            let mut replay_trace = Trace::default();
            until(&mut r, begin.transition + 2, 1, &mut replay_trace);
            let replay_frame = r.save_session_resume().unwrap();
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-replayed.resume"),
                &replay_frame,
            );
            assert!(
                replay_frame == m.save_session_resume().unwrap(),
                "WFI replay frame drift"
            );
            assert_eq!(replay_trace.0, trace.0);
        }
    }
}
