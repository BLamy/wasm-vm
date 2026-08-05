#!/usr/bin/env python3
"""E4-T03: automated in-guest CoreMark / Dhrystone benchmark harness.

Boots the RELEASE wasm-vm on the pinned Alpine rootfs, attaches the committed benchmark overlay
(bench/guest/bench.ext4) as a SECOND virtio-blk drive (/dev/vdb), drives the serial console to
run the benchmark bracketed by unique sentinels, scrapes + self-check-validates the score, repeats
for --runs, and emits a JSON result (median-of-N) to stdout.

    python3 tools/bench.py run coremark  --engine native [--runs 3] [--json OUT]
    python3 tools/bench.py run dhrystone --engine native [--runs 3] [--json OUT]

No third-party deps — stdlib subprocess + a hand-rolled serial-console expect loop, matching the
gen-tasks-json.py convention. Phase 8 (--engine browser) is reaping-deferred (see bench/README.md).

Clock model (why the timing cross-check is a RATIO, not 1:1): the guest CLINT `mtime` advances from
the retired-instruction count (clock_div=10, timebase 10 MHz), so guest-reported elapsed is a
DETERMINISTIC function of instructions retired — decoupled from host wall-clock BY DESIGN. The
score (iterations/sec, DMIPS) is therefore near-constant run-to-run; the host wall-clock varies
with machine speed. The invariant we police is host_elapsed / guest_elapsed ≈ a stable baseline;
a guest that lies about elapsed time (or a throttled host) moves that ratio (adversarial #2/#3).
"""

import argparse
import datetime
import hashlib
import json
import os
import random
import re
import select
import shlex
import statistics
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH_DIR = os.path.join(REPO, "bench", "guest")
KERNEL = os.path.join(REPO, "releases", "kernel", "6.6.63", "Image")
ROOTFS = os.path.join(REPO, "releases", "rootfs", "alpine-rootfs.ext4")
BENCH_EXT4 = os.path.join(BENCH_DIR, "bench.ext4")
GCC_EXT4 = os.path.join(BENCH_DIR, "gcc.ext4")
GCC_MANIFEST = os.path.join(BENCH_DIR, "gcc-MANIFEST.txt")
# Default is the release binary (the frozen baseline binary — never change this default).
# E4-T02 lets the flamegraph doc point the SAME harness at the `--profile profiling` binary
# (readable symbols) via WASM_VM_BIN, to (a) profile a CoreMark run and (b) prove the profiling
# build's score is within 15% of release (representativeness). Purely additive; unset = unchanged.
VM_BIN = os.environ.get("WASM_VM_BIN", os.path.join(REPO, "target", "release", "wasm-vm"))
SHA256SUMS = os.path.join(BENCH_DIR, "SHA256SUMS")

RAM_MIB = 256
MAX_INSTRS = 60_000_000_000  # a full boot + a ~13 s-guest benchmark run fits well inside this
BOOT_TIMEOUT = 1200.0        # cold Alpine boot on the interpreter is minutes; be generous
RUN_TIMEOUT = 1800.0         # the benchmark's timed region is ~1e9 instrs → tens of s host wall

# Baseline host/guest elapsed ratios, measured on the reference machine (fill after a clean run;
# None = not yet characterized → the cross-check records the ratio but does not flag). Used only
# for the anti-cheat deviation signal, never to alter the reported score.
BASELINE_RATIO = {"coremark": None, "dhrystone": None}
RATIO_TOLERANCE_PCT = 30.0   # host-speed jitter is wide; a 2x guest-clock lie still trips this

# Compiler/flags recorded into the JSON config block (kept in sync with bench/build.sh).
GCC = "gcc-13-riscv64-linux-gnu 13.3.0"
COMMON_FLAGS = "-static -O2 -g0 -march=rv64gc -mabi=lp64d"
COREMARK_ITERATIONS = 6000
DHRYSTONE_ITERS = 30_000_000

# E4-T04 in-guest gcc compile bench: overlay + reproducible-compile knobs (kept in sync with
# bench/mk-gcc-image.sh). The overlay is gitignored; its integrity is pinned by the sha256 recorded
# in gcc-MANIFEST.txt (adversarial #4 — a deleted/tampered overlay fails loudly).
GCC_SOURCE_DATE_EPOCH = 1704067200
GCC_RUN_TIMEOUT = 5400.0   # a full miniz -O2 compile on the interpreter is ~1 h on a slow 2-core box
# gcc -O2 of a ~9 kLoC TU retires FAR more guest instructions than a boot; give the whole
# boot+compile a generous instruction ceiling so a slow compile is never truncated mid-run.
GCC_MAX_INSTRS = 300_000_000_000
# gcc -O2 needs a real working set; with only 256 MiB the guest THRASHES the read-only overlay's
# page cache (endless reclaim/re-fault → billions of wasted kernel instructions, an unrealistic
# "compile time"). Give the gcc guest a comfortable RAM budget so the number reflects the compiler,
# not page-reclaim churn. Override with WASM_VM_GCC_RAM_MIB.
GCC_RAM_MIB = int(os.environ.get("WASM_VM_GCC_RAM_MIB", "768"))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def git_rev():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
        ).strip()
    except Exception:
        return "unknown"


