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
        wait_for(&transcript, "login:", 2400),
        "no login; transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, "");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "echo SHELL_\"UP\"");
    assert!(
        wait_for(&transcript, "SHELL_UP", 300),
        "no shell; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // Build bundle #1: a busybox rootfs + argv that echoes an in-guest-computed marker AND writes a
    // file inside the container (to prove the write does NOT reach the bundle rootfs).
    // The `$((6*7))` stays LITERAL in the argv file (single-quoted printf), so the marker is
    // computed by the container's shell, not by the login shell echoing our command.
    for c in [
        "mkdir -p /tmp/b/rootfs/bin /tmp/b/rootfs/lib /tmp/b/config",
        "cp -a /bin/busybox /tmp/b/rootfs/bin/",
        // Alpine busybox is dynamically linked against the musl loader; without it, the post-pivot
        // exec fails with "not found" (missing ELF interpreter). Copy the loader into the bundle.
        "cp -aL /lib/ld-musl-riscv64.so.1 /tmp/b/rootfs/lib/",
        // busybox applet symlinks the container argv needs, resolving in the pivoted rootfs (a real
        // image ships these). Explicit list — this busybox build's `--install -s` is a no-op here.
        "for a in sh env touch echo cat ls hostname ps tail mkdir head mount dd; do ln -sf busybox /tmp/b/rootfs/bin/$a; done",
        "printf '/bin/sh\\n-c\\ntouch /ephemeral; echo CONTAINED_$((6*7))\\n' > /tmp/b/config/argv",
        "printf '/\\n' > /tmp/b/config/cwd",
        ": > /tmp/b/config/env",
        ": > /tmp/b/config/user",
        "wvrun /tmp/b",
    ] {
        send(&mut stdin, c);
    }
    assert!(
        wait_for(&transcript, "CONTAINED_42", 600),
        "wvrun did not run the container argv; transcript:\n{}",
        transcript.lock().unwrap()
    );
    // The container's write to `/ephemeral` must have landed in the overlay upper, NOT the bundle.
    send(
        &mut stdin,
        "test -e /tmp/b/rootfs/ephemeral && echo LEAKED_TO_\"IMAGE\" || echo IMAGE_\"CLEAN\"",
    );
    assert!(
        wait_for(&transcript, "IMAGE_CLEAN", 300),
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
        wait_for(&transcript, "WVRUN_RC=7", 300),
        "wvrun did not propagate the container exit code; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // AC2: inside the container, PID 1 is the entrypoint (fresh pid ns + mounted /proc) and the
    // hostname is the container's (UTS ns); the guest hostname is unaffected. Markers computed inside
    // the container so the tty echo can't fake them.
    for c in [
        "printf '/bin/sh\\n-c\\nhostname wvrun-ctr; echo INIT_$(cat /proc/1/comm)_$(hostname)_$([ -d /proc/1 ] && echo P)\\n' > /tmp/b/config/argv",
        "wvrun /tmp/b",
    ] {
        send(&mut stdin, c);
    }
    assert!(
        wait_for(&transcript, "INIT_sh_wvrun-ctr_P", 300),
        "container PID-1/proc/UTS shape wrong; transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "echo GUESTHOST_$(hostname)"); // guest UTS must NOT have changed
    assert!(
        wait_for(&transcript, "GUESTHOST_", 60)
            && !transcript.lock().unwrap().contains("GUESTHOST_wvrun-ctr"),
        "UTS leaked: the container hostname changed the guest; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // AC5: `--interactive` gives a real container shell over the terminal — typed input runs inside
    // the container and its exit code propagates as wvrun's.
    send(&mut stdin, "wvrun --interactive /tmp/b");
    std::thread::sleep(Duration::from_secs(5)); // let the container shell come up
    send(&mut stdin, "echo IACT_$((6*7))"); // computed by the CONTAINER's shell
    assert!(
        wait_for(&transcript, "IACT_42", 120),
        "interactive container shell did not run typed input; transcript:\n{}",
        transcript.lock().unwrap()
    );
    send(&mut stdin, "exit 5"); // leave the container; wvrun should exit 5
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "echo IACTRC=$?");
    assert!(
        wait_for(&transcript, "IACTRC=5", 120),
        "interactive exit code did not propagate; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // AC6: the runner installs a runc-style seccomp filter before exec — a denied syscall (mount)
    // returns EPERM inside the container. Marker computed in-guest (echo-proof).
    // First, a definitive enforcement probe: wvseccomp --selftest installs the filter then calls
    // mount(2)=40 DIRECTLY via syscall() (no busybox/libc userspace precheck to mask the result). As
    // root, an unfiltered mount(2) with NULL args returns EINVAL/EFAULT; a kernel-enforced filter
    // returns EPERM. This proves SECCOMP_FILTER enforcement is real on the emulator, independent of
    // which syscall busybox's `mount` applet happens to use.
    send(&mut stdin, "/usr/local/bin/wvseccomp --selftest");
    assert!(
        wait_for(&transcript, "WVSCSELFTEST_ENFORCED", 120)
            && !transcript.lock().unwrap().contains("WVSCSELFTEST_BYPASSED"),
        "seccomp filter is not enforced by the kernel on a direct mount(2) call; transcript:\n{}",
        transcript.lock().unwrap()
    );
    // The container detection uses ONLY shell builtins (case/read) — the minimal bundle has no `grep`
    // applet, and a missing grep would make a `| grep` pipeline exit 127 and spuriously print FAIL even
    // when mount WAS denied. `CTRSC=` surfaces the in-container seccomp mode; MOUNTOUT[] the raw error.
    for c in [
        "printf '/bin/sh\\n-c\\nmkdir /m 2>/dev/null; while read k v; do case \"$k\" in Seccomp:) echo CTRSC=$v;; esac; done < /proc/self/status; out=$(mount -t tmpfs tmpfs /m 2>&1); echo \"MOUNTOUT[$out]\"; case \"$out\" in *\"not permitted\"*|*denied*) echo SECCOMP_$((6*7))_OK;; *) echo SECCOMP_$((5+4))_BAD;; esac\\n' > /tmp/b/config/argv",
        "wvrun /tmp/b",
    ] {
        send(&mut stdin, c);
    }
    // Both markers are COMPUTED ($((…))) so the literal cannot appear in the printf command echo — a
    // plain-literal FAIL marker would match the echoed command text and spuriously fail the negative
    // check. SECCOMP_42_OK = mount(2) denied with EPERM inside the container; SECCOMP_9_BAD = allowed.
    assert!(
        wait_for(&transcript, "SECCOMP_42_OK", 300)
            && !transcript.lock().unwrap().contains("SECCOMP_9_BAD"),
        "seccomp filter did not deny mount(2) with EPERM inside the container; transcript:\n{}",
        transcript.lock().unwrap()
    );

    // AC4 (last, so it can't block the other checks): a memory-limited container that over-allocates
    // is OOM-killed (signal death, rc>=128); the guest and a subsequent wvrun are unaffected. dd asks
    // for a single 64 MiB ANONYMOUS buffer — far over the 16 MiB cap — so the memcg OOM-killer SIGKILLs
    // it (rc 137). Anonymous (not a tmpfs fill, which returns ENOMEM to the writer), single large alloc
    // (trips instantly, not byte-by-byte).
    for c in [
        "cp -a /tmp/b /tmp/oom",
        "printf '/bin/sh\\n-c\\ndd if=/dev/zero of=/dev/null bs=64M count=1 2>/dev/null\\n' > /tmp/oom/config/argv",
        "wvrun --memory 16777216 /tmp/oom; rc=$?; [ $rc -ge 128 ] && echo OOMKILLED_$rc || echo OOMSURVIVED_$rc",
    ] {
        send(&mut stdin, c);
    }
    assert!(
        wait_for(&transcript, "OOMKILLED_", 300)
            && !transcript.lock().unwrap().contains("OOMSURVIVED_"),
        "over-allocating container was not OOM-killed under --memory; transcript:\n{}",
        transcript.lock().unwrap()
    );
    // The runner still works after the OOM (bundle #2 exits 7).
    send(&mut stdin, "wvrun /tmp/b2; echo AFTEROOM_$?");
    assert!(
        wait_for(&transcript, "AFTEROOM_7", 300),
        "runner broken after an OOM-killed container; transcript:\n{}",
        transcript.lock().unwrap()
    );

    send(&mut stdin, "poweroff");
    let deadline = Instant::now() + Duration::from_secs(600);
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
