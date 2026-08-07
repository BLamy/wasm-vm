//! wvseccomp — E3.5-T03 (AC6): install a runc-style seccomp filter, then exec the container argv.
//!
//! `wvrun` is POSIX shell and cannot install a BPF seccomp filter itself, so it wraps the container
//! exec: `exec wvseccomp -- <argv…>`. This helper installs a classic-BPF `SECCOMP_SET_MODE_FILTER`
//! program that returns `EPERM` for a small denylist of dangerous syscalls (mount/umount2/reboot/
//! kexec_load/swapon — the ones a container has no business calling, mirroring the deny-by-EPERM
//! shape of the runc default profile), allows everything else, and kills the process on the wrong
//! architecture. It then `execvp`s the argv, so the filter is inherited by the container process and
//! all its children — proving `SECCOMP_FILTER=y` is real on the emulator, not merely configured.
//!
//! Static musl riscv64 (built by tools/build-wvseccomp.sh, shipped into the rootfs). No allocation on
//! the hot path; failures are a clear message + nonzero exit (never a silent unfiltered exec).

use std::ffi::CString;

// riscv64 little-endian, 64-bit: EM_RISCV(243) | __AUDIT_ARCH_64BIT(0x80000000) | __AUDIT_ARCH_LE(0x40000000)
const AUDIT_ARCH_RISCV64: u32 = 0xC000_00F3;
const SECCOMP_SET_MODE_FILTER: u32 = 1;
const SECCOMP_RET_KILL_PROCESS: u32 = 0x8000_0000;
const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;

// asm-generic (riscv64) syscall numbers of the denylist.
const SYS_MOUNT: u32 = 40;
const SYS_UMOUNT2: u32 = 39;
const SYS_REBOOT: u32 = 142;
const SYS_KEXEC_LOAD: u32 = 104;
const SYS_SWAPON: u32 = 224;
// The new mount API (Linux 5.2+). busybox/util-linux mount may drive these instead of the classic
// mount(2), so denying mount(40) alone leaves a hole — block the whole family.
const SYS_OPEN_TREE: u32 = 428;
const SYS_MOVE_MOUNT: u32 = 429;
const SYS_FSOPEN: u32 = 430;
const SYS_FSCONFIG: u32 = 431;
const SYS_FSMOUNT: u32 = 432;
const DENY: &[u32] = &[
    SYS_MOUNT,
    SYS_UMOUNT2,
    SYS_REBOOT,
    SYS_KEXEC_LOAD,
    SYS_SWAPON,
    SYS_OPEN_TREE,
    SYS_MOVE_MOUNT,
    SYS_FSOPEN,
    SYS_FSCONFIG,
    SYS_FSMOUNT,
];

// Classic BPF instruction (linux/filter.h `struct sock_filter`).
#[repr(C)]
#[derive(Clone, Copy)]
struct SockFilter {
    code: u16,
    jt: u8,
    jf: u8,
    k: u32,
}
#[repr(C)]
struct SockFprog {
    len: u16,
    filter: *const SockFilter,
}

// BPF opcodes.
const BPF_LD: u16 = 0x00;
const BPF_W: u16 = 0x00;
const BPF_ABS: u16 = 0x20;
const BPF_JMP: u16 = 0x05;
const BPF_JEQ: u16 = 0x10;
const BPF_K: u16 = 0x00;
const BPF_RET: u16 = 0x06;

// `struct seccomp_data`: nr @0 (u32), arch @4 (u32).
const OFF_NR: u32 = 0;
const OFF_ARCH: u32 = 4;

fn stmt(code: u16, k: u32) -> SockFilter {
    SockFilter {
        code,
        jt: 0,
        jf: 0,
        k,
    }
}
fn jump(code: u16, k: u32, jt: u8, jf: u8) -> SockFilter {
    SockFilter { code, jt, jf, k }
}

