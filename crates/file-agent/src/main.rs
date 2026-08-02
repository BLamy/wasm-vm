use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;
use wasm_vm_file_agent::{
    Output, Session, connect_reserved, drive_stream, heartbeat_frame, monotonic_ms,
};
use wasm_vm_file_agent_storage::{Config, Storage};

const INBOX: &str = "/var/lib/wasm-vm/transfer/inbox";
const OUTBOX: &str = "/var/lib/wasm-vm/transfer/outbox";
const QUOTA: u64 = 2 * 1_073_741_824;

fn main() {
    if let Err(message) = run() {
        eprintln!("wvft-agent: {message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args().collect();
    let storage = Rc::new(
        Storage::open(Config {
            inbox: PathBuf::from(INBOX),
            outbox: PathBuf::from(OUTBOX),
            quota_bytes: QUOTA,
        })
        .map_err(|_| "storage initialization failed")?,
    );
    match args.as_slice() {
        [_program] => run_service(storage),
        [_program, mode] if mode == "service" => run_service(storage),
        [_program, mode, name] if mode == "vm-download" => {
            let (mut session, hello) = Session::download(storage, name, 1, monotonic_ms())
                .map_err(|_| "invalid outbox basename")?;
            let mut stream = connect_reserved().map_err(|_| "reserved endpoint unavailable")?;
            drive_stream(&mut stream, &mut session, &hello).map_err(|_| "download did not complete")
        }
        _ => Err("usage: wvft-agent [service | vm-download BASENAME]"),
    }
}

fn run_service(storage: Rc<Storage>) -> Result<(), &'static str> {
    let mut slots: [Option<ServiceSlot>; 2] = [None, None];
    loop {
        for slot in &mut slots {
            if slot
                .as_mut()
                .is_some_and(|active| step_slot(active).is_err())
            {
                *slot = None;
            }
            if slot.is_none() {
                *slot = service_slot(storage.clone()).ok();
            }
        }
        if slots.iter().all(Option::is_none) {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

struct ServiceSlot {
    stream: std::net::TcpStream,
    writer: Arc<Mutex<std::net::TcpStream>>,
    session: Session,
    _heartbeat: Heartbeat,
}

struct Heartbeat {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Heartbeat {
    fn spawn(writer: Arc<Mutex<std::net::TcpStream>>) -> Self {
        let (stop, receiver) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let heartbeat = heartbeat_frame();
            while let Err(mpsc::RecvTimeoutError::Timeout) =
                receiver.recv_timeout(Duration::from_secs(5))
            {
                let Ok(mut stream) = writer.lock() else {
                    break;
                };
                if stream.write_all(&heartbeat).is_err() {
                    break;
                }
            }
        });
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn service_slot(storage: Rc<Storage>) -> Result<ServiceSlot, &'static str> {
    let stream = connect_reserved().map_err(|_| "reserved endpoint unavailable")?;
    stream
        .set_read_timeout(Some(Duration::from_millis(10)))
        .map_err(|_| "reserved endpoint configuration failed")?;
    let (session, hello) = Session::service(storage, monotonic_ms());
    let writer_stream = stream
        .try_clone()
        .map_err(|_| "reserved endpoint configuration failed")?;
    let writer = Arc::new(Mutex::new(writer_stream));
    writer
        .lock()
        .map_err(|_| "reserved endpoint configuration failed")?
        .write_all(&hello)
        .map_err(|_| "reserved endpoint negotiation failed")?;
    let heartbeat = Heartbeat::spawn(writer.clone());
    Ok(ServiceSlot {
        stream,
        writer,
        session,
        _heartbeat: heartbeat,
    })
}

fn step_slot(slot: &mut ServiceSlot) -> Result<(), ()> {
    let mut bytes = [0u8; wasm_vm_file_agent::MAX_FRAME_PAYLOAD + wasm_vm_file_agent::HEADER_BYTES];
    let out = match slot.stream.read(&mut bytes) {
        Ok(0) => return Err(()),
        Ok(count) => receive_and_account_completed_io(
            &mut slot.session,
            &bytes[..count],
            monotonic_ms(),
            monotonic_ms,
        ),
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            slot.session.poll(monotonic_ms())
        }
        Err(_) => return Err(()),
    };
    for frame in out.frames {
        slot.writer
            .lock()
            .map_err(|_| ())?
            .write_all(&frame)
            .map_err(|_| ())?;
    }
    if out.close || out.complete {
        Err(())
    } else {
        Ok(())
    }
}

fn receive_and_account_completed_io(
    session: &mut Session,
    bytes: &[u8],
    received_at_ms: u64,
    completed_at_ms: impl FnOnce() -> u64,
) -> Output {
    let output = session.receive(bytes, received_at_ms);
    // `Session::receive` may synchronously extend or fsync ext4. The idle window starts after that
    // work completes, not before it begins; otherwise the next 10 ms socket poll can terminalize an
    // otherwise healthy service slot immediately after a slow write.
    session.note_io_progress(completed_at_ms());
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::net::{TcpListener, TcpStream};
    use tempfile::TempDir;
    use wasm_vm_file_agent::IDLE_TIMEOUT_MS;

    fn wire(kind: u8, stream: u32, payload: &[u8]) -> Vec<u8> {
        let mut bytes = b"WVFT".to_vec();
        bytes.push(1);
        bytes.push(kind);
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&stream.to_be_bytes());
        bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(payload);
        bytes
    }

    fn storage() -> (TempDir, Rc<Storage>) {
        let temp = tempfile::tempdir().expect("create storage root");
        let inbox = temp.path().join("inbox");
        let outbox = temp.path().join("outbox");
        std::fs::create_dir_all(&inbox).expect("create inbox");
        std::fs::create_dir_all(&outbox).expect("create outbox");
        let storage = Storage::open(Config {
            inbox,
            outbox,
            quota_bytes: 1024,
        })
        .expect("open storage");
        (temp, Rc::new(storage))
    }

    #[test]
    fn heartbeat_thread_writes_periodically_and_stops_cleanly() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind loopback listener");
        let address = listener.local_addr().expect("read loopback address");
        let writer = TcpStream::connect(address).expect("connect loopback writer");
        let (mut reader, _) = listener.accept().expect("accept loopback writer");
        reader
            .set_read_timeout(Some(Duration::from_secs(7)))
            .expect("set heartbeat read timeout");

        let heartbeat = Heartbeat::spawn(Arc::new(Mutex::new(writer)));
        let expected = heartbeat_frame();
        let mut actual = vec![0; expected.len()];
        reader
            .read_exact(&mut actual)
            .expect("receive periodic heartbeat");
        assert_eq!(actual, expected);

        drop(heartbeat);
    }

    #[test]
    fn completed_ext4_write_starts_a_fresh_idle_window_and_reports_structured_timeout() {
        let (_temp, storage) = storage();
        let (mut session, _) = Session::service(storage, 0);
        assert!(!receive_and_account_completed_io(&mut session, &wire(2, 0, &[1]), 1, || 1,).close);

        let sha: [u8; 32] = Sha256::digest(b"x").into();
        let mut offer = vec![1, 0];
        offer.extend_from_slice(&8u16.to_be_bytes());
        offer.extend_from_slice(&1u64.to_be_bytes());
        offer.extend_from_slice(&sha);
        offer.extend_from_slice(b"slow.bin");
        let accepted = receive_and_account_completed_io(&mut session, &wire(3, 7, &offer), 2, || 2);
        assert_eq!(accepted.frames[0][5], 4);

        let mut data = 0u64.to_be_bytes().to_vec();
        data.push(b'x');
        let completed_at = 3 + IDLE_TIMEOUT_MS + 5;
        let ack =
            receive_and_account_completed_io(&mut session, &wire(5, 7, &data), 3, || completed_at);
        assert!(!ack.close);
        assert_eq!(ack.frames[0][5], 6);
        assert!(
            !session.poll(completed_at + IDLE_TIMEOUT_MS - 1).close,
            "the slow storage duration itself must not consume the next idle window"
        );

        let timed_out = session.poll(completed_at + IDLE_TIMEOUT_MS);
        assert!(timed_out.close);
        assert_eq!(timed_out.frames[0][5], 10);
        let detail_len =
            u16::from_be_bytes(timed_out.frames[0][18..20].try_into().unwrap()) as usize;
        let detail = std::str::from_utf8(&timed_out.frames[0][20..20 + detail_len]).unwrap();
        assert!(detail.contains("\"transition\":\"idle-timeout\""));
        assert!(detail.contains("\"fromState\":\"Receiving\""));
        assert!(detail.contains("\"stream\":7"));
        assert!(detail.contains("\"byteOffset\":1"));
        assert!(detail.contains("\"storageWrite\":{"));
    }
}