def fail(msg):
    print(f"bench: FATAL: {msg}", file=sys.stderr)
    raise SystemExit(2)


def verify_artifacts(binname):
    """Adversarial #4: refuse to run unless the overlay + the ELF exist AND their sha256 match the
    committed SHA256SUMS. A missing/tampered overlay FAILS LOUDLY — never silently benchmark a
    different binary from the base rootfs."""
    if not os.path.exists(KERNEL):
        fail(f"missing kernel {KERNEL}")
    if not os.path.exists(ROOTFS):
        fail(f"missing Alpine rootfs {ROOTFS} (build it: tools/build-rootfs.sh)")
    if not os.path.exists(BENCH_EXT4):
        fail(f"missing benchmark overlay {BENCH_EXT4} — run bench/mkimage.sh (adversarial #4)")
    if not os.path.exists(SHA256SUMS):
        fail(f"missing {SHA256SUMS} — run bench/build.sh")
    want = {}
    with open(SHA256SUMS) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            digest, name = line.split()[0], line.split()[-1]
            want[os.path.basename(name)] = digest
    if binname not in want:
        fail(f"{binname} not listed in SHA256SUMS")
    got = sha256_file(os.path.join(BENCH_DIR, binname))
    if got != want[binname]:
        fail(f"{binname} sha256 mismatch: have {got}, SHA256SUMS says {want[binname]} "
             f"(rebuild with bench/build.sh — refusing to benchmark an unpinned binary)")
    return want[binname]


def ensure_vm():
    if os.path.exists(VM_BIN):
        return
    print("bench: release wasm-vm missing — building (cargo build --release -p wasm-vm-cli)…",
          file=sys.stderr)
    subprocess.check_call(
        ["cargo", "build", "--release", "-p", "wasm-vm-cli"], cwd=REPO
    )


class Console:
    """Minimal serial-console expect over the boot process's stdout/stdin pipes."""

    def __init__(self, proc, echo=False):
        self.proc = proc
        self.buf = ""
        # The text consumed BEFORE the most recent match (everything between the previous match and
        # this one) — this is what the caller scrapes for a benchmark's output, since `expect` drops
        # the matched-and-earlier bytes from `buf`.
        self.before = ""
        self.echo = echo
        self.fd = proc.stdout.fileno()

    def expect(self, pattern, timeout):
        rx = re.compile(pattern)
        deadline = time.monotonic() + timeout
        # First check anything already buffered.
        m = rx.search(self.buf)
        if m:
            self.before = self.buf[: m.start()]
            self.buf = self.buf[m.end():]
            return m
        while time.monotonic() < deadline:
            r, _, _ = select.select([self.fd], [], [], min(1.0, deadline - time.monotonic()))
            if r:
                chunk = os.read(self.fd, 65536)
                if not chunk:
                    break  # EOF: emulator exited
                text = chunk.decode("utf-8", "replace")
                if self.echo:
                    sys.stderr.write(text)
                    sys.stderr.flush()
                self.buf += text
                m = rx.search(self.buf)
                if m:
                    self.before = self.buf[: m.start()]
                    self.buf = self.buf[m.end():]
                    return m
            if self.proc.poll() is not None and not r:
                break
        raise TimeoutError(f"timed out waiting for /{pattern}/ after {timeout}s")

    def wait_first_byte(self, timeout):
        """Block until the FIRST byte is written to the console UART, buffering it, and return the
        host monotonic timestamp of that first output. This is the engine-identical boot-start
        endpoint (genuine first UART byte — this SBI prints no OpenSBI banner; the first line is the
        kernel's `earlycon`/`Linux version` output)."""
        deadline = time.monotonic() + timeout
        if self.buf:
            return time.monotonic()
        while time.monotonic() < deadline:
            r, _, _ = select.select([self.fd], [], [], min(1.0, deadline - time.monotonic()))
            if r:
                chunk = os.read(self.fd, 65536)
                if not chunk:
                    break
                t = time.monotonic()
                text = chunk.decode("utf-8", "replace")
                if self.echo:
                    sys.stderr.write(text)
                    sys.stderr.flush()
                self.buf += text
                return t
            if self.proc.poll() is not None and not r:
                break
        raise TimeoutError(f"no UART output within {timeout}s (boot never started)")

    def send(self, line):
        self.proc.stdin.write((line + "\n").encode())
        self.proc.stdin.flush()


# ---- per-benchmark parse + self-check --------------------------------------------------------

def parse_coremark(text):
    """Return (score iters/sec, guest_elapsed_s). Rejects a run whose CRC self-check did not
    validate (the CoreMark run rules' integrity guard) or whose performance seed is wrong."""
    if "Correct operation validated" not in text:
        fail("CoreMark CRC self-check did NOT validate (missing 'Correct operation validated')")
    seed = re.search(r"seedcrc\s*:\s*(0x[0-9a-fA-F]+)", text)
    if not seed or int(seed.group(1), 16) != 0xE9F5:
        fail(f"CoreMark seedcrc is not the standard performance-run 0xe9f5 (got {seed and seed.group(1)})")
    itsec = re.search(r"Iterations/Sec\s*:\s*([0-9.]+)", text)
    total = re.search(r"Total time \(secs\)\s*:\s*([0-9.]+)", text)
    if not itsec or not total:
        fail("CoreMark output missing Iterations/Sec or Total time")
    return float(itsec.group(1)), float(total.group(1))


