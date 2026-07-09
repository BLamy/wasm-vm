//! E3-T13 acceptance (native leg): boot Alpine with `--net` (loopback-backed virtio-net in
//! slot 1) and prove the guest end-to-end:
//!   1. the stock virtio_net driver is bound to eth0 (sysfs driver symlink — the driver
//!      probes SILENTLY, there is no virtio_net dmesg line to grep; critic F1),
//!   2. `ip link` shows `eth0` with OUR configured MAC (52:54:00:12:34:56),
//!   3. frames flow BOTH directions: bring eth0 up, arping a made-up neighbor, and assert
//!      the interface rx counter is nonzero — the only possible source of rx frames is the
//!      LoopbackBackend echoing our own tx back (MAC-swapped), so rx>0 proves tx→backend→rx.
//!
//! **Echo-proofing (critic F1, HIGH):** the guest tty echoes every sent command into the
//! transcript, and `wait_for` scans the WHOLE transcript — so an assertion marker must never
//! appear literally in the sent command text. Markers are split in the commands
//! (`echo NET_RX_"OK"` sends `NET_RX_"OK"` but prints `NET_RX_OK`), and grep-style checks
//! assert on strings that only the guest's OUTPUT can contain. This mirrors the
//! boot_alpine.rs "assert on strings that appear ONLY in the command output" rule.
//!
//! Full Alpine/OpenRC boot (~5-7 min interpreter time) → `#[ignore]`; run explicitly:
//!
//! ```text
//! cargo build --release -p wasm-vm-cli
//! cargo test  --release -p wasm-vm-cli --test boot_alpine_net -- --ignored --nocapture
//! ```
//!
//! Needs releases/kernel/6.6.63/Image built WITH networking (configs/wasm-vm.config
//! CONFIG_NET/VIRTIO_NET=y — rebuilt for E3-T13) + releases/rootfs/alpine-rootfs.ext4.

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("crates/cli → repo root")
        .to_path_buf()
}

fn wait_for(buf: &Arc<Mutex<String>>, needle: &str, secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        if buf.lock().unwrap().contains(needle) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    mut r: R,
    t: Arc<Mutex<String>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 512];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            t.lock()
                .unwrap()
                .push_str(&String::from_utf8_lossy(&chunk[..n]));
        }
    })
}

