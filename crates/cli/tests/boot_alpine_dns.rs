//! E3-T15 native acceptance: a stock Alpine rootfs boots with its existing OpenRC DHCP config and,
//! without any guest-side network setup, acquires 10.0.2.15, installs the default route and resolver,
//! resolves a real Alpine mirror through the host OS resolver, returns NXDOMAIN promptly, renews a
//! 60-second lease at T1, retains connectivity, and powers off cleanly.
//!
//! Full interpreted boot is intentionally ignored by the cheap suite:
//! `cargo build --release -p wasm-vm-cli && cargo test --release -p wasm-vm-cli --test boot_alpine_dns -- --ignored --nocapture`

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
#[ignore = "full stock Alpine boot with live DNS: release binary + kernel + rootfs required"]
fn stock_alpine_dhcp_dns_nxdomain_and_renewal_work_without_manual_setup() {
    let root = repo_root();
    let binary = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for path in [&binary, &kernel, &pristine] {
        assert!(path.exists(), "missing {}", path.display());
    }

    let temp = std::env::temp_dir();
    let image = temp.join(format!("wasm-vm-e3-t15-{}.ext4", std::process::id()));
    let preserve_dir = std::env::var_os("WASM_VM_E3_T15_EVIDENCE_DIR")
        .map(std::path::PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        });
    if let Some(dir) = &preserve_dir {
        std::fs::create_dir_all(dir).expect("create E3-T15 evidence directory");
    }
    let evidence = preserve_dir.as_ref().map_or_else(
        || temp.join(format!("wasm-vm-e3-t15-{}.evidence", std::process::id())),
        |dir| dir.join("native-alpine.evidence"),
    );
    std::fs::copy(&pristine, &image).expect("copy pristine rootfs");

    let mut guard = KillOnDrop(Some(
        Command::new(&binary)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", image.display()))
            .arg("--net-slirp")
            .args(["--net-slirp-lease-secs", "60"])
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
            .args(["--max-instrs", "60000000000"])
            .arg("--evidence")
            .arg(&evidence)
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
        wait_for(&transcript, "login:", 900),
        "never reached login:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, "");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "echo E3T15_LOGIN_\"OK\"");
    assert!(wait_for(&transcript, "E3T15_LOGIN_OK", 90));

    // These are observations only: OpenRC's stock networking service already ran udhcpc at boot.
    send(
        &mut stdin,
        "ip -4 addr show dev eth0 | grep -q '10[.]0[.]2[.]15/24' && echo DHCP_ADDR_\"OK\" || echo DHCP_ADDR_\"BAD\"",
    );
    assert!(wait_for(&transcript, "DHCP_ADDR_OK", 90));
    send(
        &mut stdin,
        "ip route | grep -q 'default via 10[.]0[.]2[.]2' && echo DHCP_ROUTE_\"OK\" || echo DHCP_ROUTE_\"BAD\"",
    );
    assert!(wait_for(&transcript, "DHCP_ROUTE_OK", 90));
    send(
        &mut stdin,
        "grep -q '^nameserver 10[.]0[.]2[.]3$' /etc/resolv.conf && echo DHCP_DNS_\"OK\" || echo DHCP_DNS_\"BAD\"",
    );
    assert!(wait_for(&transcript, "DHCP_DNS_OK", 90));

    send(
        &mut stdin,
        "nslookup dl-cdn.alpinelinux.org >/tmp/e3t15-lookup 2>&1; r=$?; cat /tmp/e3t15-lookup; [ $r -eq 0 ] && grep -q '^Name:.*dl-cdn[.]alpinelinux[.]org' /tmp/e3t15-lookup && echo DNS_PUBLIC_\"OK\" || echo DNS_PUBLIC_\"BAD\"",
    );
    assert!(
        wait_for(&transcript, "DNS_PUBLIC_OK", 120),
        "real mirror did not resolve:\n{}",
        transcript.lock().unwrap()
    );

    send(
        &mut stdin,
        "s=$(date +%s); nslookup definitely-missing-e3t15.invalid >/tmp/e3t15-nx 2>&1; r=$?; e=$(($(date +%s)-s)); cat /tmp/e3t15-nx; [ $r -ne 0 ] && [ $e -le 5 ] && grep -Eqi 'NXDOMAIN|non-existent' /tmp/e3t15-nx && echo DNS_NX_\"OK\" || echo DNS_NX_\"BAD\"",
    );
    assert!(
        wait_for(&transcript, "DNS_NX_OK", 120),
        "NXDOMAIN was wrong/slow:\n{}",
        transcript.lock().unwrap()
    );

    // A 60-second lease renews at T1=30 seconds. The deterministic pcap integration test asserts
    // the exact RENEW wire exchange; this boot leg proves stock udhcpc remains configured and live.
    send(
        &mut stdin,
        "sleep 35; ping -c 1 -W 2 10.0.2.2 >/dev/null && ip -4 addr show dev eth0 | grep -q '10[.]0[.]2[.]15/24' && echo DHCP_RENEW_\"OK\" || echo DHCP_RENEW_\"BAD\"",
    );
    assert!(
        wait_for(&transcript, "DHCP_RENEW_OK", 180),
        "lease renewal lost connectivity:\n{}",
        transcript.lock().unwrap()
    );

    send(&mut stdin, "echo E3T15_NATIVE_\"PASS\"; poweroff");
    assert!(wait_for(&transcript, "E3T15_NATIVE_PASS", 90));
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
    drop(stdin);
    let _ = stdout.join();
    let _ = stderr.join();
    let _ = std::fs::remove_file(&image);
    if let Some(dir) = &preserve_dir {
        std::fs::write(
            dir.join("native-alpine-transcript.txt"),
            transcript.lock().unwrap().as_bytes(),
        )
        .expect("write preserved native transcript");
    }
    let status = status
        .unwrap_or_else(|| panic!("guest did not power off:\n{}", transcript.lock().unwrap()));
    assert!(status.success(), "guest exit {status:?}");
    let seal = std::fs::read_to_string(&evidence).expect("compact guest evidence");
    assert!(
        seal.contains("outcome=Exited(0)"),
        "bad evidence seal: {seal}"
    );
    if preserve_dir.is_none() {
        let _ = std::fs::remove_file(evidence);
    }
}
