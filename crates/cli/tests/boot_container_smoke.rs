//! E3.5-T02 acceptance: boot Alpine and run the in-guest container-capability smoke test
//! (`/usr/local/bin/container-smoke`), asserting `SMOKE_ALL_PASS` — every container primitive
//! (namespaces, cgroup-v2 memory OOM, overlayfs, pivot_root, veth+bridge, tmpfs, loop) exercised
//! on the real emulator. A capability that FAILS in-guest but works on real riscv64 Linux is an
//! emulator syscall gap to fix before the E3.5-T03 runner depends on it.
//!
//! Needs the CONTAINER rootfs (util-linux + iproute2 + e2fsprogs + the smoke script, built by
//! `tools/build-rootfs.sh` after this task) + a release build. Full boot (~5-7 min) → `#[ignore]`:
//!
//! ```text
//! cargo build --release -p wasm-vm-cli && bash tools/build-rootfs.sh
//! cargo test  --release -p wasm-vm-cli --test boot_container_smoke -- --ignored --nocapture
//! ```
//!
//! Echo-proof: `SMOKE_ALL_PASS` is emitted split (`SMOKE_ALL_""PASS`) by the guest script, so the
//! tty echo of the command that starts it can never satisfy the assertion (the E3-T13 F1 lesson).

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
#[ignore = "full Alpine boot + container smoke: ~7 min, needs the container rootfs + release build"]
fn container_capabilities_smoke_all_pass() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for f in [&bin, &kernel, &pristine] {
        assert!(f.exists(), "missing {}", f.display());
    }
    let img = std::env::temp_dir().join(format!(
        "wasm-vm-container-smoke-{}.ext4",
        std::process::id()
    ));
    std::fs::copy(&pristine, &img).expect("copy rootfs");

    let mut guard = KillOnDrop(Some(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
            .args(["--max-instrs", "80000000000"])
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
        "no login; transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, "");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "echo SHELL_\"UP\"");
    assert!(
        wait_for(&transcript, "SHELL_UP", 90),
        "no shell; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // Run the smoke test. Some steps take real interpreter time (mkfs, OOM loop) → generous budget.
    send(&mut stdin, "container-smoke");
    let passed = wait_for(&transcript, "SMOKE_ALL_PASS", 900);
    let t = transcript.lock().unwrap().clone();
    // If it didn't all-pass, surface which capabilities FAILED (each is an emulator-gap lead).
    assert!(
        passed,
        "container smoke did not reach SMOKE_ALL_PASS. FAIL lines:\n{}\n--- full transcript ---\n{}",
        t.lines()
            .filter(|l| l.contains("FAIL"))
            .collect::<Vec<_>>()
            .join("\n"),
        t
    );

    send(&mut stdin, "poweroff");
    let deadline = Instant::now() + Duration::from_secs(300);
    let child = guard.0.as_mut().unwrap();
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
    assert!(
        status.map(|s| s.success()).unwrap_or(false),
        "guest did not power off cleanly"
    );
}
