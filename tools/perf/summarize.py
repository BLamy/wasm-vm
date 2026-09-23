#!/usr/bin/env python3
"""Headline before/after table for the PR from bench-native / bench-browser results.

    python3 tools/perf/summarize.py --native OUT/native/native.json --browser OUT/browser/browser.json \
        [--base baseline] [--new candidate] [--out OUT/SUMMARY.md]

Both result files carry every label they ran (A/B interleaved runs); --base/--new pick the two
columns (default: the first and last label). To compare a fresh single-label run against a committed
baseline instead, pass --ref-native/--ref-browser (+ --ref-label) for the "before" column; the table
then says so, because runs taken at different times on a shared machine are much noisier than an
interleaved A/B. Stdlib only.
"""

import argparse
import json
import sys


def load(path):
    if not path:
        return None
    with open(path) as f:
        return json.load(f)


def labels_of(doc, kind):
    if not doc:
        return []
    if kind == "native":
        return list(doc["meta"]["bins"].keys())
    return [r["label"] for r in doc["meta"]["roots"]]


# (suite, case, key, human label, better, digits)
ROWS = [
    ("native", "busybox-fast", "wall_s", "Native: busybox boot to userland, fast interpreter (s)", "lower", 2),
    ("native", "busybox-jit", "wall_s", "Native: busybox boot to userland, --jit (s)", "lower", 2),
    ("native", "busybox-legacy", "wall_s", "Native: busybox boot to userland, legacy interpreter (s)", "lower", 2),
    ("native", "busybox-fast", "cpu_s", "Native: busybox boot CPU time, fast (s)", "lower", 2),
    ("native", "busybox-jit", "cpu_s", "Native: busybox boot CPU time, --jit (s)", "lower", 2),
    ("native", "busybox-fast", "mips", "Native: busybox boot MIPS, fast", "higher", 1),
    ("native", "busybox-jit", "mips", "Native: busybox boot MIPS, --jit", "higher", 1),
    ("native", "compute-fast", "region_s", "Native: shell arithmetic loop, fast (s)", "lower", 2),
    ("native", "compute-jit", "region_s", "Native: shell arithmetic loop, --jit (s)", "lower", 2),
    ("native", "compute-fast", "region_cpu_s", "Native: shell arithmetic loop CPU time, fast (s)", "lower", 2),
    ("native", "compute-jit", "region_cpu_s", "Native: shell arithmetic loop CPU time, --jit (s)", "lower", 2),
    ("native", "compute-fast", "mips_est", "Native: shell loop MIPS, fast", "higher", 1),
    ("native", "compute-jit", "mips_est", "Native: shell loop MIPS, --jit", "higher", 1),
    ("native", "alpine-fast", "wall_s", "Native: Alpine ext4 boot to login, fast (s)", "lower", 1),
    ("native", "alpine-jit", "wall_s", "Native: Alpine ext4 boot to login, --jit (s)", "lower", 1),
    ("native", "alpine-fast", "cpu_s", "Native: Alpine boot CPU time, fast (s)", "lower", 1),
    ("native", "alpine-jit", "mips", "Native: Alpine boot MIPS, --jit", "higher", 1),
    ("native", "coremark-fast", "region_s", "Native: CoreMark (6000 it) host time, fast (s)", "lower", 1),
    ("native", "coremark-jit", "region_s", "Native: CoreMark (6000 it) host time, --jit (s)", "lower", 1),
    ("native", "coremark-fast", "host_iter_per_s", "Native: CoreMark iterations/s on the host clock, fast", "higher", 1),
    ("native", "coremark-jit", "host_iter_per_s", "Native: CoreMark iterations/s on the host clock, --jit", "higher", 1),
    ("native", "coremark-jit", "mips_est", "Native: CoreMark MIPS, --jit", "higher", 1),
    ("native", "microbench", "legacy_alu_mips", "Native: ALU microbench MIPS (legacy)", "higher", 1),
    ("native", "microbench", "alu_fast_mips", "Native: ALU microbench MIPS (fast)", "higher", 1),
    ("browser", "busybox-jit", "readyS", "Browser: busybox cold boot to prompt, JIT (s)", "lower", 2),
    ("browser", "busybox-nojit", "readyS", "Browser: busybox cold boot to prompt, ?jit=0 (s)", "lower", 2),
    ("browser", "busybox-jit", "bootMipsExec", "Browser: busybox boot MIPS, JIT", "higher", 1),
    ("browser", "busybox-jit", "regionS", "Browser: shell arithmetic loop, JIT (s)", "lower", 2),
    ("browser", "busybox-nojit", "regionS", "Browser: shell arithmetic loop, ?jit=0 (s)", "lower", 2),
    ("browser", "busybox-jit", "mips", "Browser: shell loop MIPS, JIT", "higher", 1),
    ("browser", "node-jit", "readyS", "Browser: node-alpine snapshot restore to prompt, JIT (s)", "lower", 2),
    ("browser", "node-jit", "regionS", "Browser: `node -e` compute script, JIT (s)", "lower", 1),
    ("browser", "node-nojit", "regionS", "Browser: `node -e` compute script, ?jit=0 (s)", "lower", 1),
    ("browser", "node-jit", "mips", "Browser: `node -e` MIPS, JIT", "higher", 1),
]


