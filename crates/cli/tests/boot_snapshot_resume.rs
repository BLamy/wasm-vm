//! E3-T12c4 — boot-level snapshot disk coherence (sync → snapshot → restore → continue → poweroff
//! → `fsck.ext4 -n` clean). The end-to-end integration proof that the E3-T12c pieces compose:
//!   - c1: virtio device serialization (transport + ring position),
//!   - c2: bounded virtqueue quiesce (no torn in-flight request),
//!   - c3: overlay-generation coherence (no stale/foreign restore).
//!
//! Two `wasm-vm boot` processes share ONE `--drive` image. Process A boots, drives a login + a
//! pre-snapshot marker write + `sync`, then prints a trigger the CLI watches for and, on sight,
//! `save_resume`s to a blob and exits 0. Process B `--resume-from`s that blob against the SAME
//! image, continues the guest, proves the pre-snapshot completed request is present exactly once,
//! runs a fresh guest-computed command, and powers off cleanly. An external `fsck.ext4 -n` then
//! confirms the ext4 root is clean.
//!
//! Both are `#[ignore]`d full Linux boots. The Alpine proof is boot-gated (~18 min on `ssh dev`, as
//! E2-T19/E2-T24 established); the busybox variant is a fast (~1-2 min) smoke of the same plumbing:
//!
//! ```text
//! cargo build --release -p wasm-vm-cli
//! cargo test  --release -p wasm-vm-cli --test boot_snapshot_resume -- --ignored --nocapture
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
        std::thread::sleep(Duration::from_millis(150));
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

/// Kill-on-drop wrapper (E2-T19 harness discipline): a panicking assert must never orphan a guest
/// that then burns a core to `--max-instrs`.
struct Guest(Child);
impl Drop for Guest {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn send(stdin: &mut std::process::ChildStdin, line: &str) {
    writeln!(stdin, "{line}").expect("write to guest");
    stdin.flush().ok();
}

/// Wait for `child` to exit within `secs`; returns the exit code (or None on timeout).
fn wait_exit(child: &mut Child, secs: u64) -> Option<i32> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.code().unwrap_or(-1)),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(150)),
            _ => return None,
        }
    }
}

const TRIGGER: &str = "WVSNAP_NOW";

