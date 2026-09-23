#!/usr/bin/env python3
"""Perf-overhaul native benchmark suite: HOST wall-clock numbers for one or more wasm-vm binaries.

Every number this script reports is measured on the host (time.monotonic_ns around the process or
around a console round-trip, plus the process's rusage CPU time). It never trusts the guest clock
for speed: under the default icount clock guest time is derived from retired instructions, so an
in-guest timer reads the same no matter how fast the host ran it.

    python3 tools/perf/bench_native.py --out OUTDIR --bin candidate=path/to/wasm-vm \
        [--bin baseline=path/to/other/wasm-vm] [--reps 3] [--alpine-reps 1] [--cases ...]

`tools/perf/bench-native.sh BIN OUTDIR [BASELINE_BIN]` is the stable entry point. With two
binaries every case runs A/B interleaved (the order flips each rep) so machine-load drift hits both
sides equally; the markdown table then carries a speedup column. See tools/perf/README.md.

Cases (all use the pinned RTC so the guest work is identical between binaries):
  busybox-legacy|fast|jit  boot to the busybox "userland up" marker (--profile-boot stops there)
  compute-fast|jit         busybox shell arithmetic loop, host-timed from Enter to a done marker
  alpine-fast|jit          Alpine ext4 disk boot to getty "login:" (fresh clone of the rootfs/run)
  microbench               crates/core perf_baseline (ALU/branch/memory/fp MIPS) built from the
                           checkout that owns each binary (skipped if that is not derivable)
  coremark-fast|jit        opt-in: CoreMark from bench/guest/bench.ext4 on the busybox guest

Stdlib only.
"""

import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import select
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

RTC_NS = os.environ.get("BENCH_FIXED_RTC_NS", "1790000000000000000")
FAST = ["--block-cache", "--interrupt-batching"]
MODE_FLAGS = {"legacy": [], "fast": FAST, "jit": ["--jit"]}
ALPINE_APPEND = "root=/dev/vda rw console=ttyS0 earlycon=sbi"
# Guest clock under the default icount model: mtime advances 1 tick per 10 retired instructions at
# a 10 MHz timebase, so one guest second of BUSY execution is 1e8 retired instructions. Used only
# to estimate the retired count of the compute region (cross-checked: a 20000-iteration loop
# retired 330.57M instructions by --stats differential vs 331M estimated). Never used for timing.
ICOUNT_INSTR_PER_GUEST_S = 1e8

ALL_CASES = [
    "busybox-legacy", "busybox-fast", "busybox-jit",
    "compute-fast", "compute-jit",
    "alpine-fast", "alpine-jit",
    "microbench",
]
OPTIONAL_CASES = ["coremark-fast", "coremark-jit", "compute-legacy"]


