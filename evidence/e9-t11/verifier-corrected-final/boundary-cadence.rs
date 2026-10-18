use jit_runtime::WasmtimeExecutor;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::rtc::{GoldfishRtc, WallClock},
    session_clock::{
        SessionDelivery, SessionEffect,
        sources::{ObservationKind, ObservationRecord, ObservationTape},
    },
};
const WARM: u64 = 384;
struct Clock {
    calls: Rc<Cell<u32>>,
    forbid: Rc<Cell<bool>>,
    ramp: bool,
}
impl WallClock for Clock {
    fn now_ns(&self) -> u64 {
        assert!(!self.forbid.get(), "replay called RTC provider");
        let n = self.calls.get();
        self.calls.set(n + 1);
        123 + if self.ramp { u64::from(n) } else { 0 }
    }
}
struct Board {
    m: Machine,
    calls: Rc<Cell<u32>>,
    forbid: Rc<Cell<bool>>,
    rtc: Rc<RefCell<GoldfishRtc>>,
}
fn jal(offset: i32) -> u32 {
    let n = offset as u32;
    ((n >> 20) & 1) << 31
        | ((n >> 1) & 0x3ff) << 21
        | ((n >> 11) & 1) << 20
        | ((n >> 12) & 0xff) << 12
        | 0x6f
}
fn board(read: bool, alarm: Option<u32>, ramp: bool) -> Board {
    let mut m = Machine::new(1 << 20);
    m.enable_clint(5);
    m.enable_plic();
    let calls = Rc::new(Cell::new(0));
    let forbid = Rc::new(Cell::new(false));
    let rtc = m.enable_rtc(Box::new(Clock {
        calls: calls.clone(),
        forbid: forbid.clone(),
        ramp,
    }));
    let mut words = vec![0x00108093, 0x00310113, 0x00518193, 0x00720213, 0x00b28293];
    if read {
        words.extend([jal(12), 0x13, 0x13, 0x00056303, jal(-36)]);
    } else {
        words.push(jal(-20));
    }
    for (i, w) in words.into_iter().enumerate() {
        m.bus_mut().store32(BASE + 4 * i as u64, w).unwrap();
    }
    m.hart_mut().regs.pc = BASE;
    m.hart_mut().regs.write(10, 0x101000);
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_hotness_threshold(1);
    m.set_jit(true);
    m.start_session_clock(1).unwrap();
    assert_eq!(m.run(WARM), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.pc, BASE);
    assert!(m.executor().unwrap().is_compiled(BASE));
    assert!(m.executor().unwrap().executed_blocks() > 0);
    if let Some(deadline) = alarm {
        m.bus_mut().store32(0x10100c, 0).unwrap();
        m.bus_mut().store32(0x101008, deadline).unwrap();
    }
    calls.set(0);
    Board {
        m,
        calls,
        forbid,
        rtc,
    }
}
fn drive(m: &mut Machine, target: u64, q: u64) -> Vec<SessionDelivery> {
    let mut out = vec![];
    while m.session_position().unwrap().transition < target {
        assert_eq!(m.run_session_until(target, q), Ok(RunOutcome::MaxInstrs));
        out.extend(m.take_session_deliveries().unwrap());
    }
    out
}
fn tape(m: &Machine, rows: &[SessionDelivery]) -> ObservationTape {
    ObservationTape {
        policy: m.source_policy(),
        records: rows
            .iter()
            .map(|r| {
                let SessionEffect::Observation(v) = &r.effect else {
                    panic!("non-source receipt")
                };
                ObservationRecord {
                    position: r.position,
                    value: v.clone(),
                }
            })
            .collect(),
    }
}
fn main() {
    let out = std::path::Path::new("target/evidence/e9-t11-verifier/corrected/boundary-cadence");
    std::fs::create_dir_all(out).unwrap();
    let mut baseline: Option<(Vec<u8>, Vec<u8>)> = None;
    let mut reports = vec![];
    for rq in [1, 6, 7] {
        for pq in [1, 6, 7] {
            let key = format!("fire-rq{rq}-pq{pq}");
            let mut r = board(false, Some(125), true);
            let policy = r.m.source_policy();
            r.m.start_session_sources(policy, None).unwrap();
            let initial = r.m.save_session_resume().unwrap();
            let before = r.m.executor().unwrap().executed_blocks();
            let rows = drive(&mut r.m, 468, rq);
            let t = tape(&r.m, &rows);
            assert_eq!(t.records.len(), 3);
            for (i, e) in t.records.iter().enumerate() {
                assert_eq!(e.value.kind, ObservationKind::RtcPoll);
                assert_eq!(
                    (
                        e.position.transition,
                        e.position.retired,
                        e.position.sequence,
                        e.position.ordinal
                    ),
                    (384 + i as u64, 384 + i as u64, 1 + i as u64, 1)
                );
                assert_eq!(e.value.bytes, (123 + i as u64).to_le_bytes());
            }
            assert_eq!(r.calls.get(), 3);
            let state = r.rtc.borrow().to_snapshot();
            assert_eq!((state[24], state[26]), (0, 1));
            let delta = r.m.executor().unwrap().executed_blocks() - before;
            if rq == 6 || rq == 7 {
                assert!(delta > 0, "compiled work must resume after disarm");
            }
            let final_frame = r.m.save_session_resume().unwrap();
            let encoded = t.encode().unwrap();
            if let Some((frame, obs)) = &baseline {
                assert_eq!(&final_frame, frame);
                assert_eq!(&encoded, obs);
            } else {
                baseline = Some((final_frame.clone(), encoded.clone()));
            }
            let mut replay = board(false, Some(125), true);
            replay.forbid.set(true);
            replay.m.start_session_sources(policy, Some(t)).unwrap();
            assert_eq!(replay.m.save_session_resume().unwrap(), initial);
            let rows2 = drive(&mut replay.m, 468, pq);
            assert_eq!(rows2, rows);
            replay.m.finish_session_source_replay().unwrap();
            let replay_frame = replay.m.save_session_resume().unwrap();
            assert_eq!(replay_frame, final_frame);
            assert_eq!(replay.calls.get(), 0);
            for (suffix, b) in [
                ("initial.resume", initial),
                ("record.resume", final_frame),
                ("replay.resume", replay_frame),
                ("observations", encoded),
            ] {
                std::fs::write(out.join(format!("{key}.{suffix}")), b).unwrap();
            }
            reports.push(format!(r#"{{"case":"{key}","record_quantum":{rq},"replay_quantum":{pq},"record_calls":3,"replay_calls":0,"compiled_record_delta":{delta},"final_transition":468,"final_retired":468,"alarm_armed":false,"alarm_fired":true}}"#));
            println!(
                "HELD {key}: polls384,385,386; raw123,124,125; final468/468; alarm_fired=true; compiled_after_disarm={delta}; replay_calls=0"
            );
        }
    }
    let mut r = board(true, None, false);
    let p = r.m.source_policy();
    r.m.start_session_sources(p, None).unwrap();
    let initial = r.m.save_session_resume().unwrap();
    let before = r.m.executor().unwrap().executed_blocks();
    let rows = drive(&mut r.m, 416, 8);
    assert_eq!(rows.len(), 4);
    assert_eq!(r.calls.get(), 4);
    let delta = r.m.executor().unwrap().executed_blocks() - before;
    assert!(delta > 0);
    let t = tape(&r.m, &rows);
    for (i, e) in t.records.iter().enumerate() {
        assert_eq!(e.value.kind, ObservationKind::RtcRead);
        assert_eq!(e.position.transition, 390 + 8 * i as u64);
    }
    let final_frame = r.m.save_session_resume().unwrap();
    for pq in [1, 8] {
        let mut x = board(true, None, false);
        x.forbid.set(true);
        x.m.start_session_sources(p, Some(t.clone())).unwrap();
        assert_eq!(x.m.save_session_resume().unwrap(), initial);
        assert_eq!(drive(&mut x.m, 416, pq), rows);
        x.m.finish_session_source_replay().unwrap();
        assert_eq!(x.m.save_session_resume().unwrap(), final_frame);
        assert_eq!(x.calls.get(), 0);
    }
    println!(
        "HELD disarmed_read: reads390,398,406,414; compiled_record_delta={delta}; replay_calls=0"
    );
    reports.push(format!(r#"{{"case":"disarmed_read","compiled_record_delta":{delta},"record_calls":4,"replay_calls":0}}"#));
    let mut ordinary = board(false, Some(u32::MAX), false);
    let before = ordinary.m.executor().unwrap().executed_blocks();
    let rows = drive(&mut ordinary.m, 420, 6);
    assert!(rows.is_empty());
    assert_eq!(ordinary.calls.get(), 6);
    let delta = ordinary.m.executor().unwrap().executed_blocks() - before;
    assert_eq!(delta, 6);
    println!("HELD ordinary_uncaptured:6polls,6compiled blocks; source_active=false");
    reports.push(format!(
        r#"{{"case":"ordinary_uncaptured","provider_calls":6,"compiled_delta":{delta}}}"#
    ));
    std::fs::write(
        out.join("results.json"),
        format!(
            "{{\"status\":\"passed\",\"cases\":[{}]}}\n",
            reports.join(",")
        ),
    )
    .unwrap();
}
