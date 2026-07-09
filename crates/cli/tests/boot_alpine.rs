//! E2-T19 expect-style Alpine integration test: boot the pinned kernel with the Alpine ext4
//! rootfs on virtio-blk, log in as root over the UART, run a command battery, and power off
//! cleanly — the Level-2 "full system" milestone on the native CLI.
//!
//! This is a FULL Alpine/OpenRC boot (~5–7 minutes of interpreter time — much heavier than
//! busybox init), so it is `#[ignore]`d. Run it explicitly, against a release build and the
//! built rootfs (`bash tools/build-rootfs.sh`):
//!
//! ```text
//! cargo build --release -p wasm-vm-cli && bash tools/build-rootfs.sh
//! cargo test  --release -p wasm-vm-cli --test boot_alpine -- --ignored --nocapture
//! ```
//!
//! It boots from a COPY of the image (so the pristine rootfs is untouched and the run is
//! repeatable), and asserts on real command output — not just that a prompt printed.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
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

#[test]
#[ignore = "full Alpine/OpenRC boot: ~5-7 min, needs a release build + built rootfs"]
fn boots_alpine_to_root_login_runs_battery_and_powers_off() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for f in [&bin, &kernel, &pristine] {
        assert!(
            f.exists(),
            "missing {} — build release + `bash tools/build-rootfs.sh`",
            f.display()
        );
    }

    // Boot from a COPY so the pristine image stays clean and the test is repeatable.
    let img = std::env::temp_dir().join("wasm-vm-alpine-test.ext4");
    std::fs::copy(&pristine, &img).expect("copy rootfs image");

    let mut child = Command::new(&bin)
        .args(["boot", "--kernel"])
        .arg(&kernel)
        .arg("--drive")
        .arg(format!("file={}", img.display()))
        .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
        .args(["--max-instrs", "60000000000"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn wasm-vm boot");

    let mut stdin = child.stdin.take().unwrap();
    let transcript = Arc::new(Mutex::new(String::new()));
    let r1 = spawn_reader(child.stdout.take().unwrap(), Arc::clone(&transcript));
    let r2 = spawn_reader(child.stderr.take().unwrap(), Arc::clone(&transcript));

    let send = |stdin: &mut std::process::ChildStdin, line: &str| {
        writeln!(stdin, "{line}").expect("write to guest");
        stdin.flush().ok();
    };

    // 1. Wait for the getty login prompt (Alpine + OpenRC is a slow boot).
    assert!(
        wait_for(&transcript, "login:", 900),
        "never reached the login prompt; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 2. Log in as root. Passwordless (empty shadow) — but tolerate an optional Password:
    //    prompt by sending a blank line, then prove the shell is live with a marker echo.
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, ""); // dismiss a Password: prompt if one appears
    std::thread::sleep(Duration::from_secs(2));
    // Echo-proof marker (sweep-critic E2-T19 F1 retrofit): the guest tty echoes every sent
    // command into the transcript, so an asserted marker must never appear literally in the
    // sent text — split it so only guest output joins the needle.
    send(&mut stdin, "echo WASMVM_LOGIN_\"OK\"");
    assert!(
        wait_for(&transcript, "WASMVM_LOGIN_OK", 90),
        "root login did not reach a working shell; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 3. Command battery — each waits for its own output before the next (ordered, no flood).
    //    ECHO-PROOF DISCIPLINE (sweep-critic E2-T19, the E3-T13 F1 class): every asserted
    //    needle must be a string only guest OUTPUT can contain — never a substring of the
    //    sent command and never something the getty banner/boot log already printed.
    //    - `Linux wasm-vm` (uname) and `/dev/root on / type ext4` (mount) are genuine
    //      output-only strings (the kernel logs `root=/dev/vda`, never `/dev/root`).
    //    - `Alpine Linux` appears in the getty BANNER, so os-release is asserted via a
    //      computed marker instead.
    //    - the marker-file readback and df computations are split-marker proofs.
    let steps: &[(&str, &str)] = &[
        ("uname -a", "Linux wasm-vm"),
        (
            "grep -q 'Alpine Linux' /etc/os-release && echo OSREL_\"OK\"",
            "OSREL_OK",
        ),
        ("mount", "/dev/root on / type ext4"),
        ("df -h / | grep -q /dev/root && echo DF_\"OK\"", "DF_OK"),
        (
            "echo persist_$((6*7)) > /root/marker.txt && cat /root/marker.txt",
            "persist_42",
        ),
        // Sweep-critic E2-T19 criterion 2: the dmesg health gate — zero WARN/BUG/Oops/I/O
        // errors, asserted via a computed count marker (output-only).
        (
            "dmesg | grep -cE 'WARNING|BUG:|Oops|I/O error' | sed 's/^/DMESGBAD=/'",
            "DMESGBAD=0",
        ),
        ("sync", ""), // no output; just must not hang before poweroff
    ];
    for (cmd, expect) in steps {
        send(&mut stdin, cmd);
        if !expect.is_empty() {
            assert!(
                wait_for(&transcript, expect, 90),
                "command `{cmd}` did not produce `{expect}`; transcript:\n{}",
                transcript.lock().unwrap()
            );
        } else {
            std::thread::sleep(Duration::from_secs(3));
        }
    }

    // 4. Clean poweroff → the process exits 0. The OpenRC shutdown runlevel (unmount, sync,
    //    SBI poweroff) is itself slow in the interpreter, so allow generous time.
    send(&mut stdin, "poweroff");
    let status = wait_exit(&mut child, 300);
    drop(stdin);
    let _ = r1.join();
    let _ = r2.join();
    let _ = std::fs::remove_file(&img);
    let status = status.unwrap_or_else(|| {
        panic!(
            "guest did not power off in time; transcript:\n{}",
            transcript.lock().unwrap()
        )
    });
    assert!(status.success(), "poweroff must exit 0, got {status:?}");
}

/// Wait up to `secs` for the child to exit; return its status, or None on timeout (killed).
fn wait_exit(child: &mut std::process::Child, secs: u64) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(300));
            }
            Err(_) => return None,
        }
    }
}