def log(msg):
    print(f"[bench-native {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def sha256_file(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_info(path):
    d = path if os.path.isdir(path) else os.path.dirname(path)
    try:
        top = subprocess.check_output(["git", "-C", d, "rev-parse", "--show-toplevel"],
                                      text=True, stderr=subprocess.DEVNULL).strip()
        rev = subprocess.check_output(["git", "-C", top, "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.run(["git", "-C", top, "diff", "--quiet", "HEAD", "--", "crates", "Cargo.toml",
                                "Cargo.lock"], stderr=subprocess.DEVNULL).returncode != 0
        branch = subprocess.check_output(["git", "-C", top, "rev-parse", "--abbrev-ref", "HEAD"],
                                         text=True).strip()
        return {"checkout": top, "rev": rev, "branch": branch, "crates_dirty": dirty}
    except Exception:
        return {"checkout": None, "rev": None, "branch": None, "crates_dirty": None}


def checkout_of_bin(bin_path):
    # <checkout>/target/<profile>/wasm-vm  ->  <checkout>
    p = os.path.realpath(bin_path)
    cand = os.path.dirname(os.path.dirname(os.path.dirname(p)))
    if os.path.isfile(os.path.join(cand, "Cargo.toml")) and os.path.isdir(os.path.join(cand, "crates", "core")):
        return cand
    return None


def find_releases(explicit, bins):
    """Kernel + initramfs are tracked in every checkout; the Alpine rootfs is gitignored and lives
    only in a checkout that built/fetched it. Resolve each asset independently."""
    roots = []
    if explicit:
        roots.append(explicit)
    roots.append(os.path.join(REPO, "releases"))
    for _, b in bins:
        c = checkout_of_bin(b)
        if c:
            roots.append(os.path.join(c, "releases"))

    def first(rel):
        for r in roots:
            p = os.path.join(r, rel)
            if os.path.isfile(p):
                return os.path.realpath(p)
        return None

    return {
        "kernel": first("kernel/6.6.63/Image"),
        "initrd": first("initramfs/initramfs.cpio.gz"),
        "alpine": first("rootfs/alpine-rootfs.ext4"),
        "search": roots,
    }


def clone_file(src, dst):
    # APFS clonefile: instant, and the Alpine boot mounts the image read-write so every run needs a
    # pristine copy. Fall back to a real copy elsewhere.
    if subprocess.run(["cp", "-c", src, dst], stderr=subprocess.DEVNULL).returncode != 0:
        shutil.copyfile(src, dst)


def _make_cpu_reader():
    """Return f(pid) -> cumulative user+sys CPU seconds of a LIVE process, or None if unsupported.
    macOS: libproc proc_pid_rusage (ticks in mach timebase units); Linux: /proc/PID/stat."""
    if sys.platform == "darwin":
        try:
            import ctypes

            libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
            libc = ctypes.CDLL("/usr/lib/libSystem.dylib")

            class Timebase(ctypes.Structure):
                _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]

            class RusageInfoV0(ctypes.Structure):
                _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in (
                    "user", "system", "pkg_idle_wkups", "interrupt_wkups", "pageins", "wired_size",
                    "resident_size", "phys_footprint", "proc_start_abstime", "proc_exit_abstime")]

            tb = Timebase()
            libc.mach_timebase_info(ctypes.byref(tb))
            scale = tb.numer / tb.denom / 1e9

            def read(pid):
                ri = RusageInfoV0()
                if libproc.proc_pid_rusage(pid, 0, ctypes.byref(ri)) != 0:
                    return None
                return (ri.user + ri.system) * scale

            return read
        except OSError:
            return lambda pid: None
    tck = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100

    def read_linux(pid):
        try:
            fields = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
            return (int(fields[11]) + int(fields[12])) / tck
        except (OSError, IndexError, ValueError):
            return None

    return read_linux


proc_cpu_s = _make_cpu_reader()


def reap(proc, block=False):
    """Non-blocking (or blocking) wait4 that records the per-process rusage on the Popen object.
    Every exit check goes through here — Popen.poll() would reap the child and lose its rusage."""
    if getattr(proc, "_ru", None) is not None:
        return True
    pid, status, ru = os.wait4(proc.pid, 0 if block else os.WNOHANG)
    if pid != proc.pid:
        return False
    proc.returncode = os.waitstatus_to_exitcode(status)
    proc._ru = ru
    return True


def wait_rusage(proc, timeout):
    """Wait for proc and return (returncode, user_s, sys_s) — per-process CPU time via wait4.
    A process still running at the deadline is killed and reported with returncode None."""
    deadline = time.monotonic() + timeout
    killed = False
    while not reap(proc):
        if time.monotonic() > deadline:
            proc.kill()
            reap(proc, block=True)
            killed = True
            break
        time.sleep(0.02)
    ru = proc._ru
    return (None if killed else proc.returncode), ru.ru_utime, ru.ru_stime


def drain_to_file(proc, stdout_path, stderr_path, timeout, t0):
    """Run a no-input process to completion streaming stdout/stderr to files; return wall ns since
    t0 (taken just before spawn), exit code, cpu. Streams (not communicate) so a chatty guest can't
    block on a full pipe."""
    fds = {proc.stdout.fileno(): open(stdout_path, "wb"), proc.stderr.fileno(): open(stderr_path, "wb")}
    deadline = time.monotonic() + timeout
    try:
        while fds and time.monotonic() < deadline:
            r, _, _ = select.select(list(fds), [], [], 0.5)
            for fd in r:
                chunk = os.read(fd, 1 << 16)
                if not chunk:
                    fds.pop(fd).close()
                else:
                    fds[fd].write(chunk)
    finally:
        for f in fds.values():
            f.close()
    code, ut, st = wait_rusage(proc, max(1.0, deadline - time.monotonic()))
    wall_ns = time.monotonic_ns() - t0
    return wall_ns, code, ut, st


