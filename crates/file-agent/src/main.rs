use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;
use wasm_vm_file_agent::{Session, connect_reserved, drive_stream, heartbeat_frame, monotonic_ms};
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
        Ok(count) => slot.session.receive(&bytes[..count], monotonic_ms()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};

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
}