def fmt(v, nd):
    return "–" if v is None else f"{v:.{nd}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native")
    ap.add_argument("--browser")
    ap.add_argument("--base")
    ap.add_argument("--new")
    ap.add_argument("--ref-native")
    ap.add_argument("--ref-browser")
    ap.add_argument("--ref-label")
    ap.add_argument("--out")
    a = ap.parse_args()
    docs = {"native": load(a.native), "browser": load(a.browser)}
    refs = {"native": load(a.ref_native), "browser": load(a.ref_browser)}
    cross_run = bool(refs["native"] or refs["browser"])

    def pick(kind):
        doc = docs[kind]
        labs = labels_of(doc, kind)
        new = a.new or (labs[-1] if labs else None)
        if cross_run:
            ref = refs[kind]
            rl = labels_of(ref, kind)
            base = a.ref_label or (rl[0] if rl else None)
            return (ref, base), (doc, new)
        base = a.base or (labs[0] if labs else None)
        if base == new:  # a single-label run: nothing to compare against
            return (None, base), (doc, new)
        return (doc, base), (doc, new)

    lines = []
    head_base = head_new = None
    body = []
    for suite, case, key, human, better, nd in ROWS:
        (bd, bl), (nd_doc, nl) = pick(suite)
        if not nd_doc:
            continue
        bv = (bd or {}).get("summary", {}).get(case, {}).get(bl, {}).get(key) if bd else None
        nv = nd_doc.get("summary", {}).get(case, {}).get(nl, {}).get(key)
        if bv is None and nv is None:
            continue
        head_base, head_new = head_base or bl, head_new or nl
        sp = "–"
        if bv and nv:
            sp = f"**{(bv / nv if better == 'lower' else nv / bv):.2f}x**"
        body.append(f"| {human} | {fmt(bv, nd)} | {fmt(nv, nd)} | {sp} |")
    lines.append(f"| metric (median; host clock / host CPU time) | {head_base or 'before'} | {head_new or 'after'} | speedup |")
    lines.append("|---|---:|---:|---:|")
    lines += body
    lines.append("")
    if cross_run:
        lines.append("_Before and after columns come from separate runs (not interleaved); treat small "
                     "differences as noise._\n")
    for kind in ("native", "browser"):
        d = docs[kind]
        if not d:
            continue
        m = d["meta"]
        loads = sorted(r.get("loadavg_1m", r.get("loadavg1m")) for r in d.get("records", [])
                       if r.get("loadavg_1m", r.get("loadavg1m")) is not None)
        load_note = f", median 1-min load avg {loads[len(loads) // 2]:.1f} on {m['host'].get('ncpu')} CPUs" if loads else ""
        if kind == "native":
            lines.append(f"Native: {m['host']['cpu']}, reps={m['reps']} (Alpine/CoreMark {m.get('slow_reps', m.get('alpine_reps'))}), "
                         f"run {m['date']}, suite wall {m.get('suite_wall_s', 0) / 60:.1f} min{load_note}.")
        else:
            lines.append(f"Browser: headless Chromium {m['browserVersion']}, samples={m['samples']}, "
                         f"run {m['date']}, suite wall {m.get('suiteWallS', 0) / 60:.1f} min{load_note}.")
    lines.append("")
    text = "\n".join(lines)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text + "\n")
    sys.stdout.write(text + "\n")


if __name__ == "__main__":
    main()
