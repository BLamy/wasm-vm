use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;
use wasm_vm_file_agent::{Session, connect_reserved, drive_stream, monotonic_ms};
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
    session: Session,
}

fn service_slot(storage: Rc<Storage>) -> Result<ServiceSlot, &'static str> {
    let mut stream = connect_reserved().map_err(|_| "reserved endpoint unavailable")?;
    stream
        .set_read_timeout(Some(Duration::from_millis(10)))
        .map_err(|_| "reserved endpoint configuration failed")?;
    let (session, hello) = Session::service(storage, monotonic_ms());
    stream
        .write_all(&hello)
        .map_err(|_| "reserved endpoint negotiation failed")?;
    Ok(ServiceSlot { stream, session })
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
        slot.stream.write_all(&frame).map_err(|_| ())?;
    }
    if out.close || out.complete {
        Err(())
    } else {
        Ok(())
    }
}