/// Kill the guest on ANY exit path — a panicking assert must not leak a running emulator
/// holding the temp image (critic F2: a leaked guest corrupted the next run's image copy).
struct KillOnDrop(Option<Child>);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(mut c) = self.0.take()
            && c.try_wait().ok().flatten().is_none()
        {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[test]
#[ignore = "full Alpine/OpenRC boot: ~5-7 min, needs a release build + net-enabled kernel + rootfs"]
fn alpine_detects_eth0_and_loopback_frames_flow() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for f in [&bin, &kernel, &pristine] {
        assert!(f.exists(), "missing {}", f.display());
    }

    // Boot from a COPY, uniquely named per run (critic F2: a fixed name let a leaked guest
    // from a failed run share the inode with the next run's copy — cross-run corruption).
    let img = std::env::temp_dir().join(format!(
        "wasm-vm-alpine-net-test-{}.ext4",
        std::process::id()
    ));
    std::fs::copy(&pristine, &img).expect("copy rootfs image");

    let mut guard = KillOnDrop(Some(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .arg("--net") // E3-T13: loopback virtio-net in slot 1
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
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
    let r1 = spawn_reader(child.stdout.take().unwrap(), Arc::clone(&transcript));
    let r2 = spawn_reader(child.stderr.take().unwrap(), Arc::clone(&transcript));
    let send = |stdin: &mut std::process::ChildStdin, line: &str| {
        writeln!(stdin, "{line}").expect("write to guest");
        stdin.flush().ok();
    };

    assert!(
        wait_for(&transcript, "login:", 900),
        "never reached login; transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, ""); // dismiss an optional Password:
    std::thread::sleep(Duration::from_secs(2));
    // Echo-proof marker: the sent text is `WASMVM_LOGIN_"OK"`; only guest output has the
    // joined form.
    send(&mut stdin, "echo WASMVM_LOGIN_\"OK\"");
    assert!(
        wait_for(&transcript, "WASMVM_LOGIN_OK", 90),
        "no shell; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 1. Driver bound: the sysfs driver symlink for eth0 ends in .../drivers/virtio_net.
    //    (virtio_net probes SILENTLY — there is no dmesg line to grep; critic F1 proved a
    //    real boot has zero `virtio_net` dmesg matches.) The sent command contains no
    //    "drivers/virtio" substring, so the assert can only match guest output.
    send(&mut stdin, "readlink /sys/class/net/eth0/device/driver");
    assert!(
        wait_for(&transcript, "drivers/virtio_net", 90),
        "eth0 not bound to the virtio_net driver; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 2. eth0 exists with OUR MAC from config space (output-only string: the sent command
    //    never contains the MAC).
    send(&mut stdin, "ip link show eth0");
    assert!(
        wait_for(&transcript, "52:54:00:12:34:56", 90),
        "eth0 with the configured MAC not shown; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 3. Frames flow both directions through the loopback: bring the interface up, arping a
    //    made-up neighbor (broadcast ARP requests tx; the backend echoes each MAC-swapped),
    //    then assert the kernel's rx counter is NONZERO — the loopback echo is the only
    //    possible source of received frames. (Even without busybox arping, IPv6 link-up
    //    RS/MLD multicasts transmit and echo back — the config builds IPV6=y.)
    send(&mut stdin, "ip addr add 10.0.2.15/24 dev eth0");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "ip link set eth0 up");
    std::thread::sleep(Duration::from_secs(3));
    send(
        &mut stdin,
        "arping -c 2 -I eth0 10.0.2.99; echo ARPING_\"DONE\"",
    );
    assert!(
        wait_for(&transcript, "ARPING_DONE", 120),
        "arping step hung; transcript:\n{}",
        transcript.lock().unwrap()
    );
    // Echo-proof: sent text has RX_"OK"/RX_"ZERO" split; only guest output joins them.
    send(
        &mut stdin,
        "[ \"$(cat /sys/class/net/eth0/statistics/rx_packets)\" -gt 0 ] && echo NET_RX_\"OK\" || echo NET_RX_\"ZERO\"",
    );
    let rx_ok = wait_for(&transcript, "NET_RX_OK", 90);
    assert!(
        rx_ok && !transcript.lock().unwrap().contains("NET_RX_ZERO"),
        "no frames received back from the loopback (rx_packets == 0); transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(
        &mut stdin,
        "[ \"$(cat /sys/class/net/eth0/statistics/tx_packets)\" -gt 0 ] && echo NET_TX_\"OK\" || echo NET_TX_\"ZERO\"",
    );
    let tx_ok = wait_for(&transcript, "NET_TX_OK", 90);
    assert!(
        tx_ok && !transcript.lock().unwrap().contains("NET_TX_ZERO"),
        "tx_packets == 0; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // Clean shutdown.
    send(&mut stdin, "poweroff");
    let child = guard.0.as_mut().unwrap();
    let deadline = Instant::now() + Duration::from_secs(300);
    let status = loop {
        if let Some(s) = child.try_wait().expect("try_wait") {
            break Some(s);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(500));
    };
    drop(stdin);
    let _ = r1.join();
    let _ = r2.join();
    let _ = std::fs::remove_file(&img);
    let status = status.unwrap_or_else(|| {
        panic!(
            "guest did not power off (KillOnDrop reaps it); transcript:\n{}",
            transcript.lock().unwrap()
        )
    });
    assert!(
        status.success(),
        "non-zero exit {status:?}; transcript:\n{}",
        transcript.lock().unwrap()
    );
}
