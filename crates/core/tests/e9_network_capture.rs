#![cfg(not(feature = "zicsr-stub"))]
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_clock::{SessionDelivery, SessionEffect},
    session_network::{
        LinkStatus, MAX_FRAME, NetworkError as Error, NetworkEvent as Event, NetworkRequest,
        SendResult,
    },
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-network-capture.bin");
const HTTP: &[u8] = b"GET /network-probe-response.json HTTP/1.1\r\nHost: session-probe\r\nConnection: close\r\n\r\n";
const HEADER: [u8; 14] = [
    2, 0, 0, 0, 0, 1, 0x52, 0x54, 0, 0x12, 0x34, 0x56, 0x88, 0xb5,
];
const START: u64 = 1024;
const END: u64 = START + 8192;
#[derive(Default)]
struct Trace(String);
impl TraceSink for Trace {
    fn retire(&mut self, r: &TraceRecord) {
        self.0.push_str(&fmt_canonical(r).to_string());
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
fn until(m: &mut Machine, target: u64, budget: u64, trace: &mut Trace) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(
            m.run_session_until_traced(target, budget, trace).unwrap(),
            RunOutcome::MaxInstrs
        );
    }
}
fn capture(m: &mut Machine, event: Event) -> SessionDelivery {
    let lease = m
        .lease_session_network(match &event {
            Event::Send { request, .. } => Some(request.id),
            _ => None,
        })
        .unwrap();
    m.complete_session_network(&lease, event).unwrap();
    let mut receipts = m.take_session_deliveries().unwrap();
    assert_eq!(receipts.len(), 1);
    receipts.remove(0)
}
fn replay(m: &mut Machine, receipt: &SessionDelivery) {
    let SessionEffect::HostInput { channel, bytes } = &receipt.effect else {
        panic!("network envelope")
    };
    assert_eq!(*channel, 20);
    m.replay_session_network(receipt.position, Event::decode(bytes).unwrap())
        .unwrap();
    assert_eq!(m.take_session_deliveries().unwrap(), vec![receipt.clone()]);
}
fn evidence(name: &str, bytes: &[u8]) {
    if let Some(dir) = std::env::var_os("E9_NETWORK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
fn expected_frame() -> Vec<u8> {
    [HEADER.as_slice(), HTTP].concat()
}
fn report(m: &mut Machine) -> Vec<u8> {
    (0..1056)
        .map(|i| m.bus_mut().load8(BASE + 0x40000 + i).unwrap())
        .collect()
}
#[test]
fn real_guest_counter_exchange_replays_offline_without_constructing_live_transport() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let counter = Arc::new(AtomicUsize::new(0));
    let server_counter = counter.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            assert!(request.len() < 4096);
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        assert_eq!(request, HTTP);
        let count = server_counter.fetch_add(1, Ordering::SeqCst) + 1;
        let body = format!("{{\"count\":{count},\"source\":\"original-counter\"}}\n");
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).into_bytes();
        stream.write_all(&response).unwrap();
        (request, response)
    });
    let mut m = fixture(false);
    let initial = m.save_session_resume().unwrap();
    let mut trace = Trace::default();
    let connects = AtomicUsize::new(0);
    let sends = AtomicUsize::new(0);
    let (mut transport, _) = m
        .open_session_network_provider(|| {
            connects.fetch_add(1, Ordering::SeqCst);
            TcpStream::connect(address).unwrap()
        })
        .unwrap();
    transport
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut receipts = vec![capture(
        &mut m,
        Event::Link {
            status: LinkStatus::Open,
            code: 0,
        },
    )];
    until(&mut m, START, 37, &mut trace);
    let requests = m.session_network_requests().unwrap();
    assert_eq!(requests.len(), 1);
    let request = requests[0].clone();
    assert_eq!(request.frame, expected_frame());
    assert_eq!(m.bus_mut().load16(BASE + 0x22002), Ok(1));
    assert_eq!(m.bus_mut().load16(BASE + 0x12002), Ok(0));
    let pending = m.save_session_resume().unwrap();
    let old = m.lease_session_network(Some(request.id)).unwrap();
    transport.write_all(&request.frame[14..]).unwrap();
    sends.fetch_add(1, Ordering::SeqCst);
    receipts.push(capture(
        &mut m,
        Event::Send {
            request: request.clone(),
            result: SendResult::Sent,
        },
    ));
    receipts.push(capture(&mut m, Event::Pending(true)));
    let mut response = Vec::new();
    transport.read_to_end(&mut response).unwrap();
    drop(transport);
    let (observed_request, observed_response) = server.join().unwrap();
    assert_eq!(observed_response, response);
    assert_eq!(counter.load(Ordering::SeqCst), 1);
    // The listener is now destroyed. No accepting transport exists for any replay.
    assert!(TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_err());
    let mut rx = HEADER.to_vec();
    rx[..6].copy_from_slice(&HEADER[6..12]);
    rx[6..12].copy_from_slice(&HEADER[..6]);
    rx.extend_from_slice(&response);
    until(&mut m, START + 97, 29, &mut trace);
    receipts.push(capture(&mut m, Event::Receive(rx.clone())));
    until(&mut m, START + 113, 29, &mut trace);
    receipts.push(capture(
        &mut m,
        Event::Link {
            status: LinkStatus::Closed,
            code: 0,
        },
    ));
    until(&mut m, END, 101, &mut trace);
    assert_eq!(m.bus_mut().load16(BASE + 0x12002), Ok(1));
    assert_eq!(m.bus_mut().load32(0x10002060).unwrap() & 1, 1);
    for (i, b) in rx.iter().enumerate() {
        assert_eq!(m.bus_mut().load8(BASE + 0x14000 + 12 + i as u64), Ok(*b));
    }
    let final_frame = m.save_session_resume().unwrap();
    let guest_report = report(&mut m);
    assert_eq!(u64::from_le_bytes(guest_report[..8].try_into().unwrap()), 1);
    assert_eq!(
        u64::from_le_bytes(guest_report[8..16].try_into().unwrap()),
        1
    );
    assert_eq!(&guest_report[32 + 12..32 + 12 + rx.len()], rx);
    let replay_opens = AtomicUsize::new(0);
    for budget in [1, 7, 4096] {
        for from_pending in [false, true] {
            let mut r = fixture(true);
            r.load_session_resume(if from_pending { &pending } else { &initial })
                .unwrap();
            assert!(matches!(
                r.open_session_network_provider(|| {
                    replay_opens.fetch_add(1, Ordering::SeqCst);
                    TcpStream::connect(address)
                }),
                Err(Error::ReplayIngress)
            ));
            let mut rt = Trace::default();
            for receipt in receipts.iter().skip(usize::from(from_pending)) {
                until(&mut r, receipt.position.transition, budget, &mut rt);
                replay(&mut r, receipt);
            }
            until(&mut r, END, budget, &mut rt);
            r.finish_session_network_replay(receipts.len() as u64)
                .unwrap();
            assert_eq!(
                r.save_session_resume().unwrap(),
                final_frame,
                "budget={budget},pending={from_pending}"
            );
            assert_eq!(report(&mut r), guest_report);
            if !from_pending {
                assert_eq!(rt.0, trace.0);
            }
            evidence(
                &format!("replay-{budget}-pending-{from_pending}.trace"),
                rt.0.as_bytes(),
            );
        }
    }
    assert_eq!(replay_opens.load(Ordering::SeqCst), 0);
    assert_eq!(counter.load(Ordering::SeqCst), 1);
    assert_eq!(connects.load(Ordering::SeqCst), 1);
    assert_eq!(sends.load(Ordering::SeqCst), 1);
    m.load_session_resume(&pending).unwrap();
    let before = m.save_session_resume().unwrap();
    assert_eq!(
        m.complete_session_network(
            &old,
            Event::Send {
                request,
                result: SendResult::Sent
            }
        ),
        Err(Error::StaleLease)
    );
    assert_eq!(m.save_session_resume().unwrap(), before);
    let mut envelopes = Vec::new();
    let mut positions = String::new();
    for receipt in &receipts {
        let SessionEffect::HostInput { bytes, .. } = &receipt.effect else {
            unreachable!()
        };
        envelopes.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        envelopes.extend_from_slice(bytes);
        positions.push_str(&format!(
            "{}\t{}\t{}\t{}\n",
            receipt.position.transition,
            receipt.position.retired,
            receipt.position.ordinal,
            receipt.position.sequence
        ));
    }
    for (name, bytes) in [
        ("initial.resume", initial),
        ("pending.resume", pending),
        ("final.resume", final_frame),
        ("guest-report.bin", guest_report),
        ("http-request.bin", observed_request),
        ("http-response.bin", response),
        ("receive-frame.bin", rx),
        ("network-envelopes.bin", envelopes),
    ] {
        evidence(name, &bytes);
    }
    evidence("network-positions.tsv", positions.as_bytes());
    evidence("original.trace", trace.0.as_bytes());
    evidence("transport-witness.json",b"{\"originalConnects\":1,\"originalSends\":1,\"serverRequests\":1,\"replays\":6,\"replayProviderConstructions\":0,\"serverUnavailable\":true}\n");
}
#[test]
fn changed_intent_duplicate_missing_exhausted_and_position_refuse_before_mutation() {
    let mut m = fixture(false);
    until(&mut m, START, 53, &mut Trace::default());
    let pending = m.save_session_resume().unwrap();
    let request = m.session_network_requests().unwrap().remove(0);
    let lease = m.lease_session_network(Some(request.id)).unwrap();
    let mut changed = request.clone();
    changed.frame[20] ^= 1;
    let before = m.save_session_resume().unwrap();
    assert_eq!(
        m.complete_session_network(
            &lease,
            Event::Send {
                request: changed.clone(),
                result: SendResult::Sent
            }
        ),
        Err(Error::Intent)
    );
    assert_eq!(m.save_session_resume().unwrap(), before);
    let receipt = capture(
        &mut m,
        Event::Send {
            request: request.clone(),
            result: SendResult::Sent,
        },
    );
    let before = m.save_session_resume().unwrap();
    assert_eq!(
        m.complete_session_network(
            &lease,
            Event::Send {
                request: request.clone(),
                result: SendResult::Sent
            }
        ),
        Err(Error::UnknownRequest)
    );
    assert_eq!(m.save_session_resume().unwrap(), before);
    let mut r = fixture(true);
    r.load_session_resume(&pending).unwrap();
    let before = r.save_session_resume().unwrap();
    assert_eq!(r.finish_session_network_replay(1), Err(Error::Exhausted));
    assert_eq!(
        r.replay_session_network(
            receipt.position,
            Event::Send {
                request: changed,
                result: SendResult::Sent
            }
        ),
        Err(Error::Intent)
    );
    assert_eq!(r.save_session_resume().unwrap(), before);
    let mut wrong = receipt.position;
    wrong.transition += 1;
    assert_eq!(
        r.replay_session_network(
            wrong,
            Event::Send {
                request: request.clone(),
                result: SendResult::Sent
            }
        ),
        Err(Error::Position)
    );
    assert_eq!(r.save_session_resume().unwrap(), before);
    let SessionEffect::HostInput { bytes, .. } = &receipt.effect else {
        unreachable!()
    };
    for prefix in 0..bytes.len() {
        assert!(Event::decode(&bytes[..prefix]).is_err());
    }
    let mut missing = bytes.clone();
    missing.pop();
    assert!(Event::decode(&missing).is_err());
    assert_eq!(r.save_session_resume().unwrap(), before);
    replay(&mut r, &receipt);
    r.finish_session_network_replay(1).unwrap();
    assert_eq!(r.finish_session_network_replay(2), Err(Error::Exhausted));
    evidence("refusal-pending.resume", &pending);
    evidence("refusal-send.event", bytes);
}
#[test]
fn error_close_cancel_queue_checkpoint_and_reset_revoke_capabilities() {
    use wasm_vm_core::dev::virtio::net::LoopbackBackend;
    let mut m = fixture(false);
    until(&mut m, START, 31, &mut Trace::default());
    let request = m.session_network_requests().unwrap().remove(0);
    let lease = m.lease_session_network(Some(request.id)).unwrap();
    let ingress = m.lease_session_network(None).unwrap();
    assert!(
        m.replace_virtio_net_backend(Box::new(LoopbackBackend::new()))
            .is_err()
    );
    let mut foreign = fixture(false);
    let before = foreign.save_session_resume().unwrap();
    assert_eq!(
        foreign.complete_session_network(&ingress, Event::Pending(true)),
        Err(Error::StaleLease)
    );
    assert_eq!(foreign.save_session_resume().unwrap(), before);
    capture(
        &mut m,
        Event::Send {
            request: request.clone(),
            result: SendResult::Failed,
        },
    );
    capture(&mut m, Event::Pending(true));
    capture(
        &mut m,
        Event::Link {
            status: LinkStatus::Failed,
            code: 111,
        },
    );
    capture(&mut m, Event::Receive(vec![0x91, 0x92, 0x93]));
    let queued = m.save_session_resume().unwrap();
    let mut restored = fixture(true);
    restored.load_session_resume(&queued).unwrap();
    until(&mut restored, START + 4000, 4096, &mut Trace::default());
    restored.finish_session_network_replay(4).unwrap();
    assert_eq!(restored.bus_mut().load8(BASE + 0x14000 + 12), Ok(0x91));
    m.bus_mut().store32(0x10002070, 0).unwrap();
    let before = m.save_session_resume().unwrap();
    assert_eq!(
        m.complete_session_network(&ingress, Event::Receive(vec![1])),
        Err(Error::StaleLease)
    );
    assert_eq!(
        m.complete_session_network(
            &lease,
            Event::Send {
                request,
                result: SendResult::Cancelled
            }
        ),
        Err(Error::StaleLease)
    );
    assert_eq!(m.save_session_resume().unwrap(), before);
    let mut cancel = fixture(false);
    until(&mut cancel, START, 11, &mut Trace::default());
    let request = cancel.session_network_requests().unwrap().remove(0);
    capture(
        &mut cancel,
        Event::Send {
            request,
            result: SendResult::Cancelled,
        },
    );
    evidence("queued-receive.resume", &queued);
    evidence("reset.resume", &before);
}
#[test]
fn codec_limits_and_impossible_links_are_rejected() {
    for event in [
        Event::Receive(vec![1; MAX_FRAME + 1]),
        Event::Send {
            request: NetworkRequest {
                id: 0,
                frame: vec![],
            },
            result: SendResult::Sent,
        },
        Event::Link {
            status: LinkStatus::Open,
            code: 1,
        },
    ] {
        assert!(event.encode().is_err());
    }
    for event in [
        Event::Receive(vec![]),
        Event::Pending(false),
        Event::Link {
            status: LinkStatus::Closed,
            code: 0,
        },
        Event::Link {
            status: LinkStatus::Failed,
            code: u32::MAX,
        },
    ] {
        let wire = event.encode().unwrap();
        assert_eq!(Event::decode(&wire), Ok(event));
        let mut trailing = wire.clone();
        trailing.push(0);
        assert!(Event::decode(&trailing).is_err());
    }
    let mut m = fixture(false);
    let lease = m.lease_session_network(None).unwrap();
    for _ in 0..256 {
        m.complete_session_network(&lease, Event::Receive(vec![1]))
            .unwrap();
        m.take_session_deliveries().unwrap();
    }
    let before = m.save_session_resume().unwrap();
    assert_eq!(
        m.complete_session_network(&lease, Event::Receive(vec![2])),
        Err(Error::Limit)
    );
    assert_eq!(m.save_session_resume().unwrap(), before);
}