fn build_program() -> Vec<SockFilter> {
    let mut p = Vec::new();
    // Load arch; if it is not riscv64, kill the process (a filter built for the wrong arch is unsafe).
    p.push(stmt(BPF_LD | BPF_W | BPF_ABS, OFF_ARCH));
    p.push(jump(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_RISCV64, 1, 0));
    p.push(stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
    // Load the syscall number.
    p.push(stmt(BPF_LD | BPF_W | BPF_ABS, OFF_NR));
    // For each denied nr: if it matches, jump to the EPERM return; else fall through.
    // The EPERM instruction is the very last one; ALLOW is second-to-last.
    let total = 4 + DENY.len() + 2; // loaded so far (4) + one JEQ per deny + ALLOW + EPERM
    let eperm_idx = total - 1;
    for (i, &nr) in DENY.iter().enumerate() {
        let here = 4 + i; // index of this JEQ
        let jt = (eperm_idx - here - 1) as u8; // instructions to skip to reach EPERM on a match
        p.push(jump(BPF_JMP | BPF_JEQ | BPF_K, nr, jt, 0));
    }
    p.push(stmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
    p.push(stmt(
        BPF_RET | BPF_K,
        SECCOMP_RET_ERRNO | (libc::EPERM as u32),
    ));
    p
}

fn fail(msg: &str) -> ! {
    eprintln!("wvseccomp: {msg}");
    std::process::exit(126);
}

fn install_filter() {
    // No-new-privs is REQUIRED before a non-privileged seccomp filter (and is good hygiene anyway).
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        fail("prctl(PR_SET_NO_NEW_PRIVS) failed");
    }
    let prog = build_program();
    let fprog = SockFprog {
        len: prog.len() as u16,
        filter: prog.as_ptr(),
    };
    // SECCOMP_SET_MODE_FILTER via the seccomp(2) syscall.
    let rc = unsafe {
        libc::syscall(
            libc::SYS_seccomp,
            SECCOMP_SET_MODE_FILTER as libc::c_long,
            0 as libc::c_long,
            &fprog as *const SockFprog as libc::c_long,
        )
    };
    if rc != 0 {
        fail("seccomp(SECCOMP_SET_MODE_FILTER) failed");
    }
}

// Prove the kernel actually ENFORCES the filter (not merely loads it): install it, then invoke the
// denied mount(2)=40 DIRECTLY via syscall() — no libc/busybox userspace precheck to mask the result.
// As root with NULL args an unfiltered mount(2) returns EINVAL/EFAULT; a filtered one returns EPERM.
fn selftest() -> ! {
    install_filter();
    let rc = unsafe { libc::syscall(SYS_MOUNT as libc::c_long, 0, 0, 0, 0, 0) };
    let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    // Emit both the raw errno and a verdict marker the boot test can grep unambiguously.
    println!("WVSCSELFTEST rc={rc} errno={err}");
    if err == libc::EPERM {
        println!("WVSCSELFTEST_ENFORCED");
    } else {
        println!("WVSCSELFTEST_BYPASSED");
    }
    std::process::exit(0);
}

fn main() {
    // argv: wvseccomp [--selftest] | [--] <program> [args…]
    let mut args = std::env::args_os().skip(1).peekable();
    if args.peek().map(|a| a == "--selftest").unwrap_or(false) {
        selftest();
    }
    if args.peek().map(|a| a == "--").unwrap_or(false) {
        args.next();
    }
    let argv: Vec<CString> = args
        .map(|a| {
            use std::os::unix::ffi::OsStrExt;
            CString::new(a.as_os_str().as_bytes()).unwrap_or_else(|_| fail("argv contains a NUL"))
        })
        .collect();
    if argv.is_empty() {
        fail("usage: wvseccomp [--] <program> [args…]");
    }

    install_filter();

    // Exec the container argv; the filter is preserved across execve and inherited by children.
    let mut ptrs: Vec<*const libc::c_char> = argv.iter().map(|c| c.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    unsafe { libc::execvp(argv[0].as_ptr(), ptrs.as_ptr()) };
    // execvp only returns on failure.
    fail("execvp failed (command not found in the container rootfs?)");
}
