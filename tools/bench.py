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
import statistics
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH_DIR = os.path.join(REPO, "bench", "guest")
KERNEL = os.path.join(REPO, "releases", "kernel", "6.6.63", "Image")
ROOTFS = os.path.join(REPO, "releases", "rootfs", "alpine-rootfs.ext4")
BENCH_EXT4 = os.path.join(BENCH_DIR, "bench.ext4")
VM_BIN = os.path.join(REPO, "target", "release", "wasm-vm")
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
    "coremark": {"bin": "coremark.rv64", "parse": parse_coremark, "unit": "iterations/sec"},
    "dhrystone": {"bin": "dhrystone.rv64", "parse": parse_dhrystone, "unit": "DMIPS"},
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


def cmd_run(args):
    if args.engine == "browser":
        if not args.allow_browser:
            raise SystemExit(
                "browser engine deferred to nightly — Alpine browser boot OS-reaps on this mac "
                "(see E3); pass --allow-browser to override at your own risk"
            )
        raise SystemExit("browser engine not implemented (Phase 8 reaping-deferred)")
    if args.engine != "native":
        raise SystemExit(f"unknown engine {args.engine}")

    bench = args.bench
    if bench not in BENCHES:
        raise SystemExit(f"unknown benchmark {bench} (expected coremark|dhrystone)")

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
    return 0


def main():
    ap = argparse.ArgumentParser(description="in-guest CoreMark/Dhrystone benchmark harness (E4-T03)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="boot the VM and run a benchmark")
    r.add_argument("bench", choices=["coremark", "dhrystone"])
    r.add_argument("--engine", default="native", choices=["native", "browser"])
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--json", help="also write the JSON result to this path")
    r.add_argument("--verbose", action="store_true", help="stream the guest console to stderr")
    r.add_argument("--allow-browser", action="store_true", help="override the browser-engine defer")
    r.set_defaults(func=cmd_run)
    args = ap.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