def parse_dhrystone(text):
    """Return (DMIPS, guest_elapsed_s). Validates the benchmark's own end-of-run integrity check
    (Int_Glob==5 etc.) before trusting the score."""
    checks = {
        r"Int_Glob:\s*(-?\d+)": 5,
        r"Bool_Glob:\s*(-?\d+)": 1,
        r"Arr_1_Glob\[8\]:\s*(-?\d+)": 7,
    }
    for pat, expect in checks.items():
        m = re.search(pat, text)
        if not m or int(m.group(1)) != expect:
            fail(f"Dhrystone self-check failed ({pat} != {expect}); refusing the score")
    dps = re.search(r"Dhrystones per Second:\s*([0-9.]+)", text)
    if not dps:
        fail("Dhrystone output missing 'Dhrystones per Second'")
    dhry_per_sec = float(dps.group(1))
    dmips = dhry_per_sec / 1757.0            # 1757 dhry/s = 1 VAX MIPS (11/780 reference)
    guest_elapsed = DHRYSTONE_ITERS / dhry_per_sec if dhry_per_sec else 0.0
    return dmips, guest_elapsed


BENCHES = {
    "coremark": {"bin": "coremark.rv64", "parse": parse_coremark,
                 "unit": "iterations/sec", "higher_is_better": True},
    "dhrystone": {"bin": "dhrystone.rv64", "parse": parse_dhrystone,
                  "unit": "DMIPS", "higher_is_better": True},
    # boot is a macro benchmark: no in-guest ELF/overlay, no parse fn — it wall-clocks the boot
    # itself (OpenSBI first UART byte → getty login:) and reads a deterministic retired-instruction
    # anchor from --profile-boot's PROFILE_JSON. Handled by its own code path in cmd_run.
    "boot": {"bin": None, "parse": None, "unit": "seconds", "higher_is_better": False},
}