fn rewrite_network(frame: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let mut out = frame[..84].to_vec();
    let mut at = 84;
    let mut edit = Some(edit);
    while at < frame.len() {
        let tag = u32::from_le_bytes(frame[at..at + 4].try_into().unwrap());
        let n = u32::from_le_bytes(frame[at + 4..at + 8].try_into().unwrap()) as usize;
        let mut bytes = frame[at + 8..at + 8 + n].to_vec();
        if tag == 21 {
            edit.take().unwrap()(&mut bytes);
        }
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&bytes);
        at += 8 + n;
    }
    assert!(edit.is_none());
    out
}
#[test]
fn malformed_network_checkpoints_are_atomic_and_preserve_callback_authority() {
    let mut m = fixture(false);
    until(&mut m, START, 31, &mut Trace::default());
    let request = m.session_network_requests().unwrap().remove(0);
    let frame = m.save_session_resume().unwrap();
    for case in 0..13 {
        let invalid = rewrite_network(&frame, |bytes| match case {
            0 => bytes[0] ^= 1,
            1 => bytes[8..16].copy_from_slice(&0u64.to_le_bytes()), // pending id exceeds allocator
            2 => bytes[16..24].copy_from_slice(&1u64.to_le_bytes()), // cursor exceeds common clock
            3 => bytes[24..32].copy_from_slice(&1u64.to_le_bytes()), // acknowledged exceeds cursor
            4 => bytes[32] = 4,
            5 => bytes[33] = 2,
            6 => bytes[34] = 2,
            7 => bytes[35] = 2,
            8 => bytes[36..40].copy_from_slice(&1u32.to_le_bytes()), // no-link error
            9 => bytes[40..44].copy_from_slice(&257u32.to_le_bytes()),
            10 => bytes[44..52].copy_from_slice(&0u64.to_le_bytes()),
            11 => bytes[52..56].copy_from_slice(&u32::MAX.to_le_bytes()),
            12 => bytes.push(0),
            _ => unreachable!(),
        });
        let lease = m.lease_session_network(Some(request.id)).unwrap();
        assert!(m.load_session_resume(&invalid).is_err(), "case={case}");
        assert_eq!(
            m.save_session_resume().unwrap(),
            frame,
            "partial mutation case={case}"
        );
        m.complete_session_network(
            &lease,
            Event::Send {
                request: request.clone(),
                result: SendResult::Cancelled,
            },
        )
        .unwrap();
        m.take_session_deliveries().unwrap();
        m.load_session_resume(&frame).unwrap();
        evidence(
            &format!("invalid-network-checkpoint-{case}.resume"),
            &invalid,
        );
    }
    let mut absent = fixture(true);
    let plain = {
        let mut n = Machine::new(1 << 20);
        n.enable_clint(1);
        n.start_session_clock(1).unwrap();
        n.save_session_resume().unwrap()
    };
    assert!(absent.load_session_resume(&plain).is_err());
    assert_eq!(absent.session_position().unwrap().transition, 0);
}
#[test]
fn oversized_guest_descriptor_is_bounded_before_allocation() {
    let mut m = fixture(false);
    let mut trace = Trace::default();
    until(&mut m, 370, 1, &mut trace);
    m.bus_mut()
        .store32(BASE + 0x20008, (MAX_FRAME + 13) as u32)
        .unwrap();
    until(&mut m, START, 31, &mut trace);
    assert!(m.session_network_requests().unwrap().is_empty());
    assert_eq!(m.bus_mut().load16(BASE + 0x22002), Ok(1));
    evidence("oversized-descriptor.trace", trace.0.as_bytes());
    evidence(
        "oversized-descriptor.resume",
        &m.save_session_resume().unwrap(),
    );
}

