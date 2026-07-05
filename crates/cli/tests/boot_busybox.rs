//! E2-T15 expect-style boot smoke test: drive the `wasm-vm boot` CLI over a real pipe, wait
//! for the busybox shell prompt, run a handful of commands, and assert on their output.
//!
//! This is a FULL unmodified-Linux boot (~1–2 minutes of interpreter time), so it is
//! `#[ignore]`d — normal `cargo test` skips it. Run it explicitly, against a release build
//! and the pinned artifacts:
//!
//! ```text
//! cargo build --release -p wasm-vm-cli
//! cargo test  --release -p wasm-vm-cli --test boot_busybox -- --ignored --nocapture
//! ```
//!
//! It is the automated form of the transcript in the E2-T15 task log: proof that the machine
//! boots to an interactive shell whose commands actually run, not just that a prompt printed.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Repo root (two levels up from this crate's manifest dir).
fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("crates/cli → repo root")
        .to_path_buf()
}

/// Block until the shared transcript contains `needle` or `secs` elapse. Polls a mutex the
/// reader thread appends to — no line-splitting heuristics, so a promptless `~ # ` is seen.
fn wait_for(buf: &Arc<Mutex<String>>, needle: &str, secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        if buf.lock().unwrap().contains(needle) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
#[ignore = "full Linux boot: ~1-2 min, needs a release build + pinned artifacts"]
fn boots_to_interactive_busybox_shell() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let initrd = root.join("releases/initramfs/initramfs.cpio.gz");
    for f in [&bin, &kernel, &initrd] {
        assert!(
            f.exists(),
            "missing {} — build release + fetch artifacts first",
            f.display()
        );
    }

    let mut child = Command::new(&bin)
        .args(["boot", "--kernel"])
        .arg(&kernel)
        .arg("--initrd")
        .arg(&initrd)
        .args(["--max-instrs", "20000000000"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped()) // dmesg + shell output
        .stderr(Stdio::inherit()) // boot banner + any exit reason → visible under --nocapture
        .spawn()
        .expect("spawn wasm-vm boot");

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    // Reader thread: append every byte to a shared transcript.
    let transcript = Arc::new(Mutex::new(String::new()));
    let t2 = Arc::clone(&transcript);
    let reader = std::thread::spawn(move || {
        let mut chunk = [0u8; 512];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => t2
                    .lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&chunk[..n])),
            }
        }
    });

    // 1. Wait for userspace + the first shell prompt.
    assert!(
        wait_for(&transcript, "busybox userland up", 180),
        "never reached userspace; transcript:\n{}",
        transcript.lock().unwrap()
    );
    assert!(
        wait_for(&transcript, "~ # ", 30),
        "userspace up but no shell prompt; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // 2. Drive the shell. Each command waits for its own output before the next, so the RX
    //    FIFO never floods and the assertions are ordered.
    let steps: &[(&str, &str)] = &[
        ("echo WASMVM_SMOKE_OK", "WASMVM_SMOKE_OK"),
        ("uname -m", "riscv64"),
        ("cat /proc/cpuinfo", "rv64imafdc"),
        ("cat /proc/interrupts", "riscv-timer"),
    ];
    for (cmd, expect) in steps {
        writeln!(stdin, "{cmd}").expect("write command");
        stdin.flush().ok();
        assert!(
            wait_for(&transcript, expect, 60),
            "command `{cmd}` did not produce `{expect}`; transcript:\n{}",
            transcript.lock().unwrap()
        );
    }

    // E2-T16: the goldfish RTC must deliver REAL wall-clock time, not the 1970 epoch — the
    // kernel logs `setting system clock to <year>-…` at probe. Assert a 21st-century year so
    // this stays true without pinning to a specific date.
    {
        let t = transcript.lock().unwrap();
        assert!(
            t.contains("setting system clock to 20"),
            "RTC did not set a real (20xx) system clock — got 1970?; transcript:\n{t}"
        );
    }

    // ttyS0 must appear in /proc/interrupts (input arrived via the UART IRQ, not polling).
    assert!(
        transcript.lock().unwrap().contains("ttyS0"),
        "no ttyS0 interrupt line; transcript:\n{}",
        transcript.lock().unwrap()
    );

    let _ = child.kill();
    let _ = child.wait();
    drop(stdin);
    let _ = reader.join();
}

/// E2-T17: `reboot -f` must produce a SECOND full boot in the same process, and `poweroff -f`
/// must then exit cleanly (code 0). Two boots + a clean exit in one child.
#[test]
#[ignore = "two full Linux boots: ~2-3 min, needs a release build + pinned artifacts"]
fn reboot_produces_second_boot_then_poweroff() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let initrd = root.join("releases/initramfs/initramfs.cpio.gz");
    for f in [&bin, &kernel, &initrd] {
        assert!(f.exists(), "missing {}", f.display());
    }

    let mut child = Command::new(&bin)
        .args(["boot", "--kernel"])
        .arg(&kernel)
        .arg("--initrd")
        .arg(&initrd)
        .args(["--max-instrs", "40000000000"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped()) // the "reboot #1" / "powered off" banners go here
        .spawn()
        .expect("spawn wasm-vm boot");

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Merge stdout (dmesg) + stderr (the "reboot #1" / "powered off" banners) into one
    // transcript. A generic reader thread drains any `Read + Send` stream.
    let transcript = Arc::new(Mutex::new(String::new()));
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
    let r1 = spawn_reader(stdout, Arc::clone(&transcript));
    let r2 = spawn_reader(stderr, Arc::clone(&transcript));

    // First boot → reboot.
    assert!(
        wait_for(&transcript, "busybox userland up", 180),
        "first boot never reached userspace"
    );
    assert!(wait_for(&transcript, "~ # ", 30), "first boot no prompt");
    writeln!(stdin, "reboot -f").unwrap();
    stdin.flush().ok();
    // The reboot banner + a SECOND userspace.
    assert!(
        wait_for(&transcript, "reboot #1", 60),
        "reboot did not restart the machine"
    );
    assert!(
        wait_for(&transcript, "busybox userland up", 180),
        "second boot never reached userspace after reboot"
    );
    assert!(wait_for(&transcript, "~ # ", 30), "second boot no prompt");
    // Poweroff → clean exit.
    writeln!(stdin, "poweroff -f").unwrap();
    stdin.flush().ok();

    let status = child.wait().expect("child exits after poweroff");
    assert!(status.success(), "poweroff must exit 0, got {status:?}");
    drop(stdin);
    let _ = r1.join();
    let _ = r2.join();
}