def run_once(bench, echo=False):
    spec = BENCHES[bench]
    binname = spec["bin"]
    nonce = "%08x" % random.randrange(1 << 32)
    # Sentinels typed with a "" split so the shell's command echo can't match the output line.
    start_typed = f'echo BENCH""START{nonce}'
    end_typed = f'echo BENCH""END{nonce}'
    start_re = rf"(?m)^BENCHSTART{nonce}\s*$"
    end_re = rf"(?m)^BENCHEND{nonce}\s*$"

    cmd = [
        VM_BIN, "boot",
        "--kernel", KERNEL,
        "--drive", f"file={ROOTFS}",
        "--drive", f"file={BENCH_EXT4},ro",
        "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
        "--ram-mib", str(RAM_MIB),
        "--max-instrs", str(MAX_INSTRS),
    ]
    # E4-T05: additive, default-off passthrough of extra boot flags (e.g. the Phase-A/B block
    # cache + Phase-C interrupt batching) without changing the frozen default command. Set
    # WASM_VM_BOOT_EXTRA="--block-cache --interrupt-batching" to measure the accelerated path.
    cmd += shlex.split(os.environ.get("WASM_VM_BOOT_EXTRA", ""))
    proc = subprocess.Popen(
        cmd, cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    con = Console(proc, echo=echo)
    try:
        con.expect(r"login:", BOOT_TIMEOUT)
        con.send("root")
        # Root has an empty password; busybox login usually drops straight to the shell, but
        # tolerate an explicit "Password:" prompt (answer with an empty line) either way.
        m = con.expect(r"(Password:|# )", 180.0)
        if m.group(1) == "Password:":
            con.send("")
            con.expect(r"# ", 120.0)
        # The overlay stages the ELFs under /bench/ (mkimage.sh), so mount at /mnt and the binaries
        # land at /mnt/bench/<name> — matching the exec path below.
        con.send("mount -o ro /dev/vdb /mnt && echo MOUNT_OK || echo MOUNT_FAIL")
        con.expect(r"(?m)^MOUNT_(OK|FAIL)\s*$", 120.0)
        con.send(start_typed)
        con.expect(start_re, 120.0)
        host_t0 = time.monotonic()
        con.send(f"/mnt/bench/{binname}")
        con.send(end_typed)
        con.expect(end_re, RUN_TIMEOUT)
        host_elapsed = time.monotonic() - host_t0
        run_text = con.before  # the text between the START and END sentinels (the benchmark's output)
        con.send("poweroff -f")
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        if proc.poll() is None:
            proc.kill()

    score, guest_elapsed = spec["parse"](run_text)
    return {"score": score, "guest_elapsed": guest_elapsed, "host_elapsed": host_elapsed}


def _browser_defer(args):
    """Every bench shares the same browser-engine defer: the Alpine browser boot OS-reaps on the
    dev mac (see E3), so --engine browser is nightly-only unless --allow-browser is forced."""
    if not getattr(args, "allow_browser", False):
        raise SystemExit(
            "browser engine deferred to nightly — Alpine browser boot OS-reaps on this mac "
            "(see E3); pass --allow-browser to override at your own risk"
        )
    raise SystemExit("browser engine not implemented (Phase 8 reaping-deferred)")


BOOT_APPEND = "root=/dev/vda rw console=ttyS0 earlycon=sbi"
# The boot bench stops itself at getty-login (--profile-boot's terminal marker), so it needs far
# fewer instructions than a full benchmark run; keep a generous budget so a slow cold boot fits.
BOOT_MAX_INSTRS = 20_000_000_000
# A cold Alpine boot reaches getty-login in a few minutes now that the box has headroom. Cap the
# per-run wait well under BOOT_TIMEOUT (used by the micro-benches) so a genuine boot failure surfaces
# fast instead of silently burning 20 min. The first UART byte lands in ~1s, login in ~2–4 min.
BOOT_BENCH_TIMEOUT = 600.0


def run_boot_once(echo=False):
    """Wall-clock a single cold boot: first UART byte written by the guest (t0) → getty `login:`.

    Runs with --profile-boot, which (a) makes the VM halt itself at the login marker so no shell
    interaction / kill is needed, and (b) prints a PROFILE_JSON line to stderr whose `total_retired`
    is the retired-instruction count AT getty-login — a deterministic, host-noise-free anchor.

    Returns {boot_wall_s, boot_retired_instrs}.
    """
    cmd = [
        VM_BIN, "boot",
        "--kernel", KERNEL,
        "--drive", f"file={ROOTFS}",
        "--append", BOOT_APPEND,
        "--ram-mib", str(RAM_MIB),
        "--max-instrs", str(BOOT_MAX_INSTRS),
        "--profile-boot",
    ]
    proc = subprocess.Popen(
        cmd, cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    con = Console(proc, echo=echo)
    t0 = None
    boot_wall_s = None
    try:
        # t0 = the genuine FIRST UART byte written by the guest (engine-identical start endpoint).
        # This VM's SBI prints no OpenSBI banner; the first line is the kernel's earlycon output.
        t0 = con.wait_first_byte(BOOT_BENCH_TIMEOUT)
        con.expect(r"login:", BOOT_BENCH_TIMEOUT)
        boot_wall_s = time.monotonic() - t0
        # --profile-boot halts the VM at the login marker; collect the rest (incl. PROFILE_JSON on
        # stderr). communicate drains both pipes so the child can't block on a full stderr buffer.
        try:
            _, err = proc.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, err = proc.communicate()
    finally:
        if proc.poll() is None:
            proc.kill()

    err_text = err.decode("utf-8", "replace") if err else ""
    m = re.search(r"PROFILE_JSON\s+(\{.*\})", err_text)
    if not m:
        fail("boot bench: no PROFILE_JSON line on stderr (did --profile-boot reach getty-login?)")
    try:
        prof = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        fail(f"boot bench: malformed PROFILE_JSON ({e})")
    retired = prof.get("total_retired")
    if not isinstance(retired, int):
        fail(f"boot bench: PROFILE_JSON has no integer total_retired (got {retired!r})")
    return {"boot_wall_s": boot_wall_s, "boot_retired_instrs": retired}


def cmd_run_boot(args):
    if os.path.exists(VM_BIN):
        pass
    else:
        ensure_vm()
    if not os.path.exists(KERNEL):
        fail(f"missing kernel {KERNEL}")
    if not os.path.exists(ROOTFS):
        fail(f"missing Alpine rootfs {ROOTFS} (build it: tools/build-rootfs.sh)")

    results = []
    for i in range(args.runs):
        print(f"bench: boot native run {i + 1}/{args.runs}…", file=sys.stderr)
        results.append(run_boot_once(echo=args.verbose))

    walls = [r["boot_wall_s"] for r in results]
    retireds = [r["boot_retired_instrs"] for r in results]
    # boot_retired_instrs is a near-deterministic anchor. In practice it is NOT bit-exact: the
    # --profile-boot report stamps the retired count in the console-feed quantum where `login:` is
    # first *seen*, and that quantum boundary isn't instruction-aligned to the exact login byte, so
    # the value jitters by ~0.2% across runs (real boot execution is instruction-count-deterministic
    # by design; this is measurement granularity, not guest nondeterminism). We assert the anchor is
    # stable within a TIGHT tolerance — a value that moves by >1% would signal real nondeterminism.
    retired_median = int(statistics.median(retireds))
    retired_spread = (max(retireds) - min(retireds)) / retired_median if retired_median else 0.0
    RETIRED_TOL = 0.01
    if retired_spread > RETIRED_TOL:
        fail(f"boot_retired_instrs spread {retired_spread:.4f} exceeds {RETIRED_TOL} "
             f"across runs {retireds} — the getty-login anchor is not stable (refuted)")
    boot_retired_instrs = retired_median

    median = statistics.median(walls)
    spread = (max(walls) - min(walls)) / median if median else 0.0
    noise_warning = spread > 0.05

    out = {
        "bench": "boot",
        "score": round(median, 3),
        "unit": BENCHES["boot"]["unit"],
        "higher_is_better": BENCHES["boot"]["higher_is_better"],
        "runs": [round(w, 3) for w in walls],
        "spread": round(spread, 4),
        "noise_warning": noise_warning,
        "boot_retired_instrs": boot_retired_instrs,
        "boot_retired_runs": retireds,
        "boot_retired_spread": round(retired_spread, 5),
        "engine": args.engine,
        "commit": git_rev(),
        "config": {
            "kernel": os.path.relpath(KERNEL, REPO),
            "rootfs": os.path.relpath(ROOTFS, REPO),
            "append": BOOT_APPEND,
            "vm_build": "release",
            "ram_mib": RAM_MIB,
        },
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "timing_check": {
            "note": "boot_wall_s is host-dependent (tens of seconds on the ~30 MIPS interpreter); "
                    "boot_retired_instrs is the near-deterministic anchor (median; jitters ~0.2% "
                    "from profiler quantum granularity, asserted stable within 1%). Endpoints: "
                    "first UART byte written by the guest (t0; this SBI prints no OpenSBI banner) "
                    "→ getty 'login:'.",
            "boot_retired_instrs": boot_retired_instrs,
            "boot_retired_spread": round(retired_spread, 5),
            "runs_wall_s": [round(w, 3) for w in walls],
        },
    }
    text = json.dumps(out, indent=2)
    print(text)
    if args.json:
        with open(args.json, "w") as f:
            f.write(text + "\n")
    if getattr(args, "ledger", False):
        ledger_append(out, args.baseline)
    return 0


def _gcc_manifest_sha():
    """Read the pinned gcc.ext4 sha256 out of gcc-MANIFEST.txt (the committed anti-drift record)."""
    if not os.path.exists(GCC_MANIFEST):
        fail(f"missing {GCC_MANIFEST} — run bench/mk-gcc-image.sh")
    with open(GCC_MANIFEST) as f:
        for line in f:
            m = re.match(r"\s*gcc_ext4_sha256:\s*([0-9a-f]{64})", line)
            if m:
                return m.group(1)
    fail("gcc-MANIFEST.txt has no gcc_ext4_sha256 line")


def verify_gcc_overlay():
    """Adversarial #4 for the gcc overlay: it is gitignored (build-on-demand), so pin it by the
    sha256 recorded in the committed gcc-MANIFEST.txt. A missing/tampered overlay fails LOUDLY."""
    if not os.path.exists(GCC_EXT4):
        fail(f"missing gcc overlay {GCC_EXT4} — build it: bench/mk-gcc-image.sh (adversarial #4)")
    want = _gcc_manifest_sha()
    got = sha256_file(GCC_EXT4)
    if got != want:
        fail(f"gcc.ext4 sha256 mismatch: have {got}, gcc-MANIFEST.txt says {want} "
             f"(rebuild with bench/mk-gcc-image.sh — refusing to benchmark an unpinned overlay)")
    return want


def run_gcc_once(echo=False):
    """Boot, mount the gcc overlay read-only, compile miniz.c at -O2 in-guest, and return
    {score(guest seconds), host_elapsed, guest_elapsed, o_size, o_sha256, cmdline, rc}.

    Determinism of the emitted .o: SOURCE_DATE_EPOCH + -frandom-seed. Guest seconds come from
    /proc/uptime (instruction-count-derived guest clock), the host-independent duration metric;
    host_elapsed is captured for the honest host/guest ratio note (same framing as the micro-benches).
    """
    nonce = "%08x" % random.randrange(1 << 32)
    start_typed = f'echo BENCH""START{nonce}'
    end_typed = f'echo BENCH""END{nonce}'
    start_re = rf"(?m)^BENCHSTART{nonce}\s*$"
    end_re = rf"(?m)^BENCHEND{nonce}\s*$"

    cmd = [
        VM_BIN, "boot",
        "--kernel", KERNEL,
        "--drive", f"file={ROOTFS}",
        "--drive", f"file={GCC_EXT4},ro",
        "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
        "--ram-mib", str(GCC_RAM_MIB),
        "--max-instrs", str(GCC_MAX_INSTRS),
    ]
    cmd += shlex.split(os.environ.get("WASM_VM_BOOT_EXTRA", ""))
    proc = subprocess.Popen(
        cmd, cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    con = Console(proc, echo=echo)
    try:
        con.expect(r"login:", BOOT_TIMEOUT)
        con.send("root")
        m = con.expect(r"(Password:|# )", 180.0)
        if m.group(1) == "Password:":
            con.send("")
            con.expect(r"# ", 120.0)
        con.send("mount -o ro /dev/vdb /mnt && echo MOUNT_OK || echo MOUNT_FAIL")
        con.expect(r"(?m)^MOUNT_(OK|FAIL)\s*$", 120.0)
        # Compile bracketed by sentinels. The gcc-wrap shim echoes the fully-resolved command
        # line (adversarial #3: -O2 must really reach gcc); /proc/uptime brackets guest seconds;
        # rc + .o size + .o sha256 are emitted on a single RESULT line for the parser.
        compile_cmd = (
            "rm -f /tmp/miniz.o; "
            "T0=$(cut -d' ' -f1 /proc/uptime); "
            "SOURCE_DATE_EPOCH=%d /mnt/gcc-wrap -O2 -frandom-seed=miniz "
            "-c /mnt/src/miniz.c -o /tmp/miniz.o; RC=$?; "
            "T1=$(cut -d' ' -f1 /proc/uptime); "
            "SZ=$(wc -c < /tmp/miniz.o 2>/dev/null || echo 0); "
            "SH=$(sha256sum /tmp/miniz.o 2>/dev/null | cut -d' ' -f1); "
            "echo GCC_RESULT rc=$RC secs=$(awk \"BEGIN{print $T1-$T0}\") osize=$SZ osha=$SH"
        ) % GCC_SOURCE_DATE_EPOCH
        con.send(start_typed)
        con.expect(start_re, 120.0)
        host_t0 = time.monotonic()
        con.send(compile_cmd)
        con.send(end_typed)
        con.expect(end_re, GCC_RUN_TIMEOUT)
        host_elapsed = time.monotonic() - host_t0
        run_text = con.before
        con.send("poweroff -f")
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        if proc.poll() is None:
            proc.kill()

    cmdline_m = re.search(r"(?m)^GCC_CMDLINE:\s*(.+?)\s*$", run_text)
    res_m = re.search(
        r"(?m)^GCC_RESULT rc=(\d+) secs=([0-9.]+) osize=(\d+) osha=([0-9a-f]*)\s*$", run_text)
    if not res_m:
        fail("gcc bench: no GCC_RESULT line (compile did not complete). "
             "Console tail:\n" + run_text[-600:])
    rc = int(res_m.group(1))
    guest_secs = float(res_m.group(2))
    o_size = int(res_m.group(3))
    o_sha = res_m.group(4)
    if rc != 0:
        fail(f"gcc bench: compile returned nonzero rc={rc} (cmdline: {cmdline_m and cmdline_m.group(1)})")
    if o_size <= 0:
        fail("gcc bench: produced a ZERO-byte .o (adversarial #3 — no real compilation happened)")
    cmdline = cmdline_m.group(1) if cmdline_m else None
    if not cmdline or "-O2" not in cmdline:
        fail(f"gcc bench: resolved command line missing -O2 (got: {cmdline!r})")
    return {"score": guest_secs, "guest_elapsed": guest_secs, "host_elapsed": host_elapsed,
            "o_size": o_size, "o_sha256": o_sha, "cmdline": cmdline, "rc": rc}


def cmd_run_gcc(args):
    overlay_sha = verify_gcc_overlay()
    ensure_vm()
    if not os.path.exists(KERNEL):
        fail(f"missing kernel {KERNEL}")
    if not os.path.exists(ROOTFS):
        fail(f"missing Alpine rootfs {ROOTFS}")

    results = []
    for i in range(args.runs):
        print(f"bench: gcc native run {i + 1}/{args.runs}…", file=sys.stderr)
        results.append(run_gcc_once(echo=args.verbose))

    scores = [r["score"] for r in results]
    median = statistics.median(scores)
    spread = (max(scores) - min(scores)) / median if median else 0.0
    noise_warning = spread > 0.05

    med_idx = scores.index(sorted(scores)[len(scores) // 2])
    med = results[med_idx]
    ratio = med["host_elapsed"] / med["guest_elapsed"] if med["guest_elapsed"] else None

    # The emitted .o must be byte-stable across runs (SOURCE_DATE_EPOCH + -frandom-seed); a moving
    # sha256 would signal nondeterministic codegen. Assert all runs agree.
    o_shas = {r["o_sha256"] for r in results if r["o_sha256"]}
    o_sizes = {r["o_size"] for r in results}
    if len(o_shas) > 1:
        fail(f"gcc bench: .o sha256 varies across runs {o_shas} — nondeterministic compile")

    out = {
        "bench": "gcc",
        "score": round(median, 3),
        "unit": "seconds",
        "higher_is_better": False,
        "runs": [round(s, 3) for s in scores],
        "spread": round(spread, 4),
        "noise_warning": noise_warning,
        "engine": args.engine,
        "commit": git_rev(),
        "config": {
            "workload": "miniz-3.0.2 miniz.c (amalgamated, ~9.3 kLoC)",
            "compile_cmd": med["cmdline"],
            "gcc_package": _gcc_pkg_from_manifest(),
            "source_date_epoch": GCC_SOURCE_DATE_EPOCH,
            "o_size_bytes": med["o_size"],
            "o_sizes_all": sorted(o_sizes),
            "o_sha256": med["o_sha256"],
            "gcc_ext4_sha256": overlay_sha,
            "vm_build": "release",
            "ram_mib": GCC_RAM_MIB,
        },
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "timing_check": {
            "note": "score is in-guest seconds (from /proc/uptime, instruction-count-derived "
                    "guest clock — host-independent). host_elapsed is recorded only for the honest "
                    "host/guest ratio, never to alter the score. The .o is byte-stable "
                    "(SOURCE_DATE_EPOCH + -frandom-seed); its sha256 is the anti-drift anchor.",
            "guest_elapsed_s": round(med["guest_elapsed"], 3),
            "host_elapsed_s": round(med["host_elapsed"], 3),
            "ratio": round(ratio, 3) if ratio else None,
        },
    }
    text = json.dumps(out, indent=2)
    print(text)
    if args.json:
        with open(args.json, "w") as f:
            f.write(text + "\n")
    if getattr(args, "ledger", False):
        ledger_append(out, args.baseline)
    return 0


def _gcc_pkg_from_manifest():
    try:
        with open(GCC_MANIFEST) as f:
            for line in f:
                m = re.match(r"\s*gcc_package:\s*(\S+)", line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return "unknown"


def cmd_run(args):
    if args.bench == "gcc":
        if args.engine == "browser":
            _browser_defer(args)
        if args.engine != "native":
            raise SystemExit(f"unknown engine {args.engine}")
        return cmd_run_gcc(args)
    if args.bench == "boot":
        if args.engine == "browser":
            _browser_defer(args)
        if args.engine != "native":
            raise SystemExit(f"unknown engine {args.engine}")
        return cmd_run_boot(args)

    if args.engine == "browser":
        _browser_defer(args)
    if args.engine != "native":
        raise SystemExit(f"unknown engine {args.engine}")

    bench = args.bench
    if bench not in BENCHES:
        raise SystemExit(f"unknown benchmark {bench} (expected coremark|dhrystone|boot)")

    digest = verify_artifacts(BENCHES[bench]["bin"])
    ensure_vm()

    results = []
    for i in range(args.runs):
        print(f"bench: {bench} native run {i + 1}/{args.runs}…", file=sys.stderr)
        results.append(run_once(bench, echo=args.verbose))

    scores = [r["score"] for r in results]
    median = statistics.median(scores)
    spread = (max(scores) - min(scores)) / median if median else 0.0
    noise_warning = spread > 0.05

    # Timing cross-check on the median-representative run (the one whose score is the median).
    med_idx = scores.index(sorted(scores)[len(scores) // 2])
    med = results[med_idx]
    ratio = med["host_elapsed"] / med["guest_elapsed"] if med["guest_elapsed"] else None
    baseline = BASELINE_RATIO.get(bench)
    if baseline and ratio:
        deviation = abs(ratio - baseline) / baseline
        flagged = deviation > RATIO_TOLERANCE_PCT / 100.0
    else:
        deviation = None
        flagged = False

    out = {
        "bench": bench,
        "score": round(median, 3),
        "unit": BENCHES[bench]["unit"],
        "higher_is_better": BENCHES[bench]["higher_is_better"],
        "runs": [round(s, 3) for s in scores],
        "spread": round(spread, 4),
        "noise_warning": noise_warning,
        "engine": args.engine,
        "commit": git_rev(),
        "config": {
            "gcc": GCC,
            "flags": COMMON_FLAGS,
            "iterations": (COREMARK_ITERATIONS if bench == "coremark" else DHRYSTONE_ITERS),
            "vm_build": "release",
            "ram_mib": RAM_MIB,
            "binary_sha256": digest,
        },
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "timing_check": {
            "note": "guest elapsed is instruction-count-derived (clock_div=10, 10 MHz timebase); "
                    "the policed invariant is host/guest ratio vs baseline, not 1:1",
            "guest_elapsed_s": round(med["guest_elapsed"], 3),
            "host_elapsed_s": round(med["host_elapsed"], 3),
            "ratio": round(ratio, 3) if ratio else None,
            "baseline_ratio": baseline,
            "deviation": round(deviation, 4) if deviation is not None else None,
            "flagged": flagged,
        },
    }
    text = json.dumps(out, indent=2)
    print(text)
    if args.json:
        with open(args.json, "w") as f:
            f.write(text + "\n")
    if getattr(args, "ledger", False):
        ledger_append(out, args.baseline)
    return 0


# ---- ledger (Phase 4): append-only, hash-chained baseline history --------------------------------

LEDGER = os.path.join(REPO, "bench", "ledger.json")
GENESIS_PREV = "0" * 64
ENTRY_KEYS = ("bench", "engine", "score", "unit", "higher_is_better", "spread",
              "commit", "vm_build", "baseline", "config", "date", "prev_sha256")


def _canonical_sha256(entry):
    """sha256 of an entry's canonical JSON — the link the next entry chains onto."""
    return hashlib.sha256(
        json.dumps(entry, sort_keys=True).encode("utf-8")
    ).hexdigest()


def load_ledger():
    if not os.path.exists(LEDGER):
        return {"schema_version": 1, "entries": []}
    with open(LEDGER) as f:
        return json.load(f)


def save_ledger(ledger):
    with open(LEDGER, "w") as f:
        f.write(json.dumps(ledger, indent=2, sort_keys=True) + "\n")


def entry_from_result(result, baseline):
    """Project a `run`-emitted result dict onto the fixed ledger entry schema (minus prev_sha256,
    filled by the append). NEVER mutates existing entries — only builds a new one."""
    return {
        "bench": result["bench"],
        "engine": result["engine"],
        "score": result["score"],
        "unit": result["unit"],
        "higher_is_better": result.get(
            "higher_is_better", BENCHES.get(result["bench"], {}).get("higher_is_better", True)
        ),
        "spread": result.get("spread", 0.0),
        "commit": result.get("commit", git_rev()),
        "vm_build": result.get("config", {}).get("vm_build", "release"),
        "baseline": baseline,
        "config": result.get("config", {}),
        "date": result.get("date", datetime.datetime.now(datetime.timezone.utc).isoformat()),
    }


def ledger_append(result, baseline):
    """Append ONE hash-chained entry built from a result dict. Append-only: existing entries are
    read but never reordered or rewritten."""
    ledger = load_ledger()
    entries = ledger.setdefault("entries", [])
    entry = entry_from_result(result, baseline)
    entry["prev_sha256"] = GENESIS_PREV if not entries else _canonical_sha256(entries[-1])
    entries.append(entry)
    save_ledger(ledger)
    print(f"bench: appended {entry['bench']}/{entry['engine']} "
          f"score={entry['score']} {entry['unit']} to {os.path.relpath(LEDGER, REPO)}",
          file=sys.stderr)
    return entry


def cmd_record(args):
    with open(args.result) as f:
        result = json.load(f)
    ledger_append(result, args.baseline)
    return 0


def verify_chain(ledger):
    """Return a list of human-readable break descriptions (empty == chain valid). Detects a mutated
    historical entry: any change to entry N breaks entry N+1's prev_sha256 link (adversarial #4)."""
    breaks = []
    entries = ledger.get("entries", [])
    prev_hash = GENESIS_PREV
    for i, entry in enumerate(entries):
        missing = [k for k in ENTRY_KEYS if k not in entry]
        if missing:
            breaks.append(f"entry {i} ({entry.get('bench', '?')}) missing keys: {missing}")
        if entry.get("prev_sha256") != prev_hash:
            breaks.append(
                f"entry {i} ({entry.get('bench', '?')}): prev_sha256 "
                f"{entry.get('prev_sha256')} != expected {prev_hash} (chain broken / tampered)"
            )
        prev_hash = _canonical_sha256(entry)
    return breaks


def cmd_report(args):
    ledger = load_ledger()
    entries = ledger.get("entries", [])

    if args.verify:
        breaks = verify_chain(ledger)
        if breaks:
            print("bench: LEDGER VERIFY FAILED — hash chain / schema broken:", file=sys.stderr)
            for b in breaks:
                print(f"  - {b}", file=sys.stderr)
            return 1
        print(f"bench: ledger OK — {len(entries)} entries, hash chain intact", file=sys.stderr)

    # Group by bench, preserving insertion order.
    by_bench = {}
    for e in entries:
        by_bench.setdefault(e["bench"], []).append(e)

    benches = [args.bench] if args.bench else list(by_bench.keys())
    for bench in benches:
        rows = by_bench.get(bench, [])
        if not rows:
            print(f"\n== {bench} ==  (no entries)")
            continue
        base = next((r for r in rows if r.get("baseline") == "level3-interpreter"), None)
        print(f"\n== {bench} ==  ({rows[0]['unit']}, "
              f"{'higher' if rows[0].get('higher_is_better') else 'lower'} is better)")
        print(f"{'date':25}  {'commit':10}  {'engine':8}  {'score':>12}  "
              f"{'spread':>8}  {'speedup':>8}")
        for r in rows:
            speedup = "-"
            if base and base["score"]:
                if r.get("higher_is_better", True):
                    speedup = f"{r['score'] / base['score']:.2f}x"
                else:
                    speedup = f"{base['score'] / r['score']:.2f}x" if r["score"] else "-"
            print(f"{r['date'][:25]:25}  {r['commit'][:10]:10}  {r['engine']:8}  "
                  f"{r['score']:>12}  {r.get('spread', 0):>8}  {speedup:>8}")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="macro + micro benchmark harness and baseline ledger (E4-T03/T04)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="boot the VM and run a benchmark")
    r.add_argument("bench", choices=["coremark", "dhrystone", "boot", "gcc"])
    r.add_argument("--engine", default="native", choices=["native", "browser"])
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--json", help="also write the JSON result to this path")
    r.add_argument("--verbose", action="store_true", help="stream the guest console to stderr")
    r.add_argument("--allow-browser", action="store_true", help="override the browser-engine defer")
    r.add_argument("--ledger", action="store_true",
                   help="append the result to bench/ledger.json after a successful run")
    r.add_argument("--baseline", default=None,
                   help="baseline tag for the ledger entry (e.g. level3-interpreter)")
    r.set_defaults(func=cmd_run)

    rec = sub.add_parser("record", help="append a run-emitted JSON result to bench/ledger.json")
    rec.add_argument("result", help="path to a `run --json` result file")
    rec.add_argument("--baseline", default=None,
                     help="baseline tag (e.g. level3-interpreter)")
    rec.set_defaults(func=cmd_record)

    rep = sub.add_parser("report", help="print per-bench ledger history")
    rep.add_argument("--bench", default=None, help="restrict to one benchmark")
    rep.add_argument("--verify", action="store_true",
                     help="walk the hash chain + validate schema; nonzero exit on any break")
    rep.set_defaults(func=cmd_report)

    args = ap.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