def parse_profile(err_text):
    m = re.search(r"PROFILE_JSON\s+(\{.*\})", err_text)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def parse_jit(err_text):
    m = re.search(r"jit_active=(\S+)\s+blocks_compiled=(\d+)\s+blocks_executed=(\d+)\s+retired_via_jit=(\d+)",
                  err_text)
    if not m:
        return None
    return {"active": m.group(1) == "true", "blocks_compiled": int(m.group(2)),
            "blocks_executed": int(m.group(3)), "retired_via_jit": int(m.group(4))}


class Runner:
    def __init__(self, args, bins, rel, outdir):
        self.args = args
        self.bins = bins  # [(label, path)]
        self.rel = rel
        self.out = outdir
        self.logs = os.path.join(outdir, "logs")
        os.makedirs(self.logs, exist_ok=True)
        self.tmp = tempfile.mkdtemp(prefix="bench-native-", dir=args.tmpdir)

    # ---- one-shot boot cases (--profile-boot, --no-input) ------------------------------------
    def boot_case(self, case, label, binp, rep):
        kind, mode = case.split("-", 1)
        tag = f"{case}.{label}.{rep}"
        cmd = [binp, "boot", "--kernel", self.rel["kernel"], "--no-input", "--fixed-rtc-ns", RTC_NS]
        clone = None
        if kind == "busybox":
            cmd += ["--initrd", self.rel["initrd"]]
            timeout = self.args.boot_timeout
        else:  # alpine
            clone = os.path.join(self.tmp, f"{tag}.ext4")
            clone_file(self.rel["alpine"], clone)
            cmd += ["--drive", f"file={clone}", "--append", ALPINE_APPEND, "--ram-mib", "256",
                    "--max-instrs", "20000000000"]
            timeout = self.args.alpine_timeout
        cmd += MODE_FLAGS[mode] + ["--profile-boot"]
        la0 = os.getloadavg()[0]
        t0 = time.monotonic_ns()
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        wall_ns, code, ut, st = drain_to_file(proc, os.path.join(self.logs, tag + ".out"),
                                              os.path.join(self.logs, tag + ".err"), timeout, t0)
        if clone:
            os.unlink(clone)
        err = open(os.path.join(self.logs, tag + ".err"), errors="replace").read()
        prof = parse_profile(err)
        rec = {"case": case, "label": label, "rep": rep, "exit": code, "wall_s": wall_ns / 1e9,
               "cpu_s": ut + st, "loadavg_1m": la0, "cmd": cmd}
        if prof:
            rec.update({"profile_total_ms": prof.get("total_ms"), "retired": prof.get("total_retired"),
                        "mips": prof.get("overall_mips"), "phases": prof.get("phases")})
        want = "busybox-userland" if kind == "busybox" else "getty-login"
        rec["ok"] = bool(code == 0 and prof and any(p.get("phase") == want for p in prof.get("phases", [])))
        jit = parse_jit(err)
        if jit:
            rec["jit"] = jit
            if rec.get("retired"):
                rec["jit_retired_fraction"] = jit["retired_via_jit"] / rec["retired"]
        return rec

    # ---- interactive busybox cases (host-timed console round trip) ---------------------------
    def interactive(self, case, label, binp, rep, command, done_re, drive=None, timeout=None):
        mode = case.split("-", 1)[1]
        tag = f"{case}.{label}.{rep}"
        cmd = [binp, "boot", "--kernel", self.rel["kernel"], "--initrd", self.rel["initrd"],
               "--fixed-rtc-ns", RTC_NS, "--max-instrs", "200000000000"] + MODE_FLAGS[mode]
        if drive:
            cmd += ["--drive", drive]
        la0 = os.getloadavg()[0]
        t_start = time.monotonic_ns()
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        outf = open(os.path.join(self.logs, tag + ".out"), "wb")
        errf = open(os.path.join(self.logs, tag + ".err"), "wb")
        buf = bytearray()
        rec = {"case": case, "label": label, "rep": rep, "loadavg_1m": la0, "cmd": cmd, "ok": False}
        timeout = timeout or self.args.compute_timeout

        open_fds = [proc.stdout, proc.stderr]

        def pump(wait_s):
            """Read whatever is ready; returns True if any bytes arrived (False at EOF/idle)."""
            if not open_fds:
                time.sleep(wait_s)
                return False
            r, _, _ = select.select(open_fds, [], [], wait_s)
            got = False
            for f in r:
                chunk = os.read(f.fileno(), 1 << 16)
                if not chunk:
                    open_fds.remove(f)
                    continue
                got = True
                if f is proc.stdout:
                    outf.write(chunk)
                    buf.extend(chunk)
                else:
                    errf.write(chunk)
            return got

        def expect(rx, limit):
            nonlocal buf
            pat = re.compile(rx)
            deadline = time.monotonic() + limit
            while True:
                m = pat.search(bytes(buf))  # bytes: a match on a bytearray reads it lazily
                if m:
                    before = bytes(buf[:m.end()])
                    del buf[:m.end()]
                    return m, before
                if time.monotonic() > deadline or reap(proc):
                    raise TimeoutError(f"no /{rx}/ within {limit}s (exit={proc.returncode})")
                pump(0.05)

        try:
            expect(rb"userland up", self.args.boot_timeout)
            expect(rb"# $", 120)
            rec["boot_to_prompt_s"] = (time.monotonic_ns() - t_start) / 1e9
            # Type the command WITHOUT its newline and let the echo settle, so the timed region is
            # Enter -> completion marker (not host->UART typing latency).
            proc.stdin.write(command.encode())
            proc.stdin.flush()
            # The tty wraps long lines with CR/CRLF, so look for the echoed tail with those removed.
            tail = command[-16:].encode()
            echo_deadline = time.monotonic() + 15
            while tail not in bytes(buf).replace(b"\r", b"").replace(b"\n", b""):
                if time.monotonic() > echo_deadline or reap(proc):
                    break
                pump(0.05)
            settle = time.monotonic() + 0.3
            while time.monotonic() < settle:
                pump(0.05)
            buf.clear()
            la1 = os.getloadavg()[0]
            cpu0 = proc_cpu_s(proc.pid)
            t0 = time.monotonic_ns()
            proc.stdin.write(b"\n")
            proc.stdin.flush()
            m, before = expect(done_re, timeout)
            t1 = time.monotonic_ns()
            cpu1 = proc_cpu_s(proc.pid)
            rec["region_s"] = (t1 - t0) / 1e9
            if cpu0 is not None and cpu1 is not None:
                # CPU the emulator burned inside the region: robust to being descheduled on a busy box.
                rec["region_cpu_s"] = cpu1 - cpu0
            rec["loadavg_1m_region"] = la1
            rec["match"] = [g.decode(errors="replace") for g in m.groups()]
            rec["region_output"] = before.decode(errors="replace")[-4000:]
            rec["ok"] = True
            proc.stdin.write(b"poweroff -f\n")
            proc.stdin.flush()
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass
        except (TimeoutError, BrokenPipeError) as e:
            rec["error"] = str(e)
        finally:
            end = time.monotonic() + 60
            while not reap(proc) and time.monotonic() < end:
                pump(0.1)
            while pump(0):
                pass
            code, ut, st = wait_rusage(proc, 5)
            rec["exit"] = code
            rec["cpu_s_process"] = ut + st
            outf.close()
            errf.close()
        return rec

    def compute_case(self, case, label, binp, rep):
        n = self.args.compute_iters
        nonce = os.urandom(4).hex()
        # `[` and $((..)) are ash builtins: no fork/exec, so this is pure guest user-mode work plus
        # timer interrupts. /proc/uptime brackets give the icount-derived retired estimate.
        command = (f"read a b </proc/uptime; i=0; while [ $i -lt {n} ]; do i=$((i+1)); done; "
                   f"read c d </proc/uptime; echo BENCH\"\"DONE{nonce} $i $a $c")
        rec = self.interactive(case, label, binp, rep, command,
                               rb"BENCHDONE" + nonce.encode() + rb" (\d+) ([0-9.]+) ([0-9.]+)")
        if rec.get("ok"):
            i, a, c = rec["match"]
            rec["ok"] = int(i) == n
            g = float(c) - float(a)
            rec["guest_region_s"] = g
            rec["retired_est"] = int(g * ICOUNT_INSTR_PER_GUEST_S)
            rec["mips_est"] = g * ICOUNT_INSTR_PER_GUEST_S / 1e6 / rec["region_s"] if rec["region_s"] else None
            rec["iterations"] = n
        rec.pop("region_output", None)
        return rec

    def coremark_case(self, case, label, binp, rep):
        img = self.args.coremark_image
        nonce = os.urandom(4).hex()
        command = ("mkdir -p /mnt && mount -o ro /dev/vda /mnt && /mnt/bench/coremark.rv64; "
                   f"echo BENCH\"\"DONE{nonce} $?")
        rec = self.interactive(case, label, binp, rep, command,
                               rb"BENCHDONE" + nonce.encode() + rb" (\d+)", drive=f"file={img},ro",
                               timeout=self.args.coremark_timeout)
        text = rec.pop("region_output", "")
        if rec.get("ok"):
            ok = "Correct operation validated" in text and re.search(r"seedcrc\s*:\s*0xe9f5", text)
            tot = re.search(r"Total time \(secs\)\s*:\s*([0-9.]+)", text)
            its = re.search(r"Iterations/Sec\s*:\s*([0-9.]+)", text)
            rec["ok"] = bool(ok and tot)
            if tot:
                g = float(tot.group(1))
                rec["guest_total_s"] = g
                rec["guest_iter_per_s"] = float(its.group(1)) if its else None
                rec["mips_est"] = g * ICOUNT_INSTR_PER_GUEST_S / 1e6 / rec["region_s"]
        return rec

    # ---- microbench (cargo test in the owning checkout) --------------------------------------
    def microbench_prepare(self, label, binp):
        co = checkout_of_bin(binp)
        if not co:
            return {"skipped": f"cannot derive a checkout from {binp}"}
        env = dict(os.environ)
        env["CARGO_TARGET_DIR"] = os.path.join(co, "target")
        cmd = ["cargo", "test", "--manifest-path", os.path.join(co, "Cargo.toml"), "-p", "wasm-vm-core",
               "--release", "--test", "perf_baseline", "--no-run", "--message-format=json"]
        log(f"microbench: building perf_baseline in {co} (not timed)")
        p = subprocess.run(cmd, env=env, capture_output=True, text=True)
        exe = None
        for line in p.stdout.splitlines():
            try:
                j = json.loads(line)
            except json.JSONDecodeError:
                continue
            if j.get("reason") == "compiler-artifact" and j.get("target", {}).get("name") == "perf_baseline" \
                    and j.get("executable"):
                exe = j["executable"]
        if p.returncode != 0 or not exe:
            return {"skipped": f"perf_baseline build failed in {co}: {p.stderr[-2000:]}"}
        return {"exe": exe, "checkout": co}

    def microbench_case(self, label, prep, rep):
        rec = {"case": "microbench", "label": label, "rep": rep, "loadavg_1m": os.getloadavg()[0]}
        if "skipped" in prep:
            rec.update(ok=False, skipped=prep["skipped"])
            return rec
        cmd = [prep["exe"], "--ignored", "--nocapture", "--test-threads=1", "--exact",
               "report", "perf_fast_interpreter_does_not_trail_legacy"]
        t0 = time.monotonic_ns()
        p = subprocess.run(cmd, capture_output=True, text=True, cwd=os.path.join(prep["checkout"], "crates", "core"))
        rec["wall_s"] = (time.monotonic_ns() - t0) / 1e9
        text = p.stdout + p.stderr
        open(os.path.join(self.logs, f"microbench.{label}.{rep}.log"), "w").write(text)
        rows = {}
        for m in re.finditer(r"^\|\s*(alu|branch|memory|fp)\s*\|\s*([0-9.]+)\s*\|", text, re.M):
            rows[m.group(1)] = float(m.group(2))
        fm = re.search(r"fast-interpreter: legacy=([0-9.]+) MIPS fast=([0-9.]+) MIPS", text)
        rec["legacy_mips"] = rows
        if fm:
            rec["alu_fast_mips"] = float(fm.group(2))
            rec["alu_legacy_mips_paired"] = float(fm.group(1))
        rec["ok"] = bool(rows)
        rec["exit"] = p.returncode
        return rec


