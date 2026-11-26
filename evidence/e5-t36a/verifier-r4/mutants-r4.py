# E5-T36a verifier (round 4): mutants of my own on the lines round 4 wrote, run against the
# worker's test file in a SCRATCH copy (never the working tree), each with a process timeout.
#   python3 mutants-r4.py SCRATCH [names...]     SCRATCH/web/src/sink + SCRATCH/web/tests/e5-t36-cursor-hotspot.test.mjs
# TEST=<path> runs another test file of the scratch copy instead (to try a promoted test).
import subprocess, sys, os
S=sys.argv.pop(1)
H=f'{S}/web/src/sink/cursor-hotspot.js'; C=f'{S}/web/src/sink/cursor-controller.js'
TEST=os.environ.get('TEST','tests/e5-t36-cursor-hotspot.test.mjs')
NOTE="      this._hotspots.notePointer(x, y);\n      // A remembered position is on its way to the guest: now it can be asked to catch up.\n      if (this._hotspotSettling) this._settleHotspots();\n      else this._armHotspotRest();"
M=[
 ("M1 the position that carries an output-size change is noted BEFORE the restart (so it is forgotten; the guest is asked all the same)", C,
  "        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();\n        this._pointerOutput = { width: outputWidth, height: outputHeight };\n      }\n",
  "        this._pointerOutput = { width: outputWidth, height: outputHeight };\n        if (previous && (previous.width !== outputWidth || previous.height !== outputHeight)) { this._hotspots.notePointer(x, y); this._restartHotspotInference(); this._settleHotspots(); return; }\n      }\n"),
 ("M2 the hook starts settling (round 3's hook)", C,
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);",
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);\n    this._hotspotSettling = true;"),
 ("M3 the guest is asked before the position is noted", C, NOTE,
  "      if (this._hotspotSettling) this._settleHotspots();\n      this._hotspots.notePointer(x, y);\n      if (!this._hotspotSettling) this._armHotspotRest();"),
 ("M4 a guest never idle within a question's two seconds is taken for caught up", C, "      if (caughtUp === true) break;", "      if (caughtUp !== null) break;"),
 ("M6 a count that changed at all (also downwards) is an idle wait", C, "      if (now > first) return true;", "      if (now !== first) return true;"),
 ("M17a an output-size change restarts only when the WIDTH changed", C, "(previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();", "(previous.width !== outputWidth)) this._restartHotspotInference();"),
 ("M17b an output-size change restarts only when the HEIGHT changed", C, "(previous.width !== outputWidth || previous.height !== outputHeight)) this._restartHotspotInference();", "(previous.height !== outputHeight)) this._restartHotspotInference();"),
 ("M18 the output size is remembered only the first time", C, "        this._pointerOutput = { width: outputWidth, height: outputHeight };\n", "        this._pointerOutput ??= { width: outputWidth, height: outputHeight };\n"),
 ("M23 the hook ends the page's settling", C,
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);",
  "    // (Nothing is known about the image shown until its plane is reported again.)\n    this._setCssHot(null);\n    this._hotspotSettling = false;"),
 ("M25 a cursor move while settling has the guest asked (no position sent since)", C,
  "      if (!this._hotspotSettling) {\n        this._inferHotspot(", "      if (this._hotspotSettling) this._settleHotspots();\n      if (!this._hotspotSettling) {\n        this._inferHotspot("),
 ("M31 starting over leaves an armed rest wait armed", C, "  _endHotspotWaits() {\n    this._cancelHotspotRest();\n", "  _endHotspotWaits() {\n"),
 ("M45 an image that is not inferred for keeps the hotspot of the one before", C, "    this._imageKey = null;\n    this._cssHot = null;\n    this._cancelHotspotRest();\n    // Only a CSS cursor", "    this._imageKey = null;\n    this._cancelHotspotRest();\n    // Only a CSS cursor"),
 ("M61 moves reach the estimator while settling; only showing the answer waits", C,
  "      if (!this._hotspotSettling) {\n        this._inferHotspot(() => this._hotspots.noteMove(\n          this._imageKey, this._descriptor.width, this._descriptor.height, state.x, state.y));\n      }",
  "      if (this._imageKey !== null) {\n        const answer = this._hotspots.noteMove(this._imageKey, this._descriptor.width, this._descriptor.height, state.x, state.y);\n        if (!this._hotspotSettling) this._inferHotspot(() => answer);\n      }"),
 ("M63 the second reading of the count is taken at once, the poll wait after it", C,
  "      if (epoch !== this._hotspotEpoch || !(await this._hotspotWait(HOTSPOT_POLL_MS))) return false;\n      const now = await count();\n      if (now === null) return null;\n      if (now > first) return true;",
  "      const now = await count();\n      if (now === null) return null;\n      if (now > first) return true;\n      if (epoch !== this._hotspotEpoch || !(await this._hotspotWait(HOTSPOT_POLL_MS))) return false;"),
 ("M64 a restart remembers the last position sent (round 3's V21)", H, "  restart() {\n    this._sent.length = 0;", "  restart() {\n    this._sent.splice(0, Math.max(0, this._sent.length - 1));"),
]
only=sys.argv[1:]; killed=0; survived=[]
for name,path,old,new in M:
    if only and not any(name.startswith(o+' ') for o in only): continue
    src=open(path).read()
    if src.count(old)!=1: print(f"{name}: PATTERN x{src.count(old)}"); continue
    ts=path[:-3]+'.ts'; keep_ts=open(ts).read()
    open(path,'w').write(src.replace(old,new)); open(ts,'w').write(src.replace(old,new))
    try:
        try:
            out=subprocess.run(['node','--test','--test-timeout=120000',TEST],cwd=f'{S}/web',capture_output=True,text=True,timeout=120).stdout
        except subprocess.TimeoutExpired:
            out='✖ the test run did not end within 120 s\n'
        failed=sorted(set(l[2:].split(' (')[0] for l in out.splitlines() if l.startswith('✖ ') and 'failing tests' not in l))
        if failed: killed+=1; print(f"{name}: KILLED by {len(failed)}: {failed[0][:90]}", flush=True)
        else: survived.append(name); print(f"{name}: SURVIVED", flush=True)
    finally:
        open(path,'w').write(src); open(ts,'w').write(keep_ts)
print(f"TOTAL killed {killed}, survived {len(survived)}: {[s.split(' ')[0] for s in survived]}")
