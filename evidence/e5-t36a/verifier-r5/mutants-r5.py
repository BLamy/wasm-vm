# E5-T36a verifier round 5: my mutants of the round's hunks in cursor-controller.js, and round
# 4's four behaviour survivors, against the worker's tests. SCRATCH COPY ONLY:
#   python3 mutants-r5.py SCRATCH        (SCRATCH/web/src/sink, SCRATCH/web/tests/<three test files>)
# The runner kills the whole process group of a test run that does not end (a spinning mutant).
import subprocess, os, signal, sys
S = sys.argv[1]
C = f'{S}/web/src/sink/cursor-controller.js'
TESTS = ['tests/e5-t36-cursor-hotspot.test.mjs', 'tests/e5-t15b-cursor-sink.test.mjs', 'tests/e5-t15c-cursor-mode.test.mjs']
M = [
 ("V1 a hidden cursor, as the device reports one (update with resource 0), counts as shown", C,
  'const wasShown = this._descriptor !== null && this._descriptor.kind !== "hidden";',
  'const wasShown = this._descriptor !== null;'),
 ("V2 any update while nothing is shown starts over, a hide included", C,
  'if (!wasShown && descriptor.kind !== "hidden") this._restartHotspotInference();',
  'if (!wasShown) this._restartHotspotInference();'),
 ("V3a acted: the width of the output is not compared", C,
  'const acted = last !== null && last.width === now.width && last.height === now.height &&',
  'const acted = last !== null && last.height === now.height &&'),
 ("V3b acted: the height of the output is not compared", C,
  'const acted = last !== null && last.width === now.width && last.height === now.height &&',
  'const acted = last !== null && last.width === now.width &&'),
 ("V4 the last position sent is kept only while settling", C,
  '      this._lastPointer = now;\n',
  '      if (this._hotspotSettling) this._lastPointer = now;\n'),
 ("V5 acted: both axes must differ", C,
  '(last.x !== now.x || last.y !== now.y);',
  '(last.x !== now.x && last.y !== now.y);'),
 ("V10 an appearing cursor does not start over while the page is already settling", C,
  'if (!wasShown && descriptor.kind !== "hidden") this._restartHotspotInference();',
  'if (!wasShown && descriptor.kind !== "hidden" && !this._hotspotSettling) this._restartHotspotInference();'),
 # Round 4's survivors that were behaviour (mutants-r4.py M1, M23, M6, M17b), re-expressed on round 5's text.
 # M1 faithfully: noted before the restart INSTEAD of after (so the estimator forgets it). The rest of
 # round 5's rule is untouched: that position is still not one the guest is asked about.
 ("M1 the position that carries an output-size change is noted before the restart, not after (forgotten)", C,
  "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);\n",
  "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) { this._hotspots.notePointer(x, y); this._restartHotspotInference(); this.__m1 = true; }\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      if (this.__m1) this.__m1 = false; else this._hotspots.notePointer(x, y);\n"),
 # The worker's C52 as written (evidence/e5-t36a/mutants.py:67): the position is noted before the
 # restart AND again after it, so the history is what the sources leave.
 ("C52w the worker's C52: noted before the restart and again after it", C,
  "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);\n",
  "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) { this._hotspots.notePointer(x, y); this._restartHotspotInference(); }\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);\n"),
 ("M23 the hook ends the page's settling", C,
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);",
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._hotspotSettling = false;\n    this._setCssHot(null);"),
 ("M6 a count that went down is an idle wait", C, "      if (now > first) return true;", "      if (now !== first) return true;"),
 ("M17b a width-only change of output size does not restart", C,
  "(previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();",
  "(previous.height !== outputHeight)) this._restartHotspotInference();"),
]
only = sys.argv[2:]; killed = 0; survived = []
for name, path, old, new in M:
    if only and not any(name.startswith(o + ' ') for o in only): continue
    src = open(path).read()
    if src.count(old) != 1: print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts = path[:-3] + '.ts'; keep_ts = open(ts).read()
    open(path, 'w').write(src.replace(old, new)); open(ts, 'w').write(src.replace(old, new))
    try:
        run = subprocess.Popen(['node', '--test', '--test-timeout=120000', *TESTS], cwd=f'{S}/web', stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        try:
            out = run.communicate(timeout=120)[0]
        except subprocess.TimeoutExpired:
            os.killpg(run.pid, signal.SIGKILL); run.communicate()
            out = '✖ the test run did not end within 120 s\n'
        failed = sorted(set(l[2:].split(' (')[0] for l in out.splitlines() if l.startswith('✖ ') and 'failing tests' not in l))
        if failed: killed += 1; print(f"{name}: NOTICED by {len(failed)}: {failed[0][:90]}", flush=True)
        else: survived.append(name); print(f"{name}: SURVIVED", flush=True)
    finally:
        open(path, 'w').write(src); open(ts, 'w').write(keep_ts)
print(f"TOTAL noticed {killed}, survived {len(survived)}: {survived}")
