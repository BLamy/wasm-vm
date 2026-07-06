//! E3.5-T03 acceptance: boot Alpine and exercise the tiny OCI runner `wvrun` (shipped at
//! `/usr/local/bin/wvrun`). We build a minimal BUNDLE in-guest (a busybox rootfs + a flat
//! `config/` the way `wasm-vm oci unpack` emits it), then assert:
//!   1. `wvrun <bundle>` runs the container's argv and prints its output (`CONTAINED_42`, computed
//!      in-guest so the tty echo can't fake it — the E3-T13 F1 lesson).
//!   2. the container's exit code IS wvrun's exit code (a `sh -c 'exit 7'` bundle → `WVRUN_RC=7`).
//!   3. container writes land in the overlay upper — the bundle's `rootfs/` is byte-unchanged.
//!
//! A step that works on real riscv64 Linux but fails here is an emulator syscall gap (clone3 ns
//! flags, `pivot_root`, `mount(overlay)`, `umount2(MNT_DETACH)`) to file + fix before E3.5-T05's
//! `wvrun postgres` capstone depends on it.
//!
//! Full boot (~5-7 min) → `#[ignore]`; needs the container rootfs (util-linux + the wvrun script)
//! + a release build:
//! ```text
//! cargo build --release -p wasm-vm-cli && bash tools/build-rootfs.sh
//! cargo test  --release -p wasm-vm-cli --test boot_wvrun -- --ignored --nocapture
//! ```

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
#[ignore = "full Alpine boot + wvrun: ~7 min, needs the container rootfs (wvrun) + release build"]
fn wvrun_runs_a_bundle_and_isolates_it() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for f in [&bin, &kernel, &pristine] {
        assert!(f.exists(), "missing {}", f.display());
    }
    let img = std::env::temp_dir().join(format!("wasm-vm-wvrun-{}.ext4", std::process::id()));
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

    // Build bundle #1: a busybox rootfs + argv that echoes an in-guest-computed marker AND writes a
    // file inside the container (to prove the write does NOT reach the bundle rootfs).
    // The `$((6*7))` stays LITERAL in the argv file (single-quoted printf), so the marker is
    // computed by the container's shell, not by the login shell echoing our command.
    for c in [
        "mkdir -p /tmp/b/rootfs/bin /tmp/b/config",
        "cp -a /bin/busybox /tmp/b/rootfs/bin/ && ln -sf busybox /tmp/b/rootfs/bin/sh",
        "printf '/bin/sh\\n-c\\ntouch /ephemeral; echo CONTAINED_$((6*7))\\n' > /tmp/b/config/argv",
        "printf '/\\n' > /tmp/b/config/cwd",
        ": > /tmp/b/config/env",
        ": > /tmp/b/config/user",
        "wvrun /tmp/b",
    ] {
        send(&mut stdin, c);
    }
    assert!(
        wait_for(&transcript, "CONTAINED_42", 180),
        "wvrun did not run the container argv; transcript:\n{}",
        transcript.lock().unwrap()
    );
    // The container's write to `/ephemeral` must have landed in the overlay upper, NOT the bundle.
    send(
        &mut stdin,
        "test -e /tmp/b/rootfs/ephemeral && echo LEAKED_TO_IMAGE || echo IMAGE_\"CLEAN\"",
    );
    assert!(
        wait_for(&transcript, "IMAGE_CLEAN", 60),
        "container write leaked into the bundle rootfs; transcript:\n{}",
        transcript.lock().unwrap()
    );
    assert!(
        !transcript.lock().unwrap().contains("LEAKED_TO_IMAGE"),
        "container write mutated the image"
    );

    // Bundle #2: exit-code fidelity — the container's exit code IS wvrun's.
    for c in [
        "cp -a /tmp/b /tmp/b2",
        "printf '/bin/sh\\n-c\\nexit 7\\n' > /tmp/b2/config/argv",
        "wvrun /tmp/b2; echo WVRUN_RC=$?",
    ] {
        send(&mut stdin, c);
    }
    assert!(
        wait_for(&transcript, "WVRUN_RC=7", 120),
        "wvrun did not propagate the container exit code; transcript:\n{}",
        transcript.lock().unwrap()
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