def median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def summarize(records, labels):
    """Per (case, label): medians of the headline metrics + raw sample lists."""
    out = {}
    for r in records:
        if r.get("discarded"):
            continue
        key = (r["case"], r["label"])
        out.setdefault(key, []).append(r)
    summary = {}
    for (case, label), rs in out.items():
        good = [r for r in rs if r.get("ok")]
        s = {"samples": len(rs), "ok": len(good)}

        def col(k):
            return [r.get(k) for r in good if r.get(k) is not None]

        if case.startswith(("busybox-", "alpine-")):
            s["wall_s"] = median(col("wall_s"))
            s["cpu_s"] = median(col("cpu_s"))
            s["mips"] = median(col("mips"))
            s["retired"] = sorted(set(col("retired")))
            s["wall_s_all"] = col("wall_s")
            s["jit_retired_fraction"] = median(col("jit_retired_fraction"))
        elif case.startswith(("compute-", "coremark-")):
            s["region_s"] = median(col("region_s"))
            s["region_cpu_s"] = median(col("region_cpu_s"))
            s["mips_est"] = median(col("mips_est"))
            s["boot_to_prompt_s"] = median(col("boot_to_prompt_s"))
            s["region_s_all"] = col("region_s")
            s["retired_est"] = median(col("retired_est"))
        elif case == "microbench":
            for w in ("alu", "branch", "memory", "fp"):
                s[f"legacy_{w}_mips"] = median([r["legacy_mips"].get(w) for r in good if r.get("legacy_mips")])
            s["alu_fast_mips"] = median(col("alu_fast_mips"))
        s["loadavg_1m"] = median(col("loadavg_1m")) if good else median([r.get("loadavg_1m") for r in rs])
        # Per-rep values of the headline metrics, for paired (same-rep, adjacent-in-time) ratios.
        s["by_rep"] = {str(r["rep"]): {k: r.get(k) for k in ("wall_s", "cpu_s", "mips", "region_s", "region_cpu_s", "mips_est")
                                       if r.get(k) is not None} for r in good}
        summary.setdefault(case, {})[label] = s
    return summary


