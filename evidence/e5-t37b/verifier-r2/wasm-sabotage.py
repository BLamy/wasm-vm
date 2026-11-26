#!/usr/bin/env python3
"""E5-T37b verifier round 2: does `wasm-pack test --node crates/wasm --lib -- exported_paced`
execute the behaviour half of the paced-idle test, and is the host-clock shim gone afterwards?

usage: wasm-sabotage.py SCRATCH_CLONE OUT_DIR [case ...]

Every mutation is applied to SCRATCH_CLONE/crates/wasm/src/lib.rs only (a `git clone --shared`
of the repo, never the checkout under test), the command is run with no NODE_OPTIONS and no
preload, and the file is restored with `git checkout` before the next case.
"""
import json, os, re, subprocess, sys

clone, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
only = set(sys.argv[3:])
LIB = os.path.join(clone, "crates/wasm/src/lib.rs")
ENV = {k: v for k, v in os.environ.items()
       if k not in ("NODE_OPTIONS", "RUSTFLAGS", "RUST_LOG") and not k.startswith("CARGO_")}

REMOVAL = '''        if shimmed {
            js_sys::eval("delete globalThis.WorkerGlobalScope").unwrap();
            assert!(JsHostTimer::new().is_none());
        }
'''
PROBE = '        assert!(JsHostTimer::new().is_none(), "verifier probe: no host clock in this realm");\n'
NEIGHBOUR_A = "    fn exported_paced_selection_preserves_lossless_time_and_truthful_source_refusal() {\n"
NEIGHBOUR_B = "    fn exported_clock_selection_preserves_default_and_reports_unavailable_source() {\n"

def once(src, old, new):
    assert src.count(old) == 1, (src.count(old), old)
    return src.replace(old, new)

def probes(src):
    return once(once(src, NEIGHBOUR_A, NEIGHBOUR_A + PROBE), NEIGHBOUR_B, NEIGHBOUR_B + PROBE)

CASES = {
    # name: (filter or None for the whole --lib set, mutation, what must happen)
    "baseline": ("exported_paced", lambda s: s, "2 passed"),
    "S1-expect-6-retired": ("exported_paced", lambda s: once(
        s, "assert_eq!(retired(&m.run_chunk(100_000, None).unwrap()), 5.0);",
        "assert_eq!(retired(&m.run_chunk(100_000, None).unwrap()), 6.0);"), "idle test fails: left 5.0 right 6.0"),
    "S2-binding-take-always-0": ("exported_paced", lambda s: once(
        s, ".map_or(0.0, |ns| ns as f64 / 1_000_000.0))", ".map_or(0.0, |_ns| 0.0))"),
        "idle test fails at the wait assertion"),
    "S3-binding-never-yields": ("exported_paced", lambda s: once(
        s, "inner.machine.set_paced_idle_policy(yield_to_host, lag);",
        "inner.machine.set_paced_idle_policy(false, lag);"), "idle test fails in the behaviour half"),
    "S4-binding-always-yields": ("exported_paced", lambda s: once(
        s, "inner.machine.set_paced_idle_policy(yield_to_host, lag);",
        "inner.machine.set_paced_idle_policy(true, lag);"), "idle test fails (refusal loop or the no-opt-in run)"),
    "S5-binding-wait-in-seconds": ("exported_paced", lambda s: once(
        s, ".map_or(0.0, |ns| ns as f64 / 1_000_000.0))", ".map_or(0.0, |ns| ns as f64 / 1_000_000_000.0))"),
        "idle test fails at the wait assertion"),
    "S6-test-stays-paced-for-last-block": ("exported_paced", lambda s: once(
        s, '''        m.set_guest_clock("icount").unwrap();
        m.set_paced_idle_policy(JsValue::TRUE, JsValue::from_f64(50.0))''',
        '''        m.set_paced_idle_policy(JsValue::TRUE, JsValue::from_f64(50.0))'''),
        "idle test fails at the last 5,000 (the pure-ICount block executes and is sensitive)"),
    "P-A-probes-only": (None, probes, "17 passed: no host clock in either neighbour, before and after the idle test"),
    "P-B-probes-and-no-removal": (None, lambda s: once(probes(s), REMOVAL, ""),
        "the neighbour that runs after the idle test fails on the probe"),
    "P-C-no-removal-no-probes": (None, lambda s: once(s, REMOVAL, ""),
        "17 passed: the neighbours are adaptive and do not notice a leaked host clock"),
    "P-D-removal-is-a-no-op": ("exported_paced", lambda s: once(
        s, 'js_sys::eval("delete globalThis.WorkerGlobalScope").unwrap();', 'js_sys::eval("0").unwrap();'),
        "idle test fails on its own closing assertion"),
}

orig = open(LIB).read()
results = []
for name, (flt, mutate, expect) in CASES.items():
    if only and name not in only:
        continue
    subprocess.run(["git", "-C", clone, "checkout", "--", "crates/wasm/src/lib.rs"], check=True)
    src = open(LIB).read()
    assert src == orig
    open(LIB, "w").write(mutate(src))
    cmd = ["wasm-pack", "test", "--node", "crates/wasm", "--lib"] + (["--", flt] if flt else [])
    p = subprocess.run(cmd, cwd=clone, env=ENV, capture_output=True, text=True)
    log = p.stdout + p.stderr
    subprocess.run(["git", "-C", clone, "checkout", "--", "crates/wasm/src/lib.rs"], check=True)
    open(os.path.join(out, f"wasm-sabotage-{name}.log"), "w").write(
        "$ " + " ".join(cmd) + "\n" + "\n".join(log.splitlines()[-60:]) + f"\nrc={p.returncode}\n")
    m = re.search(r"test result: (\w+)\. (\d+) passed; (\d+) failed", log)
    failed = re.findall(r"^test (\S+) \.\.\. FAIL", log, re.M)
    panics = re.findall(r"panicked at ([^\n]+)\n\s*([^\n]*(?:\n\s+(?:left|right): [^\n]*)*)", log)
    results.append({
        "case": name, "command": " ".join(cmd), "expected": expect, "rc": p.returncode,
        "result": m.group(0) if m else None, "failed_tests": failed,
        "panics": [{"at": a.strip(), "message": " ".join(b.split())} for a, b in panics][:4],
    })
    print(json.dumps(results[-1]), flush=True)
assert open(LIB).read() == orig
json.dump(results, open(os.path.join(out, "wasm-sabotage.json"), "w"), indent=1)
