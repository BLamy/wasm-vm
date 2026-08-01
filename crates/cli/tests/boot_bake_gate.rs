//! E3.5-T05d RUN-gate: boot Alpine from the SERVED rootfs and prove every baked container in
//! `/opt/containers/<name>` actually RUNS in the interpreted guest via `wvrun run <bundle> -- <smoke>`
//! (not merely unpacks). Uses the proven boot_wvrun.rs harness (reader threads + polling `wait_for`,
//! kill-on-drop guard) — reliable in the interpreted guest where an interactive expect handshake is
//! not. Shells echo a computed marker; servers emit their own one-shot version banner. Each needle is
//! OUTPUT-ONLY (cannot appear in the echoed command), so a PASS means real guest output.
//!
//!   cargo test --release -p wasm-vm-cli --test boot_bake_gate -- --ignored --nocapture

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

fn spawn_reader<R: Read + Send + 'static>(mut r: R, t: Arc<Mutex<String>>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 512];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            t.lock().unwrap().push_str(&String::from_utf8_lossy(&chunk[..n]));
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
#[ignore = "full Alpine boot + wvrun of 4 baked bundles: ~20-30 min; needs the served rootfs + release build"]
fn baked_containers_run_in_guest() {
    let root = repo_root();
    let bin = root.join("target/release/wasm-vm");
    let kernel = root.join("releases/kernel/6.6.63/Image");
    let pristine = root.join("releases/rootfs/alpine-rootfs.ext4");
    for f in [&bin, &kernel, &pristine] {
        assert!(f.exists(), "missing {}", f.display());
    }
    let img = std::env::temp_dir().join(format!("wasm-vm-bakegate-{}.ext4", std::process::id()));
    std::fs::copy(&pristine, &img).expect("copy rootfs");

    let mut guard = KillOnDrop(Some(
        Command::new(&bin)
            .args(["boot", "--kernel"])
            .arg(&kernel)
            .arg("--drive")
            .arg(format!("file={}", img.display()))
            .args(["--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi"])
            .args(["--max-instrs", "120000000000"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn wasm-vm boot"),
    ));
    let child = guard.0.as_mut().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let transcript = Arc::new(Mutex::new(String::new()));
    let _r1 = spawn_reader(child.stdout.take().unwrap(), Arc::clone(&transcript));
    let _r2 = spawn_reader(child.stderr.take().unwrap(), Arc::clone(&transcript));
    let send = |stdin: &mut std::process::ChildStdin, line: &str| {
        writeln!(stdin, "{line}").expect("write to guest");
        stdin.flush().ok();
    };

    assert!(wait_for(&transcript, "login:", 2400), "no login; transcript:\n{}", transcript.lock().unwrap());
    send(&mut stdin, "root");
    std::thread::sleep(Duration::from_secs(3));
    send(&mut stdin, "");
    std::thread::sleep(Duration::from_secs(2));
    send(&mut stdin, "echo SHELL_\"UP\"");
    assert!(wait_for(&transcript, "SHELL_UP", 300), "no shell; transcript:\n{}", transcript.lock().unwrap());

    // (name, smoke command run via `wvrun run <bundle> -- <cmd>`, output-only needle).
    // Shells: computed marker (echoed cmd has $((6*7)), output has 42). Servers: version banner
    // (echoed cmd has "--version"/"version", output has the version string).
    let gates: &[(&str, &str, &str)] = &[
        ("alpine", "sh -c 'echo AL_$((6*7))'", "AL_42"),
        ("busybox", "sh -c 'echo BB_$((6*7))'", "BB_42"),
        ("redis", "redis-server --version", "Redis server v"),
        ("memcached", "memcached --version", "memcached 1."),
    ];
    let mut passed: Vec<&str> = vec![];
    let mut failed: Vec<&str> = vec![];
    for (name, cmd, needle) in gates {
        send(&mut stdin, &format!("wvrun run /opt/containers/{name} -- {cmd}"));
        let ok = wait_for(&transcript, needle, 600);
        println!("\nRESULT {name} {}", if ok { "PASS" } else { "FAIL" });
        if ok {
            passed.push(name);
        } else {
            failed.push(name);
        }
        // Barrier: ensure the shell returned before the next gate (output-only token).
        send(&mut stdin, &format!("echo GB_{name}_\"OK\""));
        wait_for(&transcript, &format!("GB_{name}_OK"), 180);
    }

    send(&mut stdin, "sync; poweroff");
    let _ = wait_for(&transcript, "reboot: Power down", 600);
    drop(stdin);

    println!("\nBAKE_GATE: {}/{} passed ({:?})", passed.len(), gates.len(), passed);
    assert!(failed.is_empty(), "baked images failed the RUN gate: {failed:?}\ntranscript tail:\n{}",
        {
            let t = transcript.lock().unwrap();
            t.chars().rev().take(2000).collect::<String>().chars().rev().collect::<String>()
        });
}