#[test]
fn real_connection_refusal_and_32_callback_schedules_replay_without_transport() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let mut original = fixture(false);
    let (result, lease) = original
        .open_session_network_provider(|| {
            TcpStream::connect_timeout(&address, Duration::from_millis(100))
        })
        .unwrap();
    let error = result.unwrap_err();
    let code = error.raw_os_error().unwrap() as u32;
    original
        .complete_session_network(
            &lease,
            Event::Link {
                status: LinkStatus::Failed,
                code,
            },
        )
        .unwrap();
    let receipt = original.take_session_deliveries().unwrap().remove(0);
    let failed = original.save_session_resume().unwrap();
    let mut r = fixture(true);
    replay(&mut r, &receipt);
    assert_eq!(r.save_session_resume().unwrap(), failed);
    r.finish_session_network_replay(1).unwrap();
    evidence("real-connect-error.resume", &failed);
    let mut summary = String::new();
    for seed in 0..32u64 {
        let mut m = fixture(false);
        until(&mut m, START, 31, &mut Trace::default());
        let pending = m.save_session_resume().unwrap();
        let request = m.session_network_requests().unwrap().remove(0);
        let mut receipts = vec![capture(&mut m, Event::Pending(true))];
        let mut trace = Trace::default();
        for step in 0..2 {
            until(&mut m, START + (seed * 7) % 23 + step * 13, 1, &mut trace);
            let incoming = (step == 0) == (seed % 2 == 0);
            receipts.push(capture(
                &mut m,
                if incoming {
                    Event::Receive(vec![seed as u8, 0xa7])
                } else {
                    Event::Send {
                        request: request.clone(),
                        result: if seed % 3 == 0 {
                            SendResult::Failed
                        } else {
                            SendResult::Sent
                        },
                    }
                },
            ));
        }
        receipts.push(capture(
            &mut m,
            Event::Link {
                status: if seed % 3 == 0 {
                    LinkStatus::Failed
                } else {
                    LinkStatus::Closed
                },
                code: if seed % 3 == 0 { code } else { 0 },
            },
        ));
        until(&mut m, START + 4000, 127, &mut trace);
        let frame = m.save_session_resume().unwrap();
        let mut r = fixture(true);
        r.load_session_resume(&pending).unwrap();
        let mut rt = Trace::default();
        for row in &receipts {
            until(&mut r, row.position.transition, 1 + seed * 17, &mut rt);
            replay(&mut r, row);
        }
        until(&mut r, START + 4000, 1 + seed * 17, &mut rt);
        r.finish_session_network_replay(4).unwrap();
        assert_eq!(r.save_session_resume().unwrap(), frame, "seed={seed}");
        summary.push_str(&format!(
            "seed={seed} budget={} cursor=4 transition={} matched=true\n",
            1 + seed * 17,
            START + 4000
        ));
        evidence(&format!("schedule-{seed}.resume"), &frame);
        evidence(&format!("schedule-{seed}.trace"), rt.0.as_bytes());
    }
    evidence("schedule-witness.txt", summary.as_bytes());
}