/// Fast plumbing smoke (busybox initramfs + a scratch drive): boot → shell → write a RAM marker →
/// snapshot → resume into a fresh process → the marker survives AND the resumed shell runs a fresh
/// command. Proves the c1/c2/c3 CLI plumbing + that the console is usable after a resume, without the
/// ~18-min Alpine/ext4 path. (initramfs userland lives in RAM, so it exercises RAM/CPU/virtio-blk
/// transport resume; the ext4-on-disk coherence + fsck is the Alpine proof below.)
#[test]
#[ignore = "full busybox boot ×2: ~2-3 min, needs a release build + pinned artifacts"]
fn busybox_snapshot_resume_roundtrip() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let initrd = root.join("releases/initramfs/initramfs.cpio.gz");
    for f in [&bin, &kernel, &initrd] {
        assert!(
            f.exists(),
            "missing {} — build release + fetch artifacts",
            f.display()
        );
    }
    // A scratch drive so a virtio-blk device is present (its transport is part of the snapshot).
    let img = std::env::temp_dir().join("wvsnap-busybox-scratch.img");
    std::fs::write(&img, vec![0u8; 4 * 1024 * 1024]).expect("scratch drive");
    let blob = std::env::temp_dir().join("wvsnap-busybox.blob");
    let _ = std::fs::remove_file(&blob);

    // --- Process A: boot, reach the shell, write a RAM marker, trigger the snapshot. ---
    let mut a = Guest(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--initrd")
            .arg(&initrd)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--max-instrs", "30000000000"])
            .args(["--snapshot-trigger", TRIGGER])
            .arg("--snapshot-out")
            .arg(&blob)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn A"),
    );
    let mut a_in = a.0.stdin.take().unwrap();
    let ta = Arc::new(Mutex::new(String::new()));
    let ar1 = spawn_reader(a.0.stdout.take().unwrap(), Arc::clone(&ta));
    let ar2 = spawn_reader(a.0.stderr.take().unwrap(), Arc::clone(&ta));

    assert!(
        wait_for(&ta, "busybox userland up", 180),
        "A: no userland;\n{}",
        ta.lock().unwrap()
    );
    assert!(
        wait_for(&ta, "~ # ", 30),
        "A: no shell;\n{}",
        ta.lock().unwrap()
    );

    // A completed request BEFORE the snapshot: a RAM marker file. Computed value so the echo of the
    // command can't satisfy the readback needle.
    send(&mut a_in, "echo persist_$((6*7)) > /tmp/marker.txt");
    send(&mut a_in, "sync"); // no-op for tmpfs but drives the virtio-blk FLUSH path on the scratch drive
    std::thread::sleep(Duration::from_secs(1));
    // Trigger — split so the typed command echo can't self-fire the watcher; only the executed
    // `echo` output prints the whole marker.
    send(&mut a_in, "echo WVSNAP_\"NOW\"");

    let code_a = wait_exit(&mut a.0, 120);
    drop(a_in);
    let _ = ar1.join();
    let _ = ar2.join();
    assert_eq!(
        code_a,
        Some(0),
        "A did not exit 0 after snapshot;\n{}",
        ta.lock().unwrap()
    );
    assert!(blob.exists(), "A did not write the snapshot blob");
    assert!(
        ta.lock().unwrap().contains("snapshot") && ta.lock().unwrap().contains("written to"),
        "A did not report the snapshot;\n{}",
        ta.lock().unwrap()
    );

    // --- Process B: resume the blob against the SAME kernel/initrd/drive, continue the guest. ---
    let mut b = Guest(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--initrd")
            .arg(&initrd)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--max-instrs", "30000000000"])
            .arg("--resume-from")
            .arg(&blob)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn B"),
    );
    let mut b_in = b.0.stdin.take().unwrap();
    let tb = Arc::new(Mutex::new(String::new()));
    let br1 = spawn_reader(b.0.stdout.take().unwrap(), Arc::clone(&tb));
    let br2 = spawn_reader(b.0.stderr.take().unwrap(), Arc::clone(&tb));

    assert!(
        wait_for(&tb, "resumed", 60),
        "B: never reported a resume;\n{}",
        tb.lock().unwrap()
    );

    // The resumed shell must be usable: a fresh, guest-computed command produces new output.
    send(&mut b_in, "\n"); // nudge the line editor to redraw a prompt after the resume
    std::thread::sleep(Duration::from_secs(1));
    send(&mut b_in, "echo RESUMED_$((3*3))");
    assert!(
        wait_for(&tb, "RESUMED_9", 90),
        "B: resumed shell did not run a fresh command;\n{}",
        tb.lock().unwrap()
    );
    // The pre-snapshot completed request survived — present, exactly once.
    send(&mut b_in, "cat /tmp/marker.txt");
    assert!(
        wait_for(&tb, "persist_42", 60),
        "B: pre-snapshot RAM marker lost across resume;\n{}",
        tb.lock().unwrap()
    );
    assert_eq!(
        tb.lock().unwrap().matches("persist_42").count(),
        1,
        "B: pre-snapshot marker duplicated (replayed) across resume;\n{}",
        tb.lock().unwrap()
    );

    let _ = b.0.kill();
    let _ = b.0.wait();
    drop(b_in);
    let _ = br1.join();
    let _ = br2.join();
    let _ = std::fs::remove_file(&img);
    let _ = std::fs::remove_file(&blob);
}

