//! E3-T21b2c ignored acceptance: boot the production Alpine image and exercise the installed
//! OpenRC WVFT agent through the real `10.0.2.2:10021` slirp endpoint.

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("crates/cli to repository root")
        .to_path_buf()
}

fn wait_for(transcript: &Arc<Mutex<String>>, needle: &str, seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        if transcript.lock().unwrap().contains(needle) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn wait_for_file(path: &std::path::Path, seconds: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if path.is_file() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    transcript: Arc<Mutex<String>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut bytes = [0u8; 512];
        while let Ok(count) = reader.read(&mut bytes) {
            if count == 0 {
                break;
            }
            transcript
                .lock()
                .unwrap()
                .push_str(&String::from_utf8_lossy(&bytes[..count]));
        }
    })
}

struct KillOnDrop(Option<Child>);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take()
            && child.try_wait().ok().flatten().is_none()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[test]
#[ignore = "full Alpine/OpenRC WVFT boot: release CLI + kernel + integrated rootfs required"]
fn alpine_file_agent_round_trip_timeout_and_restart_recovery() {
    let root = repo_root();
    let binary = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for path in [&binary, &kernel, &pristine] {
        assert!(path.exists(), "missing {}", path.display());
    }

    let temp = tempfile::tempdir().expect("host fixture directory");
    let image = temp.path().join("rootfs.ext4");
    let upload = temp.path().join("upload.bin");
    let timeout_upload = temp.path().join("timeout.bin");
    std::fs::copy(&pristine, &image).expect("copy rootfs");

    let mut guard = KillOnDrop(Some(
        Command::new(&binary)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", image.display()))
            .arg("--net-slirp")
            .arg("--wvft-upload")
            .arg(&upload)
            .arg("--wvft-upload")
            .arg(&timeout_upload)
            .arg("--wvft-download-dir")
            .arg(temp.path())
            .args([
                "--append",
                "root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh",
            ])
            .args(["--max-instrs", "60000000000"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn wasm-vm boot"),
    ));
    let child = guard.0.as_mut().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let transcript = Arc::new(Mutex::new(String::new()));
    let stdout = spawn_reader(child.stdout.take().unwrap(), Arc::clone(&transcript));
    let stderr = spawn_reader(child.stderr.take().unwrap(), Arc::clone(&transcript));
    let send = |stdin: &mut std::process::ChildStdin, line: &str| {
        writeln!(stdin, "{line}").expect("write guest command");
        stdin.flush().ok();
    };

    assert!(
        wait_for(&transcript, "Run /bin/sh as init process", 600),
        "never reached the focused boot init:\n{}",
        transcript.lock().unwrap()
    );
    std::thread::sleep(Duration::from_secs(2));
    send(
        &mut stdin,
        "mount -t proc proc /proc 2>/dev/null || true; mount -t sysfs sysfs /sys 2>/dev/null || true; mount -t tmpfs tmpfs /run; ip link set lo up; ip addr add 10.0.2.15/24 dev eth0; ip link set eth0 up; ip route add default via 10.0.2.2; /usr/libexec/wasm-vm/wvft-agent service >/tmp/wvft-agent.log 2>&1 & echo $! >/run/wvft-test.pid; echo WVFT_BOOTSTRAP_\"OK\"",
    );
    assert!(
        wait_for(&transcript, "WVFT_BOOTSTRAP_OK", 300),
        "focused init could not start networking and the installed OpenRC service:\n{}",
        transcript.lock().unwrap()
    );
    assert!(!transcript.lock().unwrap().contains("WVFT_BOOTSTRAP_BAD"));

    send(
        &mut stdin,
        "kill -0 \"$(cat /run/wvft-test.pid)\" 2>/dev/null && echo WVFT_SERVICE_\"OK\" || echo WVFT_SERVICE_\"BAD\"",
    );
    assert!(wait_for(&transcript, "WVFT_SERVICE_OK", 90));
    send(
        &mut stdin,
        "if ss -lnt | grep -q ':10021 '; then echo WVFT_LISTENER_\"BAD\"; else echo WVFT_LISTENER_\"NONE\"; fi",
    );
    assert!(wait_for(&transcript, "WVFT_LISTENER_NONE", 90));
    assert!(!transcript.lock().unwrap().contains("WVFT_LISTENER_BAD"));

    let upload_bytes = b"host-to-guest through the private WVFT endpoint\n";
    std::fs::write(&upload, upload_bytes).expect("publish selected upload source");
    send(
        &mut stdin,
        "while [ ! -f /var/lib/wasm-vm/transfer/inbox/upload.bin ]; do sleep 1; done; sha256sum /var/lib/wasm-vm/transfer/inbox/upload.bin",
    );
    let upload_sha = format!("{:x}", Sha256::digest(upload_bytes));
    assert!(
        wait_for(&transcript, &upload_sha, 180),
        "upload did not commit with expected hash:\n{}",
        transcript.lock().unwrap()
    );

    let download_bytes = b"guest-to-host after durable outbox creation\n";
    send(
        &mut stdin,
        "printf '%s\n' 'guest-to-host after durable outbox creation' > /var/lib/wasm-vm/transfer/outbox/download.bin; kill \"$(cat /run/wvft-test.pid)\"; wait \"$(cat /run/wvft-test.pid)\" 2>/dev/null || true; vm-download download.bin; r=$?; /usr/libexec/wasm-vm/wvft-agent service >/tmp/wvft-agent.log 2>&1 & echo $! >/run/wvft-test.pid; [ $r -eq 0 ] && echo WVFT_DOWNLOAD_\"OK\"",
    );
    assert!(
        wait_for(&transcript, "WVFT_DOWNLOAD_OK", 180),
        "vm-download failed:\n{}",
        transcript.lock().unwrap()
    );
    let downloaded = temp.path().join("download.bin");
    assert!(wait_for_file(&downloaded, 30), "host download absent");
    assert_eq!(std::fs::read(&downloaded).unwrap(), download_bytes);

    // Freeze the guest agent while its already-negotiated socket remains open. Publishing the
    // second host-selected source now places the host engine in AwaitAccept; 30 wall-clock seconds
    // must expire it and close the private connection without creating a final guest file.
    send(
        &mut stdin,
        "kill -STOP \"$(cat /run/wvft-test.pid)\"; echo WVFT_AGENT_\"FROZEN\"",
    );
    assert!(wait_for(&transcript, "WVFT_AGENT_FROZEN", 90));
    std::fs::write(&timeout_upload, vec![0x5a; 2 * 1024 * 1024])
        .expect("publish timeout upload source");
    std::thread::sleep(Duration::from_secs(35));
    send(
        &mut stdin,
        "kill -CONT \"$(cat /run/wvft-test.pid)\"; kill \"$(cat /run/wvft-test.pid)\"; wait \"$(cat /run/wvft-test.pid)\" 2>/dev/null || true; /usr/libexec/wasm-vm/wvft-agent service >/tmp/wvft-agent.log 2>&1 & echo $! >/run/wvft-test.pid; echo WVFT_RESTART_\"OK\"",
    );
    assert!(wait_for(&transcript, "WVFT_RESTART_OK", 120));
    send(
        &mut stdin,
        "test ! -e /var/lib/wasm-vm/transfer/inbox/timeout.bin && echo WVFT_TIMEOUT_\"CLEAN\" || echo WVFT_TIMEOUT_\"BAD\"",
    );
    assert!(wait_for(&transcript, "WVFT_TIMEOUT_CLEAN", 90));
    assert!(!transcript.lock().unwrap().contains("WVFT_TIMEOUT_BAD"));

    // A corrupt interrupted record must not turn its partial into a complete-looking basename when
    // the service opens storage during restart. The post-restart download proves it also reconnects
    // to the real synthetic endpoint rather than merely reporting an OpenRC process as started.
    send(
        &mut stdin,
        "kill \"$(cat /run/wvft-test.pid)\"; wait \"$(cat /run/wvft-test.pid)\" 2>/dev/null || true; printf partial > /var/lib/wasm-vm/transfer/inbox/.wvft-0000000000000042.part; printf corrupt > /var/lib/wasm-vm/transfer/inbox/.wvft-0000000000000042.commit; /usr/libexec/wasm-vm/wvft-agent service >/tmp/wvft-agent.log 2>&1 & echo $! >/run/wvft-test.pid; test ! -e /var/lib/wasm-vm/transfer/inbox/recovered.bin && echo WVFT_RECOVERY_\"CLEAN\"",
    );
    assert!(wait_for(&transcript, "WVFT_RECOVERY_CLEAN", 120));

    let recovery_bytes = b"post-restart endpoint proof\n";
    send(
        &mut stdin,
        "printf '%s\n' 'post-restart endpoint proof' > /var/lib/wasm-vm/transfer/outbox/after-restart.bin; kill \"$(cat /run/wvft-test.pid)\"; wait \"$(cat /run/wvft-test.pid)\" 2>/dev/null || true; vm-download after-restart.bin && echo WVFT_AFTER_RESTART_\"OK\"",
    );
    assert!(
        wait_for(&transcript, "WVFT_AFTER_RESTART_OK", 180),
        "post-restart transfer failed:\n{}",
        transcript.lock().unwrap()
    );
    let recovered = temp.path().join("after-restart.bin");
    assert!(wait_for_file(&recovered, 30));
    assert_eq!(std::fs::read(&recovered).unwrap(), recovery_bytes);

    send(&mut stdin, "echo WVFT_BOOT_\"PASS\"; poweroff -f");
    assert!(wait_for(&transcript, "WVFT_BOOT_PASS", 90));
    let deadline = Instant::now() + Duration::from_secs(300);
    let status = loop {
        if let Some(status) = guard.0.as_mut().unwrap().try_wait().expect("try_wait") {
            break Some(status);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(500));
    };
    let timed_out = status.is_none();
    if timed_out {
        let child = guard.0.as_mut().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(stdin);
    let _ = stdout.join();
    let _ = stderr.join();
    assert!(
        !timed_out,
        "guest did not power off:\n{}",
        transcript.lock().unwrap()
    );
    let status = status.expect("shutdown timeout handled above");
    assert!(status.success(), "guest exit {status:?}");
}
