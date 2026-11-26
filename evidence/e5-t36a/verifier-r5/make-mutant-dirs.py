# E5-T36a verifier round 5: one copy of web/src/sink per mutant, OUTSIDE the repository, for the
# sequences that tell a mutant from the sources (SINK_DIR=<dir> node unit-r5.mjs / fuzz-r5.mjs).
#   python3 make-mutant-dirs.py SCRATCH        -> SCRATCH/sinks/<name>/cursor-controller.js ...
import os, shutil, sys
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
out = os.path.join(sys.argv[1], 'sinks')
assert not os.path.abspath(out).startswith(repo + os.sep), 'mutants are made outside the repository'
SIZE_OLD = "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      this._hotspots.notePointer(x, y);\n"
M = {
 'V1':  ('const wasShown = this._descriptor !== null && this._descriptor.kind !== "hidden";', 'const wasShown = this._descriptor !== null;'),
 'V10': ('if (!wasShown && descriptor.kind !== "hidden") this._restartHotspotInference();', 'if (!wasShown && descriptor.kind !== "hidden" && !this._hotspotSettling) this._restartHotspotInference();'),
 'V3a': ('const acted = last !== null && last.width === now.width && last.height === now.height &&', 'const acted = last !== null && last.height === now.height &&'),
 'M1':  (SIZE_OLD, "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) { this._hotspots.notePointer(x, y); this._restartHotspotInference(); this.__m1 = true; }\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n      if (this.__m1) this.__m1 = false; else this._hotspots.notePointer(x, y);\n"),
 # The worker's own two, as written in evidence/e5-t36a/mutants.py: round 4's rule, and no start-over on an appearance.
 'C43': ('      else if (acted) this._settleHotspots();', '      else this._settleHotspots();'),
 'C53': ('      if (!wasShown && descriptor.kind !== "hidden") this._restartHotspotInference();\n', ''),
}
for name, (old, new) in M.items():
    d = os.path.join(out, name)
    shutil.rmtree(d, ignore_errors=True); shutil.copytree(os.path.join(repo, 'web/src/sink'), d)
    for ext in ('js', 'ts'):
        p = os.path.join(d, f'cursor-controller.{ext}'); s = open(p).read()
        assert s.count(old) == 1, (name, s.count(old))
        open(p, 'w').write(s.replace(old, new))
    print(name, d)