/// The E3-T12c4 capstone proof (boot-gated, run on `ssh dev`): a real Alpine ext4 boot that syncs,
/// snapshots, restores into a fresh process, continues, and powers off cleanly leaves the root
/// `fsck.ext4 -n` CLEAN, with the pre-snapshot completed request present exactly once post-restore.
#[test]
#[ignore = "full Alpine boot ×2 + fsck: ~18 min, run on ssh dev (release build + built rootfs)"]
fn alpine_sync_snapshot_restore_fsck_clean() {
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
    // Boot from a COPY so the pristine image stays clean and the run is repeatable.
    let img = std::env::temp_dir().join("wvsnap-alpine.ext4");
    std::fs::copy(&pristine, &img).expect("copy rootfs image");
    let blob = std::env::temp_dir().join("wvsnap-alpine.blob");
    let _ = std::fs::remove_file(&blob);

    // Log a guest into a working root shell (the E2-T19 login discipline).
    fn login(a_in: &mut std::process::ChildStdin, t: &Arc<Mutex<String>>) {
        assert!(
            wait_for(t, "login:", 1500),
            "never reached login;\n{}",
            t.lock().unwrap()
        );
        send(a_in, "root");
        std::thread::sleep(Duration::from_secs(3));
        send(a_in, ""); // dismiss an optional Password: prompt
        std::thread::sleep(Duration::from_secs(2));
        send(a_in, "echo WASMVM_LOGIN_\"OK\"");
        assert!(
            wait_for(t, "WASMVM_LOGIN_OK", 120),
            "no working shell;\n{}",
            t.lock().unwrap()
        );
    }

    // --- Process A: boot → login → pre-snapshot marker → sync → trigger snapshot → exit 0. ---
    let mut a = Guest(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
            .args(["--max-instrs", "120000000000"])
            .args(["--snapshot-trigger", TRIGGER])
            .arg("--snapshot-out")
            .arg(&blob)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn A"),
    );
    let mut a_in = a.0.stdin.take().unwrap();
    let ta = Arc::new(Mutex::new(String::new()));
    let ar1 = spawn_reader(a.0.stdout.take().unwrap(), Arc::clone(&ta));
    let ar2 = spawn_reader(a.0.stderr.take().unwrap(), Arc::clone(&ta));
    login(&mut a_in, &ta);

    // A DURABLE completed request before the snapshot: write a marker to the ext4 root and sync it
    // to the disk (so the --drive file matches the snapshotted page cache).
    send(
        &mut a_in,
        "echo persist_$((6*7)) > /root/marker.txt; echo MK_\"OK\"",
    );
    assert!(
        wait_for(&ta, "MK_OK", 60),
        "A: marker write did not complete;\n{}",
        ta.lock().unwrap()
    );
    send(&mut a_in, "sync; echo SY_\"OK\"");
    assert!(
        wait_for(&ta, "SY_OK", 60),
        "A: sync did not complete;\n{}",
        ta.lock().unwrap()
    );
    // Trigger the snapshot (split marker: only the executed echo prints the whole trigger).
    send(&mut a_in, "echo WVSNAP_\"NOW\"");

    let code_a = wait_exit(&mut a.0, 300);
    drop(a_in);
    let _ = ar1.join();
    let _ = ar2.join();
    assert_eq!(
        code_a,
        Some(0),
        "A did not exit 0 after snapshot;\n{}",
        ta.lock().unwrap()
    );
    assert!(blob.exists(), "A did not write the snapshot blob");

    // --- Process B: resume the blob against the SAME image → continue → poweroff cleanly. ---
    let mut b = Guest(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
            .args(["--max-instrs", "120000000000"])
            .arg("--resume-from")
            .arg(&blob)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn B"),
    );
    let mut b_in = b.0.stdin.take().unwrap();
    let tb = Arc::new(Mutex::new(String::new()));
    let br1 = spawn_reader(b.0.stdout.take().unwrap(), Arc::clone(&tb));
    let br2 = spawn_reader(b.0.stderr.take().unwrap(), Arc::clone(&tb));
    assert!(
        wait_for(&tb, "resumed", 120),
        "B: never reported a resume;\n{}",
        tb.lock().unwrap()
    );

    // The resumed shell is usable: nudge a prompt, run a FRESH guest-computed command.
    send(&mut b_in, "\n");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut b_in, "echo RESUMED_$((3*3)); echo RS_\"OK\"");
    assert!(
        wait_for(&tb, "RESUMED_9", 120),
        "B: resumed shell dead;\n{}",
        tb.lock().unwrap()
    );
    // The pre-snapshot completed request survived the snapshot→restore — present, exactly once.
    send(&mut b_in, "cat /root/marker.txt");
    assert!(
        wait_for(&tb, "persist_42", 60),
        "B: pre-snapshot marker lost;\n{}",
        tb.lock().unwrap()
    );
    assert_eq!(
        tb.lock().unwrap().matches("persist_42").count(),
        1,
        "B: pre-snapshot marker duplicated (replayed);\n{}",
        tb.lock().unwrap()
    );
    // Clean poweroff → OpenRC unmounts + syncs the ext4 root → the image is left cleanly unmounted.
    send(&mut b_in, "poweroff");
    let code_b = wait_exit(&mut b.0, 300);
    drop(b_in);
    let _ = br1.join();
    let _ = br2.join();
    assert_eq!(
        code_b,
        Some(0),
        "B did not power off cleanly;\n{}",
        tb.lock().unwrap()
    );

    // --- The proof: fsck.ext4 -n on the resulting image must be CLEAN. ---
    let fsck = Command::new("fsck.ext4")
        .args(["-f", "-n"])
        .arg(&img)
        .output()
        .expect("run fsck.ext4 (needs e2fsprogs on the host)");
    let fout = format!(
        "{}{}",
        String::from_utf8_lossy(&fsck.stdout),
        String::from_utf8_lossy(&fsck.stderr)
    );
    // `fsck -n` returns 0 when clean; bit 4 (exit 4) means "errors left uncorrected". Any non-zero
    // with the "-n" answer means the fs was dirty/inconsistent.
    assert!(
        fsck.status.success(),
        "fsck.ext4 -n was NOT clean (exit {:?}) after snapshot→restore→poweroff:\n{fout}",
        fsck.status.code()
    );
    eprintln!("fsck.ext4 -n clean:\n{fout}");
    let _ = std::fs::remove_file(&img);
    let _ = std::fs::remove_file(&blob);
}