def fmt(v, nd=2):
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:.{nd}f}"
    return str(v)


def markdown(summary, labels, meta):
    base = labels[0]
    others = labels[1:]
    lines = []
    lines.append(f"# Native benchmark ({meta['date']})\n")
    lines.append(f"Host: {meta['host']['machine']} · {meta['host']['cpu']} · reps={meta['reps']} "
                 f"(alpine reps={meta['alpine_reps']}) · medians · interleaved={len(labels) > 1}\n")
    for lab in labels:
        b = meta["bins"][lab]
        lines.append(f"- **{lab}**: `{b['path']}` rev `{(b['git'].get('rev') or '?')[:10]}`"
                     f"{' (+uncommitted crate changes)' if b['git'].get('crates_dirty') else ''} sha256 `{b['sha256'][:12]}`")
    lines.append("")

    def row(name, metric, key, better, nd=2):
        per = summary.get(name, {})
        vals = [per.get(lab, {}).get(key) for lab in labels]
        cells = []
        for lab, v in zip(labels, vals):
            reps = [x.get(key) for x in per.get(lab, {}).get("by_rep", {}).values() if x.get(key) is not None]
            rng = f" [{min(reps):.{nd}f}–{max(reps):.{nd}f}]" if len(reps) > 1 else ""
            cells.append(fmt(v, nd) + rng)
        extra = []
        for i, lab in enumerate(others, start=1):
            a, b = vals[0], vals[i]
            if a and b:
                ratio = (a / b) if better == "lower" else (b / a)
                # Paired: median over reps of the same-rep ratio (the two runs were adjacent in time).
                ra = per.get(base, {}).get("by_rep", {})
                rb = per.get(lab, {}).get("by_rep", {})
                pr = [(ra[k][key] / rb[k][key]) if better == "lower" else (rb[k][key] / ra[k][key])
                      for k in ra if k in rb and ra[k].get(key) and rb[k].get(key)]
                paired = f" (paired {median(pr):.2f}x)" if len(pr) > 1 else ""
                extra.append(f"{ratio:.2f}x{paired}")
            else:
                extra.append("–")
        oks = " · ".join(f"{summary.get(name, {}).get(lab, {}).get('ok', 0)}/{summary.get(name, {}).get(lab, {}).get('samples', 0)}"
                         for lab in labels)
        return f"| {name} | {metric} | " + " | ".join(cells + extra) + f" | {oks} |"

    head = "| case | metric | " + " | ".join(labels) + "".join(f" | speedup {o} vs {base}" for o in others) + " | ok |"
    sep = "|---|---|" + "---:|" * len(labels) + "---:|" * len(others) + "---:|"
    lines += [head, sep]
    for name in ["busybox-legacy", "busybox-fast", "busybox-jit", "alpine-fast", "alpine-jit"]:
        if name in summary:
            lines.append(row(name, "wall s", "wall_s", "lower"))
            lines.append(row(name, "MIPS (profile)", "mips", "higher", 1))
            lines.append(row(name, "cpu s", "cpu_s", "lower"))
            if name.endswith("jit"):
                lines.append(row(name, "JIT-retired fraction", "jit_retired_fraction", "higher", 3))
    for name in ["compute-legacy", "compute-fast", "compute-jit", "coremark-fast", "coremark-jit"]:
        if name in summary:
            lines.append(row(name, "region wall s", "region_s", "lower"))
            lines.append(row(name, "region cpu s", "region_cpu_s", "lower"))
            lines.append(row(name, "MIPS (icount est.)", "mips_est", "higher", 1))
    if "microbench" in summary:
        for w in ("alu", "branch", "memory", "fp"):
            lines.append(row("microbench", f"{w} MIPS (legacy)", f"legacy_{w}_mips", "higher", 1))
        lines.append(row("microbench", "alu MIPS (fast)", "alu_fast_mips", "higher", 1))
    lines.append("")
    # Determinism cross-check: the same case must retire the same instruction count on every binary.
    notes = []
    for name, per in summary.items():
        rs = {lab: tuple(per[lab].get("retired") or []) for lab in per if per[lab].get("retired")}
        if len(set(rs.values())) > 1:
            notes.append(f"- WARNING {name}: retired-at-marker differs between binaries {rs} "
                         "(guest-visible divergence or a profiler-quantum change)")
        for lab, v in rs.items():
            if len(v) > 1:
                notes.append(f"- WARNING {name}/{lab}: retired-at-marker varies across reps {v}")
    if notes:
        lines.append("Determinism notes:\n")
        lines += notes
        lines.append("")
    lines.append("Median 1-minute load average during the runs: " + ", ".join(
        f"{c}/{lab}={fmt(per[lab].get('loadavg_1m'), 1)}" for c, per in summary.items() for lab in per) + "\n")
    lines.append("Cells: median [min–max over reps]. Speedup = ratio of medians; 'paired' = median of the "
                 "per-rep ratios (each A/B pair ran back to back).\n")
    lines.append("wall s = host wall-clock of the whole process; cpu s = its user+sys rusage; MIPS (profile) = "
                 "retired-at-marker / profiled wall; region wall s = host time from Enter to the done marker; "
                 "region cpu s = emulator user+sys CPU inside that region; "
                 "MIPS (icount est.) = guest-uptime delta x 1e8 / region wall (guest time is used only as an "
                 "instruction counter, never as a clock).\n")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bin", action="append", required=True, help="LABEL=PATH (repeat; first is the baseline)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--releases", default=os.environ.get("RELEASES"))
    ap.add_argument("--reps", type=int, default=int(os.environ.get("REPS", "3")))
    ap.add_argument("--alpine-reps", type=int, default=int(os.environ.get("ALPINE_REPS", "1")))
    ap.add_argument("--micro-reps", type=int, default=int(os.environ.get("MICRO_REPS", "3")),
                    help="perf_baseline runs per binary (each run is already a 5-sample median)")
    ap.add_argument("--cases", default=os.environ.get("CASES", ",".join(ALL_CASES)),
                    help="comma list; add coremark-fast,coremark-jit,compute-legacy to opt in")
    ap.add_argument("--compute-iters", type=int, default=int(os.environ.get("COMPUTE_ITERS", "10000")))
    ap.add_argument("--coremark-image", default=os.path.join(REPO, "bench", "guest", "bench.ext4"))
    ap.add_argument("--tmpdir", default=os.environ.get("TMPDIR"))
    ap.add_argument("--boot-timeout", type=float, default=900)
    ap.add_argument("--alpine-timeout", type=float, default=2400)
    ap.add_argument("--compute-timeout", type=float, default=900)
    ap.add_argument("--coremark-timeout", type=float, default=1800)
    args = ap.parse_args()

    bins = []
    for spec in args.bin:
        if "=" in spec:
            lab, p = spec.split("=", 1)
        else:
            lab, p = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(spec))))), spec
        p = os.path.abspath(p)
        if not os.access(p, os.X_OK):
            sys.exit(f"bench-native: not an executable: {p}")
        bins.append((lab, p))
    labels = [l for l, _ in bins]
    if len(set(labels)) != len(labels):
        sys.exit("bench-native: duplicate labels")
    cases = [c.strip() for c in args.cases.split(",") if c.strip()]
    for c in cases:
        if c not in ALL_CASES + OPTIONAL_CASES:
            sys.exit(f"bench-native: unknown case {c}")
    rel = find_releases(args.releases, bins)
    if not rel["kernel"] or not rel["initrd"]:
        sys.exit(f"bench-native: kernel/initramfs not found under {rel['search']}")
    if not rel["alpine"]:
        skipped = [c for c in cases if c.startswith("alpine-")]
        if skipped:
            log(f"no rootfs/alpine-rootfs.ext4 under {rel['search']} — skipping {skipped} (set RELEASES)")
        cases = [c for c in cases if not c.startswith("alpine-")]
    if any(c.startswith("coremark") for c in cases) and not os.path.isfile(args.coremark_image):
        log(f"no CoreMark overlay at {args.coremark_image} — skipping coremark cases")
        cases = [c for c in cases if not c.startswith("coremark")]

    os.makedirs(args.out, exist_ok=True)
    runner = Runner(args, bins, rel, args.out)
    meta = {
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "host": {"machine": platform.machine(), "node": platform.node(), "system": platform.platform(),
                 "cpu": subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True,
                                       text=True).stdout.strip() or platform.processor(),
                 "ncpu": os.cpu_count()},
        "reps": args.reps, "alpine_reps": args.alpine_reps, "micro_reps": args.micro_reps, "cases": cases, "rtc_ns": RTC_NS,
        "compute_iters": args.compute_iters,
        "releases": {k: v for k, v in rel.items() if k != "search"},
        "bins": {lab: {"path": p, "sha256": sha256_file(p), "git": git_info(p)} for lab, p in bins},
        "harness_rev": git_info(HERE).get("rev"),
    }
    records = []
    results_path = os.path.join(args.out, "native.json")

    def save():
        summary = summarize(records, labels)
        with open(results_path, "w") as f:
            json.dump({"meta": meta, "summary": summary, "records": records}, f, indent=2)
        with open(os.path.join(args.out, "native.md"), "w") as f:
            f.write(markdown(summary, labels, meta))
        return summary

    t_suite = time.monotonic()
    micro = {}
    if "microbench" in cases:
        for lab, p in bins:
            micro[lab] = runner.microbench_prepare(lab, p)

    def order(rep):
        return bins if rep % 2 == 0 else list(reversed(bins))

    def run_once(case, lab, p, rep):
        if case.startswith(("busybox-", "alpine-")):
            return runner.boot_case(case, lab, p, rep)
        if case.startswith("compute-"):
            return runner.compute_case(case, lab, p, rep)
        if case.startswith("coremark-"):
            return runner.coremark_case(case, lab, p, rep)
        return runner.microbench_case(lab, micro[lab], rep)

    def run(case, lab, p, rep):
        t = time.monotonic()
        rec = run_once(case, lab, p, rep)
        # A sample whose emulator died from a signal (e.g. a stray `pkill wasm-vm` from another job
        # on a shared box) is an environment casualty, not a measurement: keep it on record as
        # discarded and retry once.
        if not rec.get("ok") and isinstance(rec.get("exit"), int) and rec["exit"] < 0:
            log(f"{case} {lab} rep {rep}: emulator killed by signal {-rec['exit']} — retrying once")
            rec["discarded"] = "killed by signal; retried"
            records.append(rec)
            rec = run_once(case, lab, p, rep)
            rec["retry"] = True
        records.append(rec)
        headline = rec.get("wall_s") if "wall_s" in rec else rec.get("region_s")
        log(f"{case:<15} {lab:<12} rep {rep}: {fmt(headline)} s"
            f"{' mips=' + fmt(rec.get('mips') or rec.get('mips_est'), 1) if (rec.get('mips') or rec.get('mips_est')) else ''}"
            f" ok={rec.get('ok')} ({time.monotonic() - t:.0f}s)")
        save()

    quick = [c for c in cases if not c.startswith(("alpine-", "coremark-")) and c != "microbench"]
    slow = [c for c in cases if c.startswith(("alpine-", "coremark-"))]
    for rep in range(args.reps):
        for case in quick:
            for lab, p in order(rep):
                run(case, lab, p, rep)
    if "microbench" in cases:
        for rep in range(args.micro_reps):
            for lab, p in order(rep):
                run("microbench", lab, p, rep)
    for rep in range(args.alpine_reps):
        for case in slow:
            for lab, p in order(rep):
                run(case, lab, p, rep)
    meta["suite_wall_s"] = time.monotonic() - t_suite
    save()
    shutil.rmtree(runner.tmp, ignore_errors=True)
    sys.stdout.write(open(os.path.join(args.out, "native.md")).read())
    bad = [r for r in records if not r.get("ok") and not r.get("skipped") and not r.get("discarded")]
    if bad:
        log(f"{len(bad)} sample(s) failed: " + ", ".join(f"{r['case']}/{r['label']}/{r['rep']}" for r in bad))
        return 1
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.default_int_handler)
    sys.exit(main())
